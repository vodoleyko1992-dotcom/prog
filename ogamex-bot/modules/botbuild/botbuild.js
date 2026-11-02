/* ogamex-bot/modules/botbuild/botbuild.js — «Бот: стройка и исследования». Owner: module agent 4.
 * Contract: specs/bot/BOT_CONTRACT.md (C1, C2, C5 botbuild, C6 botbuild events, C8); algorithm: specs/bot/BOT_DESIGN.md §8
 * (F13 production research 131-133 instead of plasma, F14 slots), TBot ideas §7 with its «Поправки проверки» (ideas only).
 *
 * What it does (only while OGX.bot.isActive('botbuild'): master on + botbuild.on; in dry-run every order is journaled, not sent):
 *   0.3.2: orders are placed on the cached view while it is trusted (page or answer page <= 10 min old, no failed order / arrival
 *      since; trustedView) — no read before every order; surplus mines above the stage target (rule mineSurplus); satellites in
 *      one order for the deficit + satAheadLevels levels of all three mines; astrophysics for expedition slots past the cap.
 *   1. Reads (wctx.act read.page, prio 'read'): page=imperium at most once per hour (bodies, levels, stock, fields, defense, research
 *      fallback: merged into the cached views). Planning runs on the CACHED views (last page read / imperium; a queue whose end
 *      passed is applied to the cached levels and marks the view stale); page=buildings of a planet is read only when it was never
 *      read, its view is older than 6 h (safety net), or right before an order on it (fresh: read <= 60 s ago and not stale; a
 *      view is stale after a queue end or an order on it); page=research once (queue) and right before a research / lab order;
 *      every read right before an order (buildings / research / shipyard) passes fresh: true past botcore's shared read cache;
 *      page=shipyard only right before a 15 / 21 / units / dome order there (the step is affordable; a waiting step plans on the
 *      cached shipyard queue; a failed read waits 10 min);
 *      page=resources when an energy deficit needs the per-satellite output (production row of 212 / count).
 *   2. Plans (pure, OGX.botBuild._lib.plan): candidates per §8.2, payback per §8.3 = cost(MSU by policy vC/vD) / Δproduction (MSU/h,
 *      calc.production x22000 incl. officers and 131-133) x weight; forced TBot rules first (energy deficit -> satellites
 *      ceil(deficit / per-satellite), exactly 1 free field -> terraformer, resource at cap -> its storage, storage < storageHours of
 *      production -> storage, 108 for expedition slots), then payback ascending. The first step of each candidate passes the queue rules
 *      (2Moons ShowBuildingsPage/ShowResearchPage/ShowShipyardPage: no 31 during research, no research while 6/31 queued on the lab
 *      planet, no 15/21 while the shipyard works, no units while 15/21 are queued, fields incl. queue), storage-first (price > capacity,
 *      overflow while waiting), infrastructure (rho_R robots/nanite, rho_L lab/University, IRN) and par_tol for another queue.
 *      Only paid items: an order is placed only into an EMPTY queue (upstream charges a queued item only when it starts, A7).
 *   3. Acts: build.building / build.research / build.units, one per queue per run, each after a wctx.decide; verification by the
 *      executor (C3.3); a failed verification counts per item, after maxRetries the item cools down for 30 min.
 *   4. Waits: publishes per waiting planet ONE chain need (OGX.bot.needs 'botbuild': the planet's steps for the next needAheadMin
 *      minutes, capped by its storage; none while a delivery flies there, the waiting steps are then reserved) and per planet a 'keep'
 *      entry (its own chain, never shipped away by logistics) — BOT_DESIGN §8.8,
 *      wakes 1-2 s after min(time to afford (at most 5 min: re-plan), queue ends (known or estimated), first incoming own
 *      transport, first expedition return + 1-2 min).
 * Game speed (§8.5): solved from the queue time read after an own order, stored as botbuild.gameSpeed; until then the speed
 * measured on Aeternum (build h = (M + C) / (7.6e6 x (1 + robots) x 2^nanites) = x3040 of the 2Moons formula) is used, so
 * queue ends without a timer are estimated and the wake follows them.
 * Journal kinds 'botbuild:<event>' (C6). Code comments English, user-visible text Russian. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const NAME = 'botbuild';
  const SEC = 'Бот: стройка';
  const RES = ['metal', 'crystal', 'deuterium'];
  const MIN = 60000;
  const HOUR = 3600000;
  // Aeternum build speed measured 2026-11-01: build h = (M + C) / (7.6e6 x (1 + robots) x 2^nanites); 2Moons divides by 2500 x speed
  const SEED_SPEED = 7.6e6 / 2500;
  const WAIT_WAKE_MAX = 5 * MIN;     // «ждёт ресурсы»: re-plan at the latest after this
  const VIEW_MAX_AGE = 6 * HOUR;     // safety net: a cached planet view older than this is re-read even without an order
  const FRESH_MS = 60000;            // a view read this recently counts as fresh (tests / panel)
  // 0.3.2: an order is placed on the CACHED view (the answer page of every own order is the next fresh view) when the view came
  // from a page or an answer at most TRUST_MS ago and no order on it failed since; otherwise the page is read first. A wrong
  // guess costs one refused POST (2Moons charges nothing), a read before every order cost one GET per order (log 2026-11-01).
  const TRUST_MS = 10 * MIN;
  // a busy queue whose content / end could not be read is read again after this (was 15 min: on Aeternum a level takes seconds,
  // and before the 0.3.2 parser fix every GALAXYZ queue read as unknown — the log of 2026-11-02 had 17-30 min idle gaps)
  const UNKNOWN_Q_MS = 60000;
  const EXPORTER_STICKY_MS = 24 * 3600000;   // a planet that showed 217 within this window still ships (its 217 may be out)
  const IMPERIUM_EVERY = 60 * MIN;
  const RESOURCES_EVERY = 60 * MIN;
  const COOLDOWN_MS = 30 * MIN;      // after maxRetries failed verifications of one item [SPEC §7]
  const MAX_SHIP_QUEUE = 5;           // GALAXYZ: «Максимальное количество построек в очереди 5»
  const MAX_BUILD_QUEUE = 5;
  const YARD_RETRY_MS = 10 * MIN;    // a shipyard / defense page that could not be read is not asked again before this         // max_elements_ships [UPSTREAM install.sql:250]
  const SAT = 212;
  const MINE_RES = { 1: 'metal', 2: 'crystal', 3: 'deuterium' };
  const STORE_OF = { metal: 22, crystal: 23, deuterium: 24 };
  const PROD_RESEARCH = { 131: 'metal', 132: 'crystal', 133: 'deuterium' };
  // forced rules before the payback order (payback = 99); tactic rules (policy 'tactic') in John's order
  const RULE_RANK = { energy: 0, fields: 1, storageFull: 2, storageNeed: 2.5, storageHours: 3, wants: 3.5, foundation: 4, lab: 5, nanitesLate: 6, expoSlots: 7, unlock: 8, research: 9, defense: 10, mine: 11, mineSurplus: 12, storageLate: 100 };   // storageLate after the payback order (99) too

  /* John's build-up tactic: the rules of /mnt/project-files/ogamex-strategy/galaxyz/planet_buildup_rules.json (schema
   * ogamex-galaxyz-buildup/2, computed 2026-10-31, simulator buildup_sim.py next to it), copied here as data at build time — never
   * read at runtime. John's overrides beat the file where they differ: lab >= 22 on every planet (a minimum), shipyard 14, storages
   * «авто» (2026-11-01: mines first; a store out of turn only when full, below 1.1 x the next mine price, or below max(3 h, sleep
   * length) of production AND not dearer than the cheapest next mine), robots 10, nanites 10, energy by satellites only, the lowest mine across all planets
   * (colonies first), stages colonies -> main (45) -> 50 -> 55 -> 60 -> 65, research = the shortest of 131-133 and astrophysics
   * (astrophysics first until the planet cap), lab network (123) = planets with lab 22 minus 1, the 217 unlock (shipyard 14,
   * 110 >= 14, 111 >= 10, 114 >= 10, 117 >= 15) and 219 for debris first among research. Unverified in the file: the planet cap
   * (3 + astro/2) — the real [x / y] of the planet list is used; the trader (100 DM) — never used automatically, so the mine ranks
   * are the no-trader ones. */
  const BUILDUP = {
    schema: 'ogamex-galaxyz-buildup/2', computed: '2026-10-31',
    summaryRu: 'Ресурсы — узкое место, стройка идёт секунды. Всегда качаем самую низкую шахту среди всех планет (колонии сначала). ' +
      'Каждая планета: роботы 10, наниты 10, верфь 14, лаборатория 22, хранилища авто (3 ч добычи или длина сна, и не меньше цены следующей шахты; шахты важнее), энергия спутниками. Этапы: догнать колонии до главной (45) → ' +
      'все 50 → 55 → 60 → 65. Исследования: сначала то, что открывает «Улучшенный транспорт» (217) и «Мега переработчик» (219), ' +
      'затем астрофизика до лимита планет и самое короткое из техов добычи; сеть лабораторий = планет с лаб. 22 минус 1.',
    foundation: [{ id: 14, level: 10 }, { id: 15, level: 10 }, { id: 21, level: 14, setting: 'shipyardTarget' }],
    labTarget: 22, shipyardTarget: 14, storageHours: 0, storageAutoH: 3,
    labFromStage: 2,                        // lab to target once the planet met its stage mine targets, or from S2 on
    nanitesLateMin: 60,                     // nanites +1 when the next mine takes longer (needs the game speed)
    mineRankOffset: { 1: 0, 2: 5, 3: 11 },  // rank = level + offset (no trader; with the trader the file uses 0 / 0 / 4)
    research: { pool: [132, 131, 133], astro: 124, irn: 123, irnDiv: 2, unlock: [217, 219] },
    stages: [
      { id: 'S0', name: 'Фундамент новой/отстающей планеты', perPlanet: true, eta: 'минуты после колонизации' },
      { id: 'S1', name: 'Догнать колонии до главной', mines: { 1: 45, 2: 45, 3: 41 }, stores: { 22: 23, 23: 23, 24: 21 }, research: { 132: 15, 131: 18, 133: 18 }, eta: '~6 ч работы бота' },
      { id: 'S2', name: 'Все планеты 50', mines: { 1: 50, 2: 50, 3: 46 }, stores: { 22: 24, 23: 24, 24: 22 }, research: { 131: 20, 132: 20, 133: 20 }, other: { 31: 22 }, eta: '~1-й день' },
      { id: 'S3', name: 'Все планеты 55', mines: { 1: 55, 2: 55, 3: 51 }, stores: { 22: 25, 23: 24, 24: 23 }, research: { 131: 23, 132: 23, 133: 23 }, eta: '~3-й день' },
      { id: 'S4', name: 'Все планеты 60', mines: { 1: 60, 2: 60, 3: 56 }, stores: { 22: 26, 23: 25, 24: 24 }, research: { 131: 25, 132: 25, 133: 25 }, eta: '~7–14-й день' },
      { id: 'S5', name: '65 и дальше', mines: { 1: 65, 2: 65, 3: 61 }, stores: { 22: 27, 23: 26, 24: 25 }, research: { 131: 27, 132: 27, 133: 27 }, eta: '~3–5 недель (оценка)' },
    ],
    stageStep: 5,                           // after S5: +5 per stage
    // planet count [x / y] not parsable: the json's (unverified) cap 3 + astro / 2, at most 14 planets -> astrophysics 22 is enough
    planetCapFallback: { base: 3, perAstro: 0.5, max: 14 },
    colonizationRu: 'Свободный слот планеты: своя система 2:68 позиции 10–12, затем соседние системы 4–12 (не 1–3 и 13–15). Колонизирует модуль экспедиций или вы сами.',
  };

  /* Strategy-plan policy parameters, copied at build time (2026-10-31) from
   * /mnt/project-files/ogamex-strategy/ogamex_strategy_plan.json -> strategies.<name>.policy.params (schema ogamex-strategy-plan/1).
   * They were fitted by the plan's author for lanedirt OgameX at speed 1 (plasma, crawlers, classes, Pathfinder, Astrophysics).
   * On GALAXYZ/2Moons: w_plasma weights the production research 131/132/133 (plasma 122 gives nothing, F13); w_crawl is unused
   * (no crawlers); w_col values a new planet via 124 (planets at odd levels); w_exp has no expedition value estimate here (unused);
   * kappa belongs to botexpo. Never read the plan file at runtime. */
  const POLICIES = {
    col_mine90: { vC: 3.6564, vD: 4.4077, wM: 1.5716, wC: 1.2823, wD: 2.2721, w_plasma: 3.3939, w_col: 0.4414, beta_col: 0.3546, w_crawl: 2.8071,
      w_exp: 0.6028, kappa: 0.3525, rho_R: 0.4357, rho_L: 0.1714, psi: 0.1344, par_tol: 0.0133, w_sat: 0.6394, w_fus: 1.0817, col_pattern: 0, overflow: 0, irn: 1 },
    dis_exp90: { vC: 4.5891, vD: 6.3264, wM: 0.7307, wC: 0.9666, wD: 1.5173, w_plasma: 1.3386, w_col: 0.4748, beta_col: 0.6312, w_crawl: 0.5105,
      w_exp: 1.4857, kappa: 1.7746, rho_R: 0.989, rho_L: 0.951, psi: 1.1909, par_tol: 0.0, w_sat: 3.0, w_fus: 1.4862, col_pattern: 0, overflow: 1, irn: 0 },
  };

  const SETTINGS = {
    on: { type: 'bool', default: true, label: 'Стройка и исследования включены', section: SEC },
    policy: { type: 'enum', default: 'tactic', label: 'Стратегия развития',
      options: [{ value: 'tactic', label: 'Тактика застройки: этапы S0–S5 (основная)' }, { value: 'col_mine90', label: 'Только шахты по окупаемости (col_mine90)' },
        { value: 'dis_exp90', label: 'С экспедициями по окупаемости (dis_exp90)' }, { value: 'custom', label: 'Свои параметры (JSON ниже)' }], section: SEC },
    policyJson: { type: 'json', default: {}, label: 'Свои параметры стратегии (JSON, для «Свои параметры»)', section: SEC },
    buildings: { type: 'bool', default: true, label: 'Строить здания', section: SEC },
    research: { type: 'bool', default: true, label: 'Исследовать технологии', section: SEC },
    energy: { type: 'bool', default: true, label: 'Чинить энергию (спутники, солнечная, термояд)', section: SEC },
    storageHours: { type: 'float', default: 0, min: 0, max: 168, step: 0.5, label: 'Хранилище на (ч добычи; 0 = авто: 3 ч или длина ночного сна; шахты важнее)', section: SEC },
    labTarget: { type: 'int', default: 22, min: 22, max: 40, label: 'Лаборатория на каждой планете до уровня (не меньше 22)', section: SEC },
    shipyardTarget: { type: 'int', default: 14, min: 14, max: 30, label: 'Верфь на каждой планете до уровня (не меньше 14)', section: SEC },
    fieldsReserve: { type: 'int', default: 1, min: 0, max: 20, label: 'Свободных полей держать под терраформер', section: SEC },
    maxRetries: { type: 'int', default: 3, min: 1, max: 20, label: 'Повторов неподтверждённой постройки до паузы 30 мин', section: SEC },
    ensureExpoSlots: { type: 'bool', default: true, label: 'Компьютерная технология, если слотов флота меньше экспедиций + 1', section: SEC },
    university: { type: 'bool', default: true, label: 'Строить университет (−8 % времени исследований за уровень)', section: SEC },
    randomOrder: { type: 'bool', default: true, label: 'Случайный порядок планет', section: SEC },
    moons: { type: 'bool', default: true, label: 'Строить на лунах (лунная база на последнем поле)', section: SEC },
    defense: { type: 'bool', default: true, label: 'Ставить купола (малый и большой щит)', section: SEC },
    queueDepth: { type: 'int', default: 5, min: 1, max: 5, label: 'Построек в очереди планеты сразу (1 = ставить по одной; дальше — только если склад планеты оплачивает все)', section: SEC },
    satAheadLevels: { type: 'int', default: 10, min: 1, max: 30, label: 'Спутники одним заказом: энергия на столько уровней всех трёх шахт вперёд (если склад планеты оплачивает)', section: SEC },
    satBatchMaxMin: { type: 'int', default: 30, min: 0, max: 600, label: 'Партия спутников не дольше (мин работы верфи; на Aeternum 1 с/шт. → до 1800 за заказ; 0 = без ограничения)', section: SEC },
    surplusMines: { type: 'bool', default: true, label: 'Шахты выше цели этапа из своих излишков (планета не простаивает, пока колонии догоняют)', section: SEC },
    needAheadMin: { type: 'int', default: 45, min: 0, max: 1440, label: 'Довоз под стройку: на сколько минут стройки вперёд (цепочка шагов одним рейсом; 0 = только текущий шаг)', section: SEC },
  };

  // ------------------------------------------------------------------ small helpers (pure)
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const num = (v, d = 0) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? d : +v);
  const res0 = () => ({ metal: 0, crystal: 0, deuterium: 0 });
  /** Fields a body really uses: 2Moons field_current = Σ building levels (every level one field; checked on all 11 Aeternum planets
   *  2026-11-01). The planet-list tooltip (GALAXYZ) is rendered from the planet rows read BEFORE the page's queue update, so right
   *  after an own order that finished within seconds it shows one field too few: the bot then took the field reserved for the
   *  terraformer and the planet ended at 189/189 (log 2026-11-01 21:19). Planning uses max(tooltip / imperium, Σ levels). */
  const levelFields = (levels) => Object.entries(levels || {}).reduce((s, [id, l]) => (+id > 0 && +id < 100 && num(l) > 0 ? s + num(l) : s), 0);
  function syncFields(v) {
    if (!v || !v.levels || v.fieldsSynced) return 0;   // a planning copy with queued levels: synced on the real view (appendViews)
    const byLv = levelFields(v.levels);
    if (byLv > num(v.fieldsUsed)) { v.fieldsTip = v.fieldsUsed === undefined ? null : v.fieldsUsed; v.fieldsUsed = byLv; return byLv - num(v.fieldsTip); }
    return 0;
  }
  const fmtN = (n) => { try { return OGX.fmt.short(n); } catch (e) { return String(Math.round(n)); } };
  const fmtT = (ms) => { try { return OGX.fmt.time(ms); } catch (e) { return '—'; } };
  const fmtH = (h) => (!Number.isFinite(h) ? '∞' : h < 1 ? Math.round(h * 60) + ' мин' : String(Math.round(h * 10) / 10).replace('.', ',') + ' ч');
  const POLICY_RU = { tactic: 'тактика застройки S0–S5', col_mine90: 'только шахты', dis_exp90: 'с экспедициями', custom: 'свои параметры' };
  const PAGE_RU = { buildings: 'постройки', research: 'исследования', shipyard: 'верфь', defense: 'оборона', fleet: 'флот', resources: 'сырьё', imperium: 'империю', overview: 'обзор' };
  /** '[g:s:p]' (or '[g:s:p] луна') of a body id from the module's views or the core state; the id only when unknown. */
  function bodyRu(bodyId) {
    const v = (M.views && M.views[bodyId]) || (M.bodies || []).find((x) => +x.id === +bodyId) || null;
    return v && v.coords ? '[' + v.coords + ']' + (v.isMoon ? ' луна' : '') : 'тело ' + bodyId;
  }
  const name = (id) => { try { return OGX.catalog.name(+id) || ('#' + id); } catch (e) { return '#' + id; } };
  const cat = (id) => { try { return OGX.catalog.get(+id); } catch (e) { return null; } };
  const isResearchId = (id) => { const o = cat(id); return !!o && o.type === 'research'; };
  function errText(e) { return e && e.message ? e.message : String(e); }
  function msuOf(res, P) { return num(res && res.metal) + num(res && res.crystal) * P.vC + num(res && res.deuterium) * P.vD; }
  function addRes(a, b, k = 1) { const o = Object.assign(res0(), a || {}); for (const r of RES) o[r] = num(o[r]) + k * num(b && b[r]); return o; }
  function costOf(id, level) { const c = OGX.calc.cost(+id, level); return { metal: c.metal, crystal: c.crystal, deuterium: c.deuterium, energy: c.energy || 0 }; }
  function costRange(id, from, to) { let c = res0(); for (let l = from + 1; l <= to; l++) c = addRes(c, OGX.calc.cost(+id, l)); return c; }
  function shuffle(a, rnd) { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }

  /** Policy params: an embedded set, 'tactic' (John's build-up rules; col_mine90 prices for MSU/par_tol, no overflow, no rho/IRN
   *  payback rules — the tactic sets those targets itself), or 'custom' = policyJson (its `params` or the object itself) on top of col_mine90. */
  function policyParams(policy, json) {
    if (policy === 'tactic') return { name: 'tactic', params: Object.assign({}, POLICIES.col_mine90, { tactic: 1, overflow: 0, irn: 0 }), warnings: [] };
    if (policy !== 'custom') return { name: POLICIES[policy] ? policy : 'col_mine90', params: Object.assign({}, POLICIES[POLICIES[policy] ? policy : 'col_mine90']), warnings: [] };
    const src = json && typeof json === 'object' ? (json.params && typeof json.params === 'object' ? json.params : json) : {};
    const params = Object.assign({}, POLICIES.col_mine90);
    const warnings = [];
    for (const [k, v] of Object.entries(src)) {
      if (!(k in params)) { warnings.push('неизвестный параметр ' + k); continue; }
      if (!Number.isFinite(+v)) { warnings.push('не число: ' + k); continue; }
      params[k] = +v;
    }
    return { name: 'custom', params, warnings };
  }

  // ------------------------------------------------------------------ production model (calc.production, 2Moons grid)
  // Gains assume a body with enough energy: one producer level map plus a huge satellite count at 100 % (prodLevel = 1).
  function prodOf(levels, view, research, factors) {
    const percents = Object.assign({}, (view && view.percents) || {}, { [SAT]: 100 });
    return OGX.calc.production({ levels, percents, ships: { [SAT]: 1e9 }, tempMax: num(view && view.tempMax, 0), research: research || {}, factors: factors || OGX.calc.factors({}) });
  }
  /** Next level of mine id on a view: per-hour gain of its resource (x22000, officers, 131-133) and the extra energy use. */
  function mineGain(id, view, research, factors) {
    const L = num(view.levels[id]);
    const r = MINE_RES[id];
    const a = prodOf({ [id]: L }, view, research, factors);
    const b = prodOf({ [id]: L + 1 }, view, research, factors);
    return { res: r, gain: b.perHour[r] - a.perHour[r], dCons: b.energy.consumption - a.energy.consumption, level: L + 1 };
  }
  /** Energy produced by `levels` of solar (4) / fusion (12) with the Energy factor (and 113 for fusion). */
  function energyOf(id, level, view, research, factors) {
    if (!level) return 0;
    const percents = Object.assign({}, (view && view.percents) || {});
    return OGX.calc.production({ levels: { [id]: level }, percents, tempMax: num(view.tempMax), research: research || {}, factors }).energy.production;
  }
  /** Energy of one satellite: the page=resources row (production of 212 / count) when read, else (Tmax + 160) / 6 x (1 + Energy). */
  function perSat(view, factors) {
    if (view.perSat && view.perSat.value > 0) return { value: view.perSat.value, src: 'page' };
    return { value: (num(view.tempMax) + 160) / 6 * (1 + num(factors && factors.Energy)), src: 'formula' };
  }
  /** Planet production in MSU per hour (ticker values). */
  function prodMsu(view, P) { let s = 0; for (const r of RES) s += Math.max(0, num(view.res && view.res[r] && view.res[r].perHour)) * (r === 'metal' ? 1 : r === 'crystal' ? P.vC : P.vD); return s; }
  /** Satellites still in the planet's shipyard queue (cached page / answer page / own order): their energy is pending. */
  const queuedSats = (view) => ((view && view.shipyard && view.shipyard.items) || []).filter((x) => +x.id === SAT).reduce((s, x) => s + num(x.count), 0);
  function energyBalance(view, factors) {
    if (!view.energy) return null;
    const ps = perSat(view, factors).value;
    return num(view.energy.production) - num(view.energy.consumption) + queuedSats(view) * ps;
  }

  // ------------------------------------------------------------------ requirements
  /** Missing requirement levels of (id) in build order (deepest first). Building requirements are checked on `body` (the planet
   *  where the order is placed: for research the lab planet), research requirements player-wide [UPSTREAM isTechnologieAccessible]. */
  function reqSteps(id, body, research, { limit = 60 } = {}) {
    const steps = [];
    const lv = { body: Object.assign({}, body.levels || {}), research: Object.assign({}, research || {}) };
    let bad = false;
    const visit = (x, depth) => {
      if (depth > 12 || bad) { bad = true; return; }
      const o = cat(x);
      for (const [rid, rl] of (o && o.req) || []) {
        const isR = isResearchId(rid);
        const map = isR ? lv.research : lv.body;
        for (let l = num(map[rid]) + 1; l <= rl; l++) {
          visit(rid, depth + 1);
          if (bad) return;
          steps.push({ id: +rid, level: l, kind: isR ? 'research' : 'building' });
          map[rid] = l;
          if (steps.length > limit) { bad = true; return; }
        }
      }
    };
    visit(+id, 0);
    return bad ? null : steps;
  }
  function reqsMet(id, body, research) { const s = reqSteps(id, body, research); return !!s && s.length === 0; }

  // ------------------------------------------------------------------ queue parsing (core OGX.parse.gz.queueBox items)
  /** Building / research queue of a list page from the core parser (box markup with content is [UPSTREAM]): head end = read time +
   *  rest seconds, later rows from their span.timer end times. Unknown content -> { known: false, busy: true }. */
  function parseQueue(doc, readAt) {
    let box = null;
    try { box = OGX.parse.gz.queueBox(doc); } catch (e) { box = null; }
    if (!box) return { known: false, busy: null, items: [], end: null };
    if (box.empty) return { known: true, busy: false, items: [], end: null };
    const raw = Array.isArray(box.items) ? box.items : [];
    if (!raw.length) return { known: false, busy: true, items: [], end: null };
    const plausible = (u) => Number.isFinite(u) && Math.abs(u * 1000 - readAt) < 90 * 86400000;
    const items = raw.map((x, i) => {
      const it = { id: x.id, level: x.level, end: null };
      if (i === 0 && Number.isFinite(x.restSec)) { it.end = readAt + x.restSec * 1000; it.rest = x.restSec; }
      else if (plausible(x.endUnix)) it.end = x.endUnix * 1000;
      return it;
    });
    const last = items[items.length - 1].end || items[0].end || null;
    return { known: true, busy: true, items, end: last };
  }

  // ------------------------------------------------------------------ build-up tactic (pure)
  /** Storage hours: the setting when > 0, else auto = 3 h of production, or the night sleep length when the sleep is on
   *  (the bot spends the stock while it runs; the store only bridges a pause). John 2026-11-01. */
  function storageHoursOf(cfg) {
    const h = num(cfg && cfg.storageHours, 0);
    if (h > 0) return h;
    let sleepH = num(cfg && cfg.sleepHours, NaN);
    if (!(sleepH >= 0)) {
      sleepH = 0;
      try {
        if (OGX.settings.get('botcore.sleepOn')) {
          const hm = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? +m[1] + +m[2] / 60 : null; };
          const a = hm(OGX.settings.get('botcore.sleepFrom')); const b = hm(OGX.settings.get('botcore.sleepTo'));
          if (a !== null && b !== null) sleepH = (b - a + 24) % 24;
        }
      } catch (e) { /* no settings in pure tests */ }
    }
    return Math.max(BUILDUP.storageAutoH, Math.ceil(sleepH * 2) / 2);
  }
  /** Mines that still get a next level: all three, or (tactic) those below the stage targets `mines`. */
  const nextMines = (levels, mines) => [1, 2, 3].filter((id) => !mines || num(levels && levels[id]) < num(mines[id]));
  /** Highest next-level price of the (still planned) mines in resource r: a store below it can never pay that mine. */
  function nextMineNeed(levels, r, mines) {
    let m = 0;
    for (const id of nextMines(levels, mines)) m = Math.max(m, num(costOf(id, num(levels && levels[id]) + 1)[r]));
    return m;
  }
  /** Cheapest next mine level (M + C + D) on the planet; Infinity when no mine is planned any more. */
  function nextMineMinSum(levels, mines) {
    let m = Infinity;
    for (const id of nextMines(levels, mines)) { const c = costOf(id, num(levels && levels[id]) + 1); m = Math.min(m, num(c.metal) + num(c.crystal) + num(c.deuterium)); }
    return m;
  }
  /** Targets from the settings; never below John's minimums (lab 22, shipyard 14). */
  function tacticCfg(cfg) {
    return {
      labTarget: Math.max(BUILDUP.labTarget, num(cfg && cfg.labTarget, BUILDUP.labTarget)),
      shipyardTarget: Math.max(BUILDUP.shipyardTarget, num(cfg && cfg.shipyardTarget, BUILDUP.shipyardTarget)),
      storageHours: storageHoursOf(cfg),
    };
  }
  /** Stage i (1 = S1, ...): S1..S5 of the rules, after S5 +5 levels per stage. */
  function stageAt(i) {
    const S = BUILDUP.stages;
    if (i < S.length) return Object.assign({ idx: i }, S[i]);
    const last = S[S.length - 1];
    const k = i - (S.length - 1);
    const add = (o) => Object.fromEntries(Object.entries(o).map(([id, l]) => [id, l + k * BUILDUP.stageStep]));
    const mines = add(last.mines);
    return { idx: i, id: 'S' + i, name: `Все планеты ${mines[1]}`, mines, stores: add(last.stores), research: add(last.research), eta: 'дальше +5 уровней за этап' };
  }
  const meetsMines = (v, mines) => [1, 2, 3].every((id) => num(v.levels && v.levels[id]) >= num(mines[id]));
  const foundationLevel = (f, tc) => (f.setting ? tc[f.setting] : f.level);
  const foundationDone = (v, tc) => BUILDUP.foundation.every((f) => num(v.levels && v.levels[f.id]) >= foundationLevel(f, tc));
  /** Empire stage: the first stage whose mine targets some planet has not met yet (moons are not passed in). */
  function empireStage(planets) {
    for (let i = 1; i < 60; i++) { const st = stageAt(i); if (!planets.length || planets.some((v) => !meetsMines(v, st.mines))) return st; }
    return stageAt(60);
  }
  /** Ordered building targets of one planet: foundation (robots 10, nanites 10, shipyard 14), then the lab (from S2 on, or once
   *  the planet met its stage mine targets). */
  function planetTargets(v, stage, tc) {
    const out = BUILDUP.foundation.map((f) => ({ id: f.id, level: foundationLevel(f, tc), rule: 'foundation' }));
    if (stage.idx >= BUILDUP.labFromStage || meetsMines(v, stage.mines)) out.push({ id: 31, level: tc.labTarget, rule: 'lab' });
    return out;
  }
  const mineRank = (id, level) => num(level) + BUILDUP.mineRankOffset[id];
  /** Main planet: the highest mine sum (ties: the highest lab). */
  function mainOf(planets) {
    let best = null; let bs = -1;
    for (const v of planets) {
      const s = num(v.levels[1]) + num(v.levels[2]) + num(v.levels[3]) + num(v.levels[31]) / 1000;
      if (s > bs) { bs = s; best = v; }
    }
    return best;
  }
  /** Lab planet (research is started there, its stock pays, its need / claim carry the research): the highest lab level, ties by
   *  the lowest body id — never by the (shuffled) iteration order (audit 2026-11-02: with five planets at lab 22 the payer, the
   *  research need's bodyKey and the mineSurplus claim moved to another planet on every run). */
  function labPlanetOf(list) {
    let lab = null;
    for (const v of list || []) {
      if (!v || v.isMoon || !v.levels) continue;
      if (!lab || num(v.levels[31]) > num(lab.levels[31]) || (num(v.levels[31]) === num(lab.levels[31]) && +v.id < +lab.id)) lab = v;
    }
    return lab;
  }
  /** Planet cap reached: astrophysics is >= 2 levels above a level that already showed the same planet maximum (y of [x / y];
   *  2Moons adds a planet every 2 levels until the server cap). seen = { astroLevel: y }. */
  function astroCappedOf(seen, astro, max) {
    if (!(num(max) > 0)) return num(astro) >= astroFallbackCap();   // count unknown: the json's planet cap, never astrophysics forever
    if (!seen) return false;
    return Object.entries(seen).some(([a, y]) => +a <= num(astro) - 2 && num(y) >= num(max));
  }
  /** Astrophysics level that reaches the json's planet cap (3 + astro / 2, max 14) when the real [x / y] is unknown. */
  function astroFallbackCap() { const f = BUILDUP.planetCapFallback; return Math.ceil((f.max - f.base) / f.perAstro); }
  /** Planet cap reached for a plan input: the caller's astroCapped, or (count [x / y] unknown) the json fallback at `astro`. */
  function capReached(input, astro) {
    if (input && input.astroCapped) return true;
    const pl = input && input.planets;
    return !(pl && num(pl.max) > 0) && astroCappedOf(null, astro, 0);
  }
  function tacticContext(planets, cfg) {
    const tc = tacticCfg(cfg);
    return { tc, stage: empireStage(planets), main: mainOf(planets),
      irnTarget: Math.max(0, planets.filter((v) => num(v.levels[31]) >= tc.labTarget).length - 1) };
  }
  /** Astrophysics past the planet cap while botexpo runs (expedition slots = floor(sqrt(124))): a level pays only when it adds a
   *  slot, so the price of the NEXT SLOT (every level up to the next perfect square) competes with the production techs ABOVE the
   *  stage targets (tier 3, cheapest first); tier 2 (with the techs the stage still needs) only when the very next level adds a
   *  slot and costs no more than a research step the stage needs anyway. Audit 2026-11-02 (botbuild-1): tier 2 by level price
   *  kept astrophysics in the single research slot for good (1.75^L is cheaper per level than the 2^L techs) — levels of days,
   *  L >= 34 unaffordable, while 131-133 above the targets never came. */
  function expoAstro(research, ctx) {
    const R = BUILDUP.research;
    const rt = ctx.stage.research || {};
    const mc = (id, L) => { const c = costOf(id, L); return c.metal + c.crystal; };
    const L = num(research[R.astro]);
    const slots = Math.floor(Math.sqrt(L));
    const nextSlot = (slots + 1) * (slots + 1);
    const slotNow = L + 1 === nextSlot;
    let path = 0;
    for (let l = L + 1; l <= nextSlot; l++) path += mc(R.astro, l);
    let stageMax = 0;   // the dearest production research level the stage still needs (0: none below target)
    for (const id of R.pool) if (num(research[id]) < num(rt[id])) stageMax = Math.max(stageMax, mc(id, num(rt[id])));
    const tier = slotNow && stageMax > 0 && path <= stageMax ? 2 : 3;
    const why = slotNow
      ? `астрофизика ${L + 1}: даёт слот экспедиций (${slots} → ${slots + 1})` + (tier === 2 ? `, не дороже техов этапа ${ctx.stage.id}` : stageMax > 0 ? `, но дороже техов этапа ${ctx.stage.id} — после них` : ', наравне с техами добычи выше цели')
      : `астрофизика: слоты экспедиций — следующий слот на уровне ${nextSlot} (ещё ${nextSlot - L} ур., ${fmtN(path)} М+К), после техов добычи этапа`;
    return { id: R.astro, level: L + 1, sub: [tier, path], why, astro: { level: L, slots, nextSlot, slotNow, pathCost: Math.round(path), stageMax: Math.round(stageMax), tier } };
  }
  /** Research order of the tactic: 217 then 219 unlock chains, astrophysics while the planet cap is not reached, then 131-133 below
   *  the stage targets and the lab network (123, time / 2), shortest (metal + crystal of the next level) first, then the rest
   *  (with expeditions on: astrophysics for the next expedition slot among them, expoAstro). */
  function researchOrder(research, ctx, astroCapped, expoOn) {
    const out = [];
    const R = BUILDUP.research;
    const rt = ctx.stage.research || {};
    const mc = (id, L) => { const c = costOf(id, L); return c.metal + c.crystal; };
    if (!astroCapped) out.push({ id: R.astro, level: num(research[R.astro]) + 1, sub: [1, 0], why: 'астрофизика первой до лимита планет' });
    else if (expoOn) out.push(expoAstro(research, ctx));
    for (const id of R.pool) {
      const L = num(research[id]);
      const below = L < num(rt[id]);
      out.push({ id, level: L + 1, sub: [below ? 2 : 3, mc(id, L + 1)], why: below ? `до цели этапа ${ctx.stage.id}: ${rt[id]}` : 'самое короткое из техов добычи' });
    }
    const L123 = num(research[R.irn]);
    if (L123 < ctx.irnTarget) out.push({ id: R.irn, level: L123 + 1, sub: [2, mc(R.irn, L123 + 1) / R.irnDiv], why: `сеть лабораторий: цель ${ctx.irnTarget} (планет с лаб. ${ctx.tc.labTarget} минус 1)` });
    return out.sort((a, b) => a.sub[0] - b.sub[0] || a.sub[1] - b.sub[1]);
  }
  /** Missing research (and lab levels for it) of a ship, the shipyard level itself not counted (that is a planet target). */
  function unlockSteps(shipId, lab, research) {
    if (!lab) return null;
    return reqSteps(shipId, { id: lab.id, levels: Object.assign({}, lab.levels, { 21: 99 }) }, research);
  }
  const subCmp = (a, b) => {
    if (!a || !b) return 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = num(a[i]) - num(b[i]); if (d) return d; }
    return 0;
  };

  // ------------------------------------------------------------------ planner (pure)
  /** Stock of a view at `at` (2Moons ExecCalc projection) minus other modules' reservations, the botcore deuterium reserve and
   *  what this plan already spent on that planet. */
  function availOf(view, at, extra = {}) {
    const out = res0();
    for (const r of RES) {
      const x = view.res && view.res[r];
      out[r] = x ? Math.floor(OGX.calc.amountAt({ amount: x.amount, storage: x.storage, perHour: x.perHour, t: view.t }, at)) : 0;
      out[r] -= num(extra.reserved && extra.reserved[r]) + num(extra.spent && extra.spent[r]);
    }
    out.deuterium -= num(extra.deutReserve);
    return out;
  }
  function affordable(cost, avail) { return RES.every((r) => num(cost[r]) <= num(avail[r])); }
  /** Seconds until `cost` is affordable on the view (Infinity: no production or price above the storage). */
  function waitSec(cost, view, avail) {
    let t = 0;
    for (const r of RES) {
      const need = num(cost[r]) - num(avail[r]);
      if (need <= 0) continue;
      const x = view.res && view.res[r];
      if (!x || !(num(x.perHour) > 0)) return Infinity;
      if (Number.isFinite(+x.storage) && +x.storage > 0 && num(cost[r]) > +x.storage) return Infinity;
      t = Math.max(t, need / (x.perHour / 3600));
    }
    return t;
  }
  function missingOf(cost, avail) { const o = res0(); for (const r of RES) o[r] = Math.max(0, Math.ceil(num(cost[r]) - num(avail[r]))); return o; }

  /**
   * Queue depth > 1 (2Moons takes up to 5 buildings per planet; a queued item is paid only when it starts): a planet whose queue
   * is busy but has room is planned as if the queued items were built — levels advanced, their unpaid price (all but the head)
   * taken off the stock, the extra mine energy use added — and its queue counts as free, so the next step is appended now
   * instead of after the queue end.
   */
  function appendViews(views, depth, now, research, factors) {
    if (!(depth > 1)) return views;
    const out = {};
    for (const [id, v] of Object.entries(views)) {
      syncFields(v);   // Σ of the BUILT levels; the queued items count as fields through queue.items
      const q = v && v.queue;
      const items = (q && q.items) || [];
      const qEnd = num(q && q.end);
      if (!q || !q.known || !q.busy || (qEnd > 0 && qEnd <= now) || !items.length || items.length >= depth || items.some((x) => !(+x.id > 0) || !(num(x.level) > 0))) { out[id] = v; continue; }
      const levels = Object.assign({}, v.levels);
      for (const x of items) if (num(x.level) > num(levels[x.id])) levels[x.id] = num(x.level);
      const res = {};
      for (const r of RES) {
        const x = v.res && v.res[r];
        if (!x) { res[r] = x; continue; }
        const unpaid = items.slice(1).reduce((s, it) => s + num(costOf(+it.id, num(it.level))[r]), 0);
        res[r] = Object.assign({}, x, { amount: Math.max(0, OGX.calc.amountAt({ amount: x.amount, storage: x.storage, perHour: x.perHour, t: v.t }, now) - unpaid) });
      }
      let energy = v.energy;
      if (energy) {
        try {
          const mines = (lv) => prodOf({ 1: num(lv[1]), 2: num(lv[2]), 3: num(lv[3]) }, v, research, factors).energy.consumption;
          energy = Object.assign({}, energy, { consumption: num(energy.consumption) + Math.max(0, mines(levels) - mines(v.levels)) });
        } catch (e) { /* keep the page values */ }
      }
      out[id] = Object.assign({}, v, { levels, res, t: now, energy, fieldsSynced: true, queue: Object.assign({}, q, { busy: false, appending: items.length }) });
    }
    return out;
  }

  /**
   * Plans one cycle. input = { now, P, policyName, cfg, views: {id: View}, order: [planet ids], research: { levels, queue } | null,
   * factors, officers, gameSpeed, planets: { used, max } | null, astroCapped (tactic: planet cap reached), cooldowns: {key: until},
   * reserved: {bodyId: Res}, deutReserve, rnd }. Policy 'tactic' (P.tactic): John's build-up rules as a hard order (energy -> storages
   * full / below the next mine price / below the hour target when cheaper than the next mine -> robots 10 / nanites 10 / shipyard 14 -> lab 22 -> research unlock 217/219 -> research -> the lowest mine across planets).
   * View = { id, key, coords, name, isMoon, tempMax, fieldsUsed, fieldsMax, levels, res: {r: {amount, storage, perHour}}, t,
   *          energy: { production, consumption } | null, queue: { known, busy, items, end }, shipyard: { known, items, t } | null,
   *          defense: {id: n} | null, perSat: { value } | null, percents }.
   * Returns { candidates (sorted), actions: [{ cand, step }], waits: [{ cand, step, T, missing }], skipped: [{ cand, reason }],
   *           reads: [{ page, mode?, bodyId, why }], notes: [{ event, what, data }] }.
   */
  function plan(input) {
    const P = input.P;
    const cfg = input.cfg || {};
    const factors = input.factors || OGX.calc.factors({});
    const research = (input.research && input.research.levels) || {};
    const now = input.now;
    const views = appendViews(input.views || {}, Math.max(1, Math.min(MAX_BUILD_QUEUE, Math.floor(num(cfg.queueDepth, 1)))), now, research, factors);
    const notes = []; const reads = []; const readKeys = new Set();
    const note = (event, what, data) => notes.push({ event, what, data });
    const needRead = (page, bodyId, why, mode) => { const k = page + ':' + (mode || '') + ':' + bodyId; if (!readKeys.has(k)) { readKeys.add(k); reads.push({ page, mode, bodyId, why }); } };
    const planets = (input.order || Object.keys(views).map(Number)).map((id) => views[id]).filter((v) => v && !v.isMoon);
    const moons = Object.values(views).filter((v) => v && v.isMoon);
    const researchBusy = !!(input.research && input.research.queue && input.research.queue.busy);
    // lab planet: highest lab level, ties by id (research is started there, its stock pays) — stable across the planet order
    const lab = labPlanetOf(planets);
    const orderIdx0 = new Map(planets.map((v, i) => [v.id, i]));
    const tactic = P.tactic ? tacticContext(planets, cfg) : null;
    const storageH = tactic ? tactic.tc.storageHours : storageHoursOf(cfg);
    if (tactic) note('stage', `Этап ${tactic.stage.id} «${tactic.stage.name}»: шахты ${tactic.stage.mines[1]}/${tactic.stage.mines[2]}/${tactic.stage.mines[3]}`, { stage: tactic.stage.id, mines: tactic.stage.mines, irnTarget: tactic.irnTarget });
    if (tactic && cfg.research && !(input.planets && num(input.planets.max) > 0))
      note('planets', `Число планет [x / y] не прочитано: астрофизика только до ${astroFallbackCap()} (лимит ${BUILDUP.planetCapFallback.max} планет по таблице, не проверено)`, { astro: num(research[124]), fallbackAstro: astroFallbackCap(), capped: capReached(input, research[124]) });
    const cands = [];
    const mk = (c) => { c.costMsu = c.costMsu !== undefined ? c.costMsu : msuOf(c.cost, P); c.payback = c.rule ? -1 : (c.gainMsu > 0 ? c.costMsu / c.gainMsu * c.weight : Infinity); cands.push(c); return c; };
    const stepB = (v, id, level, extra) => Object.assign({ kind: 'building', id: +id, level, bodyId: v.id, cost: costOf(id, level), queue: 'b:' + v.id }, extra || {});
    const stepR = (id, level) => ({ kind: 'research', id: +id, level, bodyId: lab ? lab.id : null, cost: costOf(id, level), queue: 'r' });
    const stepU = (v, id, n) => ({ kind: 'units', id: +id, n, bodyId: v.id, cost: (() => { const c = OGX.calc.unitCost(+id, n); return { metal: c.metal, crystal: c.crystal, deuterium: c.deuterium }; })(), queue: 's:' + v.id });
    const chainSteps = (id, level, v, kind) => {
      const body = kind === 'research' ? lab : v;
      if (!body) return null;
      const missing = reqSteps(id, body, research);
      if (!missing) return null;
      const steps = missing.map((s) => (s.kind === 'research' ? stepR(s.id, s.level) : stepB(body, s.id, s.level)));
      steps.push(kind === 'research' ? stepR(id, level) : stepB(v, id, level));
      return steps;
    };
    const sumCost = (steps) => steps.reduce((c, s) => addRes(c, s.cost), res0());
    const stockPays = (v, cost) => RES.every((r) => {
      const x = v.res && v.res[r];
      const need = num(cost[r]);
      if (!(need > 0)) return true;
      return !!x && OGX.calc.amountAt({ amount: x.amount, storage: x.storage, perHour: x.perHour, t: v.t }, now) >= need;
    });

    /** Cheapest energy fix for `deficit` on v: satellites (w_sat, needs shipyard: its chain counts), solar (x1), fusion (w_fus; the
     *  extra deuterium use is priced for 24 h [NEW]). Returns { kind, steps, cost, costMsu, n?, perSat } or null. */
    // one satellite batch takes at most satBatchMaxMin minutes of the shipyard (audit 2026-11-02, botbuild-5: the headroom of
    // 10 levels x 3 mines meant 3 000-8 000 satellites = hours of yard at the measured 1 s per unit, during which 15 / 21 and the
    // other modules' ship orders are refused); the rest comes in the next batch once the queue drained
    const satMaxMin = num(cfg.satBatchMaxMin, 30);
    const satUnitSec = (v) => {
      try { return Math.max(1, OGX.calc.unitTime(SAT, { shipyard: num(v.levels[21]), nanite: num(v.levels[15]), gameSpeed: num(input.gameSpeed) > 0 ? num(input.gameSpeed) : SEED_SPEED, factors })); } catch (e) { return 1; }
    };
    const satCap = (v) => (satMaxMin > 0 ? Math.max(1, Math.floor(satMaxMin * 60 / satUnitSec(v))) : Infinity);
    function energyFix(v, deficit) {
      if (!(deficit > 0)) return null;
      const opts = [];
      const ps = perSat(v, factors);
      const nWanted = Math.ceil(deficit / ps.value);
      const cap = satCap(v);
      const n = Math.min(nWanted, cap);
      const satChain = reqSteps(SAT, v, research);
      if (satChain) {
        const steps = satChain.map((s) => (s.kind === 'research' ? stepR(s.id, s.level) : stepB(v, s.id, s.level))).concat([stepU(v, SAT, n)]);
        const cost = sumCost(steps);
        opts.push({ kind: 'sat', steps, cost, costMsu: msuOf(cost, P) * P.w_sat, n, nWanted, partial: n < nWanted, cap, unitSec: satUnitSec(v), deficit, perSat: ps });
      }
      const L4 = num(v.levels[4]); const e4 = P.tactic ? 0 : energyOf(4, L4, v, research, factors);
      for (let k = 1; k <= (P.tactic ? 0 : 25); k++) {   // the tactic: energy by satellites only, never solar / fusion
        if (energyOf(4, L4 + k, v, research, factors) - e4 >= deficit) { const cost = costRange(4, L4, L4 + k); opts.push({ kind: 'solar', levels: k, steps: [stepB(v, 4, L4 + 1)], cost, costMsu: msuOf(cost, P), perSat: ps }); break; }
      }
      const fChain = reqSteps(12, v, research);
      if (fChain && fChain.length === 0 && !P.tactic) {
        const L12 = num(v.levels[12]); const e12 = energyOf(12, L12, v, research, factors);
        for (let k = 1; k <= 15; k++) {
          if (energyOf(12, L12 + k, v, research, factors) - e12 >= deficit) {
            const cost = costRange(12, L12, L12 + k);
            const use = 10 * ((L12 + k) * Math.pow(1.1, L12 + k) - L12 * Math.pow(1.1, L12)) * OGX.calc.gz.resourceMultiplier;
            opts.push({ kind: 'fusion', levels: k, steps: [stepB(v, 12, L12 + 1)], cost, costMsu: msuOf(cost, P) * P.w_fus + use * P.vD * 24, perSat: ps });
            break;
          }
        }
      }
      if (!opts.length) return null;
      opts.sort((a, b) => a.costMsu - b.costMsu);
      return Object.assign({ deficit, options: opts, alternatives: opts.map((o) => ({ kind: o.kind, costMsu: Math.round(o.costMsu), n: o.n, levels: o.levels })) }, opts[0]);
    }
    // 0.3.2: satellites in big batches. A satellite costs ~2 500 MSU while a mine level here costs billions, but every shipyard
    // order is one request and one «builds» unit: the log of 2026-11-01 had 1 072 satellite orders (×1, ×2, ×11 every few
    // seconds) against 571 building orders. One order now covers the deficit plus the energy of the next satAheadLevels levels of
    // ALL three mines, when the planet's own stock pays it.
    const satAhead = Math.max(1, Math.floor(num(cfg.satAheadLevels, 10)));
    const mineHeadroom = (v) => {
      if (satAhead <= 1) return 0;
      try {
        const lv = (k) => ({ 1: num(v.levels[1]) + k, 2: num(v.levels[2]) + k, 3: num(v.levels[3]) + k });
        return Math.max(0, prodOf(lv(satAhead), v, research, factors).energy.consumption - prodOf(lv(0), v, research, factors).energy.consumption);
      } catch (e) { return 0; }
    };
    const bigSat = (v, deficit, fix, extraCost) => {
      if (!fix || fix.kind !== 'sat') return fix;
      const more = mineHeadroom(v);
      if (!(more > 0)) return fix;
      const big = energyFix(v, deficit + more);
      return big && big.kind === 'sat' && big.n > fix.n && stockPays(v, addRes(sumCost(big.steps), extraCost || res0())) ? Object.assign(big, { ahead: satAhead, baseN: fix.nWanted, baseDeficit: deficit }) : fix;
    };
    /** Why this many satellites (journal): the deficit, the mine headroom and the yard-time cap. */
    const satWhy = (f) => {
      if (!f || f.kind !== 'sat') return null;
      const baseN = f.baseN !== undefined ? f.baseN : f.nWanted;
      let s = `спутники ×${f.n}: нехватка ${Math.round(f.baseDeficit !== undefined ? f.baseDeficit : f.deficit)} → ×${baseN}`;
      if (f.ahead) s += `, +${f.ahead} ур. всех шахт → ×${f.nWanted}`;
      if (f.partial) s += `; партия не дольше ${satMaxMin} мин верфи (${f.unitSec} с/шт.) → ×${f.n}, остальное следующим заказом`;
      return s;
    };

    for (const v of planets.concat(moons)) syncFields(v);
    // ---------- per planet
    let mineSum = res0();     // Σ mine output (x prodLevel) for the 131-133 gain
    for (const v of planets) {
      const prodLevel = v.energy && num(v.energy.consumption) > 0 ? Math.min(1, num(v.energy.production) / num(v.energy.consumption)) : 1;
      const out = prodOf({ 1: num(v.levels[1]), 2: num(v.levels[2]), 3: num(v.levels[3]) }, v, research, factors);
      for (const r of RES) mineSum[r] += num(out.breakdown.mines[r]) * prodLevel;
      if (!cfg.buildings && !cfg.energy) continue;
      const queued = (v.queue && v.queue.items) || [];
      // fields unknown (no tooltip and no core state): never read as «0 free» — no field limit, journaled
      const fieldsKnown = num(v.fieldsMax) > 0;
      const free = fieldsKnown ? num(v.fieldsMax) - num(v.fieldsUsed) - queued.length : Infinity;
      v._free = free;
      if (!fieldsKnown && cfg.buildings) note('fields', `[${v.coords}]: число полей неизвестно — стройка без ограничения по полям (терраформер не планируется)`, { body: v.id, used: v.fieldsUsed, max: v.fieldsMax });
      const bal = energyBalance(v, factors);
      // energy deficit -> fix first
      if (cfg.energy && bal !== null && bal < 0) {
        const fix = bigSat(v, -bal, energyFix(v, -bal));
        note('energy', `Дефицит энергии ${Math.round(-bal)} на [${v.coords}]` + (fix ? ': ' + (fix.kind === 'sat' ? `спутники ×${fix.n} (по ${Math.round(fix.perSat.value * 100) / 100}, ${fix.perSat.src === 'page' ? 'со страницы ресурсов' : 'по формуле'}; ${satWhy(fix)})` : fix.kind === 'solar' ? 'солнечная' : 'термояд') : ': нечем чинить'),
          { body: v.id, deficit: Math.round(-bal), balance: bal, queuedSats: queuedSats(v), fix: fix ? { kind: fix.kind, n: fix.n, nWanted: fix.nWanted, partial: !!fix.partial, cap: fix.cap, ahead: fix.ahead || 0, perSat: fix.perSat.value, perSatSrc: fix.perSat.src, alternatives: fix.alternatives } : null });
        if (fix) mk({ kind: fix.steps[fix.steps.length - 1].kind, item: fix.kind === 'sat' ? SAT : fix.steps[0].id, label: `Энергия [${v.coords}]: ` + (fix.kind === 'sat' ? `спутники ×${fix.n}` : name(fix.steps[0].id)), bodyId: v.id, rule: 'energy', steps: fix.steps, cost: fix.cost, costMsu: fix.costMsu, gainMsu: 0, weight: 1,
          fix: { kind: fix.kind, n: fix.n, costMsu: Math.round(fix.costMsu), why: satWhy(fix) }, fixOptions: fix.options });
        if (fix && fix.kind === 'sat' && fix.perSat.src !== 'page' && !(v.perSatT && now - v.perSatT < RESOURCES_EVERY)) needRead('resources', v.id, 'выработка спутника для дефицита энергии');
      }
      if (!cfg.buildings) continue;
      if (free <= 0) {
        // 2Moons AddBuildingToQueue refuses every build on a full planet, the terraformer too: only a demolition frees a field
        const stuck = queued.length === 0;
        note('fields', `[${v.coords}]: свободных полей нет (${v.fieldsUsed}/${v.fieldsMax}, в очереди ${queued.length}) — пропуск` + (stuck ? '. Терраформер на полной планете игра не ставит: снесите вручную 1 уровень любого здания, бот сразу поставит терраформер' : ''),
          { body: v.id, free, used: v.fieldsUsed, max: v.fieldsMax, queued: queued.length, tip: v.fieldsTip === undefined ? null : v.fieldsTip, stuck });
      }
      // exactly the reserved free field(s) left -> terraformer
      if (free > 0 && free <= Math.max(1, num(cfg.fieldsReserve, 1))) {
        const L33 = num(v.levels[33]);
        const steps = chainSteps(33, L33 + 1, v, 'building');
        note('fields', `[${v.coords}]: свободно полей ${free} — терраформер`, { body: v.id, free, used: v.fieldsUsed, max: v.fieldsMax, tip: v.fieldsTip === undefined ? null : v.fieldsTip, chain: steps ? steps.map((s) => s.id + ':' + s.level) : null });
        if (steps) mk({ kind: 'building', item: 33, label: `Терраформер ${L33 + 1} [${v.coords}]`, bodyId: v.id, rule: 'fields', steps, cost: sumCost(steps), gainMsu: 0, weight: 1 });
      }
      // storages: resource at cap, then capacity below storageHours of production (order D, C, M)
      for (const r of ['deuterium', 'crystal', 'metal']) {
        const x = v.res && v.res[r];
        if (!x || !(num(x.storage) > 0)) continue;
        const sid = STORE_OF[r]; const L = num(v.levels[sid]);
        const amount = OGX.calc.amountAt({ amount: x.amount, storage: x.storage, perHour: x.perHour, t: v.t }, now);
        // tactic (json storage_12h): the production after the next mine level of that resource counts, while that mine still
        // has a stage target to reach (the store goes before the mine, not right after it)
        let perHour = num(x.perHour);
        const mid = r === 'metal' ? 1 : r === 'crystal' ? 2 : 3;
        if (tactic && perHour > 0 && num(v.levels[mid]) < num(tactic.stage.mines[mid])) {
          const a = prodOf({ [mid]: num(v.levels[mid]) }, v, research, factors).perHour[r];
          const b = prodOf({ [mid]: num(v.levels[mid]) + 1 }, v, research, factors).perHour[r];
          if (a > 0 && b > a) perHour = perHour * b / a;
        }
        // John 2026-11-01 «сначала шахты»: a store goes out of turn only when full, too small for the next mine's price, or cheaper than
        // the cheapest next mine; otherwise it waits behind the mines (storageLate)
        let rule = null;
        const stMines = tactic ? tactic.stage.mines : null;
        const need = nextMineNeed(v.levels, r, stMines) * 1.1;
        if (amount >= num(x.storage)) rule = 'storageFull';
        else if (need > num(x.storage)) rule = 'storageNeed';
        else if (storageH > 0 && perHour > 0 && num(x.storage) < storageH * perHour) {
          const sc = costOf(sid, L + 1);
          rule = num(sc.metal) + num(sc.crystal) + num(sc.deuterium) <= nextMineMinSum(v.levels, stMines) ? 'storageHours' : 'storageLate';
        }
        if (!rule) continue;
        note('storage', `[${v.coords}] ${rule === 'storageFull' ? 'хранилище заполнено' : rule === 'storageNeed' ? 'хранилище меньше цены следующей шахты' : 'хранилища меньше чем на ' + storageH + ' ч' + (rule === 'storageLate' ? ' (после шахт)' : '') + (perHour > num(x.perHour) ? ' (с учётом следующего уровня шахты)' : '')}: ${name(sid)} ${L + 1}`, { body: v.id, res: r, rule, amount: Math.round(amount), storage: x.storage, perHour: x.perHour, perHourNext: Math.round(perHour) });
        mk({ kind: 'building', item: sid, label: `${name(sid)} ${L + 1} [${v.coords}]`, bodyId: v.id, rule, steps: [stepB(v, sid, L + 1)], cost: costOf(sid, L + 1), gainMsu: 0, weight: 1,
          sub: [orderIdx0.get(v.id) || 0] });
      }
      // tactic: foundation (robots 10, nanites 10, shipyard 14), the lab 22, late nanites
      if (tactic) {
        planetTargets(v, tactic.stage, tactic.tc).forEach((x, i) => {
          const L = num(v.levels[x.id]);
          if (L >= x.level) return;
          const steps = chainSteps(x.id, L + 1, v, 'building');
          if (!steps) return;
          mk({ kind: 'building', item: x.id, level: L + 1, label: `${name(x.id)} ${L + 1} (цель ${x.level}) [${v.coords}]`, bodyId: v.id, rule: x.rule, steps, cost: sumCost(steps), gainMsu: 0, weight: 1,
            target: x.level, sub: [i, orderIdx0.get(v.id) || 0] });
        });
        const gs = num(input.gameSpeed);
        if (gs > 0 && num(v.levels[15]) >= 10 && foundationDone(v, tactic.tc)) {
          let tMin = Infinity;
          for (const id of [1, 2, 3]) if (num(v.levels[id]) < num(tactic.stage.mines[id])) tMin = Math.min(tMin, OGX.calc.buildTime(id, num(v.levels[id]) + 1, { robotics: num(v.levels[14]), nanite: num(v.levels[15]), gameSpeed: gs, factors }) / 60);
          if (Number.isFinite(tMin) && tMin > BUILDUP.nanitesLateMin) {
            const L = num(v.levels[15]);
            const steps = chainSteps(15, L + 1, v, 'building');
            if (steps) mk({ kind: 'building', item: 15, level: L + 1, label: `${name(15)} ${L + 1} (шахта строится ${Math.round(tMin)} мин) [${v.coords}]`, bodyId: v.id, rule: 'nanitesLate', steps, cost: sumCost(steps), gainMsu: 0, weight: 1, sub: [orderIdx0.get(v.id) || 0] });
          }
        }
      }
      // mines with the energy fix of their extra use (tactic: only below the stage target, ranked by level across all planets)
      for (const id of [1, 2, 3]) {
        // above the stage target (tactic): only from the planet's own surplus (rule mineSurplus) — a rich planet (the main with
        // 10^12 in stock, log 2026-11-01) no longer idles until the newest colony reaches the stage
        const surplus = !!tactic && num(v.levels[id]) >= num(tactic.stage.mines[id]);
        if (surplus && cfg.surplusMines === false) continue;
        const g = mineGain(id, v, research, factors);
        if (!(g.gain > 0) && !tactic) continue;
        const w = id === 1 ? P.wM : id === 2 ? P.wC : P.wD;
        const price = { metal: 0, crystal: 0, deuterium: 0 }; price[g.res] = id === 1 ? 1 : id === 2 ? P.vC : P.vD;
        const gainMsu = g.gain * price[g.res];
        let steps = [stepB(v, id, g.level)];
        let fix = null; let fixOptions = null;
        if (cfg.energy && bal !== null) {
          const after = Math.min(0, bal) < 0 ? -g.dCons : bal - g.dCons;   // a current deficit is fixed by the energy rule first
          if (after < 0) {
            fix = energyFix(v, -after);
            // satellites for satAheadLevels levels of all three mines in one order, when the planet's own stock pays them (with
            // the mine now, else the satellites alone: they are cheap and needed anyway)
            const withMine = bigSat(v, -after, fix, costOf(id, g.level));
            fix = withMine !== fix ? withMine : bigSat(v, -after, fix);
            // a batch capped by the yard time that does not cover this level's own use: the satellites alone now, the mine (and the
            // rest of the energy) once the queue drained
            const covered = !fix || fix.kind !== 'sat' || fix.n * fix.perSat.value >= -after - 1e-6;
            if (fix) steps = covered ? fix.steps.concat(steps) : fix.steps;
          }
          if (fix) fixOptions = fix.options;
        }
        const cost = sumCost(steps);
        const costMsu = msuOf(costOf(id, g.level), P) + (fix ? fix.costMsu : 0);
        const c = mk({ kind: 'building', item: id, level: g.level, label: `${name(id)} ${g.level} [${v.coords}]`, bodyId: v.id, steps, cost, costMsu, gainMsu, weight: w,
          gain: { [g.res]: g.gain }, dCons: g.dCons, fix: fix ? { kind: fix.kind, n: fix.n, costMsu: Math.round(fix.costMsu), why: satWhy(fix) } : null, fixOptions });
        if (tactic) {
          // rank = level + offset (no trader); ties: colonies before the main planet, then the lower production
          c.rule = surplus ? 'mineSurplus' : 'mine'; c.rank = mineRank(id, g.level - 1); c.sub = [c.rank, tactic.main && tactic.main.id === v.id ? 1 : 0, prodMsu(v, P)];
          c.label = `${name(id)} ${g.level} [${v.coords}] (ранг ${c.rank}, ` + (surplus ? `выше цели ${tactic.stage.id}: ${tactic.stage.mines[id]}, из излишков)` : `цель ${tactic.stage.id}: ${tactic.stage.mines[id]})`);
        }
      }
      // defense domes (off by default); the dome counts come from page=imperium or the defense page, which is read only right
      // before a dome order on that planet (unknown counts: a candidate whose order first reads the page), never per run
      if (cfg.defense && num(v.levels[21]) >= 1) {
        for (const id of [407, 408]) {
          const queuedU = ((v.shipyard && v.shipyard.items) || []).some((x) => +x.id === id);
          if ((v.defense && num(v.defense[id]) > 0) || queuedU || !reqsMet(id, v, research)) continue;
          mk({ kind: 'units', item: id, label: `${name(id)} [${v.coords}]`, bodyId: v.id, rule: 'defense', steps: [stepU(v, id, 1)], cost: stepU(v, id, 1).cost, gainMsu: 0, weight: 1,
            defRead: !v.defense });
        }
      }
      // requests of other modules (OGX.bot.wants, BOT_CONTRACT C2.7): botmissiles asks for a missile silo 4 on its best launcher
      if (cfg.buildings) {
        for (const wnt of input.wants || []) {
          if (!wnt || wnt.kind !== 'building' || +wnt.bodyId !== +v.id || !(+wnt.id > 0)) continue;
          const L = num(v.levels[wnt.id]);
          if (L >= num(wnt.level, L + 1)) continue;
          if (((v.queue && v.queue.items) || []).some((x) => +x.id === +wnt.id)) continue;
          const steps = chainSteps(+wnt.id, L + 1, v, 'building');
          if (!steps) { note('wait', `[${v.coords}] ${name(+wnt.id)} ${L + 1} (запрос ${wnt.owner || '?'}): требования не выполнимы сейчас`, { body: v.id, id: +wnt.id, owner: wnt.owner || null }); continue; }
          mk({ kind: 'building', item: +wnt.id, level: L + 1, label: `${name(+wnt.id)} ${L + 1} [${v.coords}] (запрос: ${wnt.why || wnt.owner})`, bodyId: v.id, rule: 'wants', steps, cost: sumCost(steps), gainMsu: 0, weight: 1 });
        }
      }
    }
    // moons: only the lunar base on the last free field(s)
    if (cfg.moons && cfg.buildings) {
      for (const v of moons) {
        const free = num(v.fieldsMax) > 0 ? num(v.fieldsMax) - num(v.fieldsUsed) - ((v.queue && v.queue.items) || []).length : Infinity;
        v._free = free;
        if (free > 0 && free <= Math.max(1, num(cfg.fieldsReserve, 1))) {
          const L = num(v.levels[41]);
          mk({ kind: 'building', item: 41, label: `Лунная база ${L + 1} [${v.coords}]`, bodyId: v.id, rule: 'fields', steps: [stepB(v, 41, L + 1)], cost: costOf(41, L + 1), gainMsu: 0, weight: 1 });
        }
      }
    }

    // ---------- player-wide research
    if (cfg.research && lab && tactic) {
      // 217 (all hauling) then 219 (debris) unlock chains first; the shipyard level is a planet target (shipyardTarget)
      BUILDUP.research.unlock.forEach((sid, i) => {
        const miss = unlockSteps(sid, lab, research);
        if (!miss || !miss.length) return;
        const steps = miss.map((s) => (s.kind === 'research' ? stepR(s.id, s.level) : stepB(lab, s.id, s.level)));
        const f = steps[0];
        mk({ kind: f.kind, item: sid, level: null, label: `Открыть «${name(sid)}» (${sid}): ${name(f.id)} ${f.level}` + (miss.length > 1 ? ` (+${miss.length - 1} шаг.)` : ''), bodyId: lab.id, rule: 'unlock', steps, cost: sumCost(steps), gainMsu: 0, weight: 1, sub: [i], unlock: sid });
      });
      for (const o of researchOrder(research, tactic, capReached(input, research[124]), !!input.expoOn)) {
        // the astrophysics reasoning (expeditions on, planet cap reached) in the journal: once per change (act() dedupes)
        if (o.astro) note('research', `Астрофизика при включённых экспедициях: уровень ${o.astro.level}, слотов экспедиций ${o.astro.slots}; ${o.why}`, o.astro);
        const steps = chainSteps(o.id, o.level, lab, 'research');
        if (!steps) continue;
        mk({ kind: 'research', item: o.id, level: o.level, label: `${name(o.id)} ${o.level} (${o.why})`, bodyId: lab.id, rule: 'research', steps, cost: sumCost(steps), gainMsu: 0, weight: 1, sub: o.sub });
      }
    }
    if (cfg.research && lab && !tactic) {
      // 131-133 (production research, F13): +2 %/level of the mine part of every planet (weight w_plasma); never 122
      for (const [id, r] of Object.entries(PROD_RESEARCH)) {
        const L = num(research[id]);
        const steps = chainSteps(+id, L + 1, lab, 'research');
        if (!steps) continue;
        const price = r === 'metal' ? 1 : r === 'crystal' ? P.vC : P.vD;
        const gain = 0.02 * mineSum[r] * (1 + 0);
        mk({ kind: 'research', item: +id, level: L + 1, label: `${name(id)} ${L + 1}`, bodyId: lab.id, steps, cost: sumCost(steps), gainMsu: gain * price, weight: P.w_plasma, gain: { [r]: gain } });
      }
      // 124: a new planet when every planet slot is used (planets appear at odd levels: from an odd level two levels) [SPEC §7 corr.]
      const pl = input.planets;
      if (pl && num(pl.max) > 0 && num(pl.used) >= num(pl.max)) {
        const L = num(research[124]);
        const target = L % 2 === 0 ? L + 1 : L + 2;
        const steps = chainSteps(124, L + 1, lab, 'research');
        if (steps) {
          const extra = costRange(124, L + 1, target);
          let home = planets[0];
          for (const v of planets) if (num(v.levels[1]) > num(home.levels[1])) home = v;
          let colCost = addRes(res0(), OGX.calc.unitCost(208, 1));
          let colGain = 0; const colLv = {};
          for (const id of [1, 2, 3]) {
            const lvl = Math.round(P.beta_col * num(home.levels[id]));
            colLv[id] = lvl;
            colCost = addRes(colCost, costRange(id, 0, lvl));
            const pr = prodOf({ [id]: lvl }, home, research, factors);
            const base = prodOf({}, home, research, factors);
            colGain += (pr.perHour[MINE_RES[id]] - base.perHour[MINE_RES[id]]) * (id === 1 ? 1 : id === 2 ? P.vC : P.vD);
          }
          const cost = addRes(sumCost(steps), extra);
          mk({ kind: 'research', item: 124, level: target, label: `${name(124)} ${target} (новая колония)`, bodyId: lab.id, steps, cost, costMsu: msuOf(cost, P) + msuOf(colCost, P), gainMsu: colGain, weight: P.w_col, colony: { levels: colLv, target } });
        }
      }
    }
    if (cfg.research && lab) {
      // 108 when expeditions + 1 exceed fleet slots (EnsureExpoSlots) [SPEC §7]
      if (cfg.ensureExpoSlots) {
        const exp = Math.floor(Math.sqrt(num(research[124])));
        const slots = 1 + num(research[108]) + 3 * num(input.officers && input.officers[611]);
        if (exp > 0 && exp + 1 > slots) {
          const steps = chainSteps(108, num(research[108]) + 1, lab, 'research');
          if (steps) mk({ kind: 'research', item: 108, level: num(research[108]) + 1, label: `${name(108)} ${num(research[108]) + 1} (слоты экспедиций)`, bodyId: lab.id, rule: 'expoSlots', steps, cost: sumCost(steps), gainMsu: 0, weight: 1 });
        }
      }
    }

    // ---------- order: forced rules first, then payback (ties: planet order, randomized by the caller)
    const orderIdx = new Map(planets.map((v, i) => [v.id, i]));
    cands.forEach((c, i) => { c.idx = i; c.key = c.kind + ':' + c.bodyId + ':' + c.item + ':' + (c.level || c.steps[c.steps.length - 1].level || c.steps[c.steps.length - 1].n || ''); });
    cands.sort((a, b) => {
      const ra = a.rule ? RULE_RANK[a.rule] : 99; const rb = b.rule ? RULE_RANK[b.rule] : 99;
      if (ra !== rb) return ra - rb;
      const sc = subCmp(a.sub, b.sub);
      if (sc) return sc;
      if (a.payback !== b.payback) return a.payback - b.payback;
      return (orderIdx.get(a.bodyId) || 0) - (orderIdx.get(b.bodyId) || 0) || a.idx - b.idx;
    });

    // ---------- choose the first startable step of each queue
    const spent = {};
    const claimed = {};
    const busyQ = {};
    const busyT = {};          // queue -> seconds until it is free for the tactic gates (0: works now / ordered now)
    const plannedFields = {};
    for (const v of planets.concat(moons)) {
      // busy until its end (a queue whose end passed is free: the next read shows it); the floor hold lasts only that long
      const qEnd = num(v.queue && v.queue.end);
      if (v.queue && v.queue.busy && !(qEnd > 0 && qEnd <= now)) { busyQ['b:' + v.id] = 'очередь построек занята'; busyT['b:' + v.id] = qEnd > now ? (qEnd - now) / 1000 : 0; }
      if (v.shipyard && (v.shipyard.items || []).length >= MAX_SHIP_QUEUE) { busyQ['s:' + v.id] = 'очередь верфи полна'; busyT['s:' + v.id] = 0; }
    }
    if (researchBusy) busyQ.r = 'идёт исследование';
    // tactic gates: the lowest mine across all planets goes first (a higher-ranked mine elsewhere waits while the lowest one is
    // ordered, being built or affordable within FLOOR_HOLD_S); no research start while a lab to the target is ordered / about to be
    // (2Moons refuses the lab during any research)
    const FLOOR_HOLD_S = 2 * 3600; const LAB_HOLD_S = 1800;
    let mineFloor = null; let labHold = null; let researchPlanned = null;
    // a lab / University step on the lab planet (any rule: 'lab', 'unlock'...) holds research, and research holds it
    const labStep = (step) => !!(step && lab && step.kind === 'building' && (+step.id === 31 || +step.id === 6) && +step.bodyId === +lab.id);
    const gate = (cand, T, step) => {
      if (tactic && cand.rule === 'mine' && mineFloor === null && T <= FLOOR_HOLD_S) mineFloor = { rank: cand.rank, label: cand.label, bodyId: cand.bodyId };
      if (!labHold && T <= LAB_HOLD_S && ((tactic && cand.rule === 'lab') || labStep(step))) labHold = cand.label;
    };
    const actions = []; const waits = []; const skipped = [];
    /** par_tol: another step on a planet that saves for `cl` (its waiting step) may start when it delays that wait by at most
     *  par_tol x the wait; delayH = how long the planet needs to earn the step's price again. */
    const parDelay = (step, payer, cl) => {
      let delayH = 0;
      for (const r of RES) if (num(step.cost[r]) > 0) { const ph = num(payer.res && payer.res[r] && payer.res[r].perHour); delayH = Math.max(delayH, ph > 0 ? step.cost[r] / ph : Infinity); }
      return { delayH, ok: delayH <= P.par_tol * cl.T / 3600 };
    };
    const queueHas = (v, ids) => ((v && v.queue && v.queue.items) || []).some((x) => ids.includes(+x.id));
    const cooldownKey = (s) => (s.kind === 'research' ? 'r' : s.bodyId) + ':' + s.id;
    // shipyard queue: the cached page / own orders decide planning; a fresh page (<= FRESH_MS) is needed only for the order itself
    const yardFresh = (v) => !!v.shipyard && num(v.shipyard.t) > 0 && now - num(v.shipyard.t) <= TRUST_MS;   // 0.3.2: read or answer page
    const yardBusy = (v) => !!v.shipyard && (v.shipyard.items || []).length > 0 && !(num(v.shipyard.end) > 0 && num(v.shipyard.end) <= now);

    /** Queue/server rules for one step; may replace it (storage first, infrastructure, IRN). -> { step, why[] } | { blocked } */
    function transform(step, cand, depth = 0) {
      const why = [];
      let yardRead = null;   // the shipyard page this step needs fresh: read only when the step is affordable (an order follows)
      const v = views[step.bodyId];
      if (!v) return { blocked: 'нет данных о планете' };
      if (input.cooldowns && num(input.cooldowns[cooldownKey(step)]) > now) return { blocked: 'пауза после неподтверждённых попыток до ' + fmtT(input.cooldowns[cooldownKey(step)]) };
      if (step.kind === 'building') {
        if (!cfg.buildings) return { blocked: 'стройка выключена' };
        const free = num(v.fieldsMax) > 0 ? num(v.fieldsMax) - num(v.fieldsUsed) - ((v.queue && v.queue.items) || []).length - num(plannedFields[v.id]) : Infinity;
        if (step.id === 33 || step.id === 41) { if (free < 1) return { blocked: 'нет свободного поля' }; }
        else if (free <= Math.max(0, num(cfg.fieldsReserve))) return { blocked: free <= 0 ? 'нет свободных полей' : `последние ${free} пол. — под терраформер` };
        if ((step.id === 31 || step.id === 6) && researchBusy) return { blocked: `${name(step.id)}: идёт исследование (сервер не даёт ставить лабораторию)` };
        if (step.id === 15 || step.id === 21) {
          if (yardBusy(v)) return { blocked: `${name(step.id)}: верфь работает` };
          if (!yardFresh(v)) yardRead = { page: 'shipyard', bodyId: v.id, why: 'очередь верфи перед ' + name(step.id), mode: 'fleet', queue: 'b:' + v.id };
        }
        if (step.cost.energy > 0 && num(v.energy && v.energy.production) < step.cost.energy) {
          // satellites already in the shipyard queue count (audit 2026-11-02, botbuild-4: the same batch was re-ordered every run
          // until the yard held five entries); 2Moons checks the price against the built energy, so the step waits for them
          const pending = queuedSats(v) * perSat(v, factors).value;
          if (num(v.energy && v.energy.production) + pending >= step.cost.energy) return { blocked: `ждём спутники из очереди верфи (×${queuedSats(v)}) — цена в энергии ${step.cost.energy}` };
          const fix = energyFix(v, step.cost.energy - num(v.energy && v.energy.production) - pending);
          let last = null;
          for (const o of (fix && depth < 3 ? fix.options : [])) {
            const t = transform(o.steps[0], cand, depth + 1);
            if (!t.blocked) return Object.assign({}, t, { why: why.concat(['цена в энергии ' + step.cost.energy + ': ' + o.kind], t.why) });
            last = t;
          }
          return { blocked: 'не хватает выработки энергии ' + step.cost.energy + (last ? ' (' + last.blocked + ')' : ''), read: last && last.read };
        }
      }
      if (step.kind === 'research') {
        if (!cfg.research) return { blocked: 'исследования выключены' };
        if (!lab) return { blocked: 'нет лаборатории' };
        if (queueHas(lab, [6, 31])) return { blocked: 'в очереди планеты-лаборатории стоит лаборатория/университет' };
        if (!input.research || !input.research.queue || !input.research.queue.known) return { blocked: 'очередь исследований неизвестна' };
      }
      if (step.kind === 'units') {
        if (queueHas(v, [15, 21])) return { blocked: 'в очереди построек верфь/нанитки — верфь не принимает заказы' };
        if (!(num(v.levels[21]) >= 1)) return { blocked: 'нет верфи' };
        if (v.shipyard && (v.shipyard.items || []).length >= MAX_SHIP_QUEUE) return { blocked: 'очередь верфи полна' };
        // one satellite batch at a time: the next one only once the queue drained (its energy is pending in energyBalance; a
        // second batch on top doubled the yard time and the satellites, log 2026-11-02 ×596 and ×693 twice)
        if (+step.id === SAT && queuedSats(v) > 0) {
          // a queue without an end is never cleared by advanceViews: re-read the yard instead of waiting for good
          const read = !(num(v.shipyard.end) > 0) && !yardFresh(v) && !(now - num(v.yardFailT) < YARD_RETRY_MS) ? { page: 'shipyard', bodyId: v.id, why: 'спутники в очереди верфи без срока — перечитываю', mode: 'fleet', queue: 's:' + v.id } : null;
          return { blocked: `ждём спутники из очереди верфи (×${queuedSats(v)})`, read };
        }
        if (!yardFresh(v) || (cand && cand.defRead && !v.defense)) yardRead = { page: 'shipyard', bodyId: v.id, why: +step.id >= 400 ? 'купола: оборона перед заказом' : 'очередь верфи перед заказом', mode: +step.id >= 400 ? 'defense' : 'fleet', queue: 's:' + v.id };
      }
      if (depth >= 3) return { step, why, yardRead };
      const payer = views[step.bodyId];
      // storage first: the step price exceeds a storage
      if (step.kind !== 'units' && ![22, 23, 24].includes(step.id)) {
        for (const r of RES) {
          const st = payer.res && payer.res[r] && num(payer.res[r].storage);
          if (st > 0 && num(step.cost[r]) > st) {
            const sid = STORE_OF[r]; const s2 = stepB(payer, sid, num(payer.levels[sid]) + 1);
            note('storage', `${name(step.id)}: цена ${fmtN(step.cost[r])} больше хранилища ${fmtN(st)} — сначала ${name(sid)}`, { body: payer.id, res: r, rule: 'price', step: step.id, cost: step.cost[r], storage: st });
            const t = transform(s2, cand, depth + 1);
            return t.blocked ? t : Object.assign({}, t, { why: why.concat(['цена больше хранилища'], t.why) });
          }
        }
      }
      const gs = num(input.gameSpeed);
      // infrastructure: robots / nanite for a building step (rho_R, psi) — needs the game speed
      // (the tactic has fixed robots / nanites / lab targets instead)
      if (gs > 0 && !P.tactic && step.kind === 'building' && ![14, 15, 22, 23, 24].includes(step.id)) {
        const pm = prodMsu(payer, P);
        const tStepH = OGX.calc.buildTime(step.id, step.level, { robotics: num(payer.levels[14]), nanite: num(payer.levels[15]), gameSpeed: gs, factors }) / 3600;
        const opts = [];
        if (reqsMet(15, payer, research)) opts.push(15);
        opts.push(14);
        for (const id of opts) {
          const c = costOf(id, num(payer.levels[id]) + 1);
          const earnH = pm > 0 ? msuOf(c, P) / pm : Infinity;
          if (tStepH > P.rho_R * earnH && msuOf(c, P) <= P.psi * msuOf(step.cost, P)) {
            const t = transform(stepB(payer, id, num(payer.levels[id]) + 1), cand, depth + 1);
            if (!t.blocked) return Object.assign({}, t, { why: why.concat([`инфраструктура: ${name(step.id)} строится ${fmtH(tStepH)} > ${P.rho_R}×${fmtH(earnH)}`], t.why) });
          }
        }
      }
      if (step.kind === 'research') {
        // IRN (policy irn): research the network when the next research costs (= takes, same lab) more than its next level
        if (P.irn && step.id !== 123 && lab) {
          const others = planets.filter((x) => x.id !== lab.id && num(x.levels[31]) > 0).length;
          const L123 = num(research[123]);
          const c123 = costOf(123, L123 + 1);
          if (others > L123 && num(step.cost.metal) + num(step.cost.crystal) > c123.metal + c123.crystal) {
            const ch = reqSteps(123, lab, research);
            if (ch) {
              const first = ch.length ? (ch[0].kind === 'research' ? stepR(ch[0].id, ch[0].level) : stepB(lab, ch[0].id, ch[0].level)) : stepR(123, L123 + 1);
              const t = transform(first, cand, depth + 1);
              if (!t.blocked) return Object.assign({}, t, { why: why.concat(['МИС: следующее исследование дольше уровня сети'], t.why) });
            }
          }
        }
        // lab / University (rho_L, psi) — needs the game speed
        if (gs > 0 && !P.tactic) {
          const pm = prodMsu(lab, P);
          const tStepH = OGX.calc.researchTime(step.id, step.level, { labLevel: effLabOf(step.id, lab, planets, research), university: num(lab.levels[6]), gameSpeed: gs, factors }) / 3600;
          const opts = [31];
          if (cfg.university && reqsMet(6, lab, research)) opts.unshift(6);
          for (const id of opts) {
            const c = costOf(id, num(lab.levels[id]) + 1);
            const earnH = pm > 0 ? msuOf(c, P) / pm : Infinity;
            if (tStepH > P.rho_L * earnH && msuOf(c, P) <= P.psi * msuOf(step.cost, P)) {
              const t = transform(stepB(lab, id, num(lab.levels[id]) + 1), cand, depth + 1);
              if (!t.blocked) return Object.assign({}, t, { why: why.concat([`исследование идёт ${fmtH(tStepH)} > ${P.rho_L}×${fmtH(earnH)}: сначала ${name(id)}`], t.why) });
            }
          }
        }
      }
      return { step, why, yardRead };
    }

    for (const cand of cands) {
      // the lowest mine across planets goes first: a higher mine waits (no wait, no reservation, no delivery request) unless its own
      // planet's queue is free and its own stock pays it now — planets never idle for each other (resources are per planet)
      const floorHeld = tactic && cand.rule === 'mine' && mineFloor && cand.rank > mineFloor.rank ? `сначала самая низкая шахта: «${mineFloor.label}»` : null;
      if (floorHeld && +cand.bodyId === +mineFloor.bodyId) { skipped.push({ cand, reason: floorHeld }); continue; }
      const first = cand.steps[0];
      let t = transform(first, cand);
      // a page the step needs (shipyard queue) is read only when that queue is not taken by a higher-ranked step anyway; also when
      // a fallback (solar instead of satellites) starts now: the next run then knows the cheaper option
      if (t.blocked && t.read && !busyQ[t.read.queue]) needRead(t.read.page, t.read.bodyId, t.read.why, t.read.mode);
      // an energy fix that cannot start now (fields, shipyard busy...): the next cheapest fix option
      if (t.blocked && cand.fixOptions && cand.fixOptions.length > 1 && cand.fixOptions[0].steps[0] === first) {
        for (const o of cand.fixOptions.slice(1)) {
          const t2 = transform(o.steps[0], cand);
          if (!t2.blocked) { t2.why.unshift(`энергия: ${o.kind} (${t.blocked})`); t = t2; break; }
        }
      }
      if (t.blocked) { skipped.push({ cand, reason: t.blocked }); continue; }
      let step = t.step;
      const q = step.queue;
      if (busyQ[q]) { gate(cand, num(busyT[q], Infinity), step); skipped.push({ cand, reason: busyQ[q], step }); continue; }
      if (labHold && step.kind === 'research') { skipped.push({ cand, step, reason: `ждём лабораторию: «${labHold}» (во время исследования её не построить)` }); continue; }
      if (researchPlanned && labStep(step)) { skipped.push({ cand, step, reason: `в этом цикле начато исследование «${researchPlanned}»: лабораторию сервер не даст ставить` }); continue; }
      const payer = views[step.bodyId];
      const avail = availOf(payer, now, { reserved: input.reserved && input.reserved[payer.id], spent: spent[payer.id], deutReserve: input.deutReserve });
      const why = t.why.slice();
      let parChecked = false;
      if (cand.rule === 'mineSurplus') {
        // surplus only: the planet's own stock after what the other planets wait for (their delivery needs — kept only on a
        // planet logistics can ship from: 217 on it or botdebris' origin; a colony without 217 could never deliver them, audit
        // 2026-11-02) and after its own waiting step; never a wait, a reservation or a delivery request of its own
        const exporter = !Array.isArray(input.exporters) || input.exporters.some((id) => +id === +payer.id);
        const keep = res0();
        if (exporter) for (const [bid, r] of Object.entries(input.exportKeep || {})) if (+bid !== +payer.id) for (const k of RES) keep[k] += num(r && r[k]);
        const spare = res0(); for (const k of RES) spare[k] = avail[k] - keep[k];
        if (!affordable(step.cost, spare)) { skipped.push({ cand, step, reason: 'излишки: своих ресурсов не хватает (довоз не заказывается)' + (RES.some((k) => keep[k] > 0) ? ' — часть склада ждут другие планеты' : '') }); continue; }
        const cl = claimed[payer.id];
        if (cl && cl.cand !== cand) {
          // the planet saves for its waiting step (a research): the same par_tol test as for the stage mines, not a hard skip
          // (audit 2026-11-02, botbuild-2: an unaffordable research froze every surplus mine of the main planet for days)
          const d = parDelay(step, payer, cl);
          if (!d.ok) { skipped.push({ cand, step, reason: `излишки: планета копит на «${cl.cand.label}» (задержка ${fmtH(d.delayH)} > par_tol ${P.par_tol} × ${fmtH(cl.T / 3600)})` }); continue; }
          why.push(`копит на «${cl.cand.label}»: задержка ${fmtH(d.delayH)} ≤ par_tol × ожидание`);
          parChecked = true;
        }
        why.push('из излишков планеты');
      }
      if (floorHeld && !affordable(step.cost, avail)) { skipped.push({ cand, step, reason: floorHeld }); continue; }
      if (floorHeld) why.push('своя очередь свободна и свой склад платит — не ждём шахту другой планеты');
      if (step.kind === 'units' && +step.id === SAT && cand.fix && cand.fix.why) why.push(cand.fix.why);
      if (affordable(step.cost, avail)) {
        // the order needs the shipyard / defense page fresh: read it now (this pass), order in the next plan of the same run
        if (t.yardRead) {
          const failed = now - num(views[t.yardRead.bodyId] && views[t.yardRead.bodyId].yardFailT) < YARD_RETRY_MS;
          if (!failed) needRead(t.yardRead.page, t.yardRead.bodyId, t.yardRead.why, t.yardRead.mode);
          skipped.push({ cand, step, reason: failed ? 'страница верфи не прочиталась — повтор позже' : 'очередь верфи читается перед заказом' });
          busyQ[q] = 'читаю верфь перед заказом'; busyT[q] = 0;
          continue;
        }
        const cl = claimed[payer.id];
        if (cl && cl.cand !== cand && !parChecked) {
          const d = parDelay(step, payer, cl);
          if (!d.ok) { skipped.push({ cand, step, reason: `ждём «${cl.cand.label}»: задержка ${fmtH(d.delayH)} > par_tol ${P.par_tol} × ${fmtH(cl.T / 3600)}` }); continue; }
          why.push(`в другой очереди: задержка ${fmtH(d.delayH)} ≤ par_tol × ожидание`);
        }
        actions.push({ cand, step, why });
        busyQ[q] = 'занято шагом «' + cand.label + '»'; busyT[q] = 0;
        gate(cand, 0, step);
        if (step.kind === 'research') researchPlanned = cand.label;
        spent[payer.id] = addRes(spent[payer.id], step.cost);
        if (step.kind === 'building') plannedFields[payer.id] = num(plannedFields[payer.id]) + 1;
        continue;
      }
      let T = waitSec(step.cost, payer, avail);
      // overflow (policy): a resource reaches its storage while we wait -> that storage first
      if (P.overflow && Number.isFinite(T) && T > 0 && step.kind === 'building' && ![22, 23, 24].includes(step.id) && !busyQ['b:' + payer.id]) {
        for (const r of RES) {
          const x = payer.res && payer.res[r];
          if (!x || !(num(x.perHour) > 0) || !(num(x.storage) > 0)) continue;
          const full = OGX.calc.secondsUntilFull({ amount: avail[r] + num(spent[payer.id] && spent[payer.id][r]), storage: x.storage, perHour: x.perHour, t: now }, now);
          if (full < T) {
            const sid = STORE_OF[r]; const s2 = stepB(payer, sid, num(payer.levels[sid]) + 1);
            const t2 = transform(s2, cand, 1);
            if (t2.blocked) break;
            note('storage', `[${payer.coords}] ${name(r === 'metal' ? 1 : r === 'crystal' ? 2 : 3)}: хранилище заполнится за ${fmtH(full / 3600)} раньше, чем накопится на «${cand.label}» (${fmtH(T / 3600)})`, { body: payer.id, res: r, rule: 'overflow', fullSec: Math.round(full), waitSec: Math.round(T) });
            step = t2.step; why.push('переполнение во время ожидания');
            if (affordable(step.cost, avail)) {
              actions.push({ cand, step, why });
              busyQ[step.queue] = 'занято шагом «' + cand.label + '»';
              spent[payer.id] = addRes(spent[payer.id], step.cost);
              plannedFields[payer.id] = num(plannedFields[payer.id]) + 1;
              step = null;
            } else T = waitSec(step.cost, payer, avail);
            break;
          }
        }
        if (!step) continue;
      }
      waits.push({ cand, step, T, missing: missingOf(step.cost, avail), avail: Object.assign({}, avail), why });
      busyQ[q] = 'ждёт ресурсы на «' + cand.label + '»'; busyT[q] = T;
      gate(cand, T, step);
      if (!claimed[payer.id]) claimed[payer.id] = { cand, T: Number.isFinite(T) ? T : 1e12 };
    }
    return { candidates: cands, actions, waits, skipped, reads, notes, lab: lab ? lab.id : null,
      stage: tactic ? { id: tactic.stage.id, name: tactic.stage.name, mines: tactic.stage.mines, irnTarget: tactic.irnTarget } : null };
  }

  // ------------------------------------------------------------------ long-term plan (pure, information only)
  const FIELDS_BY_TERRAFORMER = 5;   // [UPSTREAM] constants.php FIELDS_BY_TERRAFORMER
  const RES_RU = { metal: 'металл', crystal: 'кристалл', deuterium: 'дейтерий' };
  /** Views (the planner's View shape) from the core state (OGX.state.bodies(): pages the player or the bot opened). Planets only. */
  function viewsFromState(bodies, nowMs) {
    let now = num(nowMs);
    if (!(now > 0)) { try { now = OGX.time.serverNow(); } catch (e) { now = Date.now(); } }
    const out = {};
    for (const b of Object.values(bodies || {})) {
      if (!b || b.type !== 'planet' || !b.levels || !Object.keys(b.levels).length) continue;
      const res = {};
      for (const r of RES) { const x = b.res && b.res[r]; res[r] = x && x.amount !== null && x.amount !== undefined ? { amount: num(x.amount), storage: x.storage, perHour: x.perHour === null || x.perHour === undefined ? null : num(x.perHour) } : null; }
      const e = b.energy;
      const qb0 = b.queues && b.queues.building;
      const levels = Object.assign({}, b.levels);
      let fieldsUsed = b.fieldsUsed;
      // the state keeps the last queue seen until the page is read again: an item whose end passed is built (level + 1 field),
      // not a busy queue (the items behind it are unknown)
      const ended = !!qb0 && num(qb0.endsAt) > 0 && num(qb0.endsAt) <= now;
      if (ended) {
        if (+qb0.objectId > 0 && num(qb0.targetLevel) > num(levels[qb0.objectId])) levels[qb0.objectId] = num(qb0.targetLevel);
        if (fieldsUsed !== null && fieldsUsed !== undefined) fieldsUsed = num(fieldsUsed) + 1;
      }
      const qb = ended ? null : qb0;
      const items = qb ? [{ id: qb.objectId, level: qb.targetLevel }].concat((qb.queued || []).map((x) => ({ id: x.objectId, level: x.targetLevel }))) : [];
      out[b.id] = { id: +b.id, key: b.key, coords: b.coords, name: b.name, isMoon: false, tempMax: num(b.tempMax), fieldsUsed, fieldsMax: b.fieldsMax,
        levels, res, t: num(b.res && b.res.t, 0),
        energy: e && e.production !== null && e.production !== undefined && e.consumption !== null && e.consumption !== undefined ? { production: num(e.production), consumption: num(e.consumption) } : null,
        sats: b.ships && b.ships[SAT] !== undefined && b.ships[SAT] !== null ? num(b.ships[SAT]) : null, percents: b.percents || {},
        queue: { known: !!(b.queues && b.queues.t) && !ended, busy: !!qb && num(qb.endsAt) > now, items, end: qb ? num(qb.endsAt) || null : null, ended }, src: 'state' };
    }
    return out;
  }
  /**
   * Long-term staged build plan of John's tactic (pure: no requests, no state access). input = { now, views: {id: View},
   * research: { levels }, planets: { used, max } | null, factors, cfg (labTarget, shipyardTarget, storageHours, fieldsReserve), astroCapped,
   * steps (per planet, default 8), researchSteps (default 8) }.
   * Returns { stage, stages: [{ id, name, eta, mines, pct, done, current }], planets: [{ id, coords, name, isMain, stage, done: { foundation, lab, mines },
   *   perHour, storeH, fields, energy, steps: [{ kind, id, level | n, rule, label, cost, etaH, stage, why }], blockers: [text] }],
   *   next: [{ planet, step }], research: { path: [...], unlock: [{ id, name, done, missing: [text] }], irnTarget, astroCapped, planets },
   *   totals: { perHour }, summary: text }. etaH = hours until the cumulative price of the planet's steps is in its stock at the current
   * production (0 = now, Infinity = no production of a needed resource); the research ETA uses the production of all planets (217 pooling).
   */
  function longTermPlan(input) {
    const cfg = input.cfg || {};
    const factors = input.factors || OGX.calc.factors({});
    const rlev = Object.assign({}, (input.research && input.research.levels) || {});
    const N = Math.max(1, num(input.steps, 8));
    const now = num(input.now, Date.now());
    const planets = Object.values(input.views || {}).filter((v) => v && !v.isMoon && v.levels).sort((a, b) => String(a.coords).localeCompare(String(b.coords), 'en', { numeric: true }));
    const ctx = tacticContext(planets, cfg);
    const tc = ctx.tc;
    const reserve = Math.max(1, num(cfg.fieldsReserve, 1));
    const storeCap = (L) => OGX.calc.storageCapacity(L, { factors });
    const mineLv = (lv) => ({ 1: num(lv[1]), 2: num(lv[2]), 3: num(lv[3]) });
    const totals = res0();

    const outPlanets = planets.map((v) => {
      syncFields(v);
      const lv = Object.assign({}, v.levels);
      for (const id of [1, 2, 3, 4, 12, 14, 15, 21, 22, 23, 24, 31, 33]) lv[id] = num(lv[id]);   // every id the simulation raises
      const model0 = prodOf(mineLv(lv), v, { 131: num(rlev[131]), 132: num(rlev[132]), 133: num(rlev[133]), 113: num(rlev[113]) }, factors);
      // real production (ticker) when known; the model (x22000, officers, 131-133, full energy) otherwise
      const real = res0(); const kf = {};
      for (const r of RES) {
        const x = v.res && v.res[r];
        const ph = x && x.perHour !== null && x.perHour !== undefined ? num(x.perHour) : null;
        real[r] = ph !== null ? ph : model0.perHour[r];
        const k = ph !== null && model0.perHour[r] > 0 ? ph / model0.perHour[r] : 1;
        kf[r] = k >= 0.5 && k <= 2 ? k : 1;
        totals[r] += Math.max(0, real[r]);
      }
      const prodAt = (l) => { const p = prodOf(mineLv(l), v, rlev, factors); const o = res0(); for (const r of RES) o[r] = p.perHour[r] * kf[r]; return { perHour: o, cons: p.energy.consumption }; };
      const stock = res0();
      for (const r of RES) { const x = v.res && v.res[r]; stock[r] = x ? Math.floor(OGX.calc.amountAt({ amount: num(x.amount), storage: x.storage, perHour: num(x.perHour), t: num(v.t, now) }, now)) : 0; }
      const ps = perSat(v, factors).value;
      let bal = v.energy ? num(v.energy.production) - num(v.energy.consumption) : null;
      const queued = (v.queue && v.queue.items) || [];
      let used = num(v.fieldsUsed) + queued.length; let max = num(v.fieldsMax);
      const fieldsKnown = num(v.fieldsMax) > 0;
      const isMain = !!ctx.main && ctx.main.id === v.id;
      const blockers = [];
      // ---- current blockers
      if (bal !== null && bal < 0) blockers.push(`Дефицит энергии ${fmtN(-bal)}: нужно спутников ×${Math.ceil(-bal / ps)}`);
      const storeH = {};
      for (const r of RES) {
        const x = v.res && v.res[r];
        const cap = x && num(x.storage) > 0 ? num(x.storage) : storeCap(lv[STORE_OF[r]]);
        storeH[r] = real[r] > 0 ? cap / real[r] : Infinity;
        if (cap < nextMineNeed(lv, r, ctx.stage.mines) * 1.1) blockers.push(`${name(STORE_OF[r])}: вмещает меньше цены следующей шахты`);
        else if (stock[r] >= cap && cap > 0) blockers.push(`${name(STORE_OF[r])}: заполнено`);
      }
      if (fieldsKnown && max - used <= reserve) blockers.push(`Поля кончаются: свободно ${Math.max(0, max - used)} из ${max} — нужен терраформер`);
      for (const t of planetTargets(v, ctx.stage, tc)) {
        if (lv[t.id] >= t.level) continue;
        const miss = reqSteps(t.id, { levels: lv }, rlev);
        const rs = (miss || []).filter((s) => s.kind === 'research');
        if (rs.length) blockers.push(`${name(t.id)} ${t.level}: сначала исследование ${rs.map((s) => name(s.id) + ' ' + s.level).filter((x, i, a) => a.indexOf(x) === i).slice(-1)[0]}`);
      }
      if (v.queue && v.queue.busy && !(num(v.queue.end) > 0 && num(v.queue.end) <= now)) blockers.push('Очередь построек занята' + (queued.length ? ': ' + queued.map((x) => name(x.id) + ' ' + (x.level || '')).join(', ') : ''));
      // ---- simulated steps
      const steps = [];
      const cum = res0();
      let st = ctx.stage;
      const push = (s) => {
        for (const r of RES) cum[r] += num(s.cost[r]);
        let h = 0;
        for (const r of RES) { const need = cum[r] - stock[r]; if (need <= 0) continue; h = real[r] > 0 ? Math.max(h, need / real[r]) : Infinity; }
        s.etaH = h; s.stage = st.id;
        steps.push(s);
      };
      // satellites need a shipyard (2Moons requirements): its missing building prerequisites come first, one level per step
      const satPre = () => {
        const m = reqSteps(SAT, { levels: lv }, rlev);
        if (!m || !m.length || m[0].kind !== 'building') return false;
        lv[m[0].id] = m[0].level; used += 1;
        push({ kind: 'building', id: m[0].id, level: m[0].level, rule: 'energy', label: `${name(m[0].id)} ${m[0].level} (для: ${name(SAT)})`, cost: costOf(m[0].id, m[0].level), why: `спутникам нужна ${name(21)}` });
        return true;
      };
      // a step whose price does not fit a store: that store first (the planner's «storage first»)
      const storeFirst = (cost, label) => {
        for (const r of RES) {
          const sid = STORE_OF[r];
          if (!(num(cost[r]) > storeCap(lv[sid]))) continue;
          lv[sid] += 1; used += 1;
          push({ kind: 'building', id: sid, level: lv[sid], rule: 'storageNeed', label: `${name(sid)} ${lv[sid]}`, cost: costOf(sid, lv[sid]), why: `цена «${label}» больше хранилища` });
          return true;
        }
        return false;
      };
      // stores at the cap now (the stock does not change in the simulation): one level each first
      const fullAtStart = {};
      for (const r of RES) fullAtStart[r] = !!(v.res && v.res[r] && num(v.res[r].storage) > 0) && stock[r] >= num(v.res[r].storage);
      let guard = 0;
      while (steps.length < N && guard++ < 200) {
        const pr = prodAt(lv);
        // 1. energy deficit -> satellites
        if (bal !== null && bal < 0) {
          if (satPre()) continue;
          const n = Math.ceil(-bal / ps);
          push({ kind: 'units', id: SAT, n, rule: 'energy', label: `${name(SAT)} ×${fmtN(n)}`, cost: OGX.calc.unitCost(SAT, n), why: `дефицит энергии ${fmtN(-bal)}` });
          bal += n * ps;
          continue;
        }
        // 2. storages (D, C, M), John 2026-11-01 «сначала шахты»: full now, below 1.1 x the next mine price, or below storageHours of
        //    production while not dearer than the cheapest next mine (a dearer one waits behind the mines: storageLate, not simulated)
        let did = false;
        for (const r of ['deuterium', 'crystal', 'metal']) {
          const sid = STORE_OF[r];
          const cap = storeCap(lv[sid]);
          let rule = null;
          if (fullAtStart[r] && lv[sid] === num(v.levels[sid])) rule = 'storageFull';
          else if (cap < nextMineNeed(lv, r, st.mines) * 1.1) rule = 'storageNeed';
          else if (cap < tc.storageHours * pr.perHour[r] && pr.perHour[r] > 0) {
            const sc = costOf(sid, lv[sid] + 1);
            if (num(sc.metal) + num(sc.crystal) + num(sc.deuterium) <= nextMineMinSum(lv, st.mines)) rule = 'storageHours';
          }
          if (!rule) continue;
          lv[sid] += 1; used += 1;
          push({ kind: 'building', id: sid, level: lv[sid], rule, label: `${name(sid)} ${lv[sid]}`, cost: costOf(sid, lv[sid]),
            why: rule === 'storageFull' ? 'хранилище заполнено' : rule === 'storageNeed' ? 'хранилище меньше цены следующей шахты' : `хранилище меньше ${tc.storageHours} ч добычи и дешевле следующей шахты` });
          did = true; break;
        }
        if (did) continue;
        // 3. fields: the reserve is reached -> terraformer
        if (fieldsKnown && max - used <= reserve) {
          if (storeFirst(costOf(33, num(lv[33]) + 1), `${name(33)} ${num(lv[33]) + 1}`)) continue;
          lv[33] = num(lv[33]) + 1; used += 1; max += FIELDS_BY_TERRAFORMER;
          push({ kind: 'building', id: 33, level: lv[33], rule: 'fields', label: `${name(33)} ${lv[33]}`, cost: costOf(33, lv[33]), why: 'поля кончаются' });
          continue;
        }
        // 4. foundation and the lab (targets whose research requirements are missing are skipped: a blocker above)
        for (const t of planetTargets({ levels: lv }, st, tc)) {
          if (lv[t.id] >= t.level) continue;
          const miss = reqSteps(t.id, { levels: lv }, rlev);
          if (!miss || miss.some((s) => s.kind === 'research')) continue;
          const sid = miss.length ? miss[0].id : t.id;
          if (storeFirst(costOf(sid, lv[sid] + 1), `${name(sid)} ${lv[sid] + 1}`)) { did = true; break; }
          lv[sid] += 1; used += 1;
          push({ kind: 'building', id: sid, level: lv[sid], rule: t.rule, label: `${name(sid)} ${lv[sid]}` + (sid === t.id ? ` (цель ${t.level})` : ` (для: ${name(t.id)})`), cost: costOf(sid, lv[sid]), why: t.rule === 'lab' ? `лаборатория до ${t.level}` : `фундамент: ${name(t.id)} ${t.level}` });
          did = true; break;
        }
        if (did) continue;
        // 5. the lowest-ranked mine below the stage target (energy by satellites first)
        let best = null;
        for (const id of [1, 2, 3]) {
          if (lv[id] >= num(st.mines[id])) continue;
          const rk = mineRank(id, lv[id]);
          if (!best || rk < best.rk) best = { id, rk };
        }
        if (!best) { st = stageAt(st.idx + 1); continue; }   // stage targets met on this planet: the next stage
        const nl = Object.assign({}, lv, { [best.id]: lv[best.id] + 1 });
        const dCons = prodAt(nl).cons - pr.cons;
        if (bal !== null && bal - dCons < 0) {
          if (satPre()) continue;
          const n = Math.ceil((dCons - bal) / ps);
          push({ kind: 'units', id: SAT, n, rule: 'energy', label: `${name(SAT)} ×${fmtN(n)}`, cost: OGX.calc.unitCost(SAT, n), why: `энергия для: ${name(best.id)} ${lv[best.id] + 1}` });
          bal += n * ps;
          continue;
        }
        if (storeFirst(costOf(best.id, lv[best.id] + 1), `${name(best.id)} ${lv[best.id] + 1}`)) continue;
        lv[best.id] += 1; used += 1;
        if (bal !== null) bal -= dCons;
        push({ kind: 'building', id: best.id, level: lv[best.id], rule: 'mine', label: `${name(best.id)} ${lv[best.id]}`, cost: costOf(best.id, lv[best.id]), why: `самая низкая шахта (ранг ${best.rk}), цель ${st.id}: ${st.mines[best.id]}` });
      }
      if (steps[0] && steps[0].etaH > 0) {
        const miss = [];
        const c = steps[0].cost;
        for (const r of RES) if (num(c[r]) > stock[r]) miss.push(`${RES_RU[r]} ${fmtN(num(c[r]) - stock[r])}`);
        if (miss.length) blockers.push(`Не хватает на «${steps[0].label}»: ${miss.join(', ')}` + (Number.isFinite(steps[0].etaH) ? ` (накопится за ${fmtH(steps[0].etaH)})` : ' (сама планета не накопит)'));
      }
      // fields needed until the current stage target
      if (fieldsKnown) {
        let need = 0;
        for (const id of [1, 2, 3]) need += Math.max(0, num(ctx.stage.mines[id]) - num(v.levels[id]));
        for (const t of planetTargets(v, ctx.stage, tc)) need += Math.max(0, t.level - num(v.levels[t.id]));
        const free = num(v.fieldsMax) - num(v.fieldsUsed) - queued.length;
        if (need > free) blockers.push(`До цели ${ctx.stage.id} нужно ~${need} полей, свободно ${Math.max(0, free)}`);
      }
      const fd = foundationDone(v, tc);
      return { id: v.id, coords: v.coords, name: v.name, isMain, stage: fd ? ctx.stage.id : 'S0', src: v.src || 'bot',
        done: { foundation: fd, lab: num(v.levels[31]) >= tc.labTarget, mines: meetsMines(v, ctx.stage.mines) },
        levels: { 1: num(v.levels[1]), 2: num(v.levels[2]), 3: num(v.levels[3]), 14: num(v.levels[14]), 15: num(v.levels[15]), 21: num(v.levels[21]), 31: num(v.levels[31]) },
        perHour: real, storeH, energy: v.energy ? num(v.energy.production) - num(v.energy.consumption) : null,
        fields: fieldsKnown ? { used: num(v.fieldsUsed), max: num(v.fieldsMax), queued: queued.length } : null, steps, blockers };
    });

    // ---- stages S1..S5 (and the current one beyond): progress = mean of min(1, level / target) over planets and mines
    const stages = [];
    const last = Math.max(BUILDUP.stages.length - 1, ctx.stage.idx);
    for (let i = 1; i <= last; i++) {
      const st = stageAt(i);
      let s = 0; let n = 0;
      for (const v of planets) for (const id of [1, 2, 3]) { s += Math.min(1, num(v.levels[id]) / num(st.mines[id])); n++; }
      stages.push({ id: st.id, name: st.name, eta: st.eta, mines: st.mines, stores: st.stores, research: st.research, pct: n ? Math.round(s / n * 1000) / 10 : 0,
        done: !!planets.length && planets.every((v) => meetsMines(v, st.mines)), current: i === ctx.stage.idx });
    }

    // ---- research path (pooled production of all planets)
    const lab = labPlanetOf(planets);
    const sim = Object.assign({}, rlev);
    const labLv = lab ? Object.assign({}, lab.levels) : {};
    const path = [];
    const rcum = res0();
    const RN = Math.max(1, num(input.researchSteps, 8));
    let g2 = 0;
    while (lab && path.length < RN && g2++ < 100) {
      const simLab = { id: lab.id, levels: labLv };
      let step = null;
      for (const sid of BUILDUP.research.unlock) {
        const miss = unlockSteps(sid, simLab, sim);
        if (miss && miss.length) { step = Object.assign({ why: `открывает «${name(sid)}» (${sid})`, rule: 'unlock' }, miss[0]); break; }
      }
      if (!step) {
        const o = researchOrder(sim, ctx, capReached(input, sim[124]))[0];
        const miss = o ? reqSteps(o.id, simLab, sim) : null;
        if (!o || !miss) break;
        step = miss.length ? Object.assign({ why: `нужно для: ${name(o.id)} ${o.level}`, rule: 'research' }, miss[0]) : { id: o.id, level: o.level, kind: 'research', why: o.why, rule: 'research' };
      }
      const cost = costOf(step.id, step.level);
      for (const r of RES) rcum[r] += num(cost[r]);
      let h = 0;
      for (const r of RES) if (rcum[r] > 0) h = totals[r] > 0 ? Math.max(h, rcum[r] / totals[r]) : Infinity;
      path.push({ kind: step.kind, id: step.id, level: step.level, rule: step.rule, label: `${name(step.id)} ${step.level}` + (step.kind === 'building' ? ` [${lab.coords}]` : ''), cost, etaH: h, why: step.why });
      if (step.kind === 'research') sim[step.id] = step.level; else labLv[step.id] = step.level;
    }
    const unlock = BUILDUP.research.unlock.map((sid) => {
      const miss = unlockSteps(sid, lab, rlev) || [];
      const yard = num((cat(sid) && (cat(sid).req || []).find((x) => +x[0] === 21) || [0, 0])[1]);
      const yardOk = planets.some((v) => num(v.levels[21]) >= yard);
      const missing = [];
      for (const s of miss) { const t = `${name(s.id)} ${s.level}`; const prev = missing.findIndex((x) => x.startsWith(name(s.id) + ' ')); if (prev >= 0) missing[prev] = t; else missing.push(t); }
      if (!yardOk) missing.push(`${name(21)} ${yard}` + (yard > tc.shipyardTarget ? ` (выше цели ${tc.shipyardTarget}: поднимите «Верфь до»)` : ''));
      return { id: sid, name: name(sid), done: !missing.length, missing };
    });
    const pl = input.planets && num(input.planets.max) > 0 ? { used: num(input.planets.used), max: num(input.planets.max) } : null;
    const next = outPlanets.filter((p) => p.steps[0]).map((p) => ({ planet: p.id, coords: p.coords, step: p.steps[0] }))
      .sort((a, b) => (RULE_RANK[a.step.rule] - RULE_RANK[b.step.rule]) || ((a.step.rule === 'mine' ? mineRank(a.step.id, a.step.level - 1) : 0) - (b.step.rule === 'mine' ? mineRank(b.step.id, b.step.level - 1) : 0)));
    const st = ctx.stage;
    const lagging = outPlanets.filter((p) => !p.done.mines).length;
    return {
      t: now, stage: { id: st.id, idx: st.idx, name: st.name, mines: st.mines, eta: st.eta }, stages, planets: outPlanets, next,
      research: { path, unlock, irnTarget: ctx.irnTarget, irn: num(rlev[123]), astroCapped: capReached(input, rlev[124]), planets: pl, freeSlot: !!pl && pl.used < pl.max },
      totals: { perHour: totals }, targets: tc,
      summary: planets.length ? `Этап ${st.id} «${st.name}»: до шахт ${st.mines[1]}/${st.mines[2]}/${st.mines[3]} не дошли планет ${lagging} из ${planets.length}.` : 'Нет данных о планетах.',
    };
  }

  // ------------------------------------------------------------------ chain needs for logistics (pure)
  const sameStep = (a, b) => !!a && !!b && a.kind === b.kind && +a.id === +b.id && num(a.level) === num(b.level) && num(a.n) === num(b.n);
  /**
   * The planet's planned chain for the next `aheadMin` minutes of build time: `first` (the step it waits for, always included; null
   * for a planet without a wait) then the planet's own steps of the long-term plan (longTermPlan().planets[i].steps, the same
   * simulation as «План застройки», not a second planner) while the summed build time fits. Building steps already in the queue or
   * reached are skipped; units count their price but no building-queue time; research is never part of a planet chain.
   * input = { view, first, steps, aheadMin, gameSpeed, factors } -> [step]
   */
  function chainFor({ view, first = null, steps = [], aheadMin = 0, gameSpeed, factors }) {
    const lv = Object.assign({}, (view && view.levels) || {});
    for (const it of (view && view.queue && view.queue.items) || []) if (+it.id > 0 && num(it.level) > num(lv[it.id])) lv[it.id] = num(it.level);
    const out = [];
    const tOf = (s) => (s.kind === 'building' ? OGX.calc.buildTime(+s.id, num(s.level), { robotics: num(lv[14]), nanite: num(lv[15]), gameSpeed, factors }) : 0);
    const apply = (s) => { if (s.kind === 'building') lv[s.id] = Math.max(num(lv[s.id]), num(s.level)); };
    let sec = 0;
    if (first) { sec += first.kind === 'building' ? tOf(first) : 0; out.push(first); apply(first); }
    const budget = Math.max(0, num(aheadMin)) * 60;
    for (const s of steps || []) {
      if (!s || s.kind === 'research' || sameStep(s, first)) continue;
      if (s.kind === 'building' && num(s.level) <= num(lv[s.id])) continue;
      const t = tOf(s);
      if (!Number.isFinite(t) || sec + t > budget) break;
      sec += t; out.push(s); apply(s);
    }
    return out;
  }
  /**
   * One delivery need for a chain: per resource max(what the waiting step(s) miss, min(chain price − stock, storage room)); a
   * delivery never fills the planet above its storage (2Moons keeps a stock above the storage but stops production there).
   * input = { view, chain: [step], first: [step] (the waiting steps), avail: Res (stock usable now), at } -> { res, min, total, room }
   */
  function chainNeed({ view, chain = [], first = [], avail, at }) {
    const total = chain.reduce((c, s) => addRes(c, s.cost), res0());
    const base = first.reduce((c, s) => addRes(c, s.cost), res0());
    const res = res0(); const min = res0(); const room = res0();
    for (const r of RES) {
      const x = view && view.res && view.res[r];
      const stock = x ? OGX.calc.amountAt({ amount: x.amount, storage: x.storage, perHour: x.perHour, t: view.t }, at) : 0;
      room[r] = x && num(x.storage) > 0 ? Math.max(0, Math.floor(num(x.storage) - stock)) : Infinity;
      min[r] = Math.max(0, Math.ceil(num(base[r]) - num(avail && avail[r])));
      const want = Math.max(0, Math.ceil(num(total[r]) - num(avail && avail[r])));
      res[r] = Math.max(min[r], Math.min(want, room[r]));
    }
    return { res, min, total, room };
  }

  // ------------------------------------------------------------------ runtime state
  const M = {
    ctx: null, handle: null, views: {}, research: null, bodies: [], planets: null, imperiumT: 0, gameSpeed: null,
    retries: {}, cooldowns: {}, plan: null, resIds: [], loaded: false, lastRun: null,
    // long-term plan view: the last views / research / planet count the bot read (stored), the core state (pages the player opened),
    // astrophysics level -> planet maximum seen (planet cap detection), open planets of «План застройки»
    saved: null, stateCache: null, factors: null, astroSeen: {}, ltpOpen: new Set(),
  };
  async function load(store) {
    if (M.loaded) return;
    try {
      const st = store || (M.ctx && M.ctx.store);
      if (st) {
        M.gameSpeed = (await st.get('gameSpeed', null)) || null;
        M.retries = (await st.get('retries', {})) || {};
        M.cooldowns = (await st.get('cooldowns', {})) || {};
        M.plan = (await st.get('plan', null)) || null;
        M.saved = (await st.get('cache', null)) || null;
        M.astroSeen = (await st.get('astroSeen', {})) || {};
        M.imperiumT = num(await st.get('imperiumT', 0));   // once an hour also across page reloads (0.3.2)
        restoreCache(M.saved);
      }
    } catch (e) { /* defaults */ }
    M.loaded = true;
  }
  /** Cached views of the last runs (store 'cache') as the planning base after a reload; all stale (re-read before an order). */
  function restoreCache(saved) {
    if (!saved || !saved.views || Object.keys(M.views).length) return;
    let now; try { now = OGX.time.serverNow(); } catch (e) { now = Date.now(); }
    if (!(num(saved.t) > 0) || now - num(saved.t) > VIEW_MAX_AGE) return;
    for (const [id, v] of Object.entries(saved.views)) {
      if (!v || !v.levels) continue;
      M.views[id] = Object.assign({}, v, { stale: true, readAt: num(v.readAt, num(v.t)) });
    }
    if (!M.research && saved.research && saved.research.levels) M.research = { levels: saved.research.levels, queue: { known: false, busy: null, items: [], end: null }, t: num(saved.research.t), readAt: 0, stale: true };
  }

  // ------------------------------------------------------------------ cache upkeep (queue ends, estimates, freshness)
  /** Game speed for time estimates: the learned one (§8.5), else the speed measured on Aeternum. */
  function speedOf() { return M.gameSpeed && num(M.gameSpeed.value) > 0 ? num(M.gameSpeed.value) : SEED_SPEED; }
  /** Fills missing item ends of a busy queue (no timer on the page, or our own order) from the build / research time at the
   *  current game speed; the chain starts at `at`. Items without id / level stop the estimate. */
  /** botbuild-12: the lab level the server uses for a research time — the lab planet's lab plus the IRN labs (research 123) of the
   *  other planets (calc.effectiveLab); the lab alone while the network level is unknown. views: array or map of planet views. */
  function effLabOf(id, labView, views, research) {
    const lab = num(labView && labView.levels && labView.levels[31]);
    const irn = num(research && research[123]);
    if (!(irn > 0) || !labView) return lab;
    const list = Array.isArray(views) ? views : Object.values(views || {});
    const others = list.filter((v) => v && v.levels && !v.isMoon && +v.id !== +labView.id).map((v) => num(v.levels[31])).filter((l) => l > 0);
    try { const e = OGX.calc.effectiveLab(+id, lab, others, irn); return Number.isFinite(e) && e > lab ? e : lab; } catch (e) { return lab; }
  }
  /** The x1 time of a step on view v (a research with the IRN labs): the reference of the game-speed calibration. */
  function stepTime1(step, v, factors) {
    if (step.kind === 'research') return OGX.calc.researchTime(step.id, step.level, { labLevel: effLabOf(step.id, v, M.views, M.research && M.research.levels), university: num(v && v.levels[6]), gameSpeed: 1, factors });
    return OGX.calc.buildTime(step.id, step.level, { robotics: num(v && v.levels[14]), nanite: num(v && v.levels[15]), gameSpeed: 1, factors });
  }
  function estimateQueue(q, v, kind, at, research) {
    if (!q || !q.busy || !Array.isArray(q.items) || !q.items.length || q.items.every((x) => num(x.end) > 0)) return q;
    const gs = speedOf();
    const factors = M.factors || OGX.calc.factors({});
    const lv = Object.assign({}, (v && v.levels) || {});
    let t = at;
    for (const it of q.items) {
      if (num(it.end) > 0) { t = it.end; continue; }
      if (!(+it.id > 0) || !(+it.level > 0)) return q;
      let sec;
      try {
        sec = kind === 'research' ? OGX.calc.researchTime(+it.id, +it.level, { labLevel: effLabOf(+it.id, v, M.views, research || (M.research && M.research.levels)), university: num(lv[6]), gameSpeed: gs, factors })
          : OGX.calc.buildTime(+it.id, +it.level, { robotics: num(lv[14]), nanite: num(lv[15]), gameSpeed: gs, factors });
      } catch (e) { return q; }
      if (!Number.isFinite(sec)) return q;
      t += Math.max(1, sec) * 1000;
      it.end = t; it.est = true;
      if (kind !== 'research' && (+it.id === 14 || +it.id === 15)) lv[it.id] = +it.level;
    }
    q.end = q.items[q.items.length - 1].end;
    q.est = true;
    return q;
  }
  /** Queue items whose end passed are applied to the cached levels (level, field, storage capacity); the view is then stale. */
  function advanceQueue(q, levels, now, onDone) {
    if (!q || !q.busy || !Array.isArray(q.items) || !q.items.length) return { q, n: 0 };
    let n = 0;
    while (q.items.length && num(q.items[0].end) > 0 && q.items[0].end <= now) {
      const it = q.items.shift();
      if (+it.id > 0 && num(it.level) > num(levels[it.id])) { levels[it.id] = num(it.level); if (onDone) onDone(+it.id, num(it.level)); }
      n++;
    }
    if (n && !q.items.length) return { q: { known: true, busy: false, items: [], end: null, ended: true }, n };
    return { q, n };
  }
  function advanceViews(now) {
    for (const v of Object.values(M.views)) {
      if (!v || !v.levels) continue;
      const r = advanceQueue(v.queue, v.levels, now, (id, level) => {
        if (v.fieldsUsed !== null && v.fieldsUsed !== undefined) v.fieldsUsed = num(v.fieldsUsed) + 1;
        const res = { 22: 'metal', 23: 'crystal', 24: 'deuterium' }[id];
        if (res && v.res && v.res[res]) { try { const c = OGX.calc.storageCapacity(level, { factors: M.factors || OGX.calc.factors({}) }); if (c > 0) v.res[res].storage = c; } catch (e) { /* keep */ } }
      });
      if (r.n) { v.queue = r.q; v.stale = true; }
      if (v.shipyard && num(v.shipyard.end) > 0 && v.shipyard.end <= now && (v.shipyard.items || []).length) {
        // the yard queue ended by the page's time / the estimate: the satellites it held are built — their pending energy moves
        // into the production (an estimate: the next page=buildings read replaces it); the yard is no longer fresh, so a new
        // satellite batch first reads page=shipyard (a slower yard still shows them queued there: no duplicate order)
        const n212 = queuedSats(v);
        if (n212 > 0 && v.energy) v.energy = Object.assign({}, v.energy, { production: num(v.energy.production) + n212 * perSat(v, M.factors || OGX.calc.factors({})).value, credited: num(v.energy.credited) + n212 });
        v.shipyard.items = []; v.shipyard.t = 0; v.shipyard.end = null;
      }
    }
    if (M.research && M.research.queue && M.research.levels) {
      const r = advanceQueue(M.research.queue, M.research.levels, now);
      if (r.n) { M.research.queue = r.q; M.research.stale = true; }
    }
  }
  /** A yard queue still running when a page=buildings was rendered at `at`: the units built by then are in the page's energy, so
   *  only the rest stays queued (pending). Items are built in order; each item's share of the queue time is its unit time x count
   *  (count share when unknown), scaled to the queue's span base..end (review rev-botbuild-3: a mid-batch read counted the built
   *  satellites twice, and advanceViews a third time). `base` = the time the item list was last true; `t` (freshness) is kept. */
  function yardLeftAt(sy, at, levels) {
    if (!sy || !(num(sy.end) > at) || !(sy.items || []).length) return sy || null;
    const base = num(sy.base) || num(sy.t);
    if (!(base > 0) || at <= base) return sy;
    const span = num(sy.end) - base;
    const w = sy.items.map((x) => {
      let u = 1;
      try { u = OGX.calc.unitTime(+x.id, { shipyard: num(levels && levels[21]), nanite: num(levels && levels[15]), gameSpeed: speedOf(), factors: M.factors || OGX.calc.factors({}) }); } catch (e) { u = 1; }
      return (Number.isFinite(u) && u > 0 ? u : 1) * num(x.count);
    });
    const sum = w.reduce((a, b) => a + b, 0);
    if (!(sum > 0) || !(span > 0)) return sy;
    let gone = (at - base) / span * sum;
    const items = [];
    sy.items.forEach((x, i) => {
      if (gone >= w[i]) { gone -= w[i]; return; }
      const left = gone > 0 ? Math.ceil(num(x.count) * (1 - gone / w[i])) : num(x.count);
      gone = 0;
      if (left > 0) items.push({ id: x.id, count: left });
    });
    return Object.assign({}, sy, { items, base: at });
  }
  /** A view fit for an order: read from its page at most FRESH_MS ago, no queue end and no order since. */
  function freshView(v, now) { return !!v && !v.stale && now - num(v.readAt) <= FRESH_MS; }
  /** A view an order may be placed on without a read (0.3.2): page / answer page at most TRUST_MS old, no failed order since. */
  function trustedView(v, now) { return !!v && !v.mustRead && num(v.readAt) > 0 && now - num(v.readAt) <= TRUST_MS && !(v.queue && v.queue.known === false); }
  function freshResearch(now) { const R = M.research; return !!R && R.src !== 'imperium' && !R.stale && R.queue && R.queue.known && now - num(R.readAt) <= FRESH_MS; }
  async function save(store) {
    const st = store || (M.ctx && M.ctx.store);
    if (!st) return;
    try {
      await st.set('retries', M.retries);
      await st.set('cooldowns', M.cooldowns);
      if (M.plan) await st.set('plan', M.plan);
      if (Object.keys(M.views).length) {
        M.saved = { t: M.lastRun, views: M.views, research: M.research ? { levels: M.research.levels, t: M.research.t } : null, planets: M.planets };
        await st.set('cache', M.saved);
      }
      await st.set('astroSeen', M.astroSeen);
      await st.set('imperiumT', M.imperiumT || 0);
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ reads
  /** fresh: true = never the core's shared read cache (botcore.readCacheSec): right before an order the page must come from the server. */
  async function readPage(wctx, page, bodyId, why, mode, { fresh = false } = {}) {
    wctx.decide(`Читаю страницу «${PAGE_RU[mode] || PAGE_RU[page] || page}»` + (bodyId ? ' на ' + bodyRu(bodyId) : ''), { why, inputs: { page, mode: mode || null, bodyId: bodyId || null }, chosen: 'read.page', alternatives: [] });
    const r = await wctx.act({ type: 'read.page', module: NAME, prio: 'read', fresh: !!fresh, bodyId: bodyId || undefined, params: mode ? { page, mode } : { page }, why: why + ` (${page})` });
    if (!r || !r.ok || !r.data || !r.data.doc) { wctx.rec('skip', `Не прочитано ${page}: ${(r && (r.refused || r.error || r.message)) || 'нет ответа'}`, { reason: 'read', page, bodyId, refused: r && r.refused, error: r && r.error }); return null; }
    return { doc: r.data.doc, at: num(r.at, wctx.now()) };
  }
  function currentOf(doc) {
    try { const bl = OGX.parse.gz.bodies(doc); return { cur: bl.list.find((b) => b.selected) || null, bl }; } catch (e) { return { cur: null, bl: null }; }
  }
  function noteBodies(bl) {
    if (!bl || !bl.list || !bl.list.length) return;
    M.bodies = bl.list.map((b) => ({ id: +b.id, coords: b.coords, name: b.name, isMoon: !!b.isMoon, building: b.building, tip: b.tip }));
    if (bl.count) M.planets = { used: num(bl.count.used), max: num(bl.count.max) };
  }
  async function readBody(wctx, bodyId, why, opts) {
    const r = await readPage(wctx, 'buildings', bodyId, why, undefined, opts);
    if (!r) return null;
    return viewFromDoc(wctx, bodyId, r);
  }
  /** The view of a page=buildings document (a read, or the answer page of an own building order: no second read). */
  async function viewFromDoc(wctx, bodyId, r, { quiet = false } = {}) {
    const { cur, bl } = currentOf(r.doc);
    noteBodies(bl);
    if (!cur || +cur.id !== +bodyId) {
      if (quiet) return null;
      wctx.rec('skip', `Страница построек открыла другое тело (${cur ? cur.id : '?'} вместо ${bodyId})`, { reason: 'cpMismatch', bodyId, got: cur ? cur.id : null }); delete M.views[bodyId]; return null;
    }
    const G = OGX.parse.gz;
    const levels = {};
    for (const it of G.techItems(r.doc)) levels[it.id] = num(it.value);
    const R = G.resources(r.doc);
    let st = null;
    try { st = (await OGX.state.bodies())[(cur.isMoon ? 'm' : 'p') + bodyId] || null; } catch (e) { st = null; }
    const tip = cur.tip || {};
    const old = M.views[bodyId] || {};
    const v = {
      id: +bodyId, key: (cur.isMoon ? 'm' : 'p') + bodyId, coords: cur.coords, name: cur.name, isMoon: !!cur.isMoon,
      tempMax: tip.tempMax !== null && tip.tempMax !== undefined ? +tip.tempMax : num(st && st.tempMax, 0),
      fieldsUsed: tip.fieldsUsed !== null && tip.fieldsUsed !== undefined ? +tip.fieldsUsed : st && Number.isFinite(+st.fieldsUsed) && st.fieldsUsed !== null ? +st.fieldsUsed : null,
      fieldsMax: tip.fieldsMax !== null && tip.fieldsMax !== undefined ? +tip.fieldsMax : st && num(st.fieldsMax) > 0 ? +st.fieldsMax : null,   // null = unknown, never 0
      levels, t: r.at, readAt: r.at, stale: false, res: {}, energy: R.energy ? { production: num(R.energy.production), consumption: num(R.energy.consumption) } : null,
      queue: estimateQueue(parseQueue(r.doc, r.at), { levels }, 'building', r.at),
      // a yard queue whose end passed before this page was rendered is built and in the page's energy: drop it without a credit
      shipyard: old.shipyard && num(old.shipyard.end) > 0 && old.shipyard.end <= r.at && (old.shipyard.items || []).length ? { known: true, items: [], t: 0, end: null } : yardLeftAt(old.shipyard, r.at, old.levels || levels),
      defense: old.defense || null, perSat: old.perSat || null, perSatT: old.perSatT || 0, yardFailT: old.yardFailT || 0,
      percents: old.percents || (st && st.percents) || {}, sats: old.sats || null,
      had217T: old.had217T || 0,
      ships217: st && st.ships && st.ships[217] !== undefined && st.ships[217] !== null ? num(st.ships[217]) : old.ships217 !== undefined ? old.ships217 : null,
    };
    for (const k of RES) v.res[k] = R[k] ? { amount: num(R[k].amount), storage: R[k].storage, perHour: num(R[k].perHour) } : null;
    if (v.queue.busy === null && cur.building) v.queue = { known: false, busy: true, items: [], end: null };
    M.views[bodyId] = v;
    return v;
  }
  async function readResearch(wctx, labId, why, opts) {
    const r = await readPage(wctx, 'research', labId, why, undefined, opts);
    if (!r) return null;
    const { bl } = currentOf(r.doc);
    noteBodies(bl);
    const levels = {};
    for (const it of OGX.parse.gz.techItems(r.doc)) levels[it.id] = num(it.value);
    M.research = { levels, queue: estimateQueue(parseQueue(r.doc, r.at), M.views[labId], 'research', r.at, levels), t: r.at, readAt: r.at, stale: false, cp: labId };
    return M.research;
  }
  async function readShipyard(wctx, bodyId, why, mode = 'fleet', opts) {
    const r = await readPage(wctx, 'shipyard', bodyId, why, mode, opts);
    const v = M.views[bodyId];
    if (!r) { if (v) v.yardFailT = wctx.now(); return null; }
    const { cur } = currentOf(r.doc);
    if (!v || !cur || +cur.id !== +bodyId) { if (v) v.yardFailT = wctx.now(); return null; }
    v.yardFailT = 0;
    let q = null;
    try { q = OGX.parse.gz.shipyardQueue(r.doc); } catch (e) { q = null; }
    v.shipyard = { known: true, items: q ? q.items.map((x) => ({ id: x.id, count: x.count })) : [], t: r.at, end: q && q.totalSecs ? r.at + q.totalSecs * 1000 : null };
    if (!v.shipyard.end && v.shipyard.items.length) {
      // units listed without a time (secsPerUnit 0 on the page): the x3000 estimate, as after an order — a queue without an end
      // was never cleared and blocked the next satellite batch for good (review rev-botbuild-4)
      let sec = 0;
      for (const x of v.shipyard.items) {
        try { const u = OGX.calc.unitTime(+x.id, { shipyard: num(v.levels && v.levels[21]), nanite: num(v.levels && v.levels[15]), gameSpeed: speedOf(), factors: M.factors || OGX.calc.factors({}) }); if (Number.isFinite(u)) sec += Math.max(1, u) * num(x.count); } catch (e) { /* no estimate */ }
      }
      if (sec > 0) v.shipyard.end = r.at + sec * 1000;
    }
    const items = OGX.parse.gz.techItems(r.doc);
    if (mode === 'defense') { v.defense = {}; for (const it of items) v.defense[it.id] = num(it.value); }
    else { const s = items.find((x) => +x.id === SAT); if (s) v.sats = num(s.value); const bt = items.find((x) => +x.id === 217); if (bt) v.ships217 = num(bt.value); }
    return v;
  }
  async function readResources(wctx, bodyId, why) {
    const r = await readPage(wctx, 'resources', bodyId, why);
    if (!r) return null;
    const { cur } = currentOf(r.doc);
    const v = M.views[bodyId];
    if (!v || !cur || +cur.id !== +bodyId) return null;
    let rs = null;
    try { rs = OGX.parse.gz.resourceSettings(r.doc); } catch (e) { rs = null; }
    v.perSatT = r.at;
    if (rs) {
      if (rs.percents && Object.keys(rs.percents).length) v.percents = rs.percents;
      const row = (rs.rows || []).find((x) => +x.id === SAT);
      const cm = row ? /\(([^)]*)\)\s*$/.exec(row.label || '') : null;
      const count = cm ? num(String(cm[1]).replace(/\D/g, '')) : 0;
      if (row && count > 0 && num(row.energy) > 0) v.perSat = { value: num(row.energy) / count, count, energy: num(row.energy), t: r.at };
    }
    return v;
  }
  async function readImperium(wctx) {
    const r = await readPage(wctx, 'imperium', null, 'обзор всех планет (раз в час)');
    M.imperiumT = wctx.now();
    if (!r) return;
    const { bl } = currentOf(r.doc);
    noteBodies(bl);
    let e = null;
    try { e = OGX.parse.gz.empire(r.doc); } catch (x) { e = null; }
    if (!e) return;
    for (const [cp, b] of Object.entries(e.bodies || {})) if (M.views[cp] && b.ships && b.ships[SAT] !== undefined && M.views[cp].sats === null) M.views[cp].sats = num(b.ships[SAT]);
    for (const [cp, b] of Object.entries(e.bodies || {})) if (M.views[cp] && b.ships && b.ships[217] !== undefined && b.ships[217] !== null) M.views[cp].ships217 = num(b.ships[217]);
    for (const [cp, b] of Object.entries(e.bodies || {})) mergeImperium(M.views[cp], b, (e.columns || []).find((c) => +c.cp === +cp), r.at);
    if (!M.research && e.research && Object.keys(e.research).length) M.research = { levels: e.research, queue: { known: false, busy: null, items: [], end: null }, t: r.at, src: 'imperium' };
    else if (M.research && M.research.src !== 'imperium' && num(M.research.readAt) < r.at && e.research) {
      for (const [id, lv] of Object.entries(e.research)) if (Number.isFinite(lv) && lv > num(M.research.levels[id])) M.research.levels[id] = lv;
    }
  }
  /** page=imperium into a cached view read earlier: levels (queue items already built are dropped), stock, fields, domes. */
  function mergeImperium(v, b, col, at) {
    if (!v || !b || num(v.readAt) >= at) return;
    for (const [id, lv] of Object.entries(b.buildings || {})) if (Number.isFinite(lv) && lv >= 0) v.levels[id] = lv;
    if (v.queue && v.queue.busy && Array.isArray(v.queue.items) && v.queue.items.length) {
      v.queue.items = v.queue.items.filter((x) => !(+x.id > 0 && num(x.level) > 0 && num(v.levels[x.id]) >= num(x.level)));
      if (!v.queue.items.length) v.queue = { known: true, busy: false, items: [], end: null, ended: true };
    }
    const am = { metal: b.resources && b.resources[901], crystal: b.resources && b.resources[902], deuterium: b.resources && b.resources[903] };
    if (RES.every((k) => Number.isFinite(am[k]) && v.res && v.res[k])) { for (const k of RES) v.res[k].amount = am[k]; v.t = at; }
    if (col && Number.isFinite(col.fieldsUsed) && num(col.fieldsMax) > 0) { v.fieldsUsed = col.fieldsUsed; v.fieldsMax = col.fieldsMax; }
    if (b.defense && Object.keys(b.defense).length) v.defense = Object.fromEntries(Object.entries(b.defense).filter(([, n]) => Number.isFinite(n)));
  }

  // ------------------------------------------------------------------ worker
  function cfgAll(wctx) {
    const c = {};
    for (const k of Object.keys(SETTINGS)) c[k] = wctx.cfg(k);
    return c;
  }
  function knownPlanets() {
    if (M.bodies && M.bodies.length) return M.bodies;
    return [];
  }
  async function initialBodies() {
    if (M.bodies.length) return;
    try {
      const list = await OGX.state.bodyList();
      M.bodies = [];
      for (const x of list || []) {
        if (x.planet) M.bodies.push({ id: +x.planet.id, coords: x.planet.coords, name: x.planet.name, isMoon: false });
        if (x.moon) M.bodies.push({ id: +x.moon.id, coords: x.moon.coords, name: x.moon.name, isMoon: true });
      }
    } catch (e) { /* none */ }
    if (!M.bodies.length) { try { const c = OGX.state.current(); if (c && c.id) M.bodies = [{ id: +c.id, coords: c.coords, name: c.name, isMoon: !!c.isMoon }]; } catch (e) { /* none */ } }
  }
  function othersReserved() {
    const out = {};
    let list = [];
    try { list = OGX.bot.reservations.list(); } catch (e) { list = []; }
    for (const r of list) {
      if (r.module === NAME) continue;
      const id = +String(r.bodyKey || '').slice(1);
      if (!id) continue;
      out[id] = addRes(out[id], r.res);
    }
    return out;
  }
  /** Remembers the planet maximum per astrophysics level; true when the server cap is reached. */
  function astroCapped() {
    const astro = M.research && M.research.levels ? num(M.research.levels[124]) : null;
    const max = M.planets ? num(M.planets.max) : 0;
    if (astro === null) return false;
    if (!(max > 0)) return astroCappedOf(null, astro, 0);   // [x / y] unknown: the json's planet cap
    M.astroSeen = M.astroSeen || {};
    M.astroSeen[astro] = Math.max(num(M.astroSeen[astro]), max);
    return astroCappedOf(M.astroSeen, astro, max);
  }
  async function playerFactors() {
    let factors = null; let officers = {};
    try { const p = await OGX.state.player(); officers = (p && p.officers) || {}; } catch (e) { officers = {}; }
    try { factors = await OGX.state.factors(); } catch (e) { factors = null; }
    M.factors = factors || OGX.calc.factors({ officers });
    return { factors: M.factors, officers };
  }
  async function planInput(wctx, cfg, pol, order) {
    const { factors, officers } = await playerFactors();
    return {
      now: wctx.now(), P: pol.params, policyName: pol.name, cfg, views: M.views, order, research: M.research,
      factors, officers, gameSpeed: speedOf(), planets: M.planets,
      cooldowns: M.cooldowns, reserved: othersReserved(), deutReserve: num(wctx.core('deutReserve')), astroCapped: astroCapped(),
      exportKeep: M.needTotals || {}, exporters: exportersOf(wctx.now(), wctx.flights ? wctx.flights() : []), wants: (() => { try { return OGX.bot.wants.list(); } catch (e) { return []; } })(), expoOn: (() => { try { return !!OGX.bot.isActive('botexpo'); } catch (e) { return false; } })(),
    };
  }
  /** Planets logistics can ship from (John's rule 1: only 217 battle transporters haul): the ones with 217 per the last shipyard /
   *  imperium / state read, plus botdebris' configured origin; null while no ship count is known at all (then every planet keeps
   *  the other planets' delivery needs in stock, as before). The counts are ships parked at home: a planet whose 217 are out on a
   *  mission still counts while it showed 217 within EXPORTER_STICKY_MS or one of its own flights carries 217 (review
   *  rev-botbuild-2: the main dropped out whenever its fleet was away and spent the colonies' delivery stock). */
  function exportersOf(now, flights) {
    const t = num(now, Date.now());
    const flying = new Set();
    for (const f of flights || []) if (f && f.own && f.ships && num(f.ships[217]) > 0) flying.add(f.returnFlight ? f.destKey : f.originKey);
    let origin = '';
    try { origin = String(OGX.settings.get('botdebris.logisticsOrigin') || '').trim(); } catch (e) { origin = ''; }
    const out = [];
    let known = false;
    for (const v of Object.values(M.views)) {
      if (!v || v.isMoon) continue;
      if (v.ships217 !== undefined && v.ships217 !== null) {
        known = true;
        if (num(v.ships217) > 0) v.had217T = t;
        if (num(v.ships217) > 0 || (num(v.had217T) > 0 && t - num(v.had217T) <= EXPORTER_STICKY_MS) || (v.key && flying.has(v.key))) out.push(v.id);
      }
      if (origin && (String(v.id) === origin || String(v.coords) === origin.replace(/[[\]\s]/g, ''))) { known = true; if (!out.includes(v.id)) out.push(v.id); }
    }
    return known ? out : null;
  }
  function slimCand(c) {
    return { label: c.label, kind: c.kind, id: c.item, level: c.level || null, bodyId: c.bodyId, rule: c.rule || null,
      payback: Number.isFinite(c.payback) ? Math.round(c.payback * 1000) / 1000 : null, costMsu: Math.round(c.costMsu), gainMsu: Math.round(num(c.gainMsu) * 1000) / 1000, weight: c.weight,
      first: c.steps[0] ? { kind: c.steps[0].kind, id: c.steps[0].id, level: c.steps[0].level || null, n: c.steps[0].n || null, bodyId: c.steps[0].bodyId } : null, fix: c.fix || null };
  }
  function slimStep(s) { return { kind: s.kind, id: s.id, level: s.level || null, n: s.n || null, bodyId: s.bodyId, cost: s.cost, queue: s.queue }; }
  function stepRu(s) { return s.kind === 'units' ? `${name(s.id)} ×${s.n}` : `${name(s.id)} ${s.level}`; }
  function specOf(step, cand, why) {
    if (step.kind === 'building') return { type: 'build.building', module: NAME, prio: 'build', bodyId: step.bodyId, params: { id: step.id, cmd: 'insert' }, why, plan: { cand: slimCand(cand), step: slimStep(step) }, dedupeKey: 'botbuild:b:' + step.bodyId };
    if (step.kind === 'research') return { type: 'build.research', module: NAME, prio: 'build', bodyId: step.bodyId, params: { id: step.id }, why, plan: { cand: slimCand(cand), step: slimStep(step) }, dedupeKey: 'botbuild:r' };
    return { type: 'build.units', module: NAME, prio: 'build', bodyId: step.bodyId, params: { units: { [step.id]: step.n } }, why, plan: { cand: slimCand(cand), step: slimStep(step) }, dedupeKey: 'botbuild:s:' + step.bodyId };
  }

  /** §8.5: game speed from the queue time of an order we just placed. */
  async function calibrate(wctx, step, doc, at) {
    let q = null;
    try { q = parseQueue(doc, at); } catch (e) { q = null; }
    const head = q && q.items && q.items[0];
    if (!head || +head.id !== +step.id || !(num(head.rest) >= 5)) return;
    const v = M.views[step.bodyId];
    const { factors } = await playerFactors();
    const t1 = stepTime1(step, v, factors);
    if (!(t1 > 0)) return;
    const sample = t1 / num(head.rest);
    const g = M.gameSpeed || { samples: [] };
    g.samples = (g.samples || []).concat([Math.round(sample * 1e6) / 1e6]).slice(-5);
    const s = g.samples.slice().sort((a, b) => a - b);
    g.value = s[Math.floor(s.length / 2)];
    g.t = wctx.now();
    M.gameSpeed = g;
    try { await wctx.store.set('gameSpeed', g); } catch (e) { /* ignore */ }
    wctx.rec('build-verify', `Скорость игры по очереди: ×${Math.round(g.value * 100) / 100} (${name(step.id)} ${step.level}: ${head.rest} с)`, { gameSpeed: g.value, sample, rest: head.rest, est1: t1, id: step.id, level: step.level });
  }

  async function execute(wctx, a, cfg) {
    const { cand, step } = a;
    const why = `${stepRu(step)} на ${step.kind === 'research' ? 'лаборатории ' : ''}[${(M.views[step.bodyId] || {}).coords || step.bodyId}]` + (cand.rule ? ` — правило: ${ruleRu(cand.rule)}` : ` — окупаемость ${fmtH(cand.payback)}`) + (a.why.length ? ' (' + a.why.join('; ') + ')' : '');
    wctx.decide('Заказ: ' + stepRu(step), { why, inputs: { cand: slimCand(cand), step: slimStep(step), gameSpeed: M.gameSpeed && M.gameSpeed.value }, chosen: slimStep(step), alternatives: (M.lastAlternatives || []).slice(0, 4) });
    const r = await wctx.act(specOf(step, cand, why));
    const key = (step.kind === 'research' ? 'r' : step.bodyId) + ':' + step.id;
    if (!r) return { ok: false };
    if (r.dry) {
      wctx.rec(step.kind === 'research' ? 'research-start' : 'build-start', `Пробный режим: заказ «${stepRu(step)}» не отправлен`, { dry: true, step: slimStep(step), ok: r.ok, issues: r.data && r.data.issues });
      return { ok: true, dry: true };
    }
    if (r.refused) { wctx.rec('skip', `${stepRu(step)}: отказ исполнителя (${r.refused})`, { reason: r.refused, step: slimStep(step), message: r.message || null }); return { ok: false, refused: r.refused }; }
    if (r.ok && r.verified) {
      delete M.retries[key];
      let v = M.views[step.bodyId];
      if (v) {
        if (step.kind === 'building') {
          const was = v.queue && v.queue.busy && Array.isArray(v.queue.items) ? v.queue.items : [];
          v.queue = { known: true, busy: true, items: was.concat([{ id: step.id, level: step.level, end: null }]), end: was.length ? v.queue.end || null : null };
        }
        if (step.kind === 'units') {
          const at0 = num(r.at, wctx.now());
          v.shipyard = v.shipyard || { known: true, items: [], t: at0 };
          v.shipyard.items = (v.shipyard.items || []).concat([{ id: step.id, count: step.n }]);
          v.shipyard.t = at0;
          // the answer is page=shipyard of that planet rendered AFTER the insert: its queue (with the new batch and the remaining
          // time) is the truth, as fresh as a read; the x3000 estimate is used only when the page did not parse (audit 2026-11-02,
          // missed-2: adding the estimate on top of the page's time kept the cached yard busy twice as long). The ordered
          // satellites stay queued items: energyBalance counts their energy as pending until the queue drains (advanceViews /
          // the next page then credit the real value), so the next run never re-orders them (journal-6, botbuild-3).
          let yq = null;
          try { yq = r.data && r.data.doc ? OGX.parse.gz.shipyardQueue(r.data.doc) : null; } catch (e) { yq = null; }
          if (yq) v.shipyard = { known: true, items: yq.items.map((x) => ({ id: x.id, count: x.count })), t: at0, end: yq.totalSecs ? at0 + yq.totalSecs * 1000 : null };
          if (!yq || !(num(v.shipyard.end) > 0)) {
            try {
              const sec = OGX.calc.unitTime(step.id, { shipyard: num(v.levels[21]), nanite: num(v.levels[15]), gameSpeed: speedOf(), factors: M.factors || OGX.calc.factors({}) }) * num(step.n);
              if (Number.isFinite(sec)) v.shipyard.end = Math.max(num(v.shipyard.end), at0) + Math.max(1, sec) * 1000;
            } catch (e) { /* no estimate */ }
          }
        }
        for (const k of RES) if (v.res[k]) v.res[k].amount = Math.max(0, OGX.calc.amountAt(Object.assign({ t: v.t }, v.res[k]), wctx.now()) - num(step.cost[k]));
        v.t = wctx.now();
        v.stale = true;   // an order on the planet (the answer page below replaces the view for buildings)
      }
      if (step.kind === 'research' && M.research) { M.research.queue = { known: true, busy: true, items: [{ id: step.id, level: step.level, end: null }], end: null }; M.research.stale = true; }
      const at = num(r.at, wctx.now());
      if (r.data && r.data.doc) {
        if (step.kind === 'building' && v) {
          // the answer page is page=buildings of that planet: levels, stock and queue as fresh as a read (no read before the next order)
          let nv = null;
          try { nv = await viewFromDoc(wctx, step.bodyId, { doc: r.data.doc, at }, { quiet: true }); } catch (e) { nv = null; }
          if (nv) v = nv; else { const q = parseQueue(r.data.doc, at); if (q.known) v.queue = q; }
        }
        if (step.kind === 'research' && M.research) { const q = parseQueue(r.data.doc, at); if (q.known) M.research.queue = q; }
        if (step.kind !== 'units') await calibrate(wctx, step, r.data.doc, at);
      }
      // queue ends the answer page did not show: estimated at the game speed (the wake follows them)
      if (step.kind === 'building' && v) estimateQueue(v.queue, v, 'building', at);
      if (step.kind === 'research' && M.research) estimateQueue(M.research.queue, M.views[step.bodyId], 'research', at);
      wctx.rec(step.kind === 'research' ? 'research-start' : 'build-start', `${stepRu(step)} заказан [${(v || {}).coords || step.bodyId}]`, { step: slimStep(step), how: r.data && r.data.how, payback: Number.isFinite(cand.payback) ? cand.payback : null, rule: cand.rule || null });
      return { ok: true };
    }
    // not verified or failed: count per item, cooldown after maxRetries
    const n = (M.retries[key] = num(M.retries[key]) + 1);
    const max = Math.max(1, num(cfg.maxRetries, 3));
    let until = null;
    if (n >= max) { until = wctx.now() + COOLDOWN_MS; M.cooldowns[key] = until; delete M.retries[key]; }
    wctx.rec('build-verify', `${stepRu(step)}: не подтверждено (${n}/${max})` + (until ? ` — пауза до ${fmtT(until)}` : ''),
      { ok: false, step: slimStep(step), tries: n, maxRetries: max, cooldownUntil: until, error: r.error || null, message: r.message || null, note: r.verifyNote || null });
    // force a fresh read of that body / research before the next order
    if (step.kind === 'research') { if (M.research) { M.research.stale = true; M.research.readAt = 0; } } else if (M.views[step.bodyId]) { M.views[step.bodyId].stale = true; M.views[step.bodyId].readAt = 0; M.views[step.bodyId].mustRead = true; if (step.kind === 'units' && M.views[step.bodyId].shipyard) M.views[step.bodyId].shipyard.t = 0; }
    return { ok: false, unverified: true };
  }
  function ruleRu(r) {
    return { energy: 'энергия', fields: 'последнее поле', storageFull: 'хранилище заполнено', storageNeed: 'хранилище меньше цены шахты', storageHours: 'хранилище по часам добычи (дешевле шахты)', storageLate: 'хранилище по часам (после шахт)', expoSlots: 'слоты экспедиций', defense: 'купола',
      foundation: 'фундамент (роботы, наниты, верфь)', lab: 'лаборатория до цели', nanitesLate: 'наниты: шахты строятся долго', unlock: 'открыть 217/219',
      research: 'исследования по тактике', mine: 'самая низкая шахта', wants: 'запрос другого модуля (ракеты: шахта)' }[r] || r;
  }

  async function refresh(wctx, cfg, { force = [] } = {}) {
    const now = wctx.now();
    if (!M.imperiumT || now - M.imperiumT > IMPERIUM_EVERY) await readImperium(wctx);
    await initialBodies();
    let list = knownPlanets().filter((b) => !b.isMoon || cfg.moons);
    if (cfg.randomOrder) list = shuffle(list, Math.random);
    // planning runs on the cached views: a page is read only for a planet never read, a busy queue of unknown content (15 min),
    // the 6 h safety net, or `force` (right before an order on it)
    for (const b of list) {
      const v = M.views[b.id];
      const age = now - num(v && (v.readAt || v.t));
      const forced = force.includes(b.id) && !trustedView(v, now);
      const need = !v || forced || age > VIEW_MAX_AGE || (v.queue && v.queue.busy && !v.queue.end && age > UNKNOWN_Q_MS);
      if (need) await readBody(wctx, b.id, !v ? 'первые данные планеты' : forced ? 'свежие данные перед заказом' : 'данные устарели (страница не читалась давно)', { fresh: forced });
    }
    for (const id of Object.keys(M.views)) if (!M.bodies.some((b) => +b.id === +id)) delete M.views[id];
    if (cfg.research) {
      const lab = labPlanetOf(Object.values(M.views));
      const R = M.research;
      // the research view is trusted until its queue end (advanceViews applies the level; a fresh read comes before an order):
      // an unknown queue is re-read UNKNOWN_Q_MS after the last read, not on every pass (journal-18: 193 GET page=research in 3 h)
      const rAge = now - num(R && (R.readAt || R.t));
      const need = !R || R.src === 'imperium' || !R.queue || rAge > VIEW_MAX_AGE || ((!R.queue.known || (R.queue.busy && !R.queue.end)) && rAge > UNKNOWN_Q_MS)
        || (force.includes('research') && !freshResearch(now));
      if (lab && num(lab.levels[31]) > 0 && need) await readResearch(wctx, lab.id, force.includes('research') ? 'свежая очередь исследований перед заказом' : 'уровни и очередь исследований', { fresh: force.includes('research') });
    }
  }

  async function mainRun(wctx) {
    if (!OGX.bot.isActive(NAME)) { if (M.needSig !== '[]') clearNeeds(); return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'off' }; }
    await load(wctx.store);
    if (M.needSig === undefined) clearNeeds();   // first run of this session: botcore restored the previous session's needs — only this run's list counts
    M.lastRun = wctx.now();
    for (const id of M.resIds) wctx.release(id);
    M.resIds = [];
    for (const [k, u] of Object.entries(M.cooldowns)) if (u <= wctx.now()) delete M.cooldowns[k];
    const cfg = cfgAll(wctx);
    const pol = policyParams(cfg.policy, cfg.policyJson);
    if (pol.warnings.length) wctx.rec('skip', 'Параметры стратегии: ' + pol.warnings.join('; '), { reason: 'policyJson', warnings: pol.warnings });
    let result = { nextInMs: OGX.bot.randMs([600000, 1200000]), reason: 'нет данных' };
    try {
      // a transport / deployment to a planet arrived since its page was read: read it (the stock changed), once
      const arrived = [];
      for (const [k, t] of Object.entries(M.incoming || {})) {
        if (t > wctx.now()) continue;
        const v = Object.values(M.views).find((x) => x.key === k);
        if (v && num(v.t) < t) { v.stale = true; v.mustRead = true; arrived.push(v.id); }
        delete M.incoming[k];
      }
      await refresh(wctx, cfg, { force: arrived });
      advanceViews(wctx.now());
      let order = Object.values(M.views).filter((v) => !v.isMoon).map((v) => v.id);
      if (cfg.randomOrder) order = shuffle(order, Math.random);
      let out = plan(await planInput(wctx, cfg, pol, order));
      // second pass: fresh pages only for the bodies / queues an order would touch (every free queue of every planet in this run)
      const force = new Set();
      const labId = out.lab;
      for (const a of out.actions) {
        const v = M.views[a.step.bodyId];
        if (!trustedView(v, wctx.now())) force.add(a.step.bodyId);
        const labStepNow = a.step.kind === 'building' && (+a.step.id === 31 || +a.step.id === 6) && +a.step.bodyId === +labId;
        if ((a.step.kind === 'research' || labStepNow) && !freshResearch(wctx.now())) force.add('research');
      }
      const extra = out.reads.slice();
      if (force.size || extra.length) {
        await refresh(wctx, cfg, { force: [...force] });
        advanceViews(wctx.now());
        for (const rd of extra) {
          if (rd.page === 'shipyard') await readShipyard(wctx, rd.bodyId, rd.why, rd.mode || 'fleet', { fresh: true });
          else if (rd.page === 'resources') await readResources(wctx, rd.bodyId, rd.why);
        }
        out = plan(await planInput(wctx, cfg, pol, order));
        // the second plan may still want a shipyard read (e.g. satellites after the resources page): one more round
        const more = out.reads.filter((rd) => rd.page === 'shipyard' && !extra.some((x) => x.page === rd.page && x.bodyId === rd.bodyId && x.mode === rd.mode));
        for (const rd of more) await readShipyard(wctx, rd.bodyId, rd.why, rd.mode || 'fleet', { fresh: true });
        if (more.length) out = plan(await planInput(wctx, cfg, pol, order));
      }
      result = await act(wctx, cfg, pol, out);
    } finally { await save(wctx.store); }
    return result;
  }

  async function act(wctx, cfg, pol, out) {
    const now = wctx.now();
    for (const n of out.notes) {
      // the stage and the research reasoning only when they changed (or every 6 h): one line per run would be journal noise
      if (n.event === 'stage' || n.event === 'research') {
        const id = n.event === 'stage' ? n.data.stage : n.what;
        M.lastNotes = M.lastNotes || {};
        const last = M.lastNotes[n.event];
        if (last && last.id === id && now - last.t < 6 * HOUR) continue;
        M.lastNotes[n.event] = { id, t: now };
      }
      wctx.rec(n.event, n.what, n.data);
    }
    const top = out.candidates.slice(0, 5).map(slimCand);
    M.lastAlternatives = top;
    wctx.rec('candidates', `Кандидатов ${out.candidates.length}` + (top[0] ? `; лучший: ${top[0].label}` + (top[0].rule ? ` (правило ${ruleRu(top[0].rule)})` : ` (окупаемость ${fmtH(top[0].payback)})`) : ''),
      { policy: pol.name, params: pol.params, count: out.candidates.length, top, gameSpeed: M.gameSpeed && M.gameSpeed.value, gameSpeedUsed: speedOf(), lab: out.lab });
    for (const s of out.skipped.slice(0, 12)) if (s.cand && out.candidates.indexOf(s.cand) < 8) wctx.rec('skip', `${s.cand.label}: ${s.reason}`, { reason: s.reason, cand: slimCand(s.cand) });
    const bodyPlan = {};
    const results = [];
    let anyDry = false; let anyFail = false;
    for (const a of out.actions) {
      wctx.rec('choose', `Выбрано: ${stepRu(a.step)} [${(M.views[a.step.bodyId] || {}).coords || ''}] для «${a.cand.label}»` + (a.cand.rule ? ` — ${ruleRu(a.cand.rule)}` : ` — окупаемость ${fmtH(a.cand.payback)}`),
        { reason: a.cand.rule ? 'rule:' + a.cand.rule : 'payback', why: a.why, cand: slimCand(a.cand), step: slimStep(a.step) });
      const r = await execute(wctx, a, cfg);
      results.push(r);
      if (r.dry) anyDry = true;
      if (!r.ok) anyFail = true;
      bodyPlan[a.step.bodyId] = { label: a.cand.label, step: stepRu(a.step), payback: a.cand.payback, rule: a.cand.rule || null, state: r.dry ? 'пробный режим' : r.ok ? 'заказано' : r.refused ? 'отказ: ' + r.refused : 'не подтверждено', eta: null };
      if (r.refused === 'stopped' || r.refused === 'notLeader') break;
      if (r.refused === 'limit') { M.limitT = now; break; }   // the hourly builds limit: the other orders of this run would be refused too
    }
    // waits: wake times; per planet ONE chain need for logistics and a reservation only while a delivery is on its way
    let next = Infinity;
    const incoming = incomingByKey(wctx, now);
    const byBody = new Map();
    for (const w of out.waits) {
      const v = M.views[w.step.bodyId];
      const eta = Number.isFinite(w.T) ? now + w.T * 1000 : null;
      const stepTxt = `${stepRu(w.step)} [${(v || {}).coords || ''}]`;
      const forTxt = w.cand.label && w.cand.label !== stepTxt && !String(w.cand.label).includes(stepRu(w.step)) ? ` для «${w.cand.label}»` : '';
      wctx.rec('wait', `Жду ресурсы: ${stepTxt}${forTxt} — ` + (eta ? 'до ' + fmtT(eta) : 'не накопится сам (нет добычи или мало хранилища)') + (v && incoming[v.key] ? `; довоз в пути до ${fmtT(incoming[v.key])}` : ''),
        { cand: slimCand(w.cand), step: slimStep(w.step), waitSec: Number.isFinite(w.T) ? Math.round(w.T) : null, missing: w.missing, eta, incoming: v ? incoming[v.key] || null : null });
      // «ждёт ресурсы»: wake when the stock covers the price at the current production, at the latest in 5 min (re-plan)
      next = Math.min(next, eta ? Math.min(eta, now + WAIT_WAKE_MAX) : now + WAIT_WAKE_MAX);
      if (!v) continue;
      if (!byBody.has(v.id)) byBody.set(v.id, []);
      byBody.get(v.id).push(w);
      if (!bodyPlan[w.step.bodyId]) bodyPlan[w.step.bodyId] = { label: w.cand.label, step: stepRu(w.step), payback: w.cand.payback, rule: w.cand.rule || null, state: 'ждёт ресурсы', eta };
    }
    publishNeeds(wctx, cfg, pol, out, byBody, incoming, now);
    for (const s of out.skipped) {
      const b = s.cand && s.cand.bodyId;
      if (b && !bodyPlan[b]) bodyPlan[b] = { label: s.cand.label, step: s.step ? stepRu(s.step) : '', payback: s.cand.payback, rule: s.cand.rule || null, state: s.reason, eta: null };
    }
    // wake: queue ends, incoming own transports, expedition returns
    // a busy queue of unknown content (no end) is re-read UNKNOWN_Q_MS after its last read: wake for that read, not after the
    // 10–20 min pause (journal-18: the 15–18 min planet stalls of 0.3.1 — every candidate skipped, no event to wake for)
    // A re-read that was due in this run but did not happen (failed / refused read) is retried UNKNOWN_Q_MS later, not in 1 s:
    // a wake only for a read the next run will actually do (review rev-botbuild-1: a run every 2-3 s otherwise)
    const unknownQ = (q, readAt) => {
      if (!q || !((q.busy && !q.end) || q.known === false)) return Infinity;
      const due = num(readAt) + UNKNOWN_Q_MS;
      return due > now ? Math.max(now + 1000, due) : now + UNKNOWN_Q_MS;
    };
    for (const v of Object.values(M.views)) {
      if (v.queue && v.queue.end && v.queue.end > now) next = Math.min(next, v.queue.end);
      if (v.shipyard && v.shipyard.end && v.shipyard.end > now) next = Math.min(next, v.shipyard.end);
      // refresh() reads no moon while moons are off: no re-read wake for them
      if (v.queue && v.queue.busy && !v.queue.end && (!v.isMoon || cfg.moons)) next = Math.min(next, unknownQ(v.queue, v.readAt || v.t));
    }
    const R = M.research;
    if (R && R.queue && R.queue.end && R.queue.end > now) next = Math.min(next, R.queue.end);
    // refresh() reads page=research only on a planet with a lab: no re-read wake without one
    const labR = labPlanetOf(Object.values(M.views));
    if (R && R.queue && cfg.research && labR && num(labR.levels && labR.levels[31]) > 0) next = Math.min(next, unknownQ(R.queue, R.readAt || R.t));
    const ownKeys = new Set(Object.values(M.views).map((v) => v.key));
    for (const f of wctx.flights()) {
      if (!f || !f.own || !(+f.arrival > now)) continue;
      if (!f.returnFlight && (+f.missionType === 3 || +f.missionType === 4) && ownKeys.has(f.destKey)) next = Math.min(next, +f.arrival);
      if (f.returnFlight && +f.missionType === 15) next = Math.min(next, +f.arrival + OGX.bot.randMs([60000, 120000]));
    }
    M.plan = { t: now, policy: pol.name, stage: out.stage || null, bodies: bodyPlan, research: researchLine(out, now), gameSpeed: M.gameSpeed && M.gameSpeed.value, gameSpeedEst: speedOf(),
      views: Object.fromEntries(Object.values(M.views).map((v) => [v.id, { coords: v.coords, name: v.name, queue: v.queue && v.queue.items ? v.queue.items.map((x) => name(x.id) + ' ' + (x.level || '')) : [], queueEnd: v.queue && v.queue.end }])) };
    let nextAt;
    let reason;
    if (M.limitT === now) { nextAt = now + OGX.bot.randMs([60000, 120000]); reason = 'лимит заказов в час — проверка через 1–2 мин'; }
    else if (anyFail) { nextAt = now + OGX.bot.randMs([5000, 15000]); reason = 'повтор после ошибки'; }
    else if (anyDry) { nextAt = now + OGX.bot.randMs([600000, 1200000]); reason = 'пробный режим'; }
    else if (Number.isFinite(next)) { nextAt = Math.max(next, now) + OGX.bot.randMs([1000, 2000]); reason = 'до ' + fmtT(nextAt); }
    else { nextAt = now + OGX.bot.randMs([600000, 1200000]); reason = 'нет событий: проверка через 10–20 мин'; }
    if (results.length && !anyDry && !anyFail) nextAt = Math.min(nextAt, now + OGX.bot.randMs([5000, 10000]));
    // queue depth > 1: a planet that just took an order and still has room gets the next step in a few seconds
    const depth = Math.max(1, Math.min(MAX_BUILD_QUEUE, Math.floor(num(cfg.queueDepth, 1))));
    if (depth > 1 && !anyDry && out.actions.some((a, i) => results[i] && results[i].ok && a.step.kind === 'building' && (((M.views[a.step.bodyId] || {}).queue || {}).items || []).length < depth)) {
      nextAt = Math.min(nextAt, now + OGX.bot.randMs([300, 700]));
      reason = 'в очереди планеты есть место';
    }
    return { nextAt, reason: `заказов ${results.filter((x) => x.ok && !x.dry).length}, ожиданий ${out.waits.length}; ${reason}` };
  }
  /** Own transports / deployments flying to our planets: bodyKey -> latest arrival (also remembered for the read after arrival). */
  function incomingByKey(wctx, now) {
    const out = {};
    let list = [];
    try { list = wctx.flights() || []; } catch (e) { list = []; }
    for (const f of list) {
      if (!f || !f.own || f.returnFlight || !(+f.arrival > now) || !(+f.missionType === 3 || +f.missionType === 4) || !f.destKey) continue;
      out[f.destKey] = Math.max(num(out[f.destKey]), +f.arrival);
    }
    M.incoming = M.incoming || {};
    for (const [k, t] of Object.entries(out)) M.incoming[k] = Math.max(num(M.incoming[k]), t);
    return out;
  }
  /** The planets' own chains for the next needAheadMin minutes (tactic: the long-term plan's steps; other policies: none). */
  function planChains(cfg, pol, now) {
    const out = {};
    if (!pol.params.tactic || !(num(cfg.needAheadMin) > 0)) return out;
    let L = null;
    try { L = longTermPlan({ now, views: M.views, research: M.research, planets: M.planets, factors: M.factors, cfg, astroCapped: astroCapped(), steps: 24, researchSteps: 1 }); } catch (e) { L = null; }
    for (const p of (L && L.planets) || []) out[p.id] = p.steps || [];
    return out;
  }
  /** The queued-but-unpaid items of a planet as steps with their price: the building queue behind its head, and the research
   *  queue behind its head on the planet it was ordered from (2Moons pays items 2..n when they start). */
  function unpaidQueued(v) {
    const out = [];
    const add = (items) => { for (const it of (items || []).slice(1)) { if (!(+it.id > 0) || !(num(it.level) > 0)) continue; try { out.push({ id: +it.id, level: num(it.level), cost: costOf(+it.id, num(it.level)) }); } catch (e) { /* unknown item */ } } };
    add(v && v.queue && v.queue.items);
    if (v && M.research && M.research.queue && +M.research.cp === +v.id) add(M.research.queue.items);
    return out;
  }
  /** botbuild-10: an empty list replaces the needs botcore persisted — logistics must not haul for a module that is off or for a previous session. */
  function clearNeeds() {
    M.needSig = '[]'; M.needPubT = 0; M.needTotals = {}; M.needSince = {};
    try { OGX.bot.needs.set(NAME, []); } catch (e) { /* ignore */ }
  }
  /**
   * Logistics needs (OGX.bot.needs 'botbuild'), one per waiting planet: the chain of its next needAheadMin minutes (at least the
   * waiting step) minus its stock, capped by its storage; none while an own transport flies to it (the chain is being delivered:
   * then the waiting steps are reserved so nobody takes what is coming for them). Also one 'keep' entry per planet: the price of
   * its own chain, which logistics leaves on it (no repatriation / source of a delivery below that). Published only on change.
   */
  function publishNeeds(wctx, cfg, pol, out, byBody, incoming, now) {
    const ahead = Math.max(0, num(cfg.needAheadMin, 45));
    const chains = planChains(cfg, pol, now);
    const gs = speedOf(); const factors = M.factors || OGX.calc.factors({});
    const needs = []; const keeps = [];
    // botbuild-10: deterministic priority — the planet missing the largest share of its step first, then the game's planet order
    const order = (bodyId) => { const i = (M.bodies || []).findIndex((b) => +b.id === +bodyId); return i >= 0 ? i : 1e6 + num(bodyId); };
    M.needSince = M.needSince || {};
    const ids = new Set();
    for (const v of Object.values(M.views)) {
      if (!v || !v.key) continue;
      const ws = byBody.get(v.id) || [];
      const bw = ws.find((w) => w.step.kind === 'building');
      const chain = chainFor({ view: v, first: bw ? bw.step : null, steps: v.isMoon ? [] : chains[v.id] || [], aheadMin: ahead, gameSpeed: gs, factors });
      for (const w of ws) if (w !== bw) chain.push(w.step);
      // botbuild-11: the queue items behind the head are paid only when they start (2Moons SetNextQueueElementOnTop drops an
      // unaffordable one silently): their price stays on the planet too
      const unpaid = unpaidQueued(v);
      const keepRes = chain.concat(unpaid).reduce((c, s) => addRes(c, s.cost), res0());
      if (RES.some((r) => keepRes[r] > 0)) keeps.push({ id: 'botbuild:keep:' + v.key, owner: NAME, kind: 'keep', bodyKey: v.key, res: null, keep: keepRes, chain: chain.map((s) => ({ id: s.id, level: s.level || null, n: s.n || null })), queued: unpaid.map((s) => ({ id: s.id, level: s.level })), aheadMin: ahead });
      if (!ws.length) continue;
      if (incoming[v.key]) {
        const ttl = Math.max(10 * MIN, incoming[v.key] - now + 10 * MIN);
        for (const w of ws) { try { M.resIds.push(wctx.reserve(v.key, { metal: num(w.step.cost.metal), crystal: num(w.step.cost.crystal), deuterium: num(w.step.cost.deuterium) }, { ttlMs: ttl, label: 'стройка (довоз в пути): ' + stepRu(w.step) })); } catch (e) { /* ignore */ } }
        continue;
      }
      const w0 = ws[0];
      const n = chainNeed({ view: v, chain, first: ws.map((w) => w.step), avail: w0.avail || addRes(res0(), w0.step.cost, 1), at: now });
      if (!w0.avail) for (const r of RES) { n.min[r] = num(w0.missing[r]); n.res[r] = Math.max(n.res[r], n.min[r]); }
      if (!RES.some((r) => n.res[r] > 0)) continue;
      const id = 'botbuild:' + v.key + ':' + w0.step.id + ':' + (w0.step.level || w0.step.n);
      ids.add(id);
      if (!M.needSince[id]) M.needSince[id] = now;
      const costSum = RES.reduce((s, r) => s + num(w0.step.cost[r]), 0);
      const share = costSum > 0 ? Math.min(1, RES.reduce((s, r) => s + num(w0.missing && w0.missing[r]), 0) / costSum) : 1;
      needs.push({ id, owner: NAME, bodyKey: v.key, planKey: 'botbuild:' + v.key, res: n.res, min: n.min, forItem: { id: w0.step.id, level: w0.step.level || null },
        chain: chain.map((s) => ({ id: s.id, level: s.level || null, n: s.n || null })), aheadMin: ahead,
        wantedBy: M.needSince[id], priority: 0, share: Math.round(share * 1000) / 1000, until: now + 2 * HOUR, why: w0.cand.label, eta: Number.isFinite(w0.T) ? now + w0.T * 1000 : null, bodyId: v.id });
    }
    needs.sort((a, b) => b.share - a.share || order(a.bodyId) - order(b.bodyId) || a.bodyId - b.bodyId);
    needs.forEach((x, i) => { x.priority = needs.length - i; delete x.bodyId; });
    for (const id of Object.keys(M.needSince)) if (!ids.has(id)) delete M.needSince[id];
    // what each waiting planet still asks logistics for: the surplus mines of the other planets leave it in stock
    M.needTotals = {};
    for (const x of needs) { const bid = +String(x.bodyKey).slice(1); if (bid) M.needTotals[bid] = addRes(M.needTotals[bid], x.res); }
    const list = needs.concat(keeps);
    const sig = JSON.stringify(list.map((x) => [x.id, x.res, x.keep, x.min, x.priority]));
    // published on change, and once an hour anyway (the `until` of every need moves on; botcore's persisted copy stays fresh)
    if (sig === M.needSig && now - num(M.needPubT) < HOUR) return list;
    const changed = sig !== M.needSig;
    M.needSig = sig; M.needPubT = now;
    if (needs.length && changed) wctx.rec('wait', `Довоз под стройку: ${needs.map((x) => bodyRu(+String(x.bodyKey).slice(1)) + ' ' + RES.map((r) => fmtN(x.res[r])).join(' / ') + ` (шагов ${x.chain.length})`).join('; ')}`, { needs: needs.map((x) => ({ id: x.id, res: x.res, min: x.min, chain: x.chain })) });
    try { OGX.bot.needs.set(NAME, list); } catch (e) { /* ignore */ }
    return list;
  }
  function researchLine(out, now) {
    const a = out.actions.find((x) => x.step.kind === 'research');
    if (a) return { label: a.cand.label, step: stepRu(a.step), payback: a.cand.payback, state: 'заказ' };
    const w = out.waits.find((x) => x.step.kind === 'research');
    if (w) return { label: w.cand.label, step: stepRu(w.step), payback: w.cand.payback, state: 'ждёт ресурсы', eta: Number.isFinite(w.T) ? now + w.T * 1000 : null };
    const q = M.research && M.research.queue;
    if (q && q.busy) return { label: q.items.map((x) => name(x.id) + ' ' + (x.level || '')).join(', ') || 'идёт исследование', state: 'идёт', eta: q.end };
    return null;
  }

  // ------------------------------------------------------------------ panel section
  function renderPanel(container) {
    const h = (...a) => OGX.dom.h(...a);
    const P = M.plan;
    const now = OGX.time.serverNow();
    const left = (t) => (t ? (t > now ? 'через ' + fmtH((t - now) / HOUR) : fmtT(t)) : '—');
    container.appendChild(h('div', { class: 'ogx-b-build-sum' }, P ? `Стратегия «${POLICY_RU[P.policy] || P.policy}»` + (P.stage ? `, этап ${P.stage.id}` : '') + `; последний проход ${fmtT(P.t)}; скорость игры ${P.gameSpeed ? '×' + Math.round(P.gameSpeed * 100) / 100 : P.gameSpeedEst ? '×' + Math.round(P.gameSpeedEst) + ' (оценка по Aeternum, уточнится по первому заказу)' : 'ещё не известна'}` : 'Ещё не запускался.'));
    if (P) {
      const rows = Object.entries(P.views || {}).map(([id, v]) => {
        const b = (P.bodies || {})[id] || {};
        return h('tr', { dataset: { body: id } }, h('td', null, `${v.name || ''} [${v.coords || id}]`), h('td', null, b.step || (v.queue && v.queue.length ? 'в очереди: ' + v.queue.join(', ') : '—')),
          h('td', null, b.rule ? ruleRu(b.rule) : Number.isFinite(b.payback) ? fmtH(b.payback) : '—'), h('td', null, b.state || (v.queue && v.queue.length ? 'строится' : '—')), h('td', null, left(b.eta || v.queueEnd)));
      });
      container.appendChild(h('table', { class: 'ogx-table ogx-b-build-plan' }, h('tbody', null,
        h('tr', null, h('th', null, 'Тело'), h('th', null, 'Следующий шаг'), h('th', null, 'Правило / окупаемость'), h('th', null, 'Ожидание / причина'), h('th', null, 'Готово')), rows)));
      if (P.research) container.appendChild(h('div', { class: 'ogx-b-build-research' }, `Исследования: ${P.research.step || P.research.label} — ${P.research.state}` + (P.research.eta ? ', ' + left(P.research.eta) : '')));
    }
    renderLongTerm(container);
  }

  // ------------------------------------------------------------------ «План застройки» (information only, zero requests)
  /** Input of longTermPlan from cached data only: the bot's views (this tab, else the stored ones), the core state for planets the
   *  bot has not read, research levels and the planet count [x / y] likewise. Never a request. */
  function longTermInput() {
    const cfg = {};
    for (const k of ['labTarget', 'shipyardTarget', 'storageHours', 'fieldsReserve']) { try { cfg[k] = OGX.settings.get(NAME + '.' + k); } catch (e) { /* default */ } }
    const sc = M.stateCache || {};
    const views = viewsFromState(sc.bodies, OGX.time.serverNow());
    const take = (src) => { for (const v of Object.values(src || {})) if (v && !v.isMoon && v.levels && (!views[v.id] || num(v.t) >= num(views[v.id].t))) views[v.id] = Object.assign({ src: 'bot' }, v); };
    take(M.saved && M.saved.views);
    take(M.views);
    // planets the account no longer has (state bodies list is the truth when known)
    if (sc.bodies && Object.keys(sc.bodies).length) for (const id of Object.keys(views)) if (!sc.bodies['p' + id]) delete views[id];
    const levels = (M.research && M.research.levels) || (M.saved && M.saved.research && M.saved.research.levels) || (sc.research && sc.research.levels) || {};
    let planets = M.planets || (M.saved && M.saved.planets) || null;
    if (!planets) { try { const c = OGX.state.snapshot() && OGX.state.snapshot().planetCount; if (c && num(c.max) > 0) planets = { used: num(c.used), max: num(c.max) }; } catch (e) { /* none */ } }
    const astro = num(levels[124]);
    const capped = planets ? astroCappedOf(Object.assign({}, M.astroSeen || {}, { [astro]: Math.max(num((M.astroSeen || {})[astro]), num(planets.max)) }), astro, planets.max) : astroCappedOf(null, astro, 0);
    const factors = M.factors || (sc.player ? OGX.calc.factors({ officers: sc.player.officers || {}, boosts: Array.isArray(sc.player.boosts) ? sc.player.boosts : [] }) : OGX.calc.factors({}));
    return { now: OGX.time.serverNow(), views, research: { levels }, planets, factors, cfg, astroCapped: capped, steps: 8, researchSteps: 8 };
  }
  const costRu = (c) => RES.filter((r) => num(c && c[r]) > 0).map((r) => ({ metal: 'М', crystal: 'К', deuterium: 'Д' }[r]) + ' ' + fmtN(c[r])).join(' · ') || '0';
  const etaRu = (hh) => (!Number.isFinite(hh) ? 'не накопится сама' : hh <= 0 ? 'сейчас' : 'через ' + fmtH(hh));
  function renderLongTerm(container) {
    const h = (...a) => OGX.dom.h(...a);
    const box = h('div', { class: 'ogx-b-ltp', dataset: { ogxPart: 'buildPlan' } });
    container.appendChild(box);
    box.appendChild(h('div', { class: 'ogx-b-bot-h ogx-b-ltp-title' }, 'План застройки'));
    box.appendChild(h('div', { class: 'ogx-b-bot-muted' }, 'Только информация: план считается по уже сохранённым данным, без запросов к игре. ' +
      'Строит бот, только когда включены бот и «Стройка», а пробный режим выключен.'));
    let L;
    try { L = longTermPlan(longTermInput()); } catch (e) { box.appendChild(h('div', { class: 'ogx-bad' }, 'План не посчитан: ' + errText(e))); return; }
    if (!L.planets.length) { box.appendChild(h('div', { class: 'ogx-b-bot-muted ogx-b-ltp-empty' }, 'Нет данных о планетах: откройте в игре «Империю» или «Постройки» каждой планеты (или запустите бота).')); return; }
    const T = L.totals.perHour;
    box.appendChild(h('div', { class: 'ogx-b-ltp-sum' }, L.summary));
    box.appendChild(h('div', { class: 'ogx-b-bot-muted' }, `Добыча всех планет в час: металл ${fmtN(T.metal)}, кристалл ${fmtN(T.crystal)}, дейтерий ${fmtN(T.deuterium)}. ` +
      `Цели: лаборатория ${L.targets.labTarget}, верфь ${L.targets.shipyardTarget}, роботы 10, наниты 10, хранилища на ${L.targets.storageHours} ч добычи (авто, шахты важнее), энергия спутниками.`));
    // stages
    const st = h('div', { class: 'ogx-b-ltp-stages' });
    for (const s of L.stages) {
      st.appendChild(h('div', { class: 'ogx-b-ltp-stage' + (s.current ? ' ogx-b-ltp-cur' : '') + (s.done ? ' ogx-b-ltp-done' : ''), dataset: { stage: s.id } },
        h('span', { class: 'ogx-b-ltp-sid' }, s.id), h('span', { class: 'ogx-b-ltp-sname' }, `${s.name} (шахты ${s.mines[1]}/${s.mines[2]}/${s.mines[3]})`),
        h('span', { class: 'ogx-b-ltp-bar' }, h('span', { style: `width: ${Math.max(0, Math.min(100, s.pct))}%` })),
        h('span', { class: 'ogx-b-ltp-pct' }, (s.done ? 'готово' : String(s.pct).replace('.', ',') + ' %') + (s.current ? ' — сейчас' : ''))));
    }
    box.appendChild(st);
    // next steps across planets
    if (L.next.length) {
      box.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Следующие шаги (по всем планетам)'));
      box.appendChild(h('ol', { class: 'ogx-b-ltp-next' }, L.next.slice(0, 8).map((x) => h('li', null, `[${x.coords}] ${x.step.label} — ${costRu(x.step.cost)}, ${etaRu(x.step.etaH)} (${ruleRu(x.step.rule)})`))));
    }
    // planets (collapsible)
    for (const p of L.planets) {
      const open = M.ltpOpen.has(p.id);
      const lv = p.levels;
      const det = h('details', { class: 'ogx-b-ltp-planet', open: open || undefined, dataset: { body: p.id },
        onToggle: (ev) => { if (ev.target.open) M.ltpOpen.add(p.id); else M.ltpOpen.delete(p.id); } },
      h('summary', null, `${p.name || ''} [${p.coords}]` + (p.isMain ? ' (главная)' : '') + ` — этап ${p.stage}; шахты ${lv[1]}/${lv[2]}/${lv[3]}, роботы ${lv[14]}, наниты ${lv[15]}, верфь ${lv[21]}, лаб. ${lv[31]}` +
        (p.blockers.length ? ` — мешает: ${p.blockers.length}` : '')));
      det.appendChild(h('table', { class: 'ogx-table ogx-b-ltp-steps' }, h('tbody', null,
        h('tr', null, h('th', null, '№'), h('th', null, 'Шаг'), h('th', null, 'Цена'), h('th', null, 'Готово'), h('th', null, 'Почему')),
        p.steps.map((s, i) => h('tr', { dataset: { id: s.id, rule: s.rule } }, h('td', null, String(i + 1)), h('td', null, s.label), h('td', null, costRu(s.cost)), h('td', null, etaRu(s.etaH)), h('td', null, `${s.why} (${s.stage})`))))));
      if (p.blockers.length) det.appendChild(h('ul', { class: 'ogx-b-ltp-block' }, p.blockers.map((b) => h('li', null, b))));
      const sh = p.storeH;
      det.appendChild(h('div', { class: 'ogx-b-bot-muted' }, `Добыча в час: М ${fmtN(p.perHour.metal)}, К ${fmtN(p.perHour.crystal)}, Д ${fmtN(p.perHour.deuterium)}; хранилища на М ${fmtH(sh.metal)}, К ${fmtH(sh.crystal)}, Д ${fmtH(sh.deuterium)}` +
        (p.fields ? `; поля ${p.fields.used}/${p.fields.max}` : '') + (p.energy !== null ? `; энергия ${p.energy >= 0 ? '+' : ''}${fmtN(p.energy)}` : '') + (p.src === 'state' ? '; данные со страниц игры' : '')));
      box.appendChild(det);
    }
    // research
    const R = L.research;
    box.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Исследования'));
    const info = [];
    for (const u of R.unlock) info.push(u.done ? `«${u.name}» (${u.id}) открыт` : `«${u.name}» (${u.id}): не хватает ${u.missing.join(', ')}`);
    info.push(`Сеть лабораторий: ${R.irn} из ${R.irnTarget}`);
    info.push(R.planets ? `Планет ${R.planets.used} из ${R.planets.max}` + (R.astroCapped ? ' — лимит планет достигнут, астрофизика не в приоритете' : ' — астрофизика первой до лимита планет') : `Число планет [x / y] ещё не известно — астрофизика до ${astroFallbackCap()} (лимит ${BUILDUP.planetCapFallback.max} планет по таблице, не проверено)` + (R.astroCapped ? ': достигнуто' : ''));
    if (R.freeSlot) info.push('Есть свободный слот планеты. ' + BUILDUP.colonizationRu);
    box.appendChild(h('ul', { class: 'ogx-b-ltp-rinfo' }, info.map((x) => h('li', null, x))));
    if (R.path.length) {
      box.appendChild(h('table', { class: 'ogx-table ogx-b-ltp-research' }, h('tbody', null,
        h('tr', null, h('th', null, '№'), h('th', null, 'Шаг'), h('th', null, 'Цена'), h('th', null, 'Готово (добыча всех планет)'), h('th', null, 'Почему')),
        R.path.map((s, i) => h('tr', { dataset: { id: s.id } }, h('td', null, String(i + 1)), h('td', null, s.label), h('td', null, costRu(s.cost)), h('td', null, etaRu(s.etaH)), h('td', null, s.why))))));
    }
  }
  /** Core state for «План застройки» (local storage, no request); redraws the bot panel tab when it changes. */
  async function loadStateCache() {
    try {
      const [bodies, research, player] = await Promise.all([OGX.state.bodies(), OGX.state.research(), OGX.state.player()]);
      M.stateCache = { bodies: bodies || {}, research: research || null, player: player || null, t: Date.now() };
    } catch (e) { M.stateCache = M.stateCache || null; }
    try { OGX.bus.emit('bot:panel-section', { module: NAME }); } catch (e) { /* ignore */ }
  }
  const LTP_CSS = `
.ogx-b-ltp { margin-top: 12px; font-size: 12px; }
.ogx-b-ltp-sum { color: #fff; margin: 4px 0; }
.ogx-b-ltp-stage { display: flex; gap: 6px; align-items: center; margin: 2px 0; }
.ogx-b-ltp-sid { width: 22px; font-weight: bold; }
.ogx-b-ltp-sname { flex: 1 1 auto; min-width: 0; }
.ogx-b-ltp-bar { flex: 0 0 120px; height: 8px; background: rgba(255,255,255,.08); border-radius: 4px; overflow: hidden; }
.ogx-b-ltp-bar > span { display: block; height: 100%; background: var(--ogx-ok, #4caf50); }
.ogx-b-ltp-pct { flex: 0 0 110px; text-align: right; }
.ogx-b-ltp-cur { color: #fff; font-weight: bold; }
.ogx-b-ltp-done { color: var(--ogx-muted, #8593a3); }
.ogx-b-ltp-planet { margin: 4px 0; border: 1px solid var(--ogx-border, #2b3846); border-radius: 3px; padding: 2px 6px; }
.ogx-b-ltp-planet > summary { cursor: pointer; }
.ogx-b-ltp-block li { color: var(--ogx-warn, #ffb300); }
.ogx-b-ltp-next, .ogx-b-ltp-rinfo, .ogx-b-ltp-block { margin: 2px 0 6px 18px; padding: 0; }
`;

  // ------------------------------------------------------------------ module
  OGX.module({
    name: NAME,
    title: 'Бот: стройка и исследования',
    settings: SETTINGS,
    async init(ctx) {
      M.ctx = ctx;
      if (!OGX.bot) { ctx.log.warn('OGX.bot missing: botbuild idle'); return; }
      await OGX.bot.ready;
      await load(ctx.store);
      try { ctx.css(LTP_CSS); } catch (e) { /* no style */ }
      M.handle = OGX.bot.register({ id: NAME, module: NAME, prio: 'build', startJitter: [5000, 15000], wakeOn: ['bot:fleet-returned', 'bot:bodies-changed', 'bot:wants'], run: mainRun });
      OGX.bot.panelSection(NAME, renderPanel);
      const follower = () => { try { return !OGX.bot.status().leader; } catch (e) { return false; } };
      ctx.store.subscribe('plan', (v) => { if (follower() && v && typeof v === 'object') M.plan = v; });
      ctx.store.subscribe('gameSpeed', (v) => { if (follower()) M.gameSpeed = v || null; });
      ctx.store.subscribe('cache', (v) => { if (follower() && v && typeof v === 'object') M.saved = v; });
      // «План застройки» reads the core state (local storage only); reload it when pages update the state
      let tm = null;
      ctx.bus.on('state:updated', () => { if (tm) return; tm = setTimeout(() => { tm = null; loadStateCache(); }, 1000); });
      loadStateCache();
    },
  });

  // Pure functions: OGX.botBuild.plan (one planning cycle) and longTermPlan («План застройки»); the rest for tests
  // (tests/gz-bot-mod-botbuild.test.js, tests/gz-bot-mod-buildplan.test.js); not an API for other modules.
  OGX.botBuild = { version: '2.0.0', POLICIES, SETTINGS, BUILDUP, _M: M, plan, longTermPlan,
    _lib: { plan, longTermPlan, viewsFromState, syncFields, levelFields, policyParams, mineGain, perSat, energyBalance, reqSteps, reqsMet, availOf, waitSec, msuOf, prodOf, parseQueue, costRange,
      stageAt, empireStage, tacticCfg, researchOrder, astroCappedOf, mineRank, labPlanetOf, exportersOf, queuedSats, execute, storageHoursOf, nextMineNeed, nextMineMinSum, estimateQueue, advanceViews, freshView, speedOf, SEED_SPEED, chainFor, chainNeed, publishNeeds, clearNeeds, mainRun, act, effLabOf, stepTime1, calibrate, readPage, readBody, readResearch, readShipyard, viewFromDoc, yardLeftAt } };
})(window.OGX);
