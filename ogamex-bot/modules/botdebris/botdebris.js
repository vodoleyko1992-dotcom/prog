/* ogamex-bot/modules/botdebris/botdebris.js — «Бот: обломки и логистика». Owner: module agent 3.
 * Contract: specs/bot/BOT_CONTRACT.md (C1, C2, C5 botdebris, C6 botdebris events, C8); algorithm: specs/bot/BOT_DESIGN.md §7.
 *
 * What it does (only while OGX.bot says the module is active: master on + botdebris.on; dry-run journals every request instead):
 *   (a) recyclers for planned battles (OGX.bot.battles, written by botfarm): expected field = existingDebris + debris.p50 (metal +
 *       crystal, never deuterium [F4]); recyclers = botSim.debrisForRecyclers(field [- residual on farm targets], cap = state.shipStats()
 *       [219].cargo incl. Storage expert / measured factor, marginPct) — fuel does NOT reduce the harvested amount [UPSTREAM
 *       MissionCaseRecycling:64-85]. John's rule: debris goes ONLY to Battle Recyclers 219 (catalog cargo 20 M), never 209; none
 *       free -> skip + journal. A planet without a moon may get one from the battle and a new moon erases the whole field
 *       [UPSTREAM MissionCaseAttack:341-386, debris_moon 1]: the expectation is field x (1 - moonChance/100); a pre-send whose
 *       expectation is below minBattleDf is not made (post-battle sees the real field);
 *       origin = nearest body with enough recyclers and fuel, moon first on ties; slot class 'deadline' (never 'force': the slot
 *       botcore keeps in reserve belongs to the fleet save). Flight times use the ship speeds of page=fleetTable (the server's
 *       numbers, learned once and kept for every body; the catalog base speed of 219 is far off on GALAXYZ).
 *       Mode pre-send (F1: mission 8 is offered only while the field is NOT empty [UPSTREAM ShowFleetStep2Page:50-60]): the field
 *       exists now (battle.existingDebris) and probe.target to the debris (type 2) offers mission 8 (free, no galaxy view); departure
 *       D = battle + rand(arriveMinSec..arriveMaxSec) - duration(speed), the cheapest-fuel speed with D >= now + 90 s; fleet.send with
 *       precise { at: D, tolMs: 1000 }: the executor posts steps 1-2 early and step 3 at D - RTT/2 (C3.4). Result: arrival before the
 *       battle -> immediate fleet.recall (it would harvest the old field and leave) + recyclers-late; later than battle + arriveMaxSec
 *       + 5 s -> kept + recyclers-late. Mode post-battle (postBattle): timer 'botdebris:post' at battle + 1 s -> fleet.send at 100 %
 *       (prio deadline). A cancelled battle (bot:battle-cancelled / gone from the registry / status recalled) before departure cancels
 *       the plan, after a pre-send departure recalls the recyclers. The recycling report (messcat 5 [UPSTREAM], when
 *       botcore.readMessages) is read and journaled as predicted vs harvested.
 *   (b) own debris fields (ownDf) every checkMinMin..checkMaxMin minutes: galaxy cache or the last galaxy:system seen on the bus
 *       (read.galaxy only when the budget botcore.galaxyViewsPerHour > 0, the data is older than checkMaxMin and this system was not
 *       read in the last checkMinMin: one read per system, planets of a system share it; a bot scan never wakes the module), field >= minOwnDf, origin order moon full -> moon any -> planet full
 *       -> planet any, duplicate guard by value 'g:s:p:2' against own flying recycle fleets (and this module's own sends).
 *   (c) logistics (off by default): OGX.bot.needs (botbuild chain needs, BOT_DESIGN §8.8) -> ONE Transport (mission 3) per planet
 *       for the whole chain from logisticsOrigin (or the body with the largest spare; a body never gives a resource it waits for) in Battle
 *       Transporters 217 only (John's rule, «не хватает N Ул. трансп.» when short), (cargo + fuel) <= capacity; spare = available minus
 *       the body's botbuild 'keep' minus deutReserveH hours of its deuterium production; at least the waiting step (need.min);
 *       skipped when the target produces it within the one-way time (and it fits its storage) or an own transport already flies
 *       there. repatriate / overflow move stock to the main body (D > C > M when the hold is short), leaving each body's 'keep' and
 *       the deuterium reserve (the planner and transport() share repatriateLoad(), so a plan is never refused by its own rule), never
 *       from a body with an open need, only what fits the main's storage; a colony without 217 gets them by a Deploy (ferry, John's
 *       rule: 217 only) and is emptied on the next pass; a refused body is left alone for a cooldown (no fleetTable read, one journal
 *       line per situation). Normal slot class, threat-lock aware (wctx.locked), sleep aware (wctx.sleepCheck).
 *   (d) a fight on an own body (hostile mission 1/2/9 seen in the threats, or a defender-side battle botsave registered): the own
 *       field of that system is checked right after the arrival (one galaxy read regardless of checkMinMin) — the attacker's
 *       recyclers usually follow the attack (BOT_DESIGN §7.2).
 * Every game request goes through wctx.act (C1); a wctx.decide precedes every action; journal kinds 'botdebris:<event>' (C6).
 * Code comments English, user-visible text Russian. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const NAME = 'botdebris';
  const SEC = 'Бот: обломки и логистика';
  const RES = ['metal', 'crystal', 'deuterium'];
  const RU = { metal: 'металл', crystal: 'кристалл', deuterium: 'дейтерий' };
  // John's rules: debris ONLY in Battle Recyclers 219, transports ONLY in Battle Transporters 217; no fallback ships
  const REC = 219;
  const TRANSPORT = (OGX.catalog && OGX.catalog.transportShip) || 217;
  const H = 3600000;
  const PRE_LEAD_MS = 90000;         // D >= now + 90 s: time for fleetTable + steps 1-2 before the precise step 3 (§7.1)
  const PRE_ENQUEUE_MS = 150000;     // the precise send is queued when D is this close (the executor prepares 60..300 s ahead)
  const SHIPS_MAX_AGE = 10 * 60000;  // re-read page=fleetTable of a body when its ship counts are older
  const TERMINAL = new Set(['done', 'dry', 'skipped', 'cancelled', 'failed', 'recalled', 'lost']);
  const FIGHT_SETTLE_MS = 3000;      // a fight on an own body: the field is looked at this long after the arrival second
  const FIGHT_MISSIONS = new Set([1, 2, 9]);
  const POST_RETRY_MS = [30000, 60000];   // post-battle send refused for slots: try again while the field is fresh
  const POST_RETRY_MAX_MS = 15 * 60000;
  const FERRY_MAX = 5000;            // at most this many 217 are deployed to a colony without transporters per ferry
  const LOG_REPEAT_MS = H;           // the same repatriation situation is journaled again after an hour at most
  // repatriation cooldowns per skip reason [min, max] ms: nothing is re-planned (and no fleetTable is read) for a body until then
  const REP_COOLDOWN = { stock: [15 * 60000, 30 * 60000], destFull: [15 * 60000, 30 * 60000], slots: [5 * 60000, 10 * 60000], ships: [60 * 60000, 60 * 60000],
    threat: [10 * 60000, 10 * 60000], sleep: [30 * 60000, 30 * 60000], cargo: [30 * 60000, 30 * 60000], error: [10 * 60000, 20 * 60000] };

  const SETTINGS = {
    on: { type: 'bool', default: true, label: 'Обломки и логистика включены', section: SEC },
    followBattles: { type: 'bool', default: true, label: 'Посылать переработчики к боям фарма', section: SEC },
    arriveMinSec: { type: 'int', default: 1, min: 1, max: 600, label: 'Прибытие переработчиков после боя, мин. (с)', section: SEC },
    arriveMaxSec: { type: 'int', default: 2, min: 1, max: 600, label: 'Прибытие переработчиков после боя, макс. (с)', section: SEC },
    marginPct: { type: 'int', default: 10, min: 0, max: 200, label: 'Запас переработчиков (%)', section: SEC },
    keepResidual: { type: 'bool', default: true, label: 'Оставлять остаток поля у целей фарма (для следующей пред-отправки)', section: SEC },
    residual: { type: 'int', default: 1000, min: 0, label: 'Остаток поля (металл + кристалл)', section: SEC },
    postBattle: { type: 'bool', default: true, label: 'Если поля нет — отправлять сразу после боя', section: SEC },
    ownDf: { type: 'bool', default: true, label: 'Собирать поля обломков у своих планет', section: SEC },
    minOwnDf: { type: 'int', default: 10000000, min: 0, label: 'Своё поле не меньше (металл + кристалл)', section: SEC },
    checkMinMin: { type: 'int', default: 30, min: 1, max: 1440, label: 'Проверять свои поля раз в, мин. (мин)', section: SEC },
    checkMaxMin: { type: 'int', default: 60, min: 1, max: 1440, label: 'Проверять свои поля раз в, макс. (мин)', section: SEC },
    minBattleDf: { type: 'int', default: 1000000, min: 0, label: 'Пред-отправка к бою: ожидаемое поле (с учётом шанса луны) не меньше', section: SEC },
    logistics: { type: 'bool', default: true, label: 'Довозить ресурсы под постройки (логистика)', section: SEC },
    logisticsOrigin: { type: 'string', default: '', label: 'Склад: id или координаты тела (пусто: довоз — с тела с наибольшим излишком, своз — на первую планету списка)', section: SEC },
    deutReserveH: { type: 'float', default: 2, min: 0, max: 240, step: 0.5, label: 'Оставлять на складе дейтерий на (ч производства)', section: SEC },
    repatriate: { type: 'bool', default: true, label: 'Свозить ресурсы с колоний на склад', section: SEC },
    repatriateMin: { type: 'int', default: 500000000, min: 0, label: 'Свозить, когда на колонии ресурсов не меньше', section: SEC },
    overflowPct: { type: 'int', default: 90, min: 10, max: 100, label: 'Вывозить излишек при заполнении хранилища (%)', section: SEC },
    ferry: { type: 'bool', default: true, label: 'Перегонять Ул. трансп. на колонию без них под вывоз (передислокация, не больше 5000 за раз)', section: SEC },
  };

  // ------------------------------------------------------------------ small helpers (pure)
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const num = (v, d = 0) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? d : +v);
  const res0 = () => ({ metal: 0, crystal: 0, deuterium: 0 });
  const addRes = (a, b) => { const o = Object.assign(res0(), a || {}); for (const r of ['metal', 'crystal', 'deuterium']) o[r] = num(o[r]) + num(b && b[r]); return o; };
  const fmtN = (n) => { try { return OGX.fmt.short(n); } catch (e) { return String(Math.round(n)); } };
  const fmtT = (ms) => { try { return OGX.fmt.time(ms); } catch (e) { return '—'; } };
  function errText(e) { return e && e.message ? e.message : String(e); }
  /** 'g:s:p' from a string ('[2:68:5]', '2:68:5') or an object ({ galaxy, system, position|planet }). */
  function coordsOf(x) {
    if (!x) return null;
    if (typeof x === 'string') { const m = /(\d+):(\d+):(\d+)/.exec(x); return m ? m[1] + ':' + m[2] + ':' + m[3] : null; }
    if (Array.isArray(x)) return x.length >= 3 ? x.slice(0, 3).join(':') : null;
    const p = x.position !== undefined ? x.position : x.planet;
    return +x.galaxy > 0 ? [+x.galaxy, +x.system, +p].join(':') : null;
  }
  function targetOf(coords, type) { const a = String(coords).split(':').map(Number); return { galaxy: a[0], system: a[1], position: a[2], type }; }
  const isMoon = (b) => !!b && (b.type === 'moon' || /^m/.test(String(b.key || '')));
  const fieldSum = (f) => (f ? num(f.metal) + num(f.crystal) : 0);

  /** Recyclers for a field: the harvest target is field - residual on farm targets (keepResidual), else the whole field with
   *  n = ceil(target·(1+margin)/cap). With keepResidual the capacity must not exceed the target, or the margin would take the
   *  residual too: n = ceil(target/cap) and the surplus capacity is filled with ballast (metal on board), because 2Moons
   *  MissionCaseRecycling counts storage = recyclers' capacity + min(0, other ships' capacity - cargo on board) [UPSTREAM
   *  MissionCaseRecycling:58-80]: n·cap - ballast = target leaves exactly the residual. ballast false -> floor(target/cap) (keeps
   *  between residual and residual + cap). */
  function recyclersFor({ field, residual = 0, keep = false, cap, marginPct = 10, sizer, ballast = true }) {
    const total = fieldSum(field);
    const target = Math.max(0, keep ? total - Math.max(0, num(residual)) : total);
    const f = sizer || ((amount, o) => Math.ceil(amount * (1 + o.marginPct / 100) / o.cap));
    let n = target > 0 && cap > 0 ? f(target, { cap, marginPct }) : 0;
    let load = 0;
    const nFloor = keep && cap > 0 ? Math.floor(target / cap) : n;
    if (keep && n > 0 && n * cap > target) {
      if (ballast) { n = Math.ceil(target / cap); load = Math.max(0, Math.ceil(n * cap - target)); } else n = nFloor;
    }
    return { total, target, n, keep: !!keep && total > target, ballast: load, nFloor };
  }
  /** Ballast for n recyclers sent to harvest `target` (see recyclersFor): limited by the hold left after the fuel (step 3:
   *  cargo + consumption <= fleet room) and by the metal the origin can spare; none -> null (use the floored count). */
  function ballastFor({ n, cap, target, fuel = 0, metal }) {
    const want = Math.max(0, Math.ceil(n * cap - target));
    if (want <= 0) return { n, ballast: 0 };
    const room = Math.floor(n * cap - num(fuel));
    if (want > room) return null;
    if (metal !== null && metal !== undefined && num(metal) < want) return null;
    return { n, ballast: want };
  }
  /**
   * Where inside the arrival window [battle + kMin, battle + kMax] (whole server seconds, both inclusive) the step 3 is aimed, in
   * seconds after the battle second: the server stamps the arrival as (processing second) + duration, so the window is
   * kMax - kMin + 1 s wide; aiming at its middle absorbs up to ±(width/2) s of clock skew and network delay. Wider windows are
   * jittered inside the part that keeps a 1 s margin on each side.
   */
  function aimSec(kMin, kMax, rand = Math.random) {
    const lo = Math.min(kMin, kMax); const hi = Math.max(kMin, kMax);
    const center = (lo + hi + 1) / 2;
    const half = Math.max(0, (hi - lo + 1) / 2 - 1);
    return center + (half > 0 ? (rand() * 2 - 1) * half : 0);
  }
  /**
   * Departure for a pre-send (§7.1): for every speed 10..1 D = arrivalWanted - duration(speed); valid when D >= now + leadMs and the
   * fuel fits; the cheapest fuel wins (ties: the faster speed, less time in the air). durOf(speed) -> seconds, fuelOf(speed, sec) -> deut.
   * Returns { speed, departAt, duration, fuel, arrival, alternatives } or null.
   */
  function chooseSpeed({ arrivalWanted, now, leadMs = PRE_LEAD_MS, durOf, fuelOf, maxFuel = Infinity, offsetMs = 0 }) {
    const opts = [];
    for (let speed = 10; speed >= 1; speed--) {
      const duration = durOf(speed);
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const departAt = arrivalWanted - duration * 1000 + offsetMs;
      const fuel = fuelOf(speed, duration);
      opts.push({ speed, duration, fuel, departAt, arrival: arrivalWanted, ok: departAt >= now + leadMs && fuel <= maxFuel });
    }
    const ok = opts.filter((o) => o.ok).sort((a, b) => a.fuel - b.fuel || b.speed - a.speed);
    if (!ok.length) return null;
    return Object.assign({}, ok[0], { alternatives: opts.map((o) => ({ speed: o.speed, duration: o.duration, fuel: o.fuel, ok: o.ok })) });
  }
  /** Origin for battle recyclers: nearest with enough recyclers (and fuel when known), moon first on ties; none -> the body with most. */
  function pickBattleOrigin(cands, need) {
    const enough = cands.filter((c) => c.have >= need && c.fuelOk !== false);
    const order = (a, b) => a.distance - b.distance || (isMoon(b.body) ? 1 : 0) - (isMoon(a.body) ? 1 : 0) || b.have - a.have;
    if (enough.length) return { origin: enough.sort(order)[0], full: true };
    const any = cands.filter((c) => c.have > 0 && c.fuelOk !== false).sort((a, b) => b.have - a.have || order(a, b));
    return any.length ? { origin: any[0], full: false } : null;
  }
  /** Origin for an own field [SPEC §5]: moon full -> moon any -> planet full -> planet any; inside a «full» class the nearest,
   * inside an «any» class the one with most recyclers (harvests most), then the nearest. */
  function pickOwnOrigin(cands, need) {
    const cls = (c) => (isMoon(c.body) ? 0 : 2) + (c.have >= need ? 0 : 1);
    const ok = cands.filter((c) => c.have > 0 && c.fuelOk !== false);
    ok.sort((a, b) => cls(a) - cls(b) || (cls(a) % 2 ? b.have - a.have : 0) || a.distance - b.distance || b.have - a.have);
    return ok.length ? { origin: ok[0], full: ok[0].have >= need, cls: cls(ok[0]) } : null;
  }
  /**
   * OGX.botSim.debrisForRecyclers, guarded against float noise of total·(1 + m/100)/cap (e.g. x/2e4·1.1 = 220.00000000000003):
   * one ship less when that is still enough in exact integer arithmetic.
   */
  function simRecyclers(amount, cap, marginPct) {
    const sim = (OGX.botSim && OGX.botSim.debrisForRecyclers) || ((d, o) => Math.ceil((d.metal + d.crystal) * (1 + o.marginPct / 100) / o.cap));
    let n = sim({ metal: Math.max(0, Math.ceil(num(amount))), crystal: 0 }, { cap, marginPct });
    const need = Math.ceil(num(amount)) * (100 + num(marginPct));
    while (n > 1 && (n - 1) * cap * 100 >= need) n--;
    return n;
  }
  /** Transport ships: smallest n with cargo + fuel(n) <= n·cap [SPEC §5: fuel takes hold space on Transport]. */
  function transportShips({ load, cap, fuelOf, max = 1e7 }) {
    const total = RES.reduce((s, r) => s + Math.max(0, Math.ceil(num(load[r]))), 0);
    if (!(cap > 0) || total <= 0) return null;
    let n = Math.max(1, Math.ceil(total / cap));
    for (let i = 0; i < 1000 && n <= max; i++) {
      const fuel = fuelOf(n);
      if (total + fuel <= n * cap) return { n, fuel, total };
      n = Math.max(n + 1, Math.ceil((total + fuel) / cap));
    }
    return null;
  }
  /** Load order D > C > M into `room` (repatriate when the ships are short) [SPEC §5]. */
  function payloadDCM(stock, room) {
    const out = res0();
    let left = Math.max(0, Math.floor(num(room)));
    for (const r of ['deuterium', 'crystal', 'metal']) { const take = Math.max(0, Math.min(left, Math.floor(num(stock[r])))); out[r] = take; left -= take; }
    return out;
  }
  /**
   * Repatriation load (pure, the same rule transport() enforces): a colony gives its available stock minus its own botbuild `keep`,
   * minus the deuterium reserve `keepD` (deutReserveH hours of production) and minus the fuel of the trip (deuterium), D > C > M into
   * the hold `room` (n x cap - fuel). A resource flagged in `over` (storage >= overflowPct) is exported down to half its storage even
   * when keep/keepD would hold more: a full tank wastes its production. -> { load, spare } (spare = exportable before the hold limit).
   */
  function repatriateLoad({ avail, keep, keepD = 0, fuel = 0, room = Infinity, over = null, storage = null }) {
    const spare = res0();
    for (const r of RES) {
      let floor = num(keep && keep[r]) + (r === 'deuterium' ? num(keepD) : 0);
      if (over && over[r] && storage && num(storage[r]) > 0) floor = Math.min(floor, Math.floor(num(storage[r]) / 2));
      spare[r] = Math.max(0, Math.floor(num(avail && avail[r]) - floor - (r === 'deuterium' ? num(fuel) : 0)));
    }
    return { load: payloadDCM(spare, room), spare };
  }
  /** Free storage of a destination per resource (null = unknown) and whether it is already at the cap; `pending` = cargo already
   *  on its way there (or landed since the destination's amount was last read) counts as stored. */
  function destRoom(dest, pending = null) {
    const out = {}; const full = {};
    for (const r of RES) {
      const stg = storageOf(dest, r); const am = amountOf(dest, r);
      if (stg === null || !(stg > 0) || am === null) { out[r] = null; full[r] = false; continue; }
      const have = am + num(pending && pending[r]);
      out[r] = Math.max(0, Math.floor(stg - have));
      full[r] = have >= stg;
    }
    return { room: out, full };
  }
  /** Recycling report text -> harvested { metal, crystal } (upstream sys_recy_gotten, core harvest parser as a fallback). */
  function harvestFromText(text) {
    const s = String(text || '').replace(/\s+/g, ' ');
    let m = /harvested ([\d.,]+) Metal, ([\d.,]+) Crystal/i.exec(s);
    if (m) return { metal: +m[1].replace(/\D/g, ''), crystal: +m[2].replace(/\D/g, '') };
    m = /collect\s+([\d.,]+)\s+\S+\s+and\s+([\d.,]+)\s+\S+/i.exec(s);
    if (m) return { metal: +m[1].replace(/\D/g, ''), crystal: +m[2].replace(/\D/g, '') };
    return null;
  }

  // ------------------------------------------------------------------ module state
  const M = {
    ctx: null, handle: null, loaded: false,
    plans: {},       // battle id -> Plan
    own: {},         // 'g:s:p:2' -> own harvest { fleetId, arrival, back, field, ... }
    logi: [],        // logistics sends { id, kind, to, fleetId, arrival, back, cargo, needId }
    meta: {},        // { nextOwnAt, recRoom }
    pending: new Set(), timers: {}, cancelled: {}, ships: {},
    stale: new Set(),   // body keys a fleet landed on since their counts were read (bot:fleet-returned): re-read before use
    raw: {},            // the state's own stock per body key { t, amt } (rawStock, refreshed every run; see unsynced)
    seen: {},        // 'g:s' -> { t, positions } of the last galaxy:system seen on the bus (in memory)
    lastRun: null,
  };
  async function load() {
    if (M.loaded) return;
    const st = M.ctx.store;
    const [p, o, l, m] = await Promise.all([st.get('plans', {}), st.get('own', {}), st.get('logi', []), st.get('meta', {})]);
    M.plans = p && typeof p === 'object' ? p : {};
    M.own = o && typeof o === 'object' ? o : {};
    M.logi = Array.isArray(l) ? l : [];
    M.meta = m && typeof m === 'object' ? m : {};
    M.loaded = true;
  }
  async function save() {
    const st = M.ctx.store;
    const t = OGX.time.serverNow();
    for (const [id, P] of Object.entries(M.plans)) if (TERMINAL.has(P.status) && t - P.battleArrival > 24 * H) delete M.plans[id];
    for (const [k, o] of Object.entries(M.own)) if (t - (o.back || o.sentAt || 0) > 24 * H) delete M.own[k];
    for (const [k, c] of Object.entries(M.cancelled)) if (t - c.t > 24 * H) delete M.cancelled[k];
    M.logi = M.logi.filter((x) => t - (x.back || x.arrival || 0) < 24 * H).slice(-100);
    for (const [k, v] of Object.entries(M.meta.repLog || {})) if (t - num(v.t) > 24 * H) delete M.meta.repLog[k];
    for (const [k, v] of Object.entries(M.meta.repSkip || {})) if (t > num(v.until)) delete M.meta.repSkip[k];
    for (const [k, v] of Object.entries(M.meta.fights || {})) if (t - num(v.arrival) > H) delete M.meta.fights[k];
    await st.set('plans', clone(M.plans));
    await st.set('own', clone(M.own));
    await st.set('logi', clone(M.logi));
    await st.set('meta', clone(M.meta));
  }

  // ------------------------------------------------------------------ data helpers
  function capOf(stats, id) {
    const s = stats && stats[id];
    if (s && +s.cargo > 0) return +s.cargo;
    try { const c = OGX.catalog.get(id); return c && c.props ? +c.props.cargo || 0 : 0; } catch (e) { return 0; }
  }
  function amountOf(body, r) { return body && body.res && body.res[r] ? Math.max(0, Math.floor(num(body.res[r].amount))) : null; }
  function perHourOf(body, r) { return body && body.res && body.res[r] ? num(body.res[r].perHour, null) : null; }
  function storageOf(body, r) { return body && body.res && body.res[r] ? num(body.res[r].storage, null) : null; }
  /** Production of a body with memory: the core's perHour drops to null/0 after some page merges (a buildings page carries no
   *  production), so the last positive value seen in the last 3 h stands in — the deuterium reserve must not vanish for one pass. */
  function prodOf(body, r) {
    const v = perHourOf(body, r);
    const k = body && body.key;
    if (!k) return v;
    M.meta.prod = M.meta.prod || {};
    const mem = M.meta.prod[k] || (M.meta.prod[k] = {});
    let t; try { t = OGX.time.serverNow(); } catch (e) { t = Date.now(); }
    if (v !== null && v > 0) { mem[r] = { v, t }; return v; }
    const m = mem[r];
    if (m && t - num(m.t) < 3 * H) return Math.max(num(v, 0), num(m.v));
    return v;
  }
  /** Deuterium reserve of a body: deutReserveH hours of its (remembered) production. */
  function keepDOf(wctx, body) { return Math.ceil(Math.max(0, num(prodOf(body, 'deuterium'), 0)) * num(wctx.cfg('deutReserveH'), 2)); }
  /** The state's own stock of a body (time of the last page that showed it + amounts): wctx.bodies() projects every body to now
   *  (res.t = now), so whether a page was read since a send or a landing is only visible here. -> { t, amt } | null */
  async function rawStock(key) {
    let all = null;
    try { all = OGX.state && OGX.state.bodies ? await OGX.state.bodies() : null; } catch (e) { all = null; }
    const out = {};
    for (const [k, b] of Object.entries(all || {})) if (b && b.res && b.res.t) out[k] = { t: num(b.res.t), amt: { metal: amountOf(b, 'metal'), crystal: amountOf(b, 'crystal'), deuterium: amountOf(b, 'deuterium') } };
    return key ? out[key] || null : out;
  }
  /** Cargo + fuel of own transports that left `body` while the state still shows the stock they were taken from (no page of the body
   *  read since, and no core update of its amounts): the bot's sends do not lower the state's stock, so without this every pass
   *  re-planned the same stock (the server then loads only what is left — the deuterium reserve included). */
  function unsynced(body) {
    const out = res0();
    const raw = M.raw && body ? M.raw[body.key] : null;
    if (!raw) return out;
    for (const x of M.logi) {
      if (x.dry || +x.from !== +body.id || !x.srcAmt || !(num(x.sentAt) >= num(raw.t))) continue;
      if (RES.some((r) => num(raw.amt[r]) !== num(x.srcAmt[r]))) continue;   // the state moved since the send: it already shows it
      for (const r of RES) out[r] += num(x.cargo && x.cargo[r]) + (r === 'deuterium' ? num(x.fuel) : 0);
    }
    return out;
  }
  /** wctx.available minus unsynced own sends (see unsynced). */
  function availOf(wctx, body) {
    const a = wctx.available(body.key);
    const u = unsynced(body);
    for (const r of RES) a[r] = Math.max(0, num(a[r]) - u[r]);
    return a;
  }
  function bodyById(env, id) { return Object.values(env.bodies).find((b) => +b.id === +id) || null; }
  function bodyByRef(env, ref) {
    if (ref === null || ref === undefined || ref === '') return null;
    const s = String(ref).trim();
    if (/^\d+$/.test(s)) return bodyById(env, +s);
    const c = coordsOf(s);
    if (!c) return env.bodies[s] || null;
    const wantMoon = /moon|луна|\(m\)|:3$/i.test(s);
    return Object.values(env.bodies).find((b) => b.coords === c && isMoon(b) === wantMoon) || Object.values(env.bodies).find((b) => b.coords === c) || null;
  }
  /** Ship counts of a body: this module's fresh read, else the core state when fresh, else page=fleetTable (free GET). */
  /** This module's last fleetTable read of a body, dropped once a fleet landed there (the counts changed). */
  function myShips(body) {
    if (body && M.stale.has(body.key)) { M.stale.delete(body.key); delete M.ships[body.id]; }
    return body ? M.ships[body.id] : undefined;
  }
  async function shipsOf(wctx, env, body, why, { needSpeeds = false } = {}) {
    const t = wctx.now();
    const mine = myShips(body);
    if (mine && t - mine.t < SHIPS_MAX_AGE) return mine.ships;
    if (!needSpeeds && body.ships && body.shipsT && t - body.shipsT < SHIPS_MAX_AGE) return body.ships;
    wctx.decide(`Читаю флот на ${body.coords}${isMoon(body) ? ' (луна)' : ''}`, { why: why || 'нужны свежие данные о кораблях', inputs: { bodyId: body.id, shipsT: body.shipsT || null }, chosen: 'read.fleetTable', alternatives: [] });
    const r = await wctx.act({ type: 'read.fleetTable', bodyId: body.id, prio: 'read', params: {}, why: 'Обломки: корабли на ' + body.coords });
    if (r && r.ok && r.data && r.data.fleetTable) {
      const ships = {}; const speeds = {};
      for (const s of r.data.fleetTable.ships || []) { ships[s.id] = +s.count || 0; if (+s.speed > 0) speeds[s.id] = +s.speed; }
      M.ships[body.id] = { ships, speeds, t: wctx.now() };
      learnSpeeds(speeds, wctx.now());
      return ships;
    }
    return body.ships || {};
  }
  /** Ship speeds are account-wide (drive techs): every speed seen on any fleetTable is kept (persisted) for every body. The catalog's
   *  base speed of the GALAXYZ ships may be far off (219: catalog ~30 000 with John's drives, server 6 000 — a 2.2x shorter estimate). */
  function learnSpeeds(speeds, t) {
    if (!speeds) return;
    M.meta.speeds = M.meta.speeds || {};
    for (const [id, v] of Object.entries(speeds)) if (+v > 0) M.meta.speeds[id] = { speed: +v, t };
  }
  function speedKnown(body, id) {
    const mine = body && M.ships[body.id] && M.ships[body.id].speeds;
    if (mine && +mine[id] > 0) return +mine[id];
    const s = M.meta.speeds && M.meta.speeds[id];
    return s && +s.speed > 0 ? +s.speed : 0;
  }
  function forgetShips(bodyId, ships) {
    const s = M.ships[bodyId];
    if (!s) return;
    for (const [id, n] of Object.entries(ships || {})) s.ships[id] = Math.max(0, (s.ships[id] || 0) - n);
  }
  /**
   * fleetStep1-shaped `data` for ships leaving `body`: ship speeds from that body's page=fleetTable (the server's own numbers: drive
   * techs included), else the speed of that ship seen on any fleetTable (learnSpeeds), fuel from state.shipStats, game speed from
   * state.server (fleetStep1 data.gamespeed once a fleetStep1 page was seen).
   */
  function dataFor(env, body, ships) {
    const stats = Object.assign({}, env.stats || {});
    for (const id of Object.keys(ships || {})) { const v = speedKnown(body, id); if (v > 0) stats[id] = Object.assign({}, stats[id] || {}, { speed: v }); }
    return OGX.fleet.gz.dataFor(ships, stats, env.server || { fleetSpeed: 7 }, env.factors || null);
  }
  /** { duration (s, server rounding), fuel, distance } from `body` to 'g:s:p' (data: exact fleetStep1 data when at hand). */
  function flightTime(env, body, to, ships, speed = 10, data) {
    try {
      const d = data && +data.maxspeed > 0 ? data : dataFor(env, body, ships);
      const distance = OGX.fleet.gz.distance(body.coords, to);
      if (distance === null) return { duration: Infinity, fuel: 0, distance: null };
      const duration = OGX.fleet.gz.duration(d, distance, speed);
      return { duration, fuel: Number.isFinite(duration) ? OGX.fleet.gz.consumption(d, distance, duration) : 0, distance };
    } catch (e) { return { duration: Infinity, fuel: 0, distance: null }; }
  }
  /** Own recycle fleets flying to 'g:s:p' (outward, not returning) from the event-box cache. */
  /** The flight list of the event-box cache (wctx.flights(), the runtime's sync mirror), taken once per run. */
  function loadFlights(wctx, env) {
    env.flights = wctx.flights();
    return env.flights;
  }
  const flightsOf = (env) => (Array.isArray(env.flights) ? env.flights : []);
  function ownRecycleTo(env, coords) {
    return flightsOf(env).filter((f) => f && f.own && !f.returnFlight && +f.missionType === 8 && coordsOf(f.to) === coords && (+f.toType || 2) === 2);
  }
  function ownTransportTo(env, coords) {
    return flightsOf(env).filter((f) => f && f.own && !f.returnFlight && +f.missionType === 3 && coordsOf(f.to) === coords
      && (!f.cargo || RES.some((r) => num(f.cargo[r]) > 0)));
  }
  function originsWithRecyclers(wctx, env, shipsByBody, shipId, target, need, n) {
    const out = [];
    for (const b of Object.values(env.bodies)) {
      const have = num((shipsByBody[b.id] || {})[shipId]);
      if (have <= 0) continue;
      const ships = { [shipId]: Math.min(have, n) };
      const ft = flightTime(env, b, target, ships, 10);
      const deut = amountOf(b, 'deuterium');
      const avail = deut === null ? null : wctx.available(b.key).deuterium;
      const fuelOk = avail === null ? null : avail >= ft.fuel;
      const lock = wctx.locked(b.key);
      if (lock) continue;
      out.push({ body: b, have, distance: num(ft.distance, 1e9), fuel: ft.fuel, duration: ft.duration, fuelOk });
    }
    return out;
  }
  const ZERO_MAX_AGE = 60 * 60000;   // a body that showed none of a ship type is looked at again after an hour at most
  /** Ship counts of every body for one ship type. A body whose counts (this module's read, or the core state's with a parse time)
   *  showed none of that ship within the last hour is not re-read: a fleetTable read per body per battle was 8.5 % of all bot
   *  actions in the 0.3.1 journal. Bodies never parsed, or with the ship, go through shipsOf (fresh within 10 min). */
  async function shipsAll(wctx, env, shipId, why) {
    const out = {};
    const t = wctx.now();
    for (const b of Object.values(env.bodies)) {
      const mine = myShips(b);
      const src = mine ? mine : (b.shipsT > 0 && b.ships ? { ships: b.ships, t: b.shipsT } : null);
      if (src && !(num(src.ships[shipId]) > 0) && t - num(src.t) < ZERO_MAX_AGE) { out[b.id] = src.ships; continue; }
      out[b.id] = await shipsOf(wctx, env, b, why);
    }
    return out;
  }

  // ------------------------------------------------------------------ (a) recyclers for planned battles
  // [UPSTREAM MissionCaseAttack.class.php:341-386, install.sql moon_factor 1 / moon_chance 20 / debris_moon 1]: an attack on a
  // planet without a moon creates one with chance min(round(new debris / 100000 * moon_factor), moon_chance) %, and a new moon
  // ERASES the whole field (old and new debris). GALAXYZ values are not seen live: the upstream defaults are used.
  const MOON_FACTOR = 1;
  const MOON_MAX = 20;
  /** Moon chance (%) of a planned battle: 0 for a moon target or a planet that already has a moon. */
  function moonPctOf(b, add) {
    if (!b || +((b.target || {}).type || 1) !== 1 || b.targetHasMoon === true) return 0;
    const total = num(add && add.metal) + num(add && add.crystal);
    if (!(total > 0)) return 0;
    return Math.max(0, Math.min(Math.round(total / 100000 * MOON_FACTOR), MOON_MAX));
  }
  function battleField(b) {
    const ex = b.existingDebris || { metal: 0, crystal: 0 };
    const d = b.debris || {};
    const p50 = d.p50 || { metal: d.metal, crystal: d.crystal };
    const add = { metal: num(p50 && p50.metal), crystal: num(p50 && p50.crystal) };
    const field = { metal: num(ex.metal) + add.metal, crystal: num(ex.crystal) + add.crystal };
    const moonPct = moonPctOf(b, add);
    // field: what is there when no moon forms (recyclers are sized for it); expected: the mean over the moon outcome
    return { existing: { metal: num(ex.metal), crystal: num(ex.crystal) }, add, field, moonPct,
      expected: { metal: field.metal * (1 - moonPct / 100), crystal: field.crystal * (1 - moonPct / 100) } };
  }
  /** Pre-send worth it with the moon risk? The fuel is spent in every outcome, the harvest only when no moon forms; a post-battle
   *  send sees the field first (mission 8 offered only for a non-empty field) and wastes nothing. Pre stays when the expected
   *  harvest is at least PRE_MOON_GAIN x the fuel (metal equivalents). */
  const PRE_MOON_GAIN = 3;
  function preWorthIt({ harvest, moonPct, fuel, rateD = 3 }) {
    const expHarvest = num(harvest) * (1 - num(moonPct) / 100);
    const fuelMsu = num(fuel) * rateD;
    return { ok: !(num(moonPct) > 0) || expHarvest >= PRE_MOON_GAIN * fuelMsu, expHarvest: Math.round(expHarvest), fuelMsu: Math.round(fuelMsu) };
  }
  /** [UPSTREAM MissionCaseAttack:341-386] pre-send only when the field expected after the moon outcome (battleField().expected =
   *  field x (1 - moonChance/100), moonChance 0 for a moon target or a planet that has a moon) reaches the module minimum. */
  function preMinOk(F, min) {
    const expected = Math.round(fieldSum(F && F.expected));
    return { ok: expected >= Math.max(0, num(min)), expected, min: Math.max(0, num(min)) };
  }
  function setStatus(P, status, note) { P.status = status; if (note !== undefined) P.note = note; P.updated = OGX.time.serverNow(); }
  function cancelTimer(id) { const t = M.timers[id]; if (t) { try { t.cancel(); } catch (e) { /* ignore */ } delete M.timers[id]; } }
  function armTimer(P, label, at) {
    cancelTimer(P.id);
    M.timers[P.id] = OGX.bot.at(at, null, { label, payload: { id: P.id } });
    P.timerAt = at; P.timerLabel = label;
  }

  /** keepResidual sizing on the chosen origin: ceil count + metal ballast when the hold (after fuel) and the origin's metal allow,
   *  else the floored count without ballast (P.ballastNote says why). A Battle Recycler holds 20 M: on a smaller field the floored
   *  count is 0, so when no ballast fits the residual is given up and the whole field is harvested (have = the origin's 219). */
  function applyBallast(wctx, P, body, fuel, have) {
    if (!P.keepResidual) { P.ballast = 0; return; }
    const full = P.n >= Math.ceil(P.harvestTarget / P.cap);
    const metal = amountOf(body, 'metal') === null ? null : wctx.available(body.key).metal;
    const b = full ? ballastFor({ n: P.n, cap: P.cap, target: P.harvestTarget, fuel, metal }) : { n: P.n, ballast: 0 };
    if (b) { P.ballast = b.ballast; P.ballastNote = null; return; }
    P.ballast = 0;
    P.ballastNote = metal !== null && metal < Math.ceil(P.n * P.cap - P.harvestTarget) ? 'мало металла для балласта' : 'трюм занят топливом';
    P.n = Math.max(0, Math.min(P.n, num(P.nFloor, P.n)));
    if (P.n <= 0 && have > 0) {
      const total = fieldSum(P.field);
      Object.assign(P, { keepResidual: false, residual: 0, harvestTarget: total, ballast: 0,
        n: Math.min(num(have), simRecyclers(total, P.cap, num(wctx.cfg('marginPct'), 10))), ballastNote: P.ballastNote + ': остаток поля не сохранить, собираю всё поле' });
    }
  }

  /** keepResidual: among origins at the same distance (planet / moon of one position) prefer one that can carry the ballast
   *  (a moon often has no metal), so the residual stays exact instead of the floored count. */
  function preferBallast(wctx, P, cands, pick) {
    if (!P.keepResidual || !pick || !pick.full || !(P.cap > 0)) return pick;
    const nCeil = Math.ceil(P.harvestTarget / P.cap);
    const can = (c) => {
      const metal = amountOf(c.body, 'metal') === null ? null : wctx.available(c.body.key).metal;
      return c.have >= nCeil && !!ballastFor({ n: nCeil, cap: P.cap, target: P.harvestTarget, fuel: c.fuel, metal });
    };
    if (can(pick.origin)) return pick;
    const alt = cands.filter((c) => c !== pick.origin && c.distance === pick.origin.distance && c.fuelOk !== false && can(c));
    return alt.length ? { origin: alt[0], full: true } : pick;
  }

  async function planBattle(wctx, env, b) {
    const now = wctx.now();
    const F = battleField(b);
    const tcoords = coordsOf(b.target);
    const target = targetOf(tcoords, 2);
    const P = { id: b.id, battleId: b.id, owner: b.owner, coords: tcoords, target, battleArrival: +b.arrival, field: F.field, existing: F.existing, add: F.add,
      created: now, status: 'new', mode: null, n: 0, shipId: REC };
    M.plans[b.id] = P;
    const total = fieldSum(F.field);
    P.moonPct = F.moonPct;
    const moonTxt = F.moonPct > 0 ? `; шанс луны ${F.moonPct} % — луна стирает всё поле, ожидание ≈ ${fmtN(fieldSum(F.expected))}` : '';
    wctx.rec('debris-predicted', `Поле у [${tcoords}] после боя ${fmtT(P.battleArrival)}: ≈ ${fmtN(total)} (сейчас ${fmtN(fieldSum(F.existing))} + бой ${fmtN(fieldSum(F.add))})${moonTxt}`,
      { battle: b.id, field: F.field, existing: F.existing, add: F.add, p10: b.debris && b.debris.p10, arrival: P.battleArrival, moonPct: F.moonPct, expected: F.expected, targetHasMoon: b.targetHasMoon === true });
    if (total <= 0) { setStatus(P, 'skipped', 'поле не ожидается'); wctx.rec('skip', `[${tcoords}]: обломков не ожидается`, { reason: 'noDebris', battle: b.id }); return; }
    if (now > P.battleArrival + 30 * 60000) { setStatus(P, 'skipped', 'бой давно прошёл'); wctx.rec('skip', `[${tcoords}]: бой давно прошёл`, { reason: 'stale', battle: b.id }); return; }
    // ship type and capacity: Battle Recyclers 219 only (core shipStats: catalog 20 M x officer / measured cargo factor)
    const shipId = REC; const cap = capOf(env.stats, REC);
    const keep = !!wctx.cfg('keepResidual') && b.owner === 'botfarm';
    const sizing = recyclersFor({ field: F.field, residual: wctx.cfg('residual'), keep, cap, marginPct: num(wctx.cfg('marginPct'), 10),
      sizer: (amount, o) => simRecyclers(amount, o.cap, o.marginPct) });
    Object.assign(P, { shipId, cap, n: sizing.n, nFloor: sizing.nFloor, ballast: sizing.ballast, harvestTarget: sizing.target, keepResidual: sizing.keep, residual: sizing.keep ? total - sizing.target : 0 });
    if (sizing.n <= 0) { setStatus(P, 'skipped', 'нечего собирать (остаток)'); wctx.rec('skip', `[${tcoords}]: поле меньше остатка`, { reason: 'residualOnly', battle: b.id, total }); return; }
    // origin
    const shipsBy = await shipsAll(wctx, env, shipId, 'выбор тела для переработчиков');
    const cands = originsWithRecyclers(wctx, env, shipsBy, shipId, tcoords, sizing.n, sizing.n);
    const pick = preferBallast(wctx, P, cands, pickBattleOrigin(cands, sizing.n));
    if (!pick) { setStatus(P, 'skipped', 'нет боевых переработчиков'); wctx.rec('skip', `[${tcoords}]: нет свободных боевых переработчиков (219), нужно ${sizing.n}`, { reason: 'noRecyclers', battle: b.id, need: sizing.n, shipId }); return; }
    const o = pick.origin;
    const n = Math.min(sizing.n, o.have);
    Object.assign(P, { originId: o.body.id, originKey: o.body.key, originCoords: o.body.coords, originMoon: isMoon(o.body), n, short: n < sizing.n ? sizing.n - n : 0 });
    applyBallast(wctx, P, o.body, o.fuel, o.have);
    if (P.n <= 0) { setStatus(P, 'skipped', 'остаток поля: ' + P.ballastNote); wctx.rec('skip', `[${tcoords}]: собрать без потери остатка нельзя (${P.ballastNote})`, { reason: 'residualOnly', battle: b.id, total }); return; }
    const alternatives = cands.map((c) => ({ id: c.body.id, coords: c.body.coords, moon: isMoon(c.body), have: c.have, distance: c.distance, fuelOk: c.fuelOk }));
    // the flight time needs the server's speed of the recyclers (drive techs; the catalog base speed of 219 is 5x off on GALAXYZ):
    // one fleetTable read of the origin now, before the battle, when no fleetTable has shown that ship yet
    if (!speedKnown(o.body, shipId)) await shipsOf(wctx, env, o.body, 'скорость переработчиков (fleetTable) для расчёта полёта', { needSpeeds: true });
    // mode: pre-send needs an existing field now (F1) and time for steps 1-2
    // the flight time needs the server's fleetStep1 data (the core may not know the game speed yet): the probe returns it
    const preTime = P.battleArrival + num(wctx.cfg('arriveMinSec'), 1) * 1000 - 5000 >= now + PRE_LEAD_MS;
    let mode = fieldSum(F.existing) > 0 && preTime ? 'pre' : 'post';
    if (fieldSum(F.existing) <= 0) P.preWhy = 'поля нет до боя';
    else if (!preTime) P.preWhy = `до боя ${Math.max(0, Math.round((P.battleArrival - now) / 1000))} с — меньше времени на подготовку пред-отправки`;
    // [UPSTREAM MissionCaseAttack:341-386] the moon chance erases the field: a pre-send below the module minimum is not made
    const pm = preMinOk(F, num(wctx.cfg('minBattleDf'), 1000000));
    P.preMin = pm;
    if (mode === 'pre' && !pm.ok) {
      mode = 'post';
      P.preWhy = `ожидаемое поле ≈ ${fmtN(pm.expected)}${F.moonPct > 0 ? ` (шанс луны ${F.moonPct} %)` : ''} < ${fmtN(pm.min)} — пред-отправки нет, после боя видно реальное поле`;
    }
    let probe = null;
    if (mode === 'pre' && !wctx.dryRun) {
      wctx.decide(`Проверяю поле [${tcoords}] без просмотра галактики`, { why: 'пред-отправка возможна, только если поле уже не пустое (миссия 8)', inputs: { existing: F.existing, origin: o.body.id },
        chosen: 'probe.target', alternatives: ['галактика (стоит дейтерий)'] });
      const r = await wctx.act({ type: 'probe.target', bodyId: o.body.id, prio: 'deadline', params: { ships: { [shipId]: n }, target, speed: 10 }, why: `Обломки: есть ли поле [${tcoords}]` });
      probe = r && r.ok && r.data ? { missions: r.data.missions || [], data: r.data.data || null } : { missions: [], error: (r && (r.message || r.error || r.refused)) || 'нет ответа' };
      if (!probe.missions.includes(8)) { mode = 'post'; P.preWhy = probe.error ? 'проверка поля не удалась (' + probe.error + ')' : 'сервер не предлагает сбор обломков (поле пусто)'; }
      if (r && r.ok && r.data && r.data.data && +r.data.data.fleetroom > 0) M.meta.recRoom = { n, fleetroom: +r.data.data.fleetroom };
    }
    if (mode === 'pre' && !(probe && probe.data && +probe.data.maxspeed > 0)) await shipsOf(wctx, env, o.body, 'скорости кораблей для точного вылета', { needSpeeds: true });
    if (mode === 'pre') {
      const kMin = num(wctx.cfg('arriveMinSec'), 1); const kMax = Math.max(kMin, num(wctx.cfg('arriveMaxSec'), 2));
      const k = aimSec(kMin, kMax);
      const arrivalWanted = Math.floor(P.battleArrival / 1000) * 1000 + Math.round(k * 1000);
      // exact step-1 data when the probe returned it, else the fleetTable speeds of the origin + the stored game speed
      const data = probe && probe.data && +probe.data.maxspeed > 0 ? probe.data : dataFor(env, o.body, { [shipId]: n });
      P.dataSrc = probe && probe.data && +probe.data.maxspeed > 0 ? 'probe' : 'fleetTable';
      P.gameSpeed = data.gamespeed;
      const dist = OGX.fleet.gz.distance(o.body.coords, tcoords);
      const deut = amountOf(o.body, 'deuterium');
      const maxFuel = deut === null ? Infinity : wctx.available(o.body.key).deuterium;
      const ch = chooseSpeed({ arrivalWanted, now, durOf: (s) => OGX.fleet.gz.duration(data, dist, s), fuelOf: (s, sec) => OGX.fleet.gz.consumption(data, dist, sec), maxFuel, offsetMs: 0 });
      if (!ch) {
        mode = 'post';
        const fast = OGX.fleet.gz.duration(data, dist, 10);
        P.preWhy = `поле есть, но переработчики не успевают: полёт ≥ ${Math.round(fast)} с, до боя ${Math.max(0, Math.round((P.battleArrival - now) / 1000))} с (нужен вылет не раньше чем через ${PRE_LEAD_MS / 1000} с)`;
      }
      else { Object.assign(P, { speed: ch.speed, duration: ch.duration, fuel: ch.fuel, departAt: ch.departAt, wantArrival: arrivalWanted, k, speedOptions: ch.alternatives }); applyBallast(wctx, P, o.body, ch.fuel, o.have); }
    }
    if (mode === 'pre' && P.moonPct > 0) {
      const w = preWorthIt({ harvest: P.harvestTarget, moonPct: P.moonPct, fuel: P.fuel, rateD: num(wctx.core('rateD'), 3) });
      P.moonCheck = w;
      if (!w.ok) { mode = 'post'; P.preWhy = `шанс луны ${P.moonPct} %: луна сотрёт поле, ожидаемый сбор ≈ ${fmtN(w.expHarvest)} < ${PRE_MOON_GAIN}× топлива (${fmtN(w.fuelMsu)}) — после боя видно, осталось ли поле`; }
    }
    if (mode === 'post' && !wctx.cfg('postBattle')) {
      setStatus(P, 'skipped', 'поля сейчас нет, а отправка после боя выключена');
      wctx.rec('skip', `[${tcoords}]: поля нет (пред-отправка невозможна), «после боя» выключено`, { reason: 'noPreNoPost', battle: b.id, probe });
      return;
    }
    P.mode = mode;
    if (mode === 'post') { P.speed = 10; P.duration = flightTime(env, o.body, tcoords, { [shipId]: n }, 10).duration; P.departAt = P.battleArrival + 1000; }
    const modeRu = mode === 'pre' ? 'пред-отправка (поле уже есть)' : 'сразу после боя (' + (P.preWhy || 'поля нет до боя') + ')';
    wctx.rec('recyclers-planned', `Переработчики к [${tcoords}]: ${P.n} × ${shipId}${P.ballast ? ` (балласт ${fmtN(P.ballast)} металла: остаток поля ≈ ${fmtN(P.residual)})` : ''}, ${modeRu}, вылет ${fmtT(P.departAt)} со скоростью ${P.speed * 10}% с ${o.body.coords}${isMoon(o.body) ? ' (луна)' : ''}`,
      { battle: b.id, mode, n: P.n, ballast: P.ballast || 0, ballastNote: P.ballastNote || null, shipId, cap, field: F.field, harvestTarget: sizing.target, residual: P.residual, origin: o.body.id, departAt: P.departAt, speed: P.speed,
        duration: P.duration, wantArrival: P.wantArrival || null, battleArrival: P.battleArrival, preWhy: P.preWhy || null, probe: probe ? { missions: probe.missions, error: probe.error || null } : null,
        dry: wctx.dryRun, alternatives, short: P.short, moonPct: P.moonPct || 0, moonCheck: P.moonCheck || null, preMin: P.preMin || null });
    P.decision = { why: (mode === 'pre' ? 'поле уже есть: прибыть через ' + (+P.k).toFixed(1) + ' с после боя' : (P.preWhy || 'поля нет до боя') + ': отправка в бой + 1 с')
      + (mode === 'pre' && P.moonPct > 0 ? `; шанс луны ${P.moonPct} % (тогда поле пустое, топливо потеряно), ожидаемый сбор ≈ ${fmtN(P.moonCheck ? P.moonCheck.expHarvest : 0)}` : ''), alternatives };
    if (mode === 'pre') {
      if (P.departAt - now <= PRE_ENQUEUE_MS) await enqueuePre(wctx, P);
      else { setStatus(P, 'waitPre'); armTimer(P, 'botdebris:pre', P.departAt - PRE_ENQUEUE_MS); }
    } else if (now >= P.battleArrival + 1000) {
      setStatus(P, 'duePost');
    } else { setStatus(P, 'waitPost'); armTimer(P, 'botdebris:post', P.battleArrival + 1000); }
  }

  async function enqueuePre(wctx, P) {
    const now = wctx.now();
    if (P.departAt < now + 20000) {   // too late for steps 1-2: fall back to post-battle
      return fallbackPost(wctx, P, 'до вылета меньше 20 с');
    }
    const lock = wctx.locked(P.originKey);
    if (lock) return fallbackPost(wctx, P, 'тело отправки под угрозой');
    const ships = { [P.shipId]: P.n };
    // the server's arrival second = floor(processing second) + duration: a step 3 processed later than the end of the last
    // acceptable second (battle + arriveMaxSec) would land outside the window, so the executor must refuse it ('expired')
    const tolMs = preTolMs(P, num(wctx.cfg('arriveMaxSec'), 2));
    wctx.decide(`Пред-отправка ${P.n} переработчиков к [${P.coords}] на ${fmtT(P.departAt)}`, {
      why: P.decision ? P.decision.why : 'поле уже есть', inputs: { battle: P.battleId, battleArrival: P.battleArrival, field: P.field, origin: P.originId, speed: P.speed, duration: P.duration },
      chosen: { mode: 'pre', ships, speed: P.speed, departAt: P.departAt, wantArrival: P.wantArrival }, alternatives: P.decision ? P.decision.alternatives : [] });
    setStatus(P, 'queued');
    M.pending.add(P.id);
    const p = wctx.act({ type: 'fleet.send', bodyId: P.originId, prio: 'deadline', cls: 'deadline',
      params: Object.assign({ target: P.target, ships, mission: 8, speed: P.speed, expectArrival: P.wantArrival, arrivalTolMs: 1000 }, P.ballast > 0 ? { cargo: { metal: P.ballast, crystal: 0, deuterium: 0 } } : {}),
      precise: { at: P.departAt, tolMs }, deadline: P.departAt + tolMs,
      why: `Обломки: переработчики к [${P.coords}] (бой ${fmtT(P.battleArrival)} + ${(+P.k).toFixed(1)} с)`, plan: { battle: P.battleId, mode: 'pre', field: P.field, n: P.n }, dedupeKey: 'botdebris:' + P.id });
    p.then((r) => {
      M.pending.delete(P.id);
      const cur = M.plans[P.id] || P;
      cur.result = slimResult(r);
      setStatus(cur, 'result');
      save().catch(() => {});
      if (M.handle) M.handle.wake('результат пред-отправки');
    }, () => { M.pending.delete(P.id); });
  }
  /** Lateness the precise step 3 may have: the last acceptable arrival second is battle + arriveMaxSec (ends 1 s later), minus a
   *  250 ms safety for the request transit; never more than 1000 ms, at least 100 ms. */
  function preTolMs(P, kMax) {
    const lastEnd = (Math.floor(P.battleArrival / 1000) + Math.max(1, +kMax || 2) + 1) * 1000;
    return Math.max(100, Math.min(1000, lastEnd - P.wantArrival - 250));
  }
  function slimResult(r) {
    if (!r) return null;
    const o = { ok: !!r.ok, dry: !!r.dry, refused: r.refused || null, error: r.error || null, message: r.message || null, verified: !!r.verified, at: r.at || null, lateMs: r.lateMs !== undefined ? r.lateMs : null };
    if (r.data) o.data = { fleetId: r.data.fleetId !== undefined ? r.data.fleetId : null, arrival: r.data.arrival || null, back: r.data.back || null, consumption: r.data.consumption !== undefined ? r.data.consumption : null };
    return o;
  }
  function fallbackPost(wctx, P, why) {
    if (!wctx.cfg('postBattle')) { setStatus(P, 'failed', why); wctx.rec('skip', `[${P.coords}]: пред-отправка невозможна (${why}), «после боя» выключено`, { reason: 'preFailed', battle: P.battleId, why }); return; }
    P.mode = 'post'; P.speed = 10;
    P.decision = { why: 'пред-отправка невозможна (' + why + '): отправка в бой + 1 с', alternatives: P.decision ? P.decision.alternatives : [] };
    wctx.rec('recyclers-planned', `[${P.coords}]: пред-отправка невозможна (${why}) — отправка сразу после боя`, { battle: P.battleId, mode: 'post', why, n: P.n });
    if (wctx.now() >= P.battleArrival + 1000) setStatus(P, 'duePost');
    else { setStatus(P, 'waitPost'); armTimer(P, 'botdebris:post', P.battleArrival + 1000); }
  }

  async function handlePreResult(wctx, P) {
    const r = P.result || {};
    if (r.dry) { setStatus(P, 'dry', 'пробный режим: отправка только запланирована'); return; }
    if (!r.ok) {
      const why = r.refused === 'expired' ? 'окно точной отправки пропущено' : (r.message || r.error || r.refused || 'ошибка');
      if (P.cancelReason) { setStatus(P, 'cancelled', P.cancelReason); return; }
      if (r.refused === 'stopped' || r.refused === 'notLeader') { setStatus(P, 'failed', why); return; }
      return fallbackPost(wctx, P, why);
    }
    const d = r.data || {};
    Object.assign(P, { fleetId: d.fleetId, arrival: d.arrival, back: d.back, sentAt: r.at, lateMs: r.lateMs, verified: r.verified });
    forgetShips(P.originId, { [P.shipId]: P.n });
    const maxOk = Math.floor(P.battleArrival / 1000) * 1000 + num(wctx.cfg('arriveMaxSec'), 2) * 1000 + 5000;
    if (P.cancelReason && d.arrival && wctx.now() < d.arrival) return recallPlan(wctx, P, 'бой отменён: ' + P.cancelReason);
    if (d.arrival && d.arrival < P.battleArrival) {
      wctx.rec('recyclers-late', `Переработчики к [${P.coords}] прибудут РАНЬШЕ боя (${fmtT(d.arrival)} < ${fmtT(P.battleArrival)}): отзываю`, { battle: P.battleId, arrival: d.arrival, battleArrival: P.battleArrival, lateMs: r.lateMs, fleetId: d.fleetId, action: 'recall' });
      return recallPlan(wctx, P, 'прибыли бы до боя и собрали бы старое поле');
    }
    setStatus(P, 'sent');
    if (d.arrival && d.arrival > maxOk) {
      wctx.rec('recyclers-late', `Переработчики к [${P.coords}] прибудут позже окна (${fmtT(d.arrival)}), оставляю`, { battle: P.battleId, arrival: d.arrival, battleArrival: P.battleArrival, lateMs: r.lateMs, fleetId: d.fleetId, action: 'keep' });
    }
    wctx.rec('recyclers-sent', `Переработчики к [${P.coords}] в пути: ${P.n} × ${P.shipId}, прибытие ${fmtT(d.arrival)} (бой ${fmtT(P.battleArrival)})`,
      { battle: P.battleId, mode: P.mode, fleetId: d.fleetId, arrival: d.arrival, back: d.back, battleArrival: P.battleArrival, afterBattleMs: d.arrival ? d.arrival - P.battleArrival : null, lateMs: r.lateMs, verified: r.verified, n: P.n });
  }

  async function sendPost(wctx, env, P) {
    const now = wctx.now();
    if (now > P.battleArrival + 60 * 60000) { setStatus(P, 'skipped', 'бой прошёл больше часа назад'); return; }
    // the origin may have changed: re-pick (counts / locks)
    // known counts first (no extra request at battle + 1 s: the executor re-checks the ships on the fresh fleetTable)
    const known = {};
    for (const b of Object.values(env.bodies)) known[b.id] = (M.ships[b.id] && M.ships[b.id].ships) || b.ships || {};
    let cands = originsWithRecyclers(wctx, env, known, P.shipId, P.coords, P.n, P.n);
    let pick = pickBattleOrigin(cands, P.n);
    if (!pick || !pick.full) {
      cands = originsWithRecyclers(wctx, env, await shipsAll(wctx, env, P.shipId, 'отправка после боя'), P.shipId, P.coords, P.n, P.n);
      pick = pickBattleOrigin(cands, P.n);
    }
    pick = preferBallast(wctx, P, cands, pick);
    if (!pick) { setStatus(P, 'failed', 'нет боевых переработчиков'); wctx.rec('skip', `[${P.coords}]: после боя нет свободных боевых переработчиков (219)`, { reason: 'noRecyclers', battle: P.battleId, shipId: P.shipId }); return; }
    const o = pick.origin;
    // the planned count may have been floored for another origin (no metal for the ballast): size again for this one
    Object.assign(P, { n: Math.min(P.keepResidual && P.cap > 0 ? Math.max(P.n, Math.ceil(P.harvestTarget / P.cap)) : P.n, o.have) });
    const ft0 = flightTime(env, o.body, P.coords, { [P.shipId]: P.n }, 10);
    applyBallast(wctx, P, o.body, ft0.fuel, o.have);
    const n = P.n;
    const ships = { [P.shipId]: n };
    const ft = flightTime(env, o.body, P.coords, ships, 10);
    const sc = wctx.sleepCheck(now + 2 * ft.duration * 1000);
    if (!sc.ok) { setStatus(P, 'skipped', 'режим сна'); wctx.rec('skip', `[${P.coords}]: возврат попадает в сон`, { reason: sc.reason, battle: P.battleId }); return; }
    wctx.decide(`Отправляю ${n} переработчиков к [${P.coords}] сразу после боя`, { why: P.decision ? P.decision.why : 'поля не было до боя', inputs: { battle: P.battleId, battleArrival: P.battleArrival, field: P.field, origin: o.body.id },
      chosen: { mode: 'post', ships, speed: 10, origin: o.body.id }, alternatives: cands.map((c) => ({ id: c.body.id, have: c.have, distance: c.distance })) });
    setStatus(P, 'sending');
    Object.assign(P, { originId: o.body.id, originKey: o.body.key, originCoords: o.body.coords, n });
    const r = await wctx.act({ type: 'fleet.send', bodyId: o.body.id, prio: 'deadline', cls: 'deadline', params: Object.assign({ target: P.target, ships, mission: 8, speed: 10, expectArrival: now + ft.duration * 1000, arrivalTolMs: 30000 }, P.ballast > 0 ? { cargo: { metal: P.ballast, crystal: 0, deuterium: 0 } } : {}),
      why: `Обломки: переработчики к [${P.coords}] после боя`, plan: { battle: P.battleId, mode: 'post', field: P.field, n, ballast: P.ballast || 0 }, dedupeKey: 'botdebris:' + P.id, returnAt: now + 2 * ft.duration * 1000 });
    if (r.dry) { setStatus(P, 'dry', 'пробный режим: отправка только запланирована'); return; }
    if (!r.ok && r.refused === 'slots' && wctx.now() < P.battleArrival + POST_RETRY_MAX_MS) {
      // the reserve slot is the save's: wait for a slot while the field is fresh instead of giving the field up
      P.postTries = (P.postTries || 0) + 1;
      P.retryAt = wctx.now() + OGX.bot.randMs(POST_RETRY_MS);
      setStatus(P, 'duePost', 'нет слота, повтор ' + fmtT(P.retryAt));
      wctx.rec('skip', `[${P.coords}]: отправка после боя: нет свободного слота (${r.message || 'резерв'}) — повтор через ${Math.round((P.retryAt - wctx.now()) / 1000)} с`, { reason: 'slots', battle: P.battleId, retryAt: P.retryAt, tries: P.postTries, message: r.message || null });
      return;
    }
    if (!r.ok && r.error === 'noDebris') { setStatus(P, 'skipped', 'поля нет: бой без обломков'); wctx.rec('skip', `[${P.coords}]: после боя поля нет (сервер: ${r.message || 'пусто'}) — бой без обломков`, { reason: 'noDebris', battle: P.battleId, message: r.message || null }); return; }
    if (!r.ok) { setStatus(P, 'failed', r.message || r.error || r.refused); wctx.rec('skip', `[${P.coords}]: отправка после боя не удалась: ${r.message || r.error || r.refused}`, { reason: r.refused || r.error, battle: P.battleId }); return; }
    const d = r.data || {};
    Object.assign(P, { fleetId: d.fleetId, arrival: d.arrival, back: d.back, sentAt: r.at, verified: r.verified });
    forgetShips(o.body.id, ships);
    setStatus(P, 'sent');
    wctx.rec('recyclers-sent', `Переработчики к [${P.coords}] после боя: ${n} × ${P.shipId}, прибытие ${fmtT(d.arrival)}`,
      { battle: P.battleId, mode: 'post', fleetId: d.fleetId, arrival: d.arrival, back: d.back, battleArrival: P.battleArrival, afterBattleMs: d.arrival ? d.arrival - P.battleArrival : null, sentAt: r.at, verified: r.verified, n });
  }

  async function recallPlan(wctx, P, why) {
    if (!P.fleetId) { setStatus(P, 'cancelled', why + ' (id флота неизвестен)'); return; }
    wctx.decide(`Отзываю переработчики к [${P.coords}]`, { why, inputs: { fleetId: P.fleetId, arrival: P.arrival, battleArrival: P.battleArrival }, chosen: 'fleet.recall', alternatives: ['оставить'] });
    const r = await wctx.act({ type: 'fleet.recall', bodyId: P.originId, prio: 'deadline', params: { fleetId: P.fleetId }, why: `Обломки: отзыв переработчиков [${P.coords}] — ${why}` });
    if (r.ok || r.dry) { setStatus(P, 'recalled', why); wctx.rec('skip', `Переработчики к [${P.coords}] отозваны: ${why}`, { reason: 'recalled', battle: P.battleId, fleetId: P.fleetId, ok: r.ok, dry: !!r.dry }); }
    else wctx.rec('skip', `Отзыв переработчиков [${P.coords}] не удался: ${r.message || r.error || r.refused}`, { reason: 'recallFailed', battle: P.battleId, fleetId: P.fleetId });
  }

  async function cancelPlan(wctx, P, reason) {
    P.cancelReason = reason;
    cancelTimer(P.id);
    if (['new', 'waitPre', 'waitPost', 'duePost'].includes(P.status)) {
      setStatus(P, 'cancelled', reason);
      wctx.rec('skip', `Бой у [${P.coords}] отменён (${reason}): переработчики не нужны`, { reason: 'battleCancelled', battle: P.battleId, why: reason });
      return;
    }
    if (P.status === 'queued') {
      // not departed yet: drop the queued precise send (the runtime cancels it before step 3); else recall after departure
      const n = typeof wctx.cancel === 'function' ? wctx.cancel('botdebris:' + P.id) : 0;
      if (n) { setStatus(P, 'cancelled', reason); wctx.rec('skip', `Бой у [${P.coords}] отменён (${reason}): отправка переработчиков снята с очереди`, { reason: 'battleCancelled', battle: P.battleId, why: reason, dequeued: n }); return; }
      wctx.rec('skip', `Бой у [${P.coords}] отменён (${reason}): отзову после вылета`, { reason: 'battleCancelled', battle: P.battleId, why: reason });
      return;
    }
    if (P.status === 'sent' && P.mode === 'pre' && P.arrival && wctx.now() < P.arrival - 1000) return recallPlan(wctx, P, 'бой отменён: ' + reason);
  }

  async function battlesStep(wctx, env) {
    let next = Infinity;
    const now = wctx.now();
    const list = OGX.bot.battles.list();
    const byId = {};
    for (const b of list) byId[b.id] = b;
    // cancellations: gone / recalled / bus event, only before the battle (a removal after it is the owner's cleanup)
    for (const P of Object.values(M.plans)) {
      if (TERMINAL.has(P.status) || P.cancelReason) continue;
      const b = byId[P.battleId];
      const ev = M.cancelled[P.battleId];
      if (now < P.battleArrival && (!b || b.status === 'recalled' || ev)) await cancelPlan(wctx, P, (ev && ev.reason) || (b ? 'атака отозвана' : 'бой снят'));
    }
    // new battles
    if (wctx.cfg('followBattles')) {
      for (const b of list) {
        if (M.plans[b.id] || !(b.status === 'planned' || b.status === 'flying') || !b.target) continue;
        if (b.side === 'defender') continue;   // a fight on an own body (botsave stays): the real field is read after it (fightsStep)
        if (+b.arrival < now - 30 * 60000) continue;
        await planBattle(wctx, env, b);
      }
    }
    // progress
    for (const P of Object.values(M.plans)) {
      if (P.status === 'waitPre') {
        if (now >= P.departAt - PRE_ENQUEUE_MS) await enqueuePre(wctx, P);
        else next = Math.min(next, P.departAt - PRE_ENQUEUE_MS);
      }
      if (P.status === 'waitPost') {
        if (now >= P.battleArrival + 1000) setStatus(P, 'duePost');
        else next = Math.min(next, P.battleArrival + 1000);
      }
      if (P.status === 'duePost') {
        if (!(P.retryAt && now < P.retryAt)) await sendPost(wctx, env, P);
        if (P.status === 'duePost' && P.retryAt) next = Math.min(next, P.retryAt);   // refused for slots: wake for the retry
      }
      if (P.status === 'result') await handlePreResult(wctx, P);
      if (P.status === 'queued' && !M.pending.has(P.id) && now > P.departAt + 30000) {
        // reload / leader change lost the promise: find the fleet in the event box
        const f = ownRecycleTo(env, P.coords)[0];
        if (f) { Object.assign(P, { fleetId: f.fleetId || null, arrival: f.arrival }); setStatus(P, 'sent', 'найден в списке полётов'); }
        else setStatus(P, 'lost', 'результат отправки потерян (перезагрузка)');
      }
      if (P.status === 'queued') next = Math.min(next, P.departAt + 35000);
      if (P.status === 'sent' && P.arrival && !P.harvest && wctx.core('readMessages') !== false && (P.harvestTries || 0) < 3) next = Math.min(next, P.arrival + 5000);
      // home again without a readable report (readMessages off / not found): the plan is over
      if (P.status === 'sent' && now > (P.back || num(P.arrival) + H) + 60000 && (P.harvest || (P.harvestTries || 0) >= 3 || wctx.core('readMessages') === false)) setStatus(P, 'done', P.harvest ? null : 'отчёт не прочитан');
    }
    return next;
  }

  // ------------------------------------------------------------------ harvest reports (messcat 5 [UPSTREAM MissionCaseRecycling:117])
  async function readHarvests(wctx) {
    if (wctx.core('readMessages') === false) return;
    const now = wctx.now();
    const due = [];
    for (const P of Object.values(M.plans)) if (P.status === 'sent' && P.arrival && now > P.arrival + 3000 && !P.harvest && (P.harvestTries || 0) < 3) due.push({ kind: 'battle', x: P });
    for (const [k, o] of Object.entries(M.own)) if (o.arrival && now > o.arrival + 3000 && !o.harvest && (o.harvestTries || 0) < 3) due.push({ kind: 'own', k, x: o });
    if (!due.length) return;
    wctx.decide('Читаю отчёты переработки', { why: 'сравнить прогноз поля и собранное', inputs: { fleets: due.map((d) => d.x.fleetId || null) }, chosen: 'read.messages cat 5', alternatives: [] });
    const r = await wctx.act({ type: 'read.messages', prio: 'read', params: { cat: 5 }, why: 'Обломки: отчёты переработки' });
    for (const d of due) d.x.harvestTries = (d.x.harvestTries || 0) + 1;
    if (!r || !r.ok || !r.data || !r.data.doc) return;
    const rows = [];
    let items = [];
    try { items = OGX.messages.parse.list(r.data.doc) || []; } catch (e) { items = []; }
    for (const it of items) {
      const head = it.li;
      const body = head && head.nextElementSibling ? head.nextElementSibling.textContent : '';
      let h = harvestFromText(body);
      if (!h) { try { const fm = OGX.messages.parse.fleetMessage(head); if (fm && fm.harvest && fm.harvest.harvested) h = { metal: num(fm.harvest.harvested.metal), crystal: num(fm.harvest.harvested.crystal) }; } catch (e) { /* ignore */ } }
      if (h && it.ts) rows.push({ id: it.id, ts: it.ts, harvested: h });
    }
    for (const d of due) {
      const o = d.x;
      const hit = rows.filter((x) => Math.abs(x.ts - o.arrival) <= 3000).sort((a, b) => Math.abs(a.ts - o.arrival) - Math.abs(b.ts - o.arrival))[0];
      if (!hit) continue;
      o.harvest = hit.harvested;
      const predicted = d.kind === 'battle' ? { metal: o.field.metal, crystal: o.field.crystal } : o.field;
      const want = d.kind === 'battle' ? o.harvestTarget : fieldSum(o.field);
      if (d.kind === 'battle' && (o.status === 'sent')) setStatus(o, 'done');
      wctx.rec('harvest-own', `Собрано у [${o.coords}]: ${fmtN(fieldSum(hit.harvested))} (прогноз поля ${fmtN(fieldSum(predicted))}, цель сбора ${fmtN(want)})`,
        { kind: d.kind, battle: o.battleId || null, coords: o.coords, fleetId: o.fleetId || null, predicted, harvestTarget: want, harvested: hit.harvested, messageId: hit.id,
          ratio: fieldSum(predicted) > 0 ? fieldSum(hit.harvested) / fieldSum(predicted) : null });
    }
  }

  // ------------------------------------------------------------------ (d) fights on own bodies -> own field right after (§7.2)
  /** Hostile attacks on own bodies (threats with mission 1/2/9) and defender-side battles botsave registered are remembered until
   *  their arrival passed; then the own field of that system is looked at once (ownStep with M.meta.ownForce[gs]). -> next wake */
  function fightsStep(wctx, env) {
    const now = wctx.now();
    M.meta.fights = M.meta.fights || {};
    const own = (coords) => Object.values(env.bodies).some((x) => x.coords === coords);
    const live = new Set();
    for (const th of wctx.threats() || []) {
      if (!th || !th.bodyKey || th.probesOnly || !FIGHT_MISSIONS.has(+th.mission) || !(th.arrival > 0)) continue;
      const b = env.bodies[th.bodyKey];
      const coords = (b && b.coords) || coordsOf(th.to);
      if (!coords) continue;
      live.add(th.key);
      const f = M.meta.fights[th.key] || (M.meta.fights[th.key] = { key: th.key, bodyKey: th.bodyKey, coords, t: now, src: 'threat' });
      f.arrival = th.arrival; f.mission = +th.mission;
    }
    // an attack that vanished well before its arrival was recalled: no fight, no field to look for
    for (const [k, f] of Object.entries(M.meta.fights)) if (f.src === 'threat' && !f.done && !live.has(k) && now < num(f.arrival) - 5000) delete M.meta.fights[k];
    let list = [];
    try { list = OGX.bot.battles.list() || []; } catch (e) { list = []; }
    for (const b of list) {
      if (!b || b.side !== 'defender' || !b.target || !(b.arrival > 0)) continue;
      const coords = coordsOf(b.target);
      if (!coords || !own(coords)) continue;
      const key = b.threat || b.id;   // botsave's entry names its threat: one fight, one look
      if (b.threat && !live.has(b.threat) && now < +b.arrival - 5000) continue;
      const f = M.meta.fights[key] || (M.meta.fights[key] = { key, coords, t: now, src: 'battle' });
      f.arrival = +b.arrival;
    }
    let next = Infinity;
    for (const [k, f] of Object.entries(M.meta.fights)) {
      if (now - num(f.arrival) > H) { delete M.meta.fights[k]; continue; }
      if (f.done) continue;
      if (now < num(f.arrival) + FIGHT_SETTLE_MS) { next = Math.min(next, num(f.arrival) + FIGHT_SETTLE_MS); continue; }
      f.done = true;
      const gs = f.coords.split(':').slice(0, 2).join(':');
      M.meta.ownForce = M.meta.ownForce || {};
      M.meta.ownForce[gs] = Math.max(num(M.meta.ownForce[gs]), num(f.arrival));
      M.meta.nextOwnAt = now;
      wctx.rec('harvest-own', `Бой у [${f.coords}] (${fmtT(f.arrival)}) прошёл: проверяю поле обломков у своих планет в ${gs}`, { kind: 'fight', coords: f.coords, arrival: f.arrival, threat: k });
    }
    return next;
  }

  // ------------------------------------------------------------------ (b) own debris fields
  async function ownStep(wctx, env) {
    const now = wctx.now();
    const minDf = num(wctx.cfg('minOwnDf'), 10000000);
    const planets = Object.values(env.bodies).filter((b) => !isMoon(b));
    const systems = [...new Set(planets.map((b) => b.coords.split(':').slice(0, 2).join(':')))];
    const budget = num(wctx.core('galaxyViewsPerHour'), 0);
    let views = 0;
    const fields = [];
    const missing = [];   // systems with no data at all (neither the cache nor a view seen on the bus) and when they may be read
    const minMs = num(wctx.cfg('checkMinMin'), 30) * 60000;
    const maxMs = Math.max(minMs, num(wctx.cfg('checkMaxMin'), 60) * 60000);
    M.meta.ownRead = M.meta.ownRead || {};
    for (const gs of systems) {
      const [g, s] = gs.split(':').map(Number);
      let sys = null;
      try { sys = await OGX.galaxy.cached(g, s); } catch (e) { sys = null; }
      // a newer view of the system seen on the bus (a bot read.galaxy of any module — botcore does not store those in the galaxy
      // cache — or the player's galaxy page) beats the cache
      const seen = M.seen[gs];
      if (seen && seen.positions && (!sys || num(seen.t) > num(sys.t))) sys = seen;
      // [root cause of the 4–5 s loop, preview 2] the bot's own read never refreshed the cache and its galaxy:system event woke this
      // module again: now at most one read per system per checkMinMin (and only when the data is older than checkMaxMin)
      // a fight on an own body of this system just ended (fightsStep): data older than the fight is stale and one read is allowed
      // regardless of checkMinMin (budget permitting) — the attacker's recyclers are on their way
      const force = M.meta.ownForce && num(M.meta.ownForce[gs]) > 0 ? num(M.meta.ownForce[gs]) : 0;
      const stale = !sys || now - num(sys.t) > maxMs || (force > 0 && num(sys.t) < force);
      const lastRead = num(M.meta.ownRead[gs]);
      if (stale && budget > 0 && views < 2 && (force > 0 || now - lastRead >= minMs)) {
        wctx.decide(`Смотрю галактику ${gs} (свои поля)`, { why: force ? 'бой у своего тела прошёл: поле могло появиться' : sys ? 'кэш устарел' : 'системы нет в кэше', inputs: { budget, cacheT: sys ? sys.t : null, lastRead: lastRead || null, fightAt: force || null }, chosen: 'read.galaxy', alternatives: ['ждать кэш'] });
        M.meta.ownRead[gs] = now;
        if (force) delete M.meta.ownForce[gs];
        // persisted at once: the player navigating in the bot tab ends this run before save() and the next leader (with an empty
        // M.seen, bot reads are not in the galaxy cache) would read the same system again
        try { await M.ctx.store.set('meta', clone(M.meta)); } catch (e) { /* ignore */ }
        const r = await wctx.act({ type: 'read.galaxy', prio: 'read', params: { galaxy: g, system: s }, why: 'Обломки: свои поля в ' + gs });
        views++;
        if (r && r.ok && r.data && r.data.system) { sys = r.data.system; M.seen[gs] = { t: num(sys.t, now), positions: sys.positions }; }
      } else if (force > 0 && (!stale || budget <= 0)) delete M.meta.ownForce[gs];   // fresh data already / no galaxy budget: one shot
      if (!sys || !Array.isArray(sys.positions)) { missing.push({ gs, readAt: budget > 0 ? num(M.meta.ownRead[gs]) + minMs : null }); continue; }
      for (const pl of planets.filter((b) => b.coords.startsWith(gs + ':'))) {
        const pos = +pl.coords.split(':')[2];
        const row = sys.positions.find((x) => +x.position === pos);
        if (row && row.debris && fieldSum(row.debris) > 0) fields.push({ coords: pl.coords, field: { metal: num(row.debris.metal), crystal: num(row.debris.crystal) }, t: sys.t, src: 'galaxy' });
      }
    }
    // the real reason when nothing is found: no fields in the data / no data for a system (and when it may be read) / no galaxy budget
    const missTxt = missing.length ? (budget > 0 ? `нет данных по ${missing.map((m) => m.gs + (m.readAt > now ? ' (чтение после ' + fmtT(m.readAt) + ')' : '')).join(', ')}`
      : `нет данных по ${missing.map((m) => m.gs).join(', ')}, просмотр галактики запрещён (лимит просмотров в час 0)`) : '';
    const found = fields.length ? fields.map((f) => '[' + f.coords + '] ' + fmtN(fieldSum(f.field))).join(', ') : (missing.length < systems.length ? 'полей нет' : '');
    wctx.rec('harvest-own', `Свои поля: ${[found, missTxt].filter(Boolean).join('; ')}`, { kind: 'scan', systems, fields, views, missing: missing.map((m) => m.gs), budget });
    let sent = 0;
    let nextAt = null;
    // [SPEC §5] next check: return of the nearest own recycle fleet (duplicate) / any own fleet (no slot) + 20..50 s
    const backIn = (list) => { const t = list.map((f) => num(f.arrival)).filter((x) => x > now); return t.length ? Math.max(...t) + OGX.bot.randMs([20000, 50000]) : null; };
    const soon = (t) => { if (t) nextAt = nextAt ? Math.min(nextAt, t) : t; };
    for (const F of fields) {
      const key = F.coords + ':2';
      const total = fieldSum(F.field);
      if (total < minDf) { wctx.rec('skip', `Своё поле [${F.coords}] ${fmtN(total)} < порога ${fmtN(minDf)}`, { reason: 'small', coords: F.coords, field: F.field }); continue; }
      if (Object.values(M.plans).some((P) => P.coords === F.coords && !TERMINAL.has(P.status))) { wctx.rec('skip', `[${F.coords}]: поле занято планом боя`, { reason: 'battlePlan', coords: F.coords }); continue; }
      const flying = ownRecycleTo(env, F.coords);
      const mine = M.own[key];
      if (flying.length || (mine && mine.arrival && now < mine.arrival + 5000 && !mine.dry)) {
        soon(backIn(flightsOf(env).filter((f) => f && f.own && +f.missionType === 8 && (coordsOf(f.to) === F.coords || coordsOf(f.from) === F.coords))) || (mine && mine.back ? mine.back + OGX.bot.randMs([20000, 50000]) : null));
        wctx.rec('skip', `[${F.coords}]: к полю уже летят наши переработчики`, { reason: 'duplicate', coords: F.coords, key, fleets: flying.map((f) => f.fleetId || null), own: mine ? mine.fleetId : null });
        continue;
      }
      if (mine && mine.dry && now - mine.sentAt < 20 * 60000) continue;   // dry-run: plan once per 20 min
      if (mine && mine.arrival && num(F.t) < mine.arrival + 1000) { wctx.rec('skip', `[${F.coords}]: данные галактики старше нашего сбора`, { reason: 'staleCache', coords: F.coords, cacheT: F.t, harvestedAt: mine.arrival }); continue; }
      const cap = capOf(env.stats, REC);
      const need = simRecyclers(fieldSum(F.field), cap, num(wctx.cfg('marginPct'), 10));
      const shipsBy = await shipsAll(wctx, env, REC, 'выбор тела для сбора своего поля');
      const cands = originsWithRecyclers(wctx, env, shipsBy, REC, F.coords, need, need);
      const pick = pickOwnOrigin(cands, need);
      if (!pick) {
        // recyclers exist but their body is under a threat lock (a fight just ended there: the lock holds a minute after the hit): again after it
        const lockedHave = Object.values(env.bodies).filter((b) => wctx.locked(b.key) && num((shipsBy[b.id] || {})[REC]) > 0);
        if (lockedHave.length) soon(now + 65000);
        wctx.rec('skip', `[${F.coords}]: нет свободных боевых переработчиков (219), нужно ${need}` + (lockedHave.length ? ` (${lockedHave.map((b) => b.coords).join(', ')} под угрозой — повтор через минуту)` : ''), { reason: 'noRecyclers', coords: F.coords, need, shipId: REC, locked: lockedHave.map((b) => b.id) });
        continue;
      }
      const o = pick.origin; const n = Math.min(need, o.have);
      const ships = { [REC]: n };
      wctx.decide(`Проверяю свободные слоты флота`, { why: 'сбор своего поля идёт обычным классом (резерв слотов)', inputs: { reserve: wctx.core('slotsReserve') }, chosen: 'slots', alternatives: [] });
      const can = await wctx.canSend('normal');
      if (!can.ok) { soon(backIn(flightsOf(env).filter((f) => f && f.own))); wctx.rec('skip', `[${F.coords}]: нет свободного слота (свободно ${can.free}, резерв ${can.reserve})`, { reason: 'slots', coords: F.coords, can }); break; }
      const sc = wctx.sleepCheck(now + 2 * o.duration * 1000);
      if (!sc.ok) { wctx.rec('skip', `[${F.coords}]: возврат попадает в сон`, { reason: sc.reason, coords: F.coords }); continue; }
      const clsRu = ['луна, все переработчики', 'луна, сколько есть', 'планета, все переработчики', 'планета, сколько есть'][pick.cls];
      wctx.decide(`Собираю своё поле [${F.coords}] (${fmtN(total)}): ${n} переработчиков с ${o.body.coords}${isMoon(o.body) ? ' (луна)' : ''}`, {
        why: `поле ≥ ${fmtN(minDf)}; источник: ${clsRu}`, inputs: { field: F.field, cacheT: F.t, need, cap },
        chosen: { origin: o.body.id, ships, speed: 10 }, alternatives: cands.map((c) => ({ id: c.body.id, moon: isMoon(c.body), have: c.have, distance: c.distance })) });
      const r = await wctx.act({ type: 'fleet.send', bodyId: o.body.id, prio: 'fleet', cls: 'normal', params: { target: targetOf(F.coords, 2), ships, mission: 8, speed: 10, expectArrival: now + o.duration * 1000, arrivalTolMs: 30000 },
        why: `Обломки: своё поле [${F.coords}]`, plan: { field: F.field, n }, dedupeKey: 'botdebris:own:' + key, returnAt: now + 2 * o.duration * 1000 });
      if (r.dry) { M.own[key] = { coords: F.coords, field: F.field, dry: true, sentAt: now, n }; continue; }
      if (!r.ok) {
        // a send the core refused before any request (threat lock, slots, limits, sleep) is retried soon, not after checkMinMin..checkMaxMin:
        // nothing else re-checks own fields (a bot galaxy scan no longer wakes this module)
        if (r.refused && !r.verified) soon(wctx.now() + OGX.bot.randMs([30000, 60000]));
        wctx.rec('skip', `[${F.coords}]: отправка не удалась: ${r.message || r.error || r.refused}`, { reason: r.refused || r.error, coords: F.coords });
        continue;
      }
      const d = r.data || {};
      M.own[key] = { coords: F.coords, field: F.field, fleetId: d.fleetId, arrival: d.arrival, back: d.back, sentAt: r.at || now, n, origin: o.body.id };
      forgetShips(o.body.id, ships);
      sent++;
      wctx.rec('harvest-own', `Переработчики к своему полю [${F.coords}]: ${n}, прибытие ${fmtT(d.arrival)}`, { kind: 'own-sent', coords: F.coords, field: F.field, fleetId: d.fleetId, arrival: d.arrival, back: d.back, n, origin: o.body.id });
    }
    return { sent, nextAt };
  }

  // ------------------------------------------------------------------ (c) logistics
  async function transport(wctx, env, { source, dest, load: loadIn, kind, needId, why }) {
    const now = wctx.now();
    const cargoType = TRANSPORT;
    const cap = capOf(env.stats, cargoType);
    const fuelOf = (n) => flightTime(env, source, dest.coords, { [cargoType]: n }, 10).fuel;
    const load = Object.assign(res0(), loadIn);
    let plan = transportShips({ load, cap, fuelOf });
    if (!plan) return { skip: 'cargo', text: 'не удаётся рассчитать транспорт' };
    // the stock check comes before any request: the deuterium reserve (deutReserveH of production, remembered when the core's
    // perHour drops out) and the fuel come first; a deuterium load above that is trimmed (the planner applies the same rule, this
    // catches a stock that moved since), never refused as a whole
    const avail = availOf(wctx, source);
    const keepD = keepDOf(wctx, source);
    let deutTrimmed = 0;
    const dMax = Math.max(0, Math.floor(avail.deuterium - keepD - plan.fuel));
    if (num(load.deuterium) > dMax) {
      deutTrimmed = num(load.deuterium) - dMax;
      load.deuterium = dMax;
      plan = transportShips({ load, cap, fuelOf });
      if (!plan) return { skip: 'stock', text: 'на складе не хватает: дейтерий ' + fmtN(avail.deuterium) + ' − запас ' + fmtN(keepD) + ' не покрывает даже топливо' };
    }
    const lacks = [];
    if (amountOf(source, 'metal') === null) lacks.push('запас склада неизвестен');
    if (avail.metal < num(load.metal)) lacks.push('металл ' + fmtN(avail.metal) + ' < ' + fmtN(load.metal));
    if (avail.crystal < num(load.crystal)) lacks.push('кристалл ' + fmtN(avail.crystal) + ' < ' + fmtN(load.crystal));
    if (avail.deuterium - keepD < num(load.deuterium) + plan.fuel) lacks.push('дейтерий ' + fmtN(avail.deuterium) + ' − запас ' + fmtN(keepD) + ' < ' + fmtN(num(load.deuterium) + plan.fuel));
    if (lacks.length) return { skip: 'stock', text: 'на складе не хватает: ' + lacks.join('; ') };
    const ft = flightTime(env, source, dest.coords, { [cargoType]: plan.n }, 10);
    const ships = await shipsOf(wctx, env, source, 'транспорт: корабли на складе');
    if (num(ships[cargoType]) < plan.n) return { skip: 'ships', text: `не хватает ${plan.n - num(ships[cargoType])} Ул. трансп. (на ${source.coords} ${num(ships[cargoType])}, нужно ${plan.n})` };
    if (wctx.locked(source.key)) return { skip: 'threat', text: 'склад под угрозой' };
    const arrival = now + ft.duration * 1000;
    const dl = wctx.locked(dest.key);
    if (dl && dl.arrival - num(wctx.core('threatLockSec'), 3600) * 1000 <= arrival && arrival <= dl.arrival + 60000) return { skip: 'threat', text: 'цель под угрозой к прибытию' };
    wctx.decide(`Проверяю свободные слоты флота`, { why: 'транспорт идёт обычным классом (резерв слотов)', inputs: { reserve: wctx.core('slotsReserve') }, chosen: 'slots', alternatives: [] });
    const can = await wctx.canSend('normal');
    if (!can.ok) return { skip: 'slots', text: `нет слота (свободно ${can.free}, резерв ${can.reserve})` };
    const sc = wctx.sleepCheck(now + 2 * ft.duration * 1000);
    if (!sc.ok) return { skip: 'sleep', text: 'возврат попадает в сон' };
    const cargo = { metal: Math.ceil(num(load.metal)), crystal: Math.ceil(num(load.crystal)), deuterium: Math.ceil(num(load.deuterium)) };
    wctx.rec('transport-planned', `${kind === 'need' ? 'Довоз' : 'Перевоз'} ${fmtN(plan.total)} на ${dest.coords} с ${source.coords}: ${plan.n} × ${cargoType} (топливо ${fmtN(plan.fuel)})` + (deutTrimmed ? ` (дейтерий урезан на ${fmtN(deutTrimmed)}: запас ${fmtN(keepD)} + топливо)` : ''),
      { kind, needId: needId || null, from: source.id, to: dest.id, cargo, ships: { [cargoType]: plan.n }, fuel: plan.fuel, duration: ft.duration, keepDeut: keepD, deutTrimmed });
    const resId = wctx.reserve(source.key, { metal: cargo.metal, crystal: cargo.crystal, deuterium: cargo.deuterium + plan.fuel }, { ttlMs: 10 * 60000, label: 'транспорт' });
    wctx.decide(`Транспорт на ${dest.coords}: ${fmtN(cargo.metal)} / ${fmtN(cargo.crystal)} / ${fmtN(cargo.deuterium)}`, { why, inputs: { need: needId || null, load, avail, keepDeut: keepD, cap },
      chosen: { from: source.id, ships: { [cargoType]: plan.n }, cargo, speed: 10 }, alternatives: [] });
    const srcRaw = await rawStock(source.key);   // the stock the state shows right before the send (see unsynced)
    const r = await wctx.act({ type: 'fleet.send', bodyId: source.id, prio: 'fleet', cls: 'normal', params: { target: targetOf(dest.coords, isMoon(dest) ? 3 : 1), ships: { [cargoType]: plan.n }, mission: 3, speed: 10, cargo, expectArrival: arrival, arrivalTolMs: 30000 },
      why: `Логистика: ${kind === 'need' ? 'довоз под постройку' : kind} на ${dest.coords}`, plan: { needId: needId || null, kind }, dedupeKey: 'botdebris:logi:' + dest.key, returnAt: now + 2 * ft.duration * 1000 });
    wctx.release(resId);
    if (r.dry) return { dry: true };
    if (!r.ok) return { skip: r.refused || r.error || 'error', text: r.message || r.error || r.refused };
    const d = r.data || {};
    forgetShips(source.id, { [cargoType]: plan.n });
    const rec = { id: kind + ':' + (needId || dest.key) + ':' + now, kind, needId: needId || null, to: dest.key, toCoords: dest.coords, from: source.id, fleetId: d.fleetId, arrival: d.arrival, back: d.back, cargo, ships: { [cargoType]: plan.n }, sentAt: r.at || now,
      fuel: plan.fuel, srcAmt: srcRaw ? srcRaw.amt : null };
    M.logi.push(rec);
    return { sent: rec };
  }
  /** What a source body can give: its available stock (other modules' reservations off) minus what its own build plan keeps for the
   *  next needAheadMin (botbuild 'keep' need) and the deuterium reserve (deutReserveH hours of its production). */
  function spareOf(wctx, body, keep) {
    const avail = availOf(wctx, body);
    const keepD = keepDOf(wctx, body);
    const out = res0();
    for (const r of RES) out[r] = Math.max(0, Math.floor(num(avail[r]) - num(keep && keep[r]) - (r === 'deuterium' ? keepD : 0)));
    return out;
  }
  /**
   * Delivery load from one source for a need: per resource min(need.res, spare); null when the spare does not cover need.min (the
   * waiting step itself) of some resource. Pure. -> { load, short: { r: amount } } | { load: null, short }
   */
  function needLoad(need, spare) {
    const load = res0(); const short = {};
    for (const r of RES) {
      const want = Math.max(0, Math.ceil(num(need.res && need.res[r])));
      const min = Math.max(0, Math.ceil(num(need.min ? need.min[r] : want)));
      load[r] = Math.min(want, Math.max(0, Math.floor(num(spare[r]))));
      if (load[r] < min) short[r] = min - load[r];
    }
    return { load: Object.keys(short).length ? null : load, short };
  }
  /** Sources for a delivery: the configured store, else every other body, the largest spare first (all of John's planets share
   *  one system: flight times are alike, the largest spare saves trips). A body with an open need of its own gives only the
   *  resources it does not wait for (needRes: bodyKey -> { metal, crystal, deuterium } still missing there); before, any open need
   *  excluded the body and with chain needs on every planet there was no source at all (debris-save-9). */
  function sourcesFor(wctx, env, dest, origin, needRes, keeps) {
    const sourceOf = (b) => {
      const spare = spareOf(wctx, b, keeps[b.key]);
      const own = needRes && needRes[b.key];
      if (own) for (const r of RES) if (num(own[r]) > 0) spare[r] = 0;
      return { body: b, spare };
    };
    if (origin) return origin.key !== dest.key ? [sourceOf(origin)] : [];
    return Object.values(env.bodies).filter((b) => b.key !== dest.key && b.res && !wctx.locked(b.key))
      .map(sourceOf)
      .filter((c) => RES.some((r) => c.spare[r] > 0))
      .sort((a, b) => OGX.bot.msu(b.spare) - OGX.bot.msu(a.spare));
  }
  /** One journal line per key and signature; the same situation is written again after LOG_REPEAT_MS (M.meta.repLog, persisted). */
  function recOnce(wctx, key, sig, kind, text, data) {
    M.meta.repLog = M.meta.repLog || {};
    const now = wctx.now();
    const prev = M.meta.repLog[key];
    if (prev && prev.sig === sig && now - num(prev.t) < LOG_REPEAT_MS) return false;
    M.meta.repLog[key] = { sig, t: now };
    wctx.rec(kind, text, data);
    return true;
  }
  /** A refused repatriation: journal once per situation and (with `cooldown`, a REP_COOLDOWN key) leave the body alone — no plan,
   *  no fleetTable read — until the cooldown ends or a fleet lands on it (bot:fleet-returned clears it). */
  function repSkip(wctx, b, reason, text, data, cooldown) {
    const now = wctx.now();
    if (cooldown) {
      M.meta.repSkip = M.meta.repSkip || {};
      const cd = REP_COOLDOWN[cooldown] || REP_COOLDOWN.error;
      M.meta.repSkip[b.key] = { reason, until: now + OGX.bot.randMs(cd), t: now };
    }
    recOnce(wctx, 'rep:' + b.key, reason + '|' + String(text || ''), 'skip', text, Object.assign({ reason }, data || {}));
  }
  /**
   * A colony with something to export and no Battle Transporters: Deploy (mission 4) the 217 it needs (at most FERRY_MAX) from the
   * body with the most known spare ones (the main first); the next pass repatriates with them. John's rule: 217 only, nothing else
   * ever ferries resources. -> { sent } | { dry: true } | { skip, text }
   */
  async function ferry(wctx, env, { b, main, spare, cap, over }) {
    const now = wctx.now();
    if (!wctx.cfg('ferry')) return { skip: 'ships', text: 'перегон транспортов выключен' };
    const total = RES.reduce((s, r) => s + num(spare[r]), 0);
    // worth a trip: a full hold (or the repatriation threshold when lower) is exportable, or the colony's storage is at the cap
    const worth = Math.min(num(wctx.cfg('repatriateMin'), cap), cap);
    if (!over && total < worth) return { skip: 'stock', text: `вывозить всего ${fmtN(total)} — меньше трюма одного Ул. трансп. (${fmtN(worth)}), перегон не окупится` };
    const need = Math.min(FERRY_MAX, Math.max(1, Math.ceil(total / Math.max(1, cap))));
    const cands = [];
    for (const s of Object.values(env.bodies)) {
      if (s.key === b.key || wctx.locked(s.key)) continue;
      // known counts only (no reads for a ferry): this module's read, else the core state's once a page showed the ships
      const mine = myShips(s);
      const known = (mine && mine.ships) || (s.shipsT !== null && s.shipsT !== undefined ? s.ships : null) || null;
      const have = known ? num(known[TRANSPORT]) : 0;
      if (have > 0) cands.push({ body: s, have, main: s.key === main.key });
    }
    cands.sort((x, y) => (y.main ? 1 : 0) - (x.main ? 1 : 0) || y.have - x.have);
    if (!cands.length) return { skip: 'ships', text: 'перегонять нечего: Ул. трансп. нет ни на одном теле' };
    const src = cands[0];
    const n = Math.min(need, src.have);
    const ships = { [TRANSPORT]: n };
    const ft = flightTime(env, src.body, b.coords, ships, 10);
    if (amountOf(src.body, 'deuterium') !== null && availOf(wctx, src.body).deuterium < ft.fuel) return { skip: 'ships', text: `перегон с ${src.body.coords}: нет дейтерия на топливо (${fmtN(ft.fuel)})` };
    wctx.decide(`Проверяю свободные слоты флота`, { why: 'перегон транспортов идёт обычным классом (резерв слотов)', inputs: { reserve: wctx.core('slotsReserve') }, chosen: 'slots', alternatives: [] });
    const can = await wctx.canSend('normal');
    if (!can.ok) return { skip: 'slots', text: `перегон: нет слота (свободно ${can.free}, резерв ${can.reserve})` };
    const sc = wctx.sleepCheck(now + ft.duration * 1000);
    if (!sc.ok) return { skip: 'sleep', text: 'перегон попадает в сон' };
    wctx.decide(`Перегон ${n} Ул. трансп. с ${src.body.coords} на ${b.coords} под вывоз ${fmtN(total)}`, { why: over ? 'хранилище колонии почти заполнено, транспортов на ней нет' : 'запас колонии ≥ порога, транспортов на ней нет',
      inputs: { need, have: src.have, spare, cap }, chosen: { from: src.body.id, ships, mission: 4, speed: 10 }, alternatives: cands.map((c) => ({ id: c.body.id, have: c.have })) });
    const srcRaw = await rawStock(src.body.key);
    const r = await wctx.act({ type: 'fleet.send', bodyId: src.body.id, prio: 'fleet', cls: 'normal', params: { target: targetOf(b.coords, isMoon(b) ? 3 : 1), ships, mission: 4, speed: 10, expectArrival: now + ft.duration * 1000, arrivalTolMs: 30000 },
      why: `Логистика: перегон ${n} Ул. трансп. на ${b.coords} под вывоз`, plan: { kind: 'ferry', n, need, spare }, dedupeKey: 'botdebris:ferry:' + b.key, returnAt: now + ft.duration * 1000 });
    if (r.dry) { M.logi.push({ id: 'dry:ferry:' + b.key, kind: 'ferry', to: b.key, dry: true, sentAt: now }); return { dry: true }; }
    if (!r.ok) return { skip: r.refused || r.error || 'error', text: 'перегон не удался: ' + (r.message || r.error || r.refused) };
    const d = r.data || {};
    forgetShips(src.body.id, ships);
    const rec = { id: 'ferry:' + b.key + ':' + now, kind: 'ferry', to: b.key, toCoords: b.coords, from: src.body.id, fleetId: d.fleetId, arrival: d.arrival, back: d.arrival, cargo: res0(), ships, sentAt: r.at || now,
      fuel: ft.fuel, srcAmt: srcRaw ? srcRaw.amt : null };
    M.logi.push(rec);
    wctx.rec('transport-sent', `Перегон ${n} Ул. трансп. с ${src.body.coords} на ${b.coords} под вывоз, прибытие ${fmtT(d.arrival)}`, Object.assign({ action: 'ferry', need, spare }, rec));
    return { sent: rec };
  }
  async function logisticsStep(wctx, env) {
    const now = wctx.now();
    let all = [];
    try { all = OGX.bot.needs.list() || []; } catch (e) { all = []; }
    // botbuild 'keep' entries: what each body's own plan needs for the next needAheadMin (never shipped away)
    const keeps = {};
    for (const n of all) if (n && n.kind === 'keep' && n.bodyKey && n.keep) keeps[n.bodyKey] = addRes(keeps[n.bodyKey], n.keep);
    const needs = all.filter((n) => n && n.kind !== 'keep' && n.bodyKey && n.res).sort((a, b) => num(b.priority) - num(a.priority) || num(a.wantedBy) - num(b.wantedBy));
    const needKeys = new Set(needs.map((n) => n.bodyKey));
    const needRes = {};
    for (const n of needs) needRes[n.bodyKey] = addRes(needRes[n.bodyKey], n.res);
    const origin = bodyByRef(env, wctx.cfg('logisticsOrigin'));
    if (wctx.cfg('logistics')) for (const need of needs) {
      const dest = env.bodies[need.bodyKey];
      if (!dest) continue;
      const want = res0();
      for (const r of RES) want[r] = Math.max(0, Math.ceil(num(need.res[r])));
      if (!RES.some((r) => want[r] > 0)) continue;
      const sig = RES.map((r) => want[r]).join('/');
      const dry = M.logi.find((x) => x.to === dest.key && x.kind === 'need' && x.dry && now - x.sentAt < 20 * 60000);
      if (dry) continue;
      // the same need (same amounts) was already delivered to that planet: botbuild has not re-read / re-planned it yet
      if (M.logi.some((x) => x.to === dest.key && x.kind === 'need' && !x.dry && x.sig === sig && x.arrival && now < x.arrival + 30 * 60000 && now >= x.arrival + 5000)) continue;
      // one trip per planet: never a second delivery while one flies there (matched by planet, not by the step of the need)
      if (M.logi.some((x) => x.to === dest.key && !x.dry && x.arrival && now < x.arrival + 5000) || ownTransportTo(env, dest.coords).length) {
        wctx.rec('skip', `Логистика: на ${dest.coords} уже летит наш транспорт`, { reason: 'inFlight', needId: need.id, to: dest.key });
        continue;
      }
      const cands = sourcesFor(wctx, env, dest, origin, needRes, keeps);
      if (!cands.length) { wctx.rec('skip', `Логистика на ${dest.coords}: нет склада с излишком`, { reason: 'noSource', needId: need.id }); continue; }
      const what = need.forItem ? need.forItem.id + ' ур. ' + need.forItem.level : 'постройку';
      const chainTxt = Array.isArray(need.chain) && need.chain.length > 1 ? ` (цепочка ${need.chain.length} шаг., на ${num(need.aheadMin)} мин стройки)` : '';
      const fails = [];
      let done = false;
      for (const c of cands) {
        const source = c.body;
        const { load, short } = needLoad(need, c.spare);
        if (!load) { fails.push(`${source.coords}: не хватает ${Object.entries(short).map(([r, n]) => ({ metal: 'М', crystal: 'К', deuterium: 'Д' }[r]) + ' ' + fmtN(n)).join(', ')}`); continue; }
        const cargoType = TRANSPORT;
        const ft = flightTime(env, source, dest.coords, { [cargoType]: Math.max(1, Math.ceil(RES.reduce((s2, r) => s2 + load[r], 0) / Math.max(1, capOf(env.stats, cargoType)))) }, 10);
        // faster to wait: the target produces the missing amount during the one-way flight and it fits its storage
        const prod = RES.every((r) => {
          if (load[r] <= 0) return true;
          const ph = perHourOf(dest, r); const am = amountOf(dest, r); const stg = storageOf(dest, r);
          return ph !== null && ph > 0 && am !== null && ph * ft.duration / 3600 >= load[r] && (stg === null || am + load[r] <= stg);
        });
        if (prod) { wctx.rec('skip', `Логистика: ${dest.coords} само произведёт недостающее за время полёта`, { reason: 'produces', needId: need.id, duration: ft.duration }); done = true; break; }
        const out = await transport(wctx, env, { source, dest, load, kind: 'need', needId: need.id, why: `не хватает на ${what}${chainTxt}; склад с наибольшим излишком` });
        if (out.dry) { M.logi.push({ id: 'dry:' + need.id, kind: 'need', needId: need.id, to: dest.key, dry: true, sentAt: now }); return 1; }
        if (out.sent) { out.sent.sig = sig; wctx.rec('transport-sent', `Транспорт на ${dest.coords} в пути, прибытие ${fmtT(out.sent.arrival)}${chainTxt}`, Object.assign({ action: 'need', chain: need.chain || null }, out.sent)); return 1; }
        fails.push(`${source.coords}: ${out.text}`);
        // another source may have the ships / the stock; anything else (slots, sleep, threat) holds for every source
        if (out.skip !== 'ships' && out.skip !== 'stock') break;
      }
      if (!done && fails.length) wctx.rec('skip', `Логистика на ${dest.coords}: ${fails.join('; ')}`, { reason: 'noSource', needId: need.id, fails });
    }
    if (wctx.cfg('repatriate')) {
      const main = origin || Object.values(env.bodies).filter((b) => !isMoon(b)).sort((a, b) => num(a.order, 99) - num(b.order, 99))[0];
      if (!main) return 0;
      const cargoType = TRANSPORT;
      const cap = Math.max(1, capOf(env.stats, cargoType));
      // deliveries to the main still flying, or landed after its stock was last read (the state's own time, not the projected one),
      // already take its room
      const mainRaw = M.raw && M.raw[main.key];
      const mainT = mainRaw ? num(mainRaw.t) : 0;
      const pending = res0();
      for (const x of M.logi) if (x.to === main.key && !x.dry && x.cargo && x.arrival && (now < x.arrival || (mainT ? x.arrival > mainT : now < x.arrival + 30 * 60000))) for (const r of RES) pending[r] += num(x.cargo[r]);
      const dest = destRoom(main, pending);
      // a trip is worth it from one full hold (or the threshold when it is lower); an overflowing colony always
      const worth = Math.min(num(wctx.cfg('repatriateMin'), cap), cap);
      for (const b of Object.values(env.bodies)) {
        if (b.key === main.key || !b.res) continue;
        // a body waiting for a delivery is never emptied (no ping-pong: deliveries main -> colony, repatriation colony -> main)
        if (needKeys.has(b.key)) { repSkip(wctx, b, 'openNeed', `Репатриация ${b.coords}: ждёт довоз под стройку`, { body: b.id }); continue; }
        const stock = { metal: amountOf(b, 'metal'), crystal: amountOf(b, 'crystal'), deuterium: amountOf(b, 'deuterium') };
        const sum = RES.reduce((s, r) => s + num(stock[r]), 0);
        const storage = { metal: storageOf(b, 'metal'), crystal: storageOf(b, 'crystal'), deuterium: storageOf(b, 'deuterium') };
        const over = {}; let anyOver = false;
        for (const r of RES) { over[r] = num(storage[r]) > 0 && num(stock[r]) >= num(storage[r]) * num(wctx.cfg('overflowPct'), 90) / 100; anyOver = anyOver || over[r]; }
        if (sum < num(wctx.cfg('repatriateMin')) && !anyOver) continue;
        if (ownTransportTo(env, b.coords).length || M.logi.some((x) => x.to === b.key && x.kind !== 'ferry' && x.arrival && now < x.arrival)) { repSkip(wctx, b, 'incoming', `Репатриация ${b.coords}: к телу летит транспорт`, { body: b.id }); continue; }
        if (M.logi.some((x) => x.kind === 'repatriate' && x.fromKey === b.key && (x.dry ? now - x.sentAt < 20 * 60000 : x.back && now < x.back))) continue;
        if (M.logi.some((x) => x.kind === 'ferry' && x.to === b.key && (x.dry ? now - x.sentAt < 20 * 60000 : x.arrival && now < x.arrival + 5000))) continue;   // its transporters are on the way
        // a refused pass is not re-planned (nor its fleetTable re-read) before its cooldown; a fleet landing on the body clears it
        const cd = M.meta.repSkip && M.meta.repSkip[b.key];
        if (cd && now < num(cd.until)) continue;
        // what the body gives: available minus its own plan for the next needAheadMin (botbuild 'keep') minus the deuterium reserve
        // (deutReserveH of production) — the same rule transport() checks, so the plan cannot be refused by it (0.3.1: 421 'stock' skips)
        const keep = keeps[b.key] || res0();
        const keepD = keepDOf(wctx, b);
        const avail = availOf(wctx, b);
        const { spare } = repatriateLoad({ avail, keep, keepD, over, storage });
        if (!RES.some((r) => spare[r] > 0)) {
          repSkip(wctx, b, 'stock', `Репатриация ${b.coords}: вывозить нечего — всё под свою стройку (${fmtN(keep.metal)} / ${fmtN(keep.crystal)} / ${fmtN(keep.deuterium)}) и запас дейтерия ${fmtN(keepD)}`, { body: b.id, keep, keepD, avail, overflow: anyOver }, 'stock');
          continue;
        }
        // the main's storage: below its cap it takes only what fits; at the cap it takes an overflowing colony's load (nothing more is
        // lost there and the colony's production restarts) and nothing else
        const fits = res0(); const cut = {};
        for (const r of RES) {
          if (dest.room[r] === null) { fits[r] = spare[r]; continue; }
          fits[r] = dest.full[r] ? (over[r] ? spare[r] : 0) : Math.min(spare[r], dest.room[r]);
          if (fits[r] < spare[r]) cut[r] = spare[r] - fits[r];
        }
        if (!RES.some((r) => fits[r] > 0)) {
          repSkip(wctx, b, 'destFull', `Репатриация ${b.coords}: склад ${main.coords} полон (${RES.filter((r) => cut[r]).map((r) => RU[r]).join(', ')}) — вывоз подождёт`, { body: b.id, to: main.id, cut, room: dest.room }, 'destFull');
          continue;
        }
        const fitsTotal = RES.reduce((s, r) => s + fits[r], 0);
        if (!anyOver && fitsTotal < worth) {
          repSkip(wctx, b, 'stock', `Репатриация ${b.coords}: вывозить всего ${fmtN(fitsTotal)} — меньше трюма одного Ул. трансп. (${fmtN(worth)}), подожду`, { body: b.id, total: fitsTotal, worth, keep, keepD }, 'stock');
          continue;
        }
        // a ferry landed since the last read: that read showed no transporters
        const landed = M.logi.find((x) => x.kind === 'ferry' && x.to === b.key && !x.dry && x.arrival && now >= x.arrival && !x.credited);
        if (landed) { landed.credited = true; delete M.ships[b.id]; }
        // only now the ships (page=fleetTable when the counts are older than 10 min): something is exportable
        const ships = await shipsOf(wctx, env, b, 'репатриация: транспорты на колонии');
        const have = num(ships[cargoType]);
        if (!have) {
          const f = await ferry(wctx, env, { b, main, spare: fits, cap, over: anyOver });
          if (f.dry || f.sent) return 1;
          repSkip(wctx, b, 'ships', `Репатриация ${b.coords}: нет Ул. трансп. (${f.text})`, { body: b.id, shipId: cargoType, ferry: f.skip }, f.skip === 'ships' ? 'ships' : f.skip);
          continue;
        }
        const n0 = Math.min(have, Math.max(1, Math.ceil(RES.reduce((s, r) => s + fits[r], 0) / cap)));
        const ft = flightTime(env, b, main.coords, { [cargoType]: n0 }, 10);
        // the fuel comes from the deuterium above keep + reserve, like the load (transport() refuses it otherwise)
        if (spare.deuterium < ft.fuel) { repSkip(wctx, b, 'stock', `Репатриация ${b.coords}: дейтерия сверх запаса ${fmtN(keepD)} нет даже на топливо (${fmtN(ft.fuel)})`, { body: b.id, fuel: ft.fuel, keepD }, 'stock'); continue; }
        const stockD = Object.assign({}, fits, { deuterium: Math.max(0, Math.min(fits.deuterium, spare.deuterium - ft.fuel)) });
        const load = payloadDCM(stockD, n0 * cap - ft.fuel);
        if (!RES.some((r) => load[r] > 0)) { repSkip(wctx, b, 'stock', `Репатриация ${b.coords}: после топлива (${fmtN(ft.fuel)}) вывозить нечего`, { body: b.id, fuel: ft.fuel }, 'stock'); continue; }
        const left = RES.reduce((s, r) => s + Math.max(0, stockD[r] - load[r]), 0);
        const shortN = left > 0 ? Math.ceil(left / cap) : 0;
        const cutTxt = Object.keys(cut).length ? ` (на складе ${main.coords} не поместится ${RES.filter((r) => cut[r]).map((r) => RU[r] + ' ' + fmtN(cut[r])).join(', ')})` : '';
        recOnce(wctx, 'rep:plan:' + b.key, [fmtN(load.metal), fmtN(load.crystal), fmtN(load.deuterium), shortN, Object.keys(cut).join('')].join('|'), 'repatriate',
          `Репатриация ${b.coords} → ${main.coords}: ${fmtN(load.metal)} / ${fmtN(load.crystal)} / ${fmtN(load.deuterium)}` + (RES.some((r) => keep[r] > 0) ? ` (оставляю под свою стройку ${fmtN(keep.metal)} / ${fmtN(keep.crystal)} / ${fmtN(keep.deuterium)})` : '')
          + (keepD > 0 ? ` (запас дейтерия ${fmtN(keepD)})` : '') + (shortN ? ` (на весь запас не хватает ${shortN} Ул. трансп.)` : '') + cutTxt,
          { from: b.id, to: main.id, load, keep, keepD, overflow: anyOver, sum, short: shortN, cut, fuel: ft.fuel });
        const out = await transport(wctx, env, { source: b, dest: main, load, kind: 'repatriate', why: anyOver ? 'хранилище почти заполнено' : 'запас колонии ≥ порога' });
        if (out.dry) { M.logi.push({ id: 'dry:rep:' + b.key, kind: 'repatriate', fromKey: b.key, to: main.key, dry: true, sentAt: now }); return 1; }
        if (out.sent) { out.sent.fromKey = b.key; if (M.meta.repSkip) delete M.meta.repSkip[b.key]; wctx.rec('transport-sent', `Репатриация ${b.coords} → ${main.coords} в пути`, Object.assign({ action: 'repatriate' }, out.sent)); return 1; }
        repSkip(wctx, b, out.skip, `Репатриация ${b.coords}: ${out.text}`, { body: b.id }, out.skip);
      }
    }
    return 0;
  }

  // ------------------------------------------------------------------ worker
  async function mainRun(wctx) {
    if (!OGX.bot.isActive(NAME)) return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'off' };
    await load();
    const now = wctx.now();
    M.lastRun = now;
    let stats = {};
    try { stats = (await OGX.state.shipStats()) || {}; } catch (e) { stats = {}; }
    let server = null; let factors = null;
    try { server = await OGX.state.server(); } catch (e) { server = null; }
    try { factors = OGX.state.factors ? await OGX.state.factors() : null; } catch (e) { factors = null; }
    const env = { bodies: await wctx.bodies(), stats, server, factors, flights: [] };
    M.raw = await rawStock();
    loadFlights(wctx, env);
    let next = now + OGX.bot.randMs(OGX.bot.INTERVALS.m6);
    try {
      next = Math.min(next, await battlesStep(wctx, env));
      next = Math.min(next, fightsStep(wctx, env));
      if (wctx.cfg('ownDf')) {
        let dirty = 0;
        try { dirty = num(await M.ctx.store.get('ownDirty', 0)); } catch (e) { dirty = 0; }
        if (!M.meta.nextOwnAt || now >= M.meta.nextOwnAt || dirty > num(M.meta.lastOwnAt)) {
          M.meta.lastOwnAt = now;
          const out = await ownStep(wctx, env);
          const a = num(wctx.cfg('checkMinMin'), 30); const b = Math.max(a, num(wctx.cfg('checkMaxMin'), 60));
          M.meta.nextOwnAt = out && out.nextAt ? out.nextAt : wctx.now() + OGX.bot.randMs([a * 60000, b * 60000]);
        }
        next = Math.min(next, M.meta.nextOwnAt);
      }
      if (wctx.cfg('logistics') || wctx.cfg('repatriate')) await logisticsStep(wctx, env);
      await readHarvests(wctx);
      for (const o of Object.values(M.own)) if (o.arrival && !o.harvest && (o.harvestTries || 0) < 3 && wctx.core('readMessages') !== false) next = Math.min(next, o.arrival + 5000);
    } finally { await save(); }
    const active = Object.values(M.plans).filter((P) => !TERMINAL.has(P.status)).length;
    return { nextAt: Math.max(next, wctx.now() + 1000), reason: `планов ${active}, своих сборов ${Object.keys(M.own).length}` };
  }

  // ------------------------------------------------------------------ panel section
  const STATUS_RU = { new: 'планирую', waitPre: 'ждёт пред-отправку', queued: 'точная отправка в очереди', result: 'проверка результата', waitPost: 'ждёт бой', duePost: 'отправка после боя',
    sending: 'отправка', sent: 'в пути', done: 'собрано', dry: 'пробный режим', skipped: 'пропущено', cancelled: 'отменено', failed: 'ошибка', recalled: 'отозвано', lost: 'результат потерян' };
  function renderPanel(container) {
    const h = (...a) => OGX.dom.h(...a);
    const now = OGX.time.serverNow();
    const left = (t) => (t ? (t > now ? 'через ' + Math.ceil((t - now) / 1000) + ' с' : fmtT(t)) : '—');
    const plans = Object.values(M.plans).filter((P) => !TERMINAL.has(P.status) || now - (P.updated || P.created) < H).sort((a, b) => a.battleArrival - b.battleArrival);
    container.appendChild(h('div', { class: 'ogx-b-debris-sum' }, `Планов переработки: ${plans.length}; своих сборов: ${Object.keys(M.own).length}` + (M.lastRun ? `; последний проход ${fmtT(M.lastRun)}` : '')));
    container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Переработчики к боям'));
    if (!plans.length) container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, 'Нет запланированных боёв (их создаёт «Бот: фарм»).'));
    else {
      container.appendChild(h('table', { class: 'ogx-table ogx-b-debris-plans' }, h('tbody', null,
        h('tr', null, h('th', null, 'Цель'), h('th', null, 'Режим'), h('th', null, 'Поле'), h('th', null, 'Переработчики'), h('th', null, 'Вылет'), h('th', null, 'Бой'), h('th', null, 'Статус')),
        plans.map((P) => h('tr', { dataset: { battle: P.id, status: P.status, mode: P.mode || '' } }, h('td', null, '[' + P.coords + ']'),
          h('td', null, P.mode === 'pre' ? 'пред-отправка' : P.mode === 'post' ? 'после боя' : '—'), h('td', null, fmtN(fieldSum(P.field)) + (P.residual ? ' (остаток ' + fmtN(P.residual) + ')' : '')),
          h('td', null, P.n ? P.n + ' × ' + P.shipId : '—'), h('td', null, left(P.departAt)), h('td', null, left(P.battleArrival)),
          h('td', null, (STATUS_RU[P.status] || P.status) + (P.note ? ' — ' + P.note : '')))))));
    }
    const logi = M.logi.filter((x) => !x.dry && x.arrival && now < (x.back || x.arrival) + 60000);
    container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Логистика'));
    let needs = [];
    try { needs = OGX.bot.needs.list().filter((n) => n && n.kind !== 'keep'); } catch (e) { needs = []; }
    container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, OGX.settings.get('botdebris.logistics') ? `Потребностей стройки: ${needs.length}; транспортов в пути: ${logi.length}` : 'Логистика выключена.'));
    if (logi.length) {
      container.appendChild(h('table', { class: 'ogx-table ogx-b-debris-logi' }, h('tbody', null,
        h('tr', null, h('th', null, 'Куда'), h('th', null, 'Груз'), h('th', null, 'Прибытие')),
        logi.map((x) => h('tr', null, h('td', null, x.toCoords || x.to), h('td', null, `${fmtN(x.cargo.metal)} / ${fmtN(x.cargo.crystal)} / ${fmtN(x.cargo.deuterium)}`), h('td', null, left(x.arrival)))))));
    }
  }

  // ------------------------------------------------------------------ module
  OGX.module({
    name: NAME,
    title: 'Бот: обломки и логистика',
    settings: SETTINGS,
    async init(ctx) {
      M.ctx = ctx;
      if (!OGX.bot || !OGX.botSim) { ctx.log.warn('OGX.bot / OGX.botSim missing: botdebris idle'); return; }
      await OGX.bot.ready;
      await load();
      M.handle = OGX.bot.register({ id: NAME, module: NAME, prio: 'deadline', startJitter: [20000, 50000],
        wakeOn: ['bot:battle-planned', 'bot:battle-cancelled', 'bot:threat', 'bot:fleet-returned', 'bot:needs'], run: mainRun });
      OGX.bus.on('bot:battle-cancelled', (p) => { if (p && p.id) M.cancelled[p.id] = { reason: p.reason || 'отменён', t: OGX.time.serverNow() }; });
      // a fleet landed on a body: its repatriation cooldown ('no transporters', 'stock', ...) is over, the next pass looks again
      OGX.bus.on('bot:fleet-returned', (p) => {
        if (!p || !p.bodyKey) return;
        M.stale.add(p.bodyKey);   // its ship counts changed: the next shipsOf re-reads (a colony whose transporters came home is not ferried)
        if (M.meta.repSkip && M.meta.repSkip[p.bodyKey]) delete M.meta.repSkip[p.bodyKey];
      });
      const wakeFor = (label) => (payload) => {
        const P = payload && M.plans[payload.id];
        if (P && P.timerLabel === label) delete M.timers[P.id];
        if (M.handle) M.handle.wake('timer ' + label);
      };
      OGX.bot.onTimer('botdebris:pre', wakeFor('botdebris:pre'));
      OGX.bot.onTimer('botdebris:post', wakeFor('botdebris:post'));
      OGX.bot.panelSection(NAME, renderPanel);
      // own fields: re-check soon when the user views an own system (fresh galaxy cache) or changes this module's settings
      const dirty = () => { Promise.resolve(ctx.store.set('ownDirty', OGX.time.serverNow())).catch(() => {}); if (M.handle) M.handle.wake('свои поля'); };
      try {
        OGX.galaxy.onSystem((p) => {
          const sys = p && p.system;
          if (!sys) return;
          OGX.state.bodies().then((bodies) => {
            if (!Object.values(bodies || {}).some((b) => b.coords && b.coords.startsWith(sys.galaxy + ':' + sys.system + ':'))) return;
            if (Array.isArray(sys.positions)) M.seen[sys.galaxy + ':' + sys.system] = { t: num(sys.t, OGX.time.serverNow()), positions: sys.positions };
            // only the player's own view re-checks soon; a bot scan (source 'scan', ours included) just feeds the data
            if (p.source !== 'scan') dirty();
          }).catch(() => {});
        });
      } catch (e) { /* galaxy module absent */ }
      try { OGX.settings.onChange(NAME, () => dirty()); } catch (e) { /* ignore */ }
      // keep the panel's copy fresh in non-leader tabs (the leader owns the in-memory state)
      const follower = () => { try { return !OGX.bot.status().leader; } catch (e) { return false; } };
      ctx.store.subscribe('plans', (v) => { if (follower() && v && typeof v === 'object') M.plans = v; });
      ctx.store.subscribe('own', (v) => { if (follower() && v && typeof v === 'object') M.own = v; });
      ctx.store.subscribe('logi', (v) => { if (follower() && Array.isArray(v)) M.logi = v; });
    },
  });

  // Pure helpers for tests (tests/gz-bot-mod-botdebris.test.js); not an API for other modules.
  OGX.botDebris = { version: '1.0.0', _ownStep: ownStep, _sourcesFor: sourcesFor, _logisticsStep: logisticsStep, _fightsStep: fightsStep, _rawStock: rawStock, _availOf: availOf, _lib: { recyclersFor, ballastFor, simRecyclers, aimSec, chooseSpeed, preTolMs, pickBattleOrigin, pickOwnOrigin, transportShips, payloadDCM, repatriateLoad, destRoom, harvestFromText, battleField, coordsOf, moonPctOf, preWorthIt, preMinOk, needLoad, REC, TRANSPORT }, _M: M, SETTINGS };
})(window.OGX);
