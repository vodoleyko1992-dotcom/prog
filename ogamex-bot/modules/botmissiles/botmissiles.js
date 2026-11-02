/* ogamex-bot/modules/botmissiles/botmissiles.js — «Бот: ракеты». Owner: module agent (0.3.2 feature).
 * Contract: specs/bot/BOT_CONTRACT.md (C1, C2, C5 botmissiles, C6 botmissiles events, C8).
 *
 * Request (John, 2026-11-02): «нужно чтобы ракеты летели на автомате для сноса обороны в ноль» — the bot BUILDS interplanetary
 * missiles (IPM, 503) and LAUNCHES them itself at the farm's inactive targets until their defence is zero, with no confirmation
 * per launch (this supersedes his 2026-10-31 rule «every launch needs two clicks», which still holds for the manual Infinity tool).
 *
 * Engine facts (re-checked in upstream 2Moons, scratchpad/src/2Moons; GALAXYZ is a fork):
 *   - Launch [UPSTREAM ShowFleetMissilePage.class.php]: POST page=fleetMissile { galaxy, system, planet, type, SendMI, Target } with
 *     cp = the launching planet; checks in this order: own vacation, silo (44) >= 4, impulse drive (117) >= 1, same galaxy and
 *     |dSystem| <= 117 * 5 - 1, target exists, Target 0 or a defence id, missiles > 0, count = min(SendMI, 503 on the planet) > 0,
 *     then admin / target vacation / noob / strong. The answer is an info page: «<b>N</b> Missles Deployed. Targeted: All» or the
 *     refusal text (botcore MISSILE_REFUSALS maps EN + RU texts to codes).
 *   - Flight [UPSTREAM FleetFunctions::GetMIPDuration]: max(round((30 + 60 * |dSystem|) / fleetSpeed), MIN_FLEET_TIME 5) s.
 *   - Impact [UPSTREAM MissionCaseMIP + calculateMIPAttack]: the target's interceptors (502; a moon uses its PLANET's) stop
 *     missiles 1:1 and are consumed; ABM >= missiles -> nothing is hit. The rest: attack = hits * 12000 * (1 + 0.1 * our 109),
 *     order primary (0 -> 401), 401..411, 503; a unit costs (metal + crystal) * (1 + 0.1 * target shield 110) / 10 (setting
 *     defTech can switch to armour 111). OGX.missiles.math (infinity/missiles, assigned at script load even when that module is
 *     off) implements it; its plan() gives needAll / needAllSafe.
 *   - Slots: missiles are a mission-10 fleet, but [UPSTREAM class.FleetFunctions.php:282 GetCurrentFleets] counts only
 *     fleet_mission != 10, so a launch takes NO fleet slot (the feature brief's «takes a slot» is wrong). No canSend/holdSlot,
 *     botfarm's maxSlots is never touched. Launches still count as fleet sends (botcore limit fleetSends) and respect threat locks.
 *   - Silo capacity [UPSTREAM BuildFunctions::getMaxConstructibleRockets]: silo level * 10 slots, IPM 2, ABM 1 (queued units too).
 *
 * Wave rule: fill the silo (or the whole need when smaller) before launching; launch min(need, IPM on the launcher); a wave smaller
 * than the target's ABM is allowed (it burns interceptors 1:1). One wave per target at a time and no new launch while any wave flies:
 * «the report is the truth» — after each wave botfarm re-spies the target (OGX.botFarm.api.respy, T.staleBefore makes the
 * pre-impact report stale) and the next wave is planned from the new report (bus bot:intel wakes the worker). Impact messages
 * are not parsed.
 *
 * Caps: maxPerTarget missiles per target in total, maxPerDay missiles per rolling 24 h; inactive farm targets only (botfarm's DB
 * holds inactives; a manual `targets` entry of an active player is skipped and journaled); server refusals stop the target
 * (vacation / noob / strong / admin / gone: blocked 24 h) or the launcher (silo / impulse: next launcher, 1 h).
 *
 * Silo hook: with no own planet with silo >= 4 in range the module publishes OGX.bot.wants { kind: 'building', id: 44, level: 4,
 * bodyId } (setting buildSilo) and botbuild's rule 'wants' builds it — botbuild owns the build queue, dedupe, requirement chains,
 * fields and energy checks, so ordering build.building 44 here would duplicate (and race) all of that; and botbuild may not read
 * OGX.botMissiles (C1), hence a botcore registry. Journal «нужна ракетная шахта 4 …» at most once per hour.
 *
 * Targets and intel come from botfarm's read-only OGX.botFarm.api (targets(), respy(key, at)) — the sanctioned cross-module
 * read of the farm DB; this module never reads the botfarm.* store (C1).
 * Dry run (botcore.dryRun): plans and journals only (botcore answers action-dry). Every game request goes through wctx.act (C1);
 * a wctx.decide precedes every action. Code comments English, user-visible text Russian. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const NAME = 'botmissiles';
  const SEC = 'Ракеты';
  const IPM = 503;
  const ABM = 502;
  const SILO = 44;
  const SILO_MIN = 4;
  const IMPULSE = 117;
  const H = 3600000;
  const DAY = 24 * H;
  const KEEP_MS = 7 * DAY;                    // cleared / blocked campaigns are pruned after a week
  const PLAN_PER_RUN = 5;                     // campaigns planned per worker pass
  const NO_FIGHT = [ABM, IPM];
  const DEF_IDS = [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411];

  const SETTINGS = {
    on: { type: 'bool', default: true, label: 'Ракеты на автомате: сносить оборону целей фарма в ноль', section: SEC },
    buildMissiles: { type: 'bool', default: true, label: 'Строить межпланетные ракеты (503) под волну', section: SEC },
    buildSilo: { type: 'bool', default: true, label: 'Просить стройку построить ракетную шахту 4, если пусковой нет', section: SEC },
    targets: { type: 'json', default: [], label: 'Доп. цели g:s:p (должны быть в базе фарма; активных бот не трогает)', section: SEC },
    exclude: { type: 'json', default: [], label: 'Не трогать цели g:s:p', section: SEC },
    maxReportAgeMin: { type: 'int', default: 180, min: 5, max: 1440, label: 'Доклад не старше (мин)', section: SEC },
    reservePct: { type: 'int', default: 10, min: 0, max: 100, label: 'Запас ракет сверх расчёта (%)', section: SEC },
    defTech: { type: 'enum', default: '110', label: 'Структура обороны считается по технологии', section: SEC,
      options: [{ value: '110', label: 'щитовая (как в 2Moons)' }, { value: '111', label: 'броня' }] },
    maxPerTarget: { type: 'int', default: 2000, min: 1, label: 'Не больше ракет на одну цель', section: SEC },
    maxPerDay: { type: 'int', default: 5000, min: 1, label: 'Не больше ракет за 24 часа', section: SEC },
  };

  // ------------------------------------------------------------------ small helpers (pure)
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const num = (v, d = 0) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? d : +v);
  const fmtT = (ms) => { try { return OGX.fmt.time(ms); } catch (e) { return '—'; } };
  const sysOf = (coords) => { const a = String(coords || '').split(':').map(Number); return Number.isFinite(a[1]) ? a[1] : 0; };
  const cfg = (k) => { try { return OGX.bot.cfg(NAME + '.' + k); } catch (e) { return SETTINGS[k] ? SETTINGS[k].default : undefined; } };

  /** Defence units that missiles can destroy (401..411) left in a report's intel. */
  function defLeftOf(intel) {
    const d = (intel && intel.defense) || {};
    let n = 0;
    for (const id of DEF_IDS) n += Math.max(0, Math.floor(num(d[id])));
    return n;
  }
  /**
   * Missiles needed to clear a target: { need, abm, defLeft, plan }. intel = botfarm intel (defense {id: n}, abm, ipm, research);
   * research = our levels; unknown target tech -> our own level of that tech (the safe side).
   */
  function needFor({ intel, research = {}, defTech = 110, reservePct = 10 }) {
    const it = intel || {};
    const tr = it.research || {};
    const dt = tr[defTech] !== undefined && tr[defTech] !== null ? num(tr[defTech]) : num(research[defTech]);
    const defense = Object.assign({}, it.defense || {}, num(it.ipm) > 0 ? { [IPM]: num(it.ipm) } : {});
    delete defense[ABM];
    const plan = OGX.missiles.math.plan({ defense, abm: num(it.abm), weapons: num(research[109]), defTech: dt, primary: 0, reservePct });
    return { need: plan.empty ? 0 : plan.needAllSafe, abm: num(it.abm), defLeft: defLeftOf(it), plan };
  }
  /** Free silo slots (botsave.js formula): silo * 10 - ABM - 2 * IPM - queued ABM - 2 * queued IPM. */
  function siloFree({ silo = 0, abm = 0, ipm = 0, queuedAbm = 0, queuedIpm = 0 } = {}) {
    return Math.max(0, num(silo) * 10 - num(abm) - 2 * num(ipm) - num(queuedAbm) - 2 * num(queuedIpm));
  }
  /**
   * One wave decision: { launch, build, wait, reason, capLeft, goal, siloCapIpm }.
   * reason: none | cap | siloFull | ready | build | yard | partial | empty.
   */
  function wave({ need, ipm = 0, abm = 0, silo = 0, queuedIpm = 0, queuedAbm = 0, launched = 0, maxPerTarget = 2000, dayLaunched = 0, maxPerDay = 5000, buildAllowed = true }) {
    ipm = Math.max(0, Math.floor(num(ipm))); queuedIpm = Math.max(0, Math.floor(num(queuedIpm)));
    const capLeft = Math.max(0, Math.min(num(maxPerTarget) - num(launched), num(maxPerDay) - num(dayLaunched)));
    const want = Math.min(Math.ceil(num(need)), capLeft);
    const free = siloFree({ silo, abm, ipm, queuedAbm, queuedIpm });
    const siloCapIpm = ipm + queuedIpm + Math.floor(free / 2);
    const goal = Math.min(want, siloCapIpm);
    const out = (launch, build, wait, reason) => ({ launch, build, wait, reason, capLeft, goal, siloCapIpm });
    if (want <= 0) return out(0, 0, false, capLeft <= 0 && num(need) > 0 ? 'cap' : 'none');
    if (goal <= 0) return out(0, 0, false, 'siloFull');
    if (ipm >= goal) return out(Math.min(ipm, want), 0, false, 'ready');
    const build = buildAllowed ? Math.max(0, goal - ipm - queuedIpm) : 0;
    if (build > 0) return out(0, build, true, 'build');
    if (queuedIpm > 0) return out(0, 0, true, 'yard');
    return out(Math.min(ipm, want), 0, false, ipm > 0 ? 'partial' : 'empty');
  }
  /**
   * Own planets that can hit `coords`, best first: planet (no moon), silo >= 4, impulse >= 1, in range, not threat-locked, not
   * marked bad. Order: most IPM (unknown defence = -1), largest silo, nearest system.
   */
  function launchersFor({ bodies, coords, impulse, now = 0, locked = () => false, bad = {}, exclude = [] }) {
    const list = Object.values(bodies || {}).filter((b) => b && !b.isMoon && b.type !== 'moon'
      && num((b.levels || {})[SILO]) >= SILO_MIN && num(impulse) >= 1
      && OGX.missiles.math.inRange(b.coords, coords, impulse)
      && !locked(b.key) && !(num(bad[b.id]) > now) && !exclude.includes(b.id));
    const ipmOf = (b) => (b.defenseT ? num((b.defense || {})[IPM]) : -1);
    const ds = (b) => Math.abs(sysOf(b.coords) - sysOf(coords));
    return list.sort((a, b) => ipmOf(b) - ipmOf(a) || num(b.levels[SILO]) - num(a.levels[SILO]) || ds(a) - ds(b));
  }
  /** Planet to ask a silo 4 for: the own planet (silo < 4) with the most targets in range; tie -> highest silo, then lowest id. */
  function siloWant({ planets, targets, impulse }) {
    let best = null; let bestN = 0;
    for (const p of Object.values(planets || {})) {
      if (!p || p.isMoon || p.type === 'moon' || num((p.levels || {})[SILO]) >= SILO_MIN) continue;
      const n = (targets || []).filter((c) => OGX.missiles.math.inRange(p.coords, c, impulse)).length;
      if (!n) continue;
      const better = !best || n > bestN || (n === bestN && (num(p.levels[SILO]) > num(best.levels[SILO]) || (num(p.levels[SILO]) === num(best.levels[SILO]) && +p.id < +best.id)));
      if (better) { best = p; bestN = n; }
    }
    return best ? { id: best.id, key: best.key, coords: best.coords, inRange: bestN } : null;
  }
  /** Missiles launched after sinceMs (meta.launches [{ t, n }]). */
  function launchedSince(launches, sinceMs) { return (launches || []).filter((x) => num(x.t) > sinceMs).reduce((s, x) => s + num(x.n), 0); }
  /** Setting list -> Set of 'g:s:p:type' keys ('g:s:p' -> type 1; 'g:s:p:3' moon). */
  function parseKeys(list) {
    const out = new Set();
    for (const x of Array.isArray(list) ? list : []) {
      const m = /^\s*(\d+):(\d+):(\d+)(?::([13]))?\s*$/.exec(String(x));
      if (m) out.add(`${+m[1]}:${+m[2]}:${+m[3]}:${m[4] ? +m[4] : 1}`);
    }
    return out;
  }
  /** Units of `id` waiting in a body's shipyard queue (body.queues.unit of OGX.state). */
  function queuedUnits(unitQueue, id) {
    if (!unitQueue) return 0;
    return (unitQueue.queued || []).filter((x) => +x.id === +id).reduce((s, x) => s + num(x.amount), 0);
  }
  /** Expected missile flight in ms (+10 s margin for the impact event and the report read). */
  function flightMs(from, to, fleetSpeed) { return OGX.missiles.math.flightSecs(sysOf(from), sysOf(to), fleetSpeed) * 1000 + 10000; }
  function stateRu(s) {
    return { plan: 'расчёт', build: 'строятся ракеты', flying: 'ракеты летят', respy: 'ждёт доклад', cleared: 'оборона снесена', blocked: 'пауза' }[s] || s || '—';
  }

  // ------------------------------------------------------------------ module state (store keys botmissiles.targets / botmissiles.meta)
  // Campaign C (key 'g:s:p:type'): { key, coords, target: { galaxy, system, position, type }, playerName,
  //   state: 'plan' | 'build' | 'flying' | 'respy' | 'cleared' | 'blocked', stateAt, until, reason, note,
  //   launcher: { id, key, coords } | null, need, defLeft, abm, reportTs, launched, waves: [{ t, n, launcherId, arrival }],
  //   readyAt, arrival, staleBefore, respyAskedAt, dryAt, created }
  const M = { ctx: null, handle: null, targets: {}, meta: emptyMeta(), loaded: false, busy: 0, lastRun: null };
  function emptyMeta() { return { launches: [], siloNoteAt: 0, badLaunchers: {}, farmNoteAt: 0, researchReadAt: 0, levelReadAt: {} }; }
  async function load(force) {
    if (M.loaded && !force) return;
    const st = M.ctx.store;
    const [t, m] = await Promise.all([st.get('targets', {}), st.get('meta', null)]);
    M.targets = t && typeof t === 'object' ? t : {};
    M.meta = Object.assign(emptyMeta(), m && typeof m === 'object' ? m : {});
    M.loaded = true;
  }
  async function save(...keys) {
    const st = M.ctx.store;
    for (const k of keys.length ? keys : ['targets', 'meta']) await st.set(k, clone(M[k]));
  }
  /** Drop cleared / blocked campaigns older than a week and launches older than a day. */
  function prune(now) {
    for (const [k, C] of Object.entries(M.targets)) if ((C.state === 'cleared' || C.state === 'blocked') && now - num(C.stateAt) > KEEP_MS && !(num(C.until) > now)) delete M.targets[k];
    M.meta.launches = (M.meta.launches || []).filter((x) => now - num(x.t) < DAY);
  }
  function skip(wctx, what, reason, data) { wctx.rec('skip', what, Object.assign({ reason }, data || {})); }

  // ------------------------------------------------------------------ worker
  function setState(wctx, C, state, why, extra) {
    const from = C.state;
    C.state = state;
    C.stateAt = wctx.now();
    C.note = why || null;
    if (extra) Object.assign(C, extra);
    if (from !== state) wctx.rec('state', `[${C.coords}] ${stateRu(from)} → ${stateRu(state)}${why ? ': ' + why : ''}`, { key: C.key, from: from || null, to: state, why: why || null });
  }
  const isPlanet = (b) => b && !b.isMoon && b.type !== 'moon' && b.coords && b.id;
  const unitCost = (id, n) => {
    let p = null;
    try { const c = OGX.catalog.get(+id); p = c && c.price; } catch (e) { p = null; }
    p = p || (id === IPM ? { metal: 12500, crystal: 2500, deuterium: 10000 } : { metal: 8000, crystal: 0, deuterium: 2000 });
    return { metal: num(p.metal) * n, crystal: num(p.crystal) * n, deuterium: num(p.deuterium) * n };
  };
  /** Research (109 weapons, the defTech level, 117 impulse), bodies, fleet speed; page=research at most every 30 min when unknown. */
  async function runEnv(wctx, defTech) {
    let rs = await OGX.state.research().catch(() => null);
    const lv = (rs && rs.levels) || {};
    if ([109, defTech, IMPULSE].some((id) => lv[id] === undefined || lv[id] === null)) {
      if (wctx.now() - num(M.meta.researchReadAt) > 30 * 60000) {
        M.meta.researchReadAt = wctx.now();
        wctx.decide('Читаю исследования', { why: 'уровни оружейной, щитовой/брони и импульсного двигателя неизвестны (страница исследований не открывалась)', inputs: {}, chosen: 'read.page research', alternatives: [] });
        await wctx.act({ type: 'read.page', prio: 'read', params: { page: 'research' }, why: 'Ракеты: уровни исследований' });
        rs = await OGX.state.research().catch(() => null);
      }
    }
    const [server, bodies] = await Promise.all([OGX.state.server().catch(() => ({})), wctx.bodies()]);
    const research = (rs && rs.levels) || {};
    const fleetSpeed = server && +server.fleetSpeed > 0 ? +server.fleetSpeed : 7;
    return { research, bodies: bodies || {}, fleetSpeed, impulse: num(research[IMPULSE]) };
  }
  /** Fresh page=shipyard&mode=defense of a launcher (once per pass): IPM / ABM on the planet and the queued ones. */
  async function readSilo(wctx, env, L, why) {
    env.silo = env.silo || {};
    if (env.silo[L.id]) return env.silo[L.id];
    wctx.decide(`Читаю оборону [${L.coords}]`, { why: 'перед заказом / запуском: ракеты в шахте и очередь верфи (в империи ракет нет)', inputs: { body: L.id }, chosen: 'read.page shipyard defense', alternatives: [] });
    const r = await wctx.act({ type: 'read.page', bodyId: L.id, prio: 'read', fresh: true, params: { page: 'shipyard', mode: 'defense' }, why: 'Ракеты: ' + why + ' [' + L.coords + ']' });
    if (!r || !r.ok || r.dry || !r.data || !r.data.doc) {
      // dry run / no page: the core state of the body (defense page or imperium; missiles may be unknown there)
      const b = env.bodies[L.key] || L;
      const d = (b.defenseT && b.defense) || {};
      const out = { ok: !!(r && r.dry), ipm: num(d[IPM]), abm: num(d[ABM]), queuedIpm: queuedUnits(b.queues && b.queues.unit, IPM), queuedAbm: queuedUnits(b.queues && b.queues.unit, ABM), queueSecs: 0, error: r ? r.refused || r.error || null : 'no answer' };
      env.silo[L.id] = out;
      return out;
    }
    const units = {};
    try { for (const it of OGX.parse.gz.techItems(r.data.doc)) units[it.id] = it.value; } catch (e) { /* empty */ }
    let sq = null;
    try { sq = OGX.parse.gz.shipyardQueue(r.data.doc); } catch (e) { sq = null; }
    const items = (sq && sq.items) || [];
    const q = (id) => items.filter((x) => +x.id === id).reduce((s0, x) => s0 + num(x.count), 0);
    const out = { ok: true, ipm: num(units[IPM]), abm: num(units[ABM]), queuedIpm: q(IPM), queuedAbm: q(ABM), queueSecs: sq ? num(sq.totalSecs) : 0,
      perUnitIpm: (items.find((x) => +x.id === IPM) || {}).secsPerUnit || null };
    env.silo[L.id] = out;
    return out;
  }
  const BLOCK = { vacation: 'вы в режиме отпуска', targetVacation: 'игрок в режиме отпуска', noob: 'защита новичка', strong: 'игрок слишком сильный',
    admin: 'администратор', noTarget: 'планеты нет', wrongTarget: 'неправильная цель' };

  /**
   * One pass (BOT_CONTRACT C2 worker): research + bodies, campaigns reconciled from OGX.botFarm.api.targets(), housekeeping
   * (flying -> respy -> plan, build -> plan, blocked -> plan), then up to PLAN_PER_RUN campaigns planned: build 503 or launch a wave.
   */
  async function mainRun(wctx) {
    if (!OGX.bot.isActive(NAME)) {
      try { if (OGX.bot.wants.get(NAME).length) OGX.bot.wants.set(NAME, []); } catch (e) { /* ignore */ }
      return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'off' };
    }
    M.busy++;
    try {
      let now = wctx.now();
      if (!OGX.botFarm || !OGX.botFarm.api || !OGX.bot.isActive('botfarm')) {
        if (now - num(M.meta.farmNoteAt) > H) {
          M.meta.farmNoteAt = now;
          skip(wctx, 'Ракеты: нужен включённый «Фарм» — цели и доклады берутся из его базы', 'noFarm');
          await save('meta');
        }
        return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'нет фарма' };
      }
      await load();
      prune(now);
      M.lastRun = now;
      const defTech = String(cfg('defTech')) === '111' ? 111 : 110;
      const env = await runEnv(wctx, defTech);
      now = wctx.now();
      const { research, bodies, impulse } = env;
      const planets = Object.values(bodies).filter(isPlanet);
      const maxAge = num(cfg('maxReportAgeMin'), 180) * 60000;
      const manual = parseKeys(cfg('targets'));
      const excl = parseKeys(cfg('exclude'));
      M.notes = M.notes || {};
      const noteOnce = (k, ms) => { if (now - num(M.notes[k]) < ms) return false; M.notes[k] = now; return true; };

      // ---------- 1. campaigns from the farm DB
      let rows = [];
      try { rows = OGX.botFarm.api.targets() || []; } catch (e) { rows = []; }
      const byKey = new Map(rows.map((r) => [r.key, r]));
      for (const C of Object.values(M.targets)) {
        const row = byKey.get(C.key);
        const why = !row ? 'цели нет в базе фарма' : row.gone ? 'цели нет (отпуск / планета пропала)' : (row.excluded || excl.has(C.key)) ? 'исключена настройкой' : null;
        if (why && C.state !== 'flying') { wctx.rec('state', `[${C.coords}] снята: ${why}`, { key: C.key, removed: true, why }); delete M.targets[C.key]; }
      }
      for (const k of manual) {
        if (byKey.has(k) || !noteOnce('nofarm:' + k, H)) continue;
        // not a farm target: an active player (the galaxy cache shows no i / I) is never hit; anything else has no report here
        const [g, sy, pos] = k.split(':').map(Number);
        let row = null;
        try { const sys = OGX.galaxy && OGX.galaxy.cached ? await OGX.galaxy.cached(g, sy) : null; row = sys && Array.isArray(sys.positions) ? sys.positions.find((x) => x && +x.position === pos) : null; } catch (e) { row = null; }
        const coords = [g, sy, pos].join(':');
        if (row && row.playerName && !row.own && !/[iI]/.test(String(row.status || ''))) skip(wctx, `[${coords}] ${row.playerName}: активного игрока не трогаю`, 'active', { key: k, status: row.status || '' });
        else skip(wctx, `[${coords}] доп. цель не в базе фарма — нет доклада, ракеты не планирую`, 'notInFarm', { key: k });
      }
      if (impulse < 1) {
        if (noteOnce('impulse', H)) skip(wctx, 'Ракеты: нужен импульсный двигатель (117) ≥ 1', 'impulse', { impulse });
      }
      const siloTargets = [];
      for (const row of rows) {
        if (M.targets[row.key] || row.excluded || row.gone || excl.has(row.key)) continue;
        const isManual = manual.has(row.key);
        if (!row.inactive) {
          if (isManual && noteOnce('active:' + row.key, H)) skip(wctx, `[${row.coords}] ${row.playerName || ''}: активного игрока не трогаю`, 'active', { key: row.key });
          continue;
        }
        if (!isManual && !row.minLootOk) continue;
        if (!row.intelTs || impulse < 1) continue;
        let intel = null;
        try { intel = OGX.bot.intel.get(row.key); } catch (e) { intel = null; }
        if (!intel || !intel.known || !intel.known.defense || !intel.ts || now - intel.ts > maxAge) continue;
        if (row.staleBefore && intel.ts < row.staleBefore) continue;
        if (defLeftOf(intel) <= 0) continue;
        if (!planets.some((p) => OGX.missiles.math.inRange(p.coords, row.coords, impulse))) continue;
        M.targets[row.key] = { key: row.key, coords: row.coords, target: clone(row.target), playerName: row.playerName || null, state: null, stateAt: now, until: null, reason: null, note: null,
          launcher: null, need: null, defLeft: defLeftOf(intel), abm: num(intel.abm), reportTs: null, launched: 0, waves: [], readyAt: null, arrival: null, impactAt: null,
          staleBefore: null, respyAskedAt: null, dryAt: null, created: now, manual: isManual };
        setState(wctx, M.targets[row.key], 'plan', `оборона ${defLeftOf(intel)}, перехватчиков ${num(intel.abm)} (доклад ${fmtT(intel.ts)})`);
      }

      // ---------- 2. housekeeping
      for (const C of Object.values(M.targets)) {
        if (C.state === 'flying' && now >= num(C.arrival)) {
          setState(wctx, C, 'respy', 'ракеты долетели: жду новый доклад фарма', { respyAskedAt: now });
          wctx.rec('impact', `[${C.coords}] волна ${num((C.waves[C.waves.length - 1] || {}).n)} ракет долетела; новый доклад — через фарм`, { key: C.key, launched: C.launched, staleBefore: C.staleBefore });
          try { await OGX.botFarm.api.respy(C.key, C.staleBefore || now); } catch (e) { /* ignore */ }
        }
        if (C.state === 'respy') {
          let intel = null;
          try { intel = OGX.bot.intel.get(C.key); } catch (e) { intel = null; }
          if (intel && intel.ts && intel.ts > num(C.reportTs) && intel.ts >= num(C.staleBefore)) setState(wctx, C, 'plan', `новый доклад ${fmtT(intel.ts)}`);
          else if (now - num(C.respyAskedAt) > Math.min(maxAge, 30 * 60000)) {
            C.respyAskedAt = now;
            try { await OGX.botFarm.api.respy(C.key, Math.max(num(C.staleBefore), num(C.reportTs) + 1)); } catch (e) { /* ignore */ }
            wctx.rec('state', `[${C.coords}] доклада всё нет: прошу фарм отшпионить ещё раз`, { key: C.key });
          }
        }
        if (C.state === 'build' && now >= num(C.readyAt)) setState(wctx, C, 'plan', 'верфь должна была закончить');
        if (C.state === 'blocked' && C.until && now >= num(C.until)) setState(wctx, C, 'plan', 'пауза закончилась', { until: null, reason: null });
      }

      // ---------- 3. plan / build / launch
      const anyFlying = () => Object.values(M.targets).some((x) => x.state === 'flying');
      const dayLaunched = () => launchedSince(M.meta.launches, now - DAY);
      const bad = M.meta.badLaunchers || (M.meta.badLaunchers = {});
      for (const id of Object.keys(bad)) if (num(bad[id]) <= now) delete bad[id];
      let planned = 0;
      const plans = Object.values(M.targets).filter((C) => C.state === 'plan').sort((a, b) => num(a.created) - num(b.created));
      for (const C of plans) {
        if (planned >= PLAN_PER_RUN) break;
        if (C.dryAt && now - C.dryAt < 20 * 60000 && OGX.bot.isDryRun()) continue;
        planned++;
        let intel = null;
        try { intel = OGX.bot.intel.get(C.key); } catch (e) { intel = null; }
        if (!intel || !intel.known || !intel.known.defense || now - num(intel.ts) > maxAge || num(intel.ts) < num(C.staleBefore)) {
          setState(wctx, C, 'respy', 'доклад устарел: жду новый от фарма', { respyAskedAt: now, reportTs: intel ? num(intel.ts) : 0 });
          try { await OGX.botFarm.api.respy(C.key, now); } catch (e) { /* ignore */ }
          continue;
        }
        const r = needFor({ intel, research, defTech, reservePct: num(cfg('reservePct'), 10) });
        Object.assign(C, { need: r.need, abm: r.abm, defLeft: r.defLeft, reportTs: intel.ts });
        wctx.rec('plan', `[${C.coords}] оборона ${r.defLeft}, перехватчиков ${r.abm}: нужно ракет ${r.need} (запущено ${num(C.launched)})`,
          { key: C.key, need: r.need, needAll: r.plan.needAll, abm: r.abm, defLeft: r.defLeft, perMissile: r.plan.perMissile, total: r.plan.total, weapons: num(research[109]), defTech, reportTs: intel.ts });
        if (r.need <= 0 || r.defLeft <= 0) {
          setState(wctx, C, 'cleared', 'оборона снесена');
          wctx.rec('cleared', `[${C.coords}] оборона снесена в ноль (ракет запущено ${num(C.launched)}, волн ${C.waves.length}) — дальше грабит фарм`, { key: C.key, launched: C.launched, waves: C.waves.length });
          continue;
        }
        let launchers = launchersFor({ bodies, coords: C.coords, impulse, now, locked: (k) => !!wctx.locked(k), bad });
        if (!launchers.length) {
          // silo level unknown on a planet in range (page=buildings / imperium never seen): read it once per 30 min, then retry
          const unknown = planets.filter((p) => (p.levels || {})[SILO] === undefined && OGX.missiles.math.inRange(p.coords, C.coords, impulse)
            && now - num((M.meta.levelReadAt || {})[p.id]) > 30 * 60000);
          if (unknown.length) {
            const p = unknown[0];
            M.meta.levelReadAt = Object.assign({}, M.meta.levelReadAt || {}, { [p.id]: now });
            wctx.decide(`Читаю постройки [${p.coords}]`, { why: 'уровень ракетной шахты неизвестен', inputs: { key: C.key, body: p.id }, chosen: 'read.page buildings', alternatives: [] });
            const rb = await wctx.act({ type: 'read.page', bodyId: p.id, prio: 'read', params: { page: 'buildings' }, why: 'Ракеты: уровень ракетной шахты [' + p.coords + ']' });
            env.bodies = await wctx.bodies();
            Object.keys(bodies).forEach((k) => { delete bodies[k]; });
            Object.assign(bodies, env.bodies);
            // the page itself is the truth now (the core state may merge it a moment later)
            try {
              const it = rb && rb.ok && rb.data && rb.data.doc ? OGX.parse.gz.techItems(rb.data.doc).find((x) => +x.id === SILO) : null;
              const b = Object.values(bodies).find((x) => +x.id === +p.id);
              if (it && b) b.levels = Object.assign({}, b.levels, { [SILO]: num(it.value) });
            } catch (e) { /* state only */ }
            planets.splice(0, planets.length, ...Object.values(bodies).filter(isPlanet));
            launchers = launchersFor({ bodies, coords: C.coords, impulse, now, locked: (k) => !!wctx.locked(k), bad });
          }
        }
        if (!launchers.length) {
          C.launcher = null;
          C.note = `нет пусковой (шахта ${SILO_MIN}+) в пределах ${OGX.missiles.math.missileRange(impulse)} систем`;
          siloTargets.push(C.coords);
          continue;
        }
        const L = launchers[0];
        C.launcher = { id: L.id, key: L.key, coords: L.coords };
        const st = await readSilo(wctx, env, L, 'ракеты в шахте и очередь верфи');
        const w = wave({ need: r.need, ipm: st.ipm, abm: st.abm, silo: num(L.levels[SILO]), queuedIpm: st.queuedIpm, queuedAbm: st.queuedAbm, launched: C.launched,
          maxPerTarget: num(cfg('maxPerTarget'), 2000), dayLaunched: dayLaunched(), maxPerDay: num(cfg('maxPerDay'), 5000), buildAllowed: cfg('buildMissiles') !== false });
        const inputs = { key: C.key, launcher: L.coords, need: r.need, ipm: st.ipm, abm: st.abm, silo: num(L.levels[SILO]), queuedIpm: st.queuedIpm, launched: C.launched, wave: w };
        if (w.reason === 'cap') {
          const perTarget = num(C.launched) >= num(cfg('maxPerTarget'), 2000);
          const until = perTarget ? now + KEEP_MS : (Math.min(...(M.meta.launches || []).map((x) => num(x.t)), now) + DAY);
          setState(wctx, C, 'blocked', perTarget ? `лимит ${num(cfg('maxPerTarget'), 2000)} ракет на цель` : `лимит ${num(cfg('maxPerDay'), 5000)} ракет за сутки`, { until, reason: 'cap' });
          continue;
        }
        if (w.reason === 'siloFull') { bad[L.id] = now + H; C.note = `шахта [${L.coords}] занята перехватчиками`; skip(wctx, `[${C.coords}] шахта [${L.coords}] заполнена перехватчиками — места под МПР нет`, 'siloFull', inputs); continue; }
        if (w.build > 0) {
          const cost = unitCost(IPM, w.build);
          const avail = wctx.available(L.key);
          if (['metal', 'crystal', 'deuterium'].some((k) => num(avail[k]) < cost[k])) { C.note = 'не хватает ресурсов на ракеты'; skip(wctx, `[${C.coords}] ${w.build} МПР на [${L.coords}]: не хватает ресурсов`, 'resources', Object.assign({ cost, avail }, inputs)); continue; }
          const resId = wctx.reserve(L.key, cost, { ttlMs: 10 * 60000, label: 'межпланетные ракеты' });
          wctx.decide(`Строю ${w.build} МПР на [${L.coords}] для [${C.coords}]`, { why: `нужно ${r.need}, в шахте ${st.ipm} (+${st.queuedIpm} в очереди), шахта ${num(L.levels[SILO])} вмещает ${w.siloCapIpm}`, inputs, chosen: 'build.units 503 x' + w.build, alternatives: ['ждать', 'запустить что есть'] });
          const b = await wctx.act({ type: 'build.units', bodyId: L.id, prio: 'build', params: { units: { [IPM]: w.build } }, why: `Ракеты: ${w.build} МПР для [${C.coords}]` });
          if (!(b && b.ok && !b.dry)) wctx.release(resId);
          if (b && b.dry) { C.dryAt = now; C.note = '[пробный режим] заказ ракет не отправлен'; }
          else if (b && b.ok) {
            let secs = 0;
            try { const q = OGX.parse.gz.shipyardQueue(b.data && b.data.doc); secs = q ? num(q.totalSecs) : 0; } catch (e) { secs = 0; }
            if (!(secs > 0)) secs = Math.max(30, w.build * num(st.perUnitIpm, 2));
            setState(wctx, C, 'build', `строятся ${w.build} МПР на [${L.coords}]`, { readyAt: now + secs * 1000 + 3000 });
          } else C.note = 'заказ ракет не прошёл: ' + ((b && (b.message || b.error || b.refused)) || '?');
          wctx.rec('build', (b && b.dry ? '[пробный режим] ' : '') + `[${C.coords}] МПР ×${w.build} заказаны на [${L.coords}]` + (b && !b.ok && !b.dry ? ': ' + (b.message || b.error || b.refused) : ''),
            Object.assign({ ok: !!(b && b.ok), dry: !!(b && b.dry), cost }, inputs));
          continue;
        }
        if (w.reason === 'yard') { setState(wctx, C, 'build', `ждём верфь: ${st.queuedIpm} МПР в очереди [${L.coords}]`, { readyAt: now + Math.max(5, st.queueSecs) * 1000 + 3000 }); continue; }
        if (!(w.launch > 0)) { C.note = w.reason === 'empty' ? 'ракет нет, постройка ракет выключена' : 'нечего запускать'; skip(wctx, `[${C.coords}] ${C.note}`, w.reason, inputs); continue; }
        if (anyFlying()) { C.note = 'ждёт: другая волна в полёте'; continue; }
        if (wctx.locked(L.key)) { C.note = 'пусковая под угрозой'; continue; }
        wctx.decide(`Запускаю ${w.launch} МПР с [${L.coords}] по [${C.coords}]`, { why: `оборона ${r.defLeft}, перехватчиков ${r.abm}, нужно ${r.need}; волна ${C.waves.length + 1}` + (w.launch < r.need ? ` (шахта вмещает ${w.siloCapIpm})` : ''), inputs, chosen: 'fleet.missile x' + w.launch, alternatives: ['ждать'] });
        const r2 = await wctx.act({ type: 'fleet.missile', bodyId: L.id, prio: 'fleet', params: { target: clone(C.target), count: w.launch, primary: 0 }, dedupeKey: 'botmissiles:launch:' + C.key, why: `Ракеты: волна ${C.waves.length + 1} по [${C.coords}]` });
        now = wctx.now();
        if (r2 && r2.dry) { C.dryAt = now; C.note = '[пробный режим] запуск не отправлен'; wctx.rec('launch', `[пробный режим] [${C.coords}] ${w.launch} МПР с [${L.coords}] — не отправлено`, Object.assign({ dry: true }, inputs)); continue; }
        const possibly = r2 && !r2.ok && (r2.error === 'uncertain' || r2.error === 'missile');
        if (r2 && (r2.ok || possibly)) {
          const n = r2.ok ? Math.max(1, num(r2.data && r2.data.count, w.launch)) : w.launch;
          const impactAt = num(r2.at, now) + OGX.missiles.math.flightSecs(sysOf(L.coords), sysOf(C.coords), env.fleetSpeed) * 1000;
          const arrival = impactAt + 10000;
          C.launched = num(C.launched) + n;
          C.waves.push({ t: now, n, launcherId: L.id, arrival, ok: !!r2.ok });
          M.meta.launches.push({ t: now, n, key: C.key });
          setState(wctx, C, 'flying', `волна ${C.waves.length}: ${n} МПР, удар ${fmtT(impactAt)}` + (possibly ? ' (ответ не распознан — считаю запущенными)' : ''), { arrival, impactAt, staleBefore: impactAt + 1000 });
          try { await OGX.botFarm.api.respy(C.key, impactAt + 1000); } catch (e) { /* ignore */ }
          wctx.rec('launch', `[${C.coords}] запущено ${n} МПР с [${L.coords}] (волна ${C.waves.length}, всего ${C.launched}), удар ${fmtT(impactAt)}` + (possibly ? ': ответ не распознан' : ''),
            Object.assign({ ok: !!r2.ok, n, impactAt, uncertain: !!possibly, message: r2.message || null }, inputs));
          continue;
        }
        const code = r2 && r2.code;
        const msg = (r2 && (r2.message || r2.error || r2.refused)) || '?';
        if (code && BLOCK[code]) {
          setState(wctx, C, 'blocked', 'сервер отказал: ' + BLOCK[code], { until: now + DAY, reason: code });
          wctx.rec('refused', `[${C.coords}] запуск отклонён: ${BLOCK[code]} — пауза на сутки`, Object.assign({ code, message: msg }, inputs));
        } else if (code === 'silo' || code === 'impulse' || code === 'range') {
          bad[L.id] = now + H;
          C.note = `пусковая [${L.coords}] не подходит (${code})`;
          wctx.rec('refused', `[${C.coords}] запуск с [${L.coords}] отклонён (${code === 'silo' ? 'шахта меньше 4' : code === 'impulse' ? 'нет импульсного двигателя' : 'вне досягаемости'}): другая пусковая через час`, Object.assign({ code, message: msg }, inputs));
        } else {
          C.note = 'запуск не прошёл: ' + msg;
          wctx.rec('refused', `[${C.coords}] запуск не прошёл (${(r2 && (r2.refused || code || r2.error)) || '?'}): ${msg} — повторю позже`, Object.assign({ code: code || null, refused: (r2 && r2.refused) || null, message: msg }, inputs));
        }
      }

      // ---------- 4. silo hook (OGX.bot.wants -> botbuild rule 'wants')
      const want = siloTargets.length ? siloWant({ planets, targets: siloTargets, impulse }) : null;
      const wantList = want && cfg('buildSilo') !== false ? [{ kind: 'building', id: SILO, level: SILO_MIN, bodyId: want.id, why: 'ракеты: нужна пусковая шахта 4' }] : [];
      try {
        const cur = OGX.bot.wants.get(NAME);
        if (JSON.stringify(cur.map((x) => [x.id, x.level, x.bodyId])) !== JSON.stringify(wantList.map((x) => [x.id, x.level, x.bodyId]))) OGX.bot.wants.set(NAME, wantList);
      } catch (e) { /* ignore */ }
      if (siloTargets.length && now - num(M.meta.siloNoteAt) > H) {
        M.meta.siloNoteAt = now;
        const range = OGX.missiles.math.missileRange(impulse);
        wctx.rec('silo', `Нужна ракетная шахта ${SILO_MIN} на планете в пределах ${range} систем от целей (${siloTargets.length}: ${siloTargets.slice(0, 5).join(', ')})` +
          (want ? (cfg('buildSilo') !== false ? ` — прошу стройку построить её на [${want.coords}]` : ` — лучше на [${want.coords}] (автопостройка шахты выключена)`) : ' — своих планет в досягаемости нет'),
          { targets: siloTargets.slice(0, 20), range, want, buildSilo: cfg('buildSilo') !== false });
      }

      await save('targets', 'meta');
      // ---------- 5. next pass: the earliest arrival / yard, else m6 (bus bot:intel wakes on a new report)
      let next = now + OGX.bot.randMs(OGX.bot.INTERVALS.m6);
      for (const C of Object.values(M.targets)) {
        if (C.state === 'flying') next = Math.min(next, num(C.arrival) + 1000);
        if (C.state === 'build') next = Math.min(next, num(C.readyAt) + 1000);
        if (C.state === 'respy') next = Math.min(next, now + OGX.bot.randMs(OGX.bot.INTERVALS.s140));
        if (C.state === 'plan' && !(C.dryAt && OGX.bot.isDryRun())) next = Math.min(next, now + OGX.bot.randMs(OGX.bot.INTERVALS.s140));
      }
      const count = (s0) => Object.values(M.targets).filter((C) => C.state === s0).length;
      return { nextAt: Math.max(next, wctx.now() + 2000), reason: `целей ${Object.keys(M.targets).length}, в полёте ${count('flying')}, строится ${count('build')}` };
    } finally { M.busy--; }
  }

  // ------------------------------------------------------------------ panel section
  function renderPanel(container) {
    const h = (...a) => OGX.dom.h(...a);
    const list = Object.values(M.targets).sort((a, b) => (a.coords < b.coords ? -1 : 1));
    const day = launchedSince(M.meta.launches, (OGX.time && OGX.time.serverNow ? OGX.time.serverNow() : Date.now()) - DAY);
    container.appendChild(h('div', { class: 'ogx-b-mip-sum' }, `Целей: ${list.length}; ракет за сутки: ${day} из ${num(cfg('maxPerDay'), 5000)}` + (M.lastRun ? `; последний проход ${fmtT(M.lastRun)}` : '')));
    if (!list.length) { container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, 'Целей нет: ракеты берут неактивные цели фарма с обороной в пределах досягаемости ракетной шахты 4.')); return; }
    container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Ракеты'));
    container.appendChild(h('table', { class: 'ogx-table ogx-b-mip-targets' }, h('tbody', null,
      h('tr', null, h('th', null, 'Цель'), h('th', null, 'Оборона осталось'), h('th', null, 'Перехватчики'), h('th', null, 'Нужно / запущено'), h('th', null, 'Пусковая'), h('th', null, 'Состояние')),
      list.slice(0, 150).map((C) => h('tr', { dataset: { key: C.key, state: C.state || '' } },
        h('td', null, '[' + C.coords + ']' + (C.playerName ? ' ' + C.playerName : '')),
        h('td', null, C.defLeft === undefined || C.defLeft === null ? '?' : String(C.defLeft)),
        h('td', null, C.abm === undefined || C.abm === null ? '?' : String(C.abm)),
        h('td', null, `${C.need === undefined || C.need === null ? '?' : C.need} / ${num(C.launched)}`),
        h('td', null, C.launcher ? '[' + C.launcher.coords + ']' : '—'),
        h('td', null, stateRu(C.state) + (C.note ? ': ' + C.note : '')))))));
  }

  // ------------------------------------------------------------------ module
  OGX.module({
    name: NAME,
    title: 'Бот: ракеты',
    settings: SETTINGS,
    async init(ctx) {
      M.ctx = ctx;
      if (!OGX.bot || !(OGX.missiles && OGX.missiles.math)) { ctx.log.warn('OGX.bot / OGX.missiles.math missing: botmissiles idle'); return; }
      await OGX.bot.ready;
      await load();
      M.handle = OGX.bot.register({ id: NAME, module: NAME, prio: 'fleet', startJitter: [45000, 150000], wakeOn: ['bot:intel', 'bot:threat'], run: mainRun });
      OGX.bot.panelSection(NAME, renderPanel);
      // the panel copy in non-leader tabs follows the stored state
      const follower = () => { try { return !OGX.bot.status().leader; } catch (e) { return false; } };
      ctx.store.subscribe('targets', (v) => { if (follower() && !M.busy && v && typeof v === 'object') M.targets = v; });
      ctx.store.subscribe('meta', (v) => { if (follower() && !M.busy && v && typeof v === 'object') M.meta = Object.assign(emptyMeta(), v); });
    },
  });

  // Pure helpers for tests (tests/gz-bot-mod-botmissiles.test.js); not an API for other modules.
  OGX.botMissiles = { version: '1.0.0', _lib: { defLeftOf, needFor, siloFree, wave, launchersFor, siloWant, launchedSince, parseKeys, queuedUnits, flightMs, stateRu, NO_FIGHT, DEF_IDS }, _M: M, SETTINGS };
})(window.OGX);
