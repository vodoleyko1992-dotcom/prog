/* ogamex-bot/modules/botsave/botsave.js — «Бот: сейв флота и защита» (module agent 1).
 * Contract: specs/bot/BOT_CONTRACT.md C1, C2, C5 (botsave keys), C6 (botsave events), C8; design: specs/bot/BOT_DESIGN.md §5.
 * Ideas (not code) from bot-spec/BOT_TBOT_IDEAS.md §2 and §4 with their «Поправки проверки» applied.
 *
 * One worker 'botsave' (prio defense, allowDuringSleep, wakeOn bot:threat + bot:fleet-returned):
 *   - every Threat (OGX.bot.threats(), deduped by Threat.key, re-evaluated when arrival/units/body change) is classified in order:
 *     whitelist -> missiles (ABM order on the hit planet) -> espionage only -> weak attack (only with weakIgnore) -> nothing to
 *     lose -> SAVE; one alarm per threat with the decision;
 *   - the save of a body starts in [first arrival - saveLeadMaxSec, first arrival - saveLeadMinSec]; the destination cascade follows
 *     missionOrder (deploy: own moons first, then planets; transport: own body; harvest: non-empty debris within ±5 systems;
 *     expedition g:s:16 last, with a warning); per target the first speed 10..1 whose one-way time reaches the threshold and whose
 *     fuel fits; hypotheses sorted by fuel; exact payload (D > C > M, step 3 refuses overflow);
 *   - ships and cargo (John's rules): a save moves ALL ships of the body; the resources taken along go ONLY into the Battle
 *     Transporters 217 of that fleet: payload() caps them at count(217) x 217 cargo (and at fleetroom - fuel). 202/203 or combat
 *     holds carry only the fuel; no 217 on the body -> the ships flee without resources (journaled «нет Ул. трансп.»). A save never
 *     adds a separate transport. The harvest destination is offered only when the
 *     fleet holds Battle Recyclers 219 (debris goes only to 219; 209 alone does not make a harvest save);
 *   - the recall is a persisted OGX.bot.at timer (label 'botsave:recall') at start + oneWay/2 + recallJitter, moved so the fleet
 *     lands home after the last threat on that body + 30 s, strictly before the destination arrival - 5 s;
 *   - fleets landing on the threatened body before the hit (return legs, Deploys): the save waits for the last landing that still
 *     leaves time and takes those ships too; a body with nothing at home is planned again at the next landing (never a final
 *     «нечего спасать» while a landing is due); a fleet landing after a save left gets a save of its own (#2); a send refused for
 *     slots is retried every ~10 s until arrival - 10 s; every attack on an own body is registered in OGX.bot.battles (side
 *     'defender', BOT_DESIGN §5.1.8) so botdebris looks at the own field right after the fight.
 *   - spyAttacker (off) and sleepSave (off) as BOT_DESIGN §5.1.9 / §5.2.
 * Every game request goes through wctx.act (the runtime executor); a wctx.decide precedes every action.
 * Off by default (botsave.on false); in dry-run every send comes back dry and no recall is scheduled. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const NAME = 'botsave';
  const SEC = 'Бот: сейв и защита';
  const SETTINGS = {
    on: { type: 'bool', default: true, label: 'Сейв флота и защита включены', section: SEC },
    defense: { type: 'bool', default: true, label: 'Реагировать на враждебные флоты (сейв при атаке)', section: SEC },
    ignoreProbes: { type: 'bool', default: true, label: 'Не реагировать на шпионаж (только зонды)', section: SEC },
    weakIgnore: { type: 'bool', default: false, label: 'Не сейвить при слабой атаке', section: SEC },
    weakRatio: { type: 'float', default: 3, min: 1, max: 100, step: 0.5, label: 'Слабая атака: наши очки (флот + оборона) больше в N раз', section: SEC },
    whitelist: { type: 'json', default: [], label: 'Белый список игроков (имена или id), их флоты не трогаем', section: SEC },
    minFleetPoints: { type: 'int', default: 0, min: 0, label: 'Нечего терять: флот и ресурсы меньше (очков, 0 = выкл.)', section: SEC },
    saveLeadMinSec: { type: 'int', default: 30, min: 10, max: 3600, label: 'Сейв не позже чем за (с) до удара', section: SEC },
    saveLeadMaxSec: { type: 'int', default: 90, min: 10, max: 7200, label: 'Сейв не раньше чем за (с) до удара', section: SEC },
    marginPct: { type: 'int', default: 30, min: 0, max: 500, label: 'Запас времени полёта (%)', section: SEC },
    deutToLeave: { type: 'int', default: 0, min: 0, label: 'Оставлять дейтерия на планете при сейве', section: SEC },
    missionOrder: { type: 'json', default: ['deploy', 'transport', 'harvest', 'expedition'], label: 'Порядок миссий сейва (JSON-список: deploy — передислокация, transport — транспорт, harvest — сбор обломков, expedition — экспедиция)', section: SEC },
    moonsFirst: { type: 'bool', default: true, label: 'Сначала свои луны', section: SEC },
    recall: { type: 'bool', default: true, label: 'Отзывать флот после удара', section: SEC },
    recallJitterMinSec: { type: 'int', default: 40, min: 0, max: 3600, label: 'Отзыв: случайная добавка, мин. (с)', section: SEC },
    recallJitterMaxSec: { type: 'int', default: 140, min: 0, max: 3600, label: 'Отзыв: случайная добавка, макс. (с)', section: SEC },
    abm: { type: 'bool', default: true, label: 'Строить ракеты-перехватчики против МПР', section: SEC },
    spyAttacker: { type: 'bool', default: true, label: 'Шпионить атакующего (зонды на его планету)', section: SEC },
    sleepSave: { type: 'bool', default: true, label: 'Сейв при засыпании бота (режим сна)', section: SEC },
    sleepSaveOnlyMoons: { type: 'bool', default: true, label: 'Ночной сейв только с лун', section: SEC },
    sleepDeutToLeave: { type: 'int', default: 0, min: 0, label: 'Ночной сейв: оставлять дейтерия', section: SEC },
    resSave: { type: 'bool', default: true, label: 'Забирать ресурсы при сейве', section: SEC },
  };

  // ------------------------------------------------------------------ constants
  const RES = ['metal', 'crystal', 'deuterium'];
  const TRANSPORT = 217;            // «Улучшенный транспорт»: the only carrier of the resources taken on a save
  const MISSION_ID = { deploy: 4, transport: 3, harvest: 8, expedition: 15 };
  const MISSION_RU = { 1: 'атака', 2: 'САБ', 3: 'транспорт', 4: 'оставить', 6: 'шпионаж', 8: 'переработка', 9: 'уничтожение', 10: 'ракетная атака', 15: 'экспедиция' };
  const PREP_MS = 30000;            // planning reads start this long before the save start
  const SEND_LEAD_MS = 6000;        // fleetTable + steps 1-3 take a few seconds: the send is queued this long before the start
  const RECALL_SAFE_MS = 5000;      // recall strictly before the destination arrival - 5 s
  const HOME_AFTER_MS = 30000;      // fleet lands home after the last threat + 30 s
  const DEADLINE_MS = 10000;        // a save not started by arrival - 10 s is useless
  const PLAN_MS = 8000;             // readSource (fleetTable + probe) before the send is queued
  const LAND_MARGIN_MS = 2000;      // a landed fleet is on the page this long after its arrival second
  const SLOT_RETRY = [8000, 12000]; // a send refused for slots is tried again after this long
  const LAST_TRY_MS = 4000;         // ... and one last time this long before the executor's deadline
  const MAX_REPLANS = 6;            // «нечего спасать» -> wait for a landing, at most this many times per save
  const FIGHT_MISSIONS = [1, 2, 9];
  const POLL = [240000, 360000];    // look at the event box when no page was seen for this long (no request when pages flow)
  const SILO_FACTOR = 1;            // 2Moons config silo_factor default [UPSTREAM]; GALAXYZ value unknown -> max(silo_factor, 1)
  const EXPO_POS = 16;              // max_planets + 1 (Aeternum: 15 positions)
  const KEEP_MS = 86400000;         // keep finished records one day (panel / journal context)

  const now = () => { try { return OGX.time.serverNow(); } catch (e) { return Date.now(); } };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  const fmtT = (ms) => { try { return OGX.fmt.time(ms); } catch (e) { return new Date(ms).toISOString().slice(11, 19); } };
  const fmtDur = (s) => { try { return OGX.fmt.duration(s); } catch (e) { return Math.round(s) + ' с'; } };
  const coordsStr = (t) => (t ? [t.galaxy, t.system, t.position].join(':') + (+t.type === 3 ? ' Л' : +t.type === 2 ? ' ПО' : '') : '?');
  const isMoon = (b) => !!b && (b.type === 'moon' || /^m/.test(b.key || ''));
  const coordsObj = (c, type = 1) => { const a = String(c || '').split(':').map(Number); return a.length === 3 && a.every((x) => x > 0) ? { galaxy: a[0], system: a[1], position: a[2], type } : null; };
  const randInt = (a, b) => { try { return OGX.bot.rand(Math.round(a), Math.round(b)); } catch (e) { return Math.round(a + Math.random() * (b - a)); } };

  // ------------------------------------------------------------------ pure helpers (exported as OGX.botSave for tests)
  /** Points of a unit set by the catalog: Σ(M+C+D)/1000 (2Moons statistics weights). */
  function pointsOf(units, catalog) {
    let p = 0;
    for (const [id, n] of Object.entries(units || {})) {
      const c = catalog ? catalog(+id) : null;
      const pr = c && c.price ? c.price : null;
      if (!pr) continue;
      p += ((+pr.metal || 0) + (+pr.crystal || 0) + (+pr.deuterium || 0)) * (+n || 0) / 1000;
    }
    return p;
  }
  /** Exact payload for a save: room = min(fleetroom - fuel, transportRoom = count(217) x 217 cargo); deuterium first, then
   *  crystal, then metal (step 3 refuses overflow). Resources ride only in 217 (John's rule): no 217 -> transportRoom 0. */
  function payload({ stock, fuel, fleetroom, deutKeep = 0, resSave = true, transportRoom = Infinity }) {
    const out = { metal: 0, crystal: 0, deuterium: 0 };
    if (!resSave) return out;
    let room = Math.max(0, Math.floor(Math.min(num(fleetroom) - num(fuel), transportRoom === Infinity ? Infinity : num(transportRoom))));
    const dAvail = Math.max(0, Math.floor(num(stock && stock.deuterium) - num(fuel) - num(deutKeep)));
    out.deuterium = Math.min(dAvail, room); room -= out.deuterium;
    out.crystal = Math.min(Math.max(0, Math.floor(num(stock && stock.crystal))), room); room -= out.crystal;
    out.metal = Math.min(Math.max(0, Math.floor(num(stock && stock.metal))), room);
    return out;
  }
  const deutKeepOf = (k, keep) => (k === 'deuterium' ? num(keep) : 0);
  /** Free silo room for interceptors: silo·10·max(siloFactor,1) - 502 - 2·503 - queued (502 counts 1, 503 counts 2). */
  function siloFree({ silo, abm = 0, ipm = 0, queuedAbm = 0, queuedIpm = 0, siloFactor = SILO_FACTOR }) {
    return Math.max(0, num(silo) * 10 * Math.max(num(siloFactor, 1), 1) - num(abm) - 2 * num(ipm) - num(queuedAbm) - 2 * num(queuedIpm));
  }
  /** Interceptors to order: min(free silo, missiles needed, affordable, finishing before the impact). */
  function abmCount({ free, needed, stock, perUnitSec, queueSec = 0, secondsLeft, price = { metal: 8000, crystal: 0, deuterium: 2000 } }) {
    const aff = Math.min(...RES.map((r) => (num(price[r]) > 0 ? Math.floor(num(stock && stock[r]) / num(price[r])) : Infinity)));
    let fit = Infinity;
    if (Number.isFinite(+perUnitSec) && +perUnitSec > 0 && Number.isFinite(+secondsLeft)) fit = Math.floor((secondsLeft - num(queueSec)) / +perUnitSec);
    return Math.max(0, Math.min(num(free), num(needed), aff, fit));
  }
  /** Thresholds: minFlight = (horizon - start)·(1 + margin) + extra; Deploy one-way >= minFlight, circular one-way >= minFlight/2. */
  function minOneWay(mission, minFlightSec) { return mission === 4 ? minFlightSec : minFlightSec / 2; }
  /** Hypotheses for one save. flight(target, speed) -> { duration (s), fuel }. Candidates carry their group rank (mission order,
   * moons first). Per target: the first speed 10..1 reaching the threshold with fuel <= deutLimit and <= fleetroom; Deploy also gets a
   * «landing» fallback (no speed reaches the threshold: the fleet lands on the safe body, no recall). Sorted: group (landings after
   * every hypothesis that reaches the threshold, before the expedition), fuel ascending, shorter duration. */
  function hypotheses({ candidates, flight, minFlightSec, deutLimit, fleetroom }) {
    const out = [];
    for (const c of candidates) {
      const need = minOneWay(c.mission, minFlightSec);
      let pick = null; let landing = null;
      for (let sp = 10; sp >= 1; sp--) {
        const f = flight(c.target, sp);
        if (!f || !Number.isFinite(f.duration)) continue;
        if (f.fuel > deutLimit || f.fuel > fleetroom) continue;
        if (f.duration >= need) { pick = { speed: sp, duration: f.duration, fuel: f.fuel }; break; }
        if (c.mission === 4 && (!landing || f.duration > landing.duration)) landing = { speed: sp, duration: f.duration, fuel: f.fuel };
      }
      if (pick) out.push(Object.assign({}, c, pick, { landing: false, need }));
      else if (landing) out.push(Object.assign({}, c, landing, { landing: true, need }));
    }
    // a landing (no speed reaches the threshold) comes after every hypothesis that reaches it, but before the risky expedition
    const expo = Math.min(...candidates.filter((c) => c.risky).map((c) => c.group), Infinity);
    for (const h of out) h.rank = !h.landing ? h.group : Number.isFinite(expo) ? expo - 0.5 + h.group / 1000 : 1000 + h.group;
    out.sort((a, b) => (a.rank - b.rank) || (a.fuel - b.fuel) || (a.duration - b.duration));
    return out;
  }
  /** Recall moment: start + oneWay/2 + jitter, at least so that home (= 2R - start) >= horizon; null when it would be too late. */
  function recallAt({ start, destArrival, jitterMs, horizon }) {
    const oneWay = destArrival - start;
    const want = start + oneWay / 2 + num(jitterMs);
    // + 2 s: the server counts the start and the recall in whole seconds (home = 2·R - start can lose up to ~2 s)
    const need = Number.isFinite(+horizon) ? (+horizon + start) / 2 + 2000 : -Infinity;
    const at = Math.round(Math.max(want, need));
    if (at >= destArrival - RECALL_SAFE_MS) return { at: null, want, need, reason: 'late' };
    return { at, want, need, reason: null };
  }
  /** The next own fleet landing on `bodyKey` (a return leg or a Deploy arrival) after `now` and before `before` (ServerMs), or null. */
  function nextLanding(flights, bodyKey, now, before) {
    let best = null;
    for (const f of Array.isArray(flights) ? flights : []) {
      if (!f || !f.own || f.destKey !== bodyKey || !(+f.arrival > now) || !(+f.arrival < before)) continue;
      if (!(f.returnFlight || +f.missionType === 4)) continue;
      if (best === null || +f.arrival < best) best = +f.arrival;
    }
    return best;
  }
  /** The latest moment planning may start so the send still leaves before the deadline: reads + queueing + the landing margin. */
  const latestPlanAt = (firstArrival) => firstArrival - DEADLINE_MS - SEND_LEAD_MS - PLAN_MS - LAND_MARGIN_MS;
  /** The fight an attack on an own body produces (BOT_DESIGN §5.1.8), for OGX.bot.battles: side 'defender' (nothing to send before
   *  the hit; botdebris reads the own field right after it). Probes and missiles make no field -> null. */
  function battleOf(th, decision) {
    if (!th || !th.key || !th.bodyKey || th.probesOnly || !FIGHT_MISSIONS.includes(+th.mission) || !(+th.arrival > 0)) return null;
    const target = coordsObj(th.to, +th.toType === 3 ? 3 : 1);
    if (!target) return null;
    return { id: 'save:' + th.key, owner: NAME, side: 'defender', target, arrival: +th.arrival, fleetId: null, status: 'planned', decision: decision || null,
      threat: th.key, bodyKey: th.bodyKey, debris: null, existingDebris: null };
  }
  /** Classification of one threat (filters in BOT_DESIGN §5.1 order). ctx: { cfg(k), ourPoints: { fleet, defense, res }|null, catalog } */
  function classify(th, ctx) {
    const cfg = ctx.cfg;
    if (!th.bodyKey) return { decision: 'ignore', filter: 'unknown', why: 'цель не наше тело' };
    const wl = Array.isArray(cfg('whitelist')) ? cfg('whitelist') : [];
    const name = String(th.ownerName || '').trim().toLowerCase();
    for (const w of wl) {
      const s = String(w).trim().toLowerCase();
      if (!s) continue;
      if (th.ownerId != null && /^\d+$/.test(s) && +s === +th.ownerId) return { decision: 'ignore', filter: 'whitelist', why: 'игрок в белом списке (id ' + th.ownerId + ')' };
      // full names (botcore reads 'Jon Snow' whole); a one-word name from an older stored threat matches the entry's first word
      if (name && (s === name || (!/\s/.test(name) && s.split(/\s+/)[0] === name))) return { decision: 'ignore', filter: 'whitelist', why: 'игрок в белом списке (' + th.ownerName + ')' };
    }
    if (+th.mission === 10) {
      return cfg('abm') !== false ? { decision: 'abm', filter: 'missile', why: 'ракетная атака: перехватчики' } : { decision: 'notify', filter: 'missile', why: 'ракетная атака (перехватчики выключены)' };
    }
    if ((th.probesOnly || +th.mission === 6) && cfg('ignoreProbes') !== false) return { decision: 'ignore', filter: 'probes', why: 'только шпионаж' };
    if (cfg('defense') === false) return { decision: 'notify', filter: 'off', why: 'реакция на атаки выключена' };
    if (cfg('weakIgnore') === true) {
      const known = th.ships && Object.keys(th.ships).length && (th.units == null || Object.values(th.ships).reduce((s, n) => s + n, 0) >= th.units);
      if (known && ctx.ourPoints) {
        const att = pointsOf(th.ships, ctx.catalog);
        const ours = ctx.ourPoints.fleet + ctx.ourPoints.defense;
        const ratio = Math.max(1, num(cfg('weakRatio'), 3));
        if (att < ours / ratio) return { decision: 'ignore', filter: 'weak', why: 'слабая атака: ' + Math.round(att) + ' очк. против ' + Math.round(ours) + ' / ' + ratio, att, ours };
      }
    }
    const minPts = num(cfg('minFleetPoints'));
    if (minPts > 0 && ctx.ourPoints && ctx.ourPoints.fleet < minPts && ctx.ourPoints.res < minPts) {
      return { decision: 'ignore', filter: 'nothing', why: 'нечего терять: флот ' + Math.round(ctx.ourPoints.fleet) + ' и ресурсы ' + Math.round(ctx.ourPoints.res) + ' очк. < ' + minPts };
    }
    return { decision: 'save', filter: 'save', why: 'атака: сейв флота и ресурсов' };
  }
  OGX.botSave = { version: '1.0.0', pointsOf, payload, siloFree, abmCount, minOneWay, hypotheses, recallAt, classify, spyProbesSetting, nextLanding, battleOf, latestPlanAt, spySource: (...a) => spySource(...a),
    nearbyFields: (...a) => nearbyFields(...a), candidates: (...a) => candidates(...a) };

  // ------------------------------------------------------------------ module
  let view = { threats: {}, saves: {}, t: 0 };   // mirror of botsave.state for the panel (every tab)
  let handle = null;
  const landed = {};   // body key -> ServerMs of the last own fleet landing seen on the bus (bot:fleet-returned)

  OGX.module({
    name: NAME,
    title: 'Бот: сейв флота и защита',
    pages: '*',
    settings: SETTINGS,
    async init(ctx) {
      if (!OGX.bot || !OGX.bot.ready) return;
      await OGX.bot.ready;
      try { view = (await ctx.store.get('state', null)) || view; } catch (e) { /* empty */ }
      try { ctx.store.subscribe('state', (v) => { if (v) { view = v; repaint(); } }); } catch (e) { /* no subscribe */ }
      OGX.bot.panelSection(NAME, renderPanel);
      // a fleet landed on a body: a save that found nothing at home (or already left) is planned again for it
      OGX.bus.on('bot:fleet-returned', (p) => { if (p && p.bodyKey) landed[p.bodyKey] = Math.max(num(landed[p.bodyKey]), num(p.at) || now()); });
      OGX.bot.onTimer('botsave:recall', (p) => { if (handle) handle.wake('recall', now()); return p; });
      handle = OGX.bot.register({
        id: NAME, module: NAME, prio: 'defense', allowDuringSleep: true, startJitter: [5000, 15000],
        wakeOn: ['bot:threat', 'bot:fleet-returned'],
        run: (w) => run(w),
      });
    },
  });

  let repaintTimer = null;
  function repaint() {
    if (repaintTimer) return;
    repaintTimer = setTimeout(() => { repaintTimer = null; try { OGX.bot.panelSection(NAME, renderPanel); } catch (e) { /* ignore */ } }, 300);
  }

  // ------------------------------------------------------------------ state
  async function load(w) {
    const st = (await w.store.get('state', null)) || {};
    st.threats = st.threats || {}; st.saves = st.saves || {}; st.sleep = st.sleep || {}; st.abmSecs = st.abmSecs || {};
    return st;
  }
  async function save(w, st) {
    st.t = now();
    const t = st.t;
    for (const [k, r] of Object.entries(st.threats)) if (r.arrival < t - KEEP_MS) delete st.threats[k];
    for (const [k, s] of Object.entries(st.saves)) if (['done', 'failed', 'skipped', 'cancelled', 'dry'].includes(s.state) && (s.lastArrival || s.created || 0) < t - KEEP_MS) delete st.saves[k];
    await w.store.set('state', st);
    view = clone(st);
    repaint();
  }

  // ------------------------------------------------------------------ worker
  async function run(w) {
    const t = w.now();
    const st = await load(w);
    let next = t + OGX.bot.randMs(POLL);
    const bodies = await w.bodies();
    const threats = w.threats();
    const live = new Set();
    // a run that died mid-way (reload, leader change): planning starts again, an interrupted recall is retried before the arrival
    for (const sv of Object.values(st.saves)) {
      if (sv.state === 'planning') { sv.state = 'waiting'; w.rec('skip', 'Сейв ' + sv.bodyKey + ' прерван: планирую заново', { reason: 'interrupted', bodyKey: sv.bodyKey }); }
      if (sv.state === 'sent' && sv.recall && sv.recall.state === 'running') sv.recall.state = t < sv.destArrival - RECALL_SAFE_MS ? 'armed' : 'late';
    }

    // 1. classify (dedupe by key; re-evaluate on change)
    for (const th of threats) {
      live.add(th.key);
      if (th.arrival <= t) continue;
      const sig = [th.arrival, th.units, th.bodyKey, JSON.stringify(th.ships || null), th.ownerId].join('|');
      let rec = st.threats[th.key];
      if (rec && rec.sig === sig) continue;
      const changed = !!rec;
      let ourPoints = null;
      if (th.bodyKey && (w.cfg('weakIgnore') === true || num(w.cfg('minFleetPoints')) > 0) && +th.mission !== 10 && !th.probesOnly) ourPoints = await readOurPoints(w, bodies[th.bodyKey]);
      const c = classify(th, { cfg: w.cfg, ourPoints, catalog: (id) => OGX.catalog.get(id) });
      rec = Object.assign(rec || { firstSeen: t, notified: false }, {
        key: th.key, sig, bodyKey: th.bodyKey, to: th.to, toType: th.toType, from: th.from, mission: th.mission, arrival: th.arrival,
        ownerId: th.ownerId, ownerName: th.ownerName, units: th.units, ships: th.ships, probesOnly: th.probesOnly,
        decision: c.decision, filter: c.filter, why: c.why, updated: t,
      });
      st.threats[th.key] = rec;
      // the fight itself (attack on an own body, whatever we do about it) goes to the battle registry for botdebris (§5.1.8)
      const fight = battleOf(th, c.decision);
      if (fight && OGX.bot.battles && (rec.battleAt !== th.arrival || rec.battleDecision !== c.decision)) {
        try { OGX.bot.battles.put(fight); rec.battleAt = th.arrival; rec.battleDecision = c.decision; rec.battleGone = false; } catch (e) { /* registry missing */ }
      }
      const info = { threat: th.key, to: th.to, bodyKey: th.bodyKey, mission: th.mission, arrival: th.arrival, from: th.from, owner: th.ownerName, ownerId: th.ownerId, ships: th.ships, units: th.units, decision: c.decision, filter: c.filter, why: c.why, changed };
      if (c.decision === 'ignore') w.rec('threat-ignored', 'Угроза на ' + (th.to || '?') + ' без реакции: ' + c.why, info);
      else w.rec('threat-seen', (changed ? 'Угроза изменилась: ' : 'Угроза: ') + (MISSION_RU[th.mission] || th.mission) + ' на ' + (th.to || '?') + ' в ' + fmtT(th.arrival) + ' — ' + c.why, info);
      if (!rec.notified) {
        rec.notified = true;
        const left = Math.max(0, Math.round((th.arrival - t) / 1000));
        const dec = { save: 'сейв', abm: 'перехватчики', ignore: 'без реакции (' + c.why + ')', notify: 'только оповещение' }[c.decision];
        const text = (+th.mission === 10 ? 'Ракетная атака' : +th.mission === 6 ? 'Шпионаж' : 'Атака') + ' на [' + (th.to || '?') + '] через ' + fmtDur(left) + ' от ' + (th.ownerName || 'неизвестного') + ': решение — ' + dec;
        try { OGX.bot.notify(text, { level: c.decision === 'ignore' ? 'info' : 'alarm', sound: c.decision !== 'ignore' }); } catch (e) { /* ignore */ }
      }
    }
    // registered fights whose threat vanished before the hit (recalled attack) are withdrawn; past ones are dropped after 10 min
    for (const rec of Object.values(st.threats)) {
      if (!rec.battleAt || rec.battleGone) continue;
      const vanished = !live.has(rec.key) && rec.arrival > t + 5000;
      const over = rec.arrival < t - 10 * 60000;
      if (!vanished && !over) continue;
      rec.battleGone = true;
      try { OGX.bot.battles.remove('save:' + rec.key, vanished ? 'угроза исчезла' : 'done'); } catch (e) { /* ignore */ }
    }
    await save(w, st);

    // 2. missiles -> interceptors
    for (const rec of Object.values(st.threats)) {
      if (rec.decision !== 'abm' || rec.abmDone || rec.arrival <= t || !live.has(rec.key)) continue;
      rec.abmDone = true;
      await save(w, st);
      try { await handleAbm(w, rec, bodies, st); } catch (e) { w.rec('abm-ordered', 'Перехватчики не заказаны: ' + (e && e.message), { threat: rec.key, error: String(e && e.message) }); }
      await save(w, st);
    }

    // 3. spy the attacker (off by default)
    if (w.cfg('spyAttacker') === true) {
      for (const rec of Object.values(st.threats)) {
        if (rec.decision !== 'save' || rec.spied || rec.arrival <= t || !live.has(rec.key) || !rec.from) continue;
        rec.spied = true;
        await save(w, st);
        await spyAttacker(w, rec, bodies, st);
        await save(w, st);
      }
    }

    // 4. saves per body (the first arrival sets the start, the last one the recall)
    const groups = {};
    for (const rec of Object.values(st.threats)) {
      if (rec.decision !== 'save' || !live.has(rec.key) || rec.arrival <= t || !rec.bodyKey) continue;
      (groups[rec.bodyKey] = groups[rec.bodyKey] || []).push(rec);
    }
    for (const [bodyKey, recs] of Object.entries(groups)) {
      recs.sort((a, b) => a.arrival - b.arrival);
      const first = recs[0].arrival; const last = recs[recs.length - 1].arrival;
      let sv = st.saves[bodyKey];
      if (sv && ['done', 'failed', 'skipped', 'cancelled', 'dry'].includes(sv.state) && (sv.lastArrival || 0) < first - 1000 && sv.firstArrival !== first) sv = null;
      if (!sv) {
        const lmin = Math.max(10, num(w.cfg('saveLeadMinSec'), 30)); const lmax = Math.max(lmin, num(w.cfg('saveLeadMaxSec'), 90));
        sv = st.saves[bodyKey] = { bodyKey, kind: 'threat', state: 'waiting', created: t, firstArrival: first, lastArrival: last, threatKeys: recs.map((r) => r.key),
          startAt: first - randInt(lmin, lmax) * 1000 };
        w.rec('save-planned', 'Сейв ' + bodyLabel(bodies[bodyKey], bodyKey) + ' запланирован на ' + fmtT(sv.startAt) + ' (удар в ' + fmtT(first) + ')', { bodyKey, startAt: sv.startAt, firstArrival: first, lastArrival: last, threats: sv.threatKeys });
        await save(w, st);
      }
      sv.threatKeys = [...new Set((sv.threatKeys || []).concat(recs.map((r) => r.key)))];
      // «нечего спасать» was final only while no fleet landed: a landing since then re-plans the save while there is time
      if (sv.state === 'skipped' && sv.noShips && num(landed[bodyKey]) > num(sv.skippedAt) && t < latestPlanAt(first) && num(sv.replans) <= MAX_REPLANS) {
        sv.state = 'waiting'; sv.notBefore = t; sv.waitFor = null;
        w.rec('save-planned', 'Сейв ' + bodyLabel(bodies[bodyKey], bodyKey) + ': флот сел — планирую заново (удар в ' + fmtT(first) + ')', { bodyKey, firstArrival: first, startAt: sv.startAt, replan: true, landedAt: landed[bodyKey] });
      }
      if (sv.state === 'waiting') {
        sv.firstArrival = first; sv.lastArrival = last;
        if (sv.startAt > first - DEADLINE_MS - 5000) sv.startAt = Math.max(t, first - DEADLINE_MS - 5000);
        // a fleet landing on the body while a save after it still makes the deadline: the save waits for it (the landed ships go too;
        // a body with nothing at home now is saved then). Planning starts right after the landing, the send keeps its lead window.
        const landing = nextLanding(w.flights(), bodyKey, t, latestPlanAt(first));
        if (landing && landing !== sv.waitFor) {
          sv.waitFor = landing; sv.notBefore = Math.max(num(sv.notBefore), landing + LAND_MARGIN_MS);
          w.rec('save-planned', 'Сейв ' + bodyLabel(bodies[bodyKey], bodyKey) + ': жду посадку флота в ' + fmtT(landing) + ' — успеваем спасти и его (удар в ' + fmtT(first) + ')', { bodyKey, waitFor: landing, firstArrival: first, startAt: sv.startAt, notBefore: sv.notBefore });
        }
        const due = Math.max(sv.startAt - PREP_MS, num(sv.notBefore));
        if (t >= due) {
          await doSave(w, st, sv, bodies);
        } else next = Math.min(next, due);
      } else if (sv.state === 'sent') {
        if (last > (sv.lastArrival || 0)) {
          sv.lastArrival = last;
          sv.horizon = last + HOME_AFTER_MS;
          planRecall(w, st, sv, 'новая волна на ' + bodyLabel(bodies[bodyKey], bodyKey));
        }
        // a fleet landing on the body after the save left (or due before the deadline): a save of its own
        const latest = latestPlanAt(first);
        const due = nextLanding(w.flights(), bodyKey, t, latest);
        const at = due || (num(landed[bodyKey]) > num(sv.sentAt) && t < latest ? num(landed[bodyKey]) : null);
        if (at && at > num(sv.sentAt)) {
          const key = bodyKey + '#' + Math.floor(at / 1000);
          if (!st.saves[key]) {
            const lmin = Math.max(10, num(w.cfg('saveLeadMinSec'), 30)); const lmax = Math.max(lmin, num(w.cfg('saveLeadMaxSec'), 90));
            st.saves[key] = { key, bodyKey, kind: 'threat', extra: true, state: 'waiting', created: t, firstArrival: first, lastArrival: last, threatKeys: sv.threatKeys.slice(),
              startAt: Math.max(first - randInt(lmin, lmax) * 1000, at + LAND_MARGIN_MS + SEND_LEAD_MS), notBefore: at + LAND_MARGIN_MS, waitFor: at };
            w.rec('save-planned', 'Сейв ' + bodyLabel(bodies[bodyKey], bodyKey) + ': ещё один флот ' + (due ? 'сядет в ' + fmtT(at) : 'сел после отправки сейва') + ' — дополнительный сейв (удар в ' + fmtT(first) + ')',
              { bodyKey, key, extra: true, waitFor: at, firstArrival: first, startAt: st.saves[key].startAt });
          }
        }
      }
      await save(w, st);
    }
    // extra saves (a fleet that landed after the body's save left)
    for (const sv of Object.values(st.saves)) {
      if (!sv.extra || sv.state !== 'waiting') continue;
      if (!groups[sv.bodyKey]) { sv.state = 'cancelled'; w.rec('skip', 'Дополнительный сейв ' + sv.bodyKey + ' отменён: угроза исчезла', { reason: 'threatGone', bodyKey: sv.bodyKey, key: sv.key }); continue; }
      const first = groups[sv.bodyKey][0].arrival;
      if (sv.startAt > first - DEADLINE_MS - 5000) sv.startAt = Math.max(t, first - DEADLINE_MS - 5000);
      const due = Math.max(sv.startAt - PREP_MS, num(sv.notBefore));
      if (t >= due) await doSave(w, st, sv, bodies); else next = Math.min(next, due);
      await save(w, st);
    }
    // waiting saves whose threats vanished
    for (const sv of Object.values(st.saves)) {
      if (sv.state === 'waiting' && sv.kind === 'threat' && !groups[sv.bodyKey]) {
        sv.state = 'cancelled';
        w.rec('skip', 'Сейв ' + sv.bodyKey + ' отменён: угроза исчезла', { reason: 'threatGone', bodyKey: sv.bodyKey });
      }
    }

    // 5. recalls due (timer wake or missed timer)
    for (const sv of Object.values(st.saves)) {
      const rc = sv.recall;
      if (sv.state !== 'sent' || !rc || rc.state !== 'armed') continue;
      if (rc.at <= w.now() + 500) await doRecall(w, st, sv);
      else next = Math.min(next, rc.at);
    }

    // 6. sleep save (off by default)
    if (w.cfg('sleepSave') === true) await sleepSave(w, st, bodies);

    await save(w, st);

    // 7. passive watch: a free page read when no page has refreshed the event box for a while
    try {
      const c = await OGX.flights.cached();
      const age = c && c.t ? w.now() - c.t : Infinity;
      const pollMs = OGX.bot.randMs(POLL);
      if (age > pollMs) {
        const cur = OGX.state.current();
        // not awaited: a read held back by user-first must never block this defense worker; one poll at a time (dedupeKey)
        act(w, { type: 'read.page', prio: 'read', bodyId: cur && cur.id ? +cur.id : undefined, params: { page: 'overview' }, why: 'Проверка событий (атаки)', dedupeKey: 'botsave:poll', deadline: w.now() + 300000 },
          { what: 'Проверить список событий', why: 'страница с событиями не обновлялась ' + (Number.isFinite(age) ? Math.round(age / 1000) + ' с' : 'ни разу'), inputs: { ageMs: Number.isFinite(age) ? age : null }, chosen: 'read.page overview', alternatives: ['ждать страниц пользователя'] })
          .catch(() => {});
      }
    } catch (e) { /* ignore */ }
    for (const sv of Object.values(st.saves)) if (sv.state === 'waiting') next = Math.min(next, Math.max(w.now() + 1000, sv.startAt - PREP_MS, num(sv.notBefore)));
    return { nextAt: Math.max(w.now() + 1000, next), reason: Object.keys(groups).length ? 'угрозы: ' + Object.keys(groups).length : 'наблюдение' };
  }

  /** decide + act */
  async function act(w, spec, d) {
    w.decide(d.what, { why: d.why, inputs: d.inputs || null, chosen: d.chosen || spec.type, alternatives: d.alternatives || [] });
    return w.act(Object.assign({ module: NAME }, spec));
  }
  function bodyLabel(b, key) { return b ? '[' + b.coords + (isMoon(b) ? ' Л' : '') + ']' : key; }

  // ------------------------------------------------------------------ our points (weak attack / nothing to lose)
  async function readOurPoints(w, body) {
    if (!body) return null;
    const cat = (id) => OGX.catalog.get(id);
    let ships = body.ships || null; let defense = body.defense || null; let res = null;
    const r = await act(w, { type: 'read.fleetTable', prio: 'defense', bodyId: +body.id, params: {}, why: 'Оценка флота под атакой' },
      { what: 'Прочитать флот ' + bodyLabel(body), why: 'оценка слабой атаки / «нечего терять»', chosen: 'read.fleetTable' });
    if (r && r.ok && r.data && r.data.fleetTable) {
      ships = {}; for (const s of r.data.fleetTable.ships || []) if (+s.count > 0) ships[s.id] = +s.count;
      try { res = OGX.fleet.gz.stock(r.data.doc); } catch (e) { res = null; }
    }
    const d = await act(w, { type: 'read.page', prio: 'defense', bodyId: +body.id, params: { page: 'shipyard', mode: 'defense' }, why: 'Оценка обороны под атакой' },
      { what: 'Прочитать оборону ' + bodyLabel(body), why: 'оценка слабой атаки', chosen: 'read.page shipyard defense' });
    if (d && d.ok && d.data && d.data.doc) {
      defense = {};
      try { for (const it of OGX.parse.gz.techItems(d.data.doc)) if (it.isUnit && it.id >= 400 && it.id < 500 && it.value > 0) defense[it.id] = it.value; } catch (e) { /* keep */ }
    }
    if (!ships && !defense) return null;
    const rs = res || (body.res ? { metal: num(body.res.metal && body.res.metal.amount), crystal: num(body.res.crystal && body.res.crystal.amount), deuterium: num(body.res.deuterium && body.res.deuterium.amount) } : null);
    return { fleet: pointsOf(ships || {}, cat), defense: pointsOf(defense || {}, cat), res: rs ? (num(rs.metal) + num(rs.crystal) + num(rs.deuterium)) / 1000 : 0 };
  }

  // ------------------------------------------------------------------ interceptors
  async function handleAbm(w, rec, bodies, st) {
    let body = bodies[rec.bodyKey];
    if (body && isMoon(body) && body.planetId) body = Object.values(bodies).find((b) => +b.id === +body.planetId) || body;   // the planet's silo protects its moon
    if (!body) { w.rec('abm-ordered', 'Перехватчики: тело ' + rec.bodyKey + ' неизвестно', { threat: rec.key, ok: false, reason: 'body' }); return; }
    const id = +body.id;
    const needed = num(rec.ships && rec.ships[503]) || num(rec.units);
    const b = await act(w, { type: 'read.page', prio: 'defense', bodyId: id, params: { page: 'buildings' }, why: 'Ракетная шахта и очередь построек' },
      { what: 'Прочитать постройки ' + bodyLabel(body), why: 'ракетная атака: уровень шахты, верфи и очередь (15/21 блокируют верфь)', inputs: { threat: rec.key, missiles: needed }, chosen: 'read.page buildings' });
    const dpage = await act(w, { type: 'read.page', prio: 'defense', bodyId: id, params: { page: 'shipyard', mode: 'defense' }, why: 'Ракеты и очередь верфи' },
      { what: 'Прочитать оборону ' + bodyLabel(body), why: 'ракетная атака: ракеты в шахте и очередь верфи', inputs: { threat: rec.key }, chosen: 'read.page shipyard defense' });
    if (!b.ok || !dpage.ok || !b.data || !dpage.data) { w.rec('abm-ordered', 'Перехватчики: страницы не прочитаны', { threat: rec.key, ok: false, reason: 'read', b: b.refused || b.error, d: dpage.refused || dpage.error }); return; }
    const lv = {};
    try { for (const it of OGX.parse.gz.techItems(b.data.doc)) lv[it.id] = it.value; } catch (e) { /* empty */ }
    const units = {};
    try { for (const it of OGX.parse.gz.techItems(dpage.data.doc)) units[it.id] = it.value; } catch (e) { /* empty */ }
    let sq = null;
    try { sq = OGX.parse.gz.shipyardQueue(dpage.data.doc); } catch (e) { sq = null; }
    const items = (sq && sq.items) || [];
    const queuedAbm = items.filter((x) => x.id === 502).reduce((s, x) => s + x.count, 0);
    const queuedIpm = items.filter((x) => x.id === 503).reduce((s, x) => s + x.count, 0);
    const silo = num(lv[44]); const yard = num(lv[21]);
    const blockers = queueBlockers(b.data.doc);
    const stock = OGX.fleet.gz.stock(dpage.data.doc);
    const free = siloFree({ silo, abm: units[502], ipm: units[503], queuedAbm, queuedIpm });
    const secondsLeft = (rec.arrival - w.now()) / 1000 - 5;
    const cached = ((st.abmSecs || {})[id]) || null;
    let per = items.find((x) => x.id === 502) ? items.find((x) => x.id === 502).secsPerUnit : (cached && cached.yard === yard && cached.nanite === num(lv[15]) ? cached.secs : null);
    const inputs = { threat: rec.key, planet: body.coords, missiles: needed, silo, shipyard: yard, nanite: num(lv[15]), abm: num(units[502]), ipm: num(units[503]), queuedAbm, queuedIpm,
      capacity: silo * 10 * Math.max(SILO_FACTOR, 1), free, stock, secondsLeft: Math.round(secondsLeft), queueSec: sq ? sq.totalSecs : 0, perUnitSec: per, blockers };
    let why = null;
    if (yard < 1 || silo < 2) why = 'требования не выполнены (верфь ' + yard + ', шахта ' + silo + ')';
    else if (blockers.length) why = 'в очереди построек ' + blockers.join(', ') + ' — верфь не принимает заказ';
    else if (!(needed > 0)) why = 'число ракет неизвестно';
    else if (free < 1) why = 'шахта заполнена';
    if (why) { w.rec('abm-ordered', 'Перехватчики не заказаны: ' + why, Object.assign({ ok: false, reason: why }, inputs)); return; }
    let ordered = 0; const orders = [];
    const order = async (n, note) => {
      const r = await act(w, { type: 'build.units', prio: 'defense', bodyId: id, params: { units: { 502: n } }, why: 'Перехватчики против МПР (' + n + ')', plan: inputs },
        { what: 'Заказать ' + n + ' перехватчиков на ' + bodyLabel(body), why: note, inputs, chosen: { 502: n }, alternatives: ['не строить'] });
      orders.push({ n, ok: r.ok, dry: !!r.dry, refused: r.refused || null, verified: r.verified });
      if (r.ok && !r.dry) {
        ordered += n;
        try {
          const q = OGX.parse.gz.shipyardQueue(r.data && r.data.doc);
          const it = q && q.items.filter((x) => x.id === 502).pop();
          if (it && it.secsPerUnit > 0) { per = it.secsPerUnit; st.abmSecs = st.abmSecs || {}; st.abmSecs[id] = { secs: per, yard, nanite: num(lv[15]), t: w.now() }; }
        } catch (e) { /* keep */ }
      }
      return r;
    };
    let n = abmCount({ free, needed, stock, perUnitSec: per, queueSec: inputs.queueSec, secondsLeft });
    if (per === null && !w.dryRun) {
      // unknown build time: order one, read the per-unit time from the shipyard queue, then the rest that finishes in time
      if (abmCount({ free, needed, stock, perUnitSec: null, secondsLeft }) < 1) { w.rec('abm-ordered', 'Перехватчики не заказаны: не хватает ресурсов', Object.assign({ ok: false }, inputs)); return; }
      const r1 = await order(1, 'время постройки неизвестно: заказ 1 шт. для замера');
      if (!r1.ok) { w.rec('abm-ordered', 'Перехватчики: заказ не принят', Object.assign({ ok: false, orders }, inputs)); return; }
      inputs.perUnitSec = per;
      const s2 = { metal: num(stock.metal) - 8000, crystal: num(stock.crystal), deuterium: num(stock.deuterium) - 2000 };
      n = per ? abmCount({ free: free - 1, needed: needed - 1, stock: s2, perUnitSec: per, queueSec: inputs.queueSec + per, secondsLeft }) : 0;
    }
    if (n > 0) await order(n, 'свободно в шахте ' + free + ', ракет ' + needed + ', успеет до удара');
    w.rec('abm-ordered', 'Перехватчики: ' + (w.dryRun ? 'план ' + n : 'заказано ' + ordered) + ' на ' + bodyLabel(body) + ' (шахта ' + silo + ', свободно ' + free + ', МПР ' + needed + ')',
      Object.assign({ ok: ordered > 0 || (w.dryRun && n > 0), ordered, planned: n, orders, dry: w.dryRun }, inputs));
  }
  function queueBlockers(doc) {
    const out = [];
    try {
      const box = [...doc.querySelectorAll('#technologies')].find((x) => !x.querySelector('ul.icons') && x.querySelector('.largebox'));
      const text = box ? box.querySelector('.largebox').textContent.toLowerCase() : '';
      for (const id of [15, 21]) {
        const c = OGX.catalog.get(id) || {};
        if ([c.en, c.ru].filter(Boolean).some((n) => text.includes(String(n).toLowerCase()))) out.push(c.ru || String(id));
      }
    } catch (e) { /* none */ }
    return out;
  }

  // ------------------------------------------------------------------ spy the attacker
  /** spy.probes (the Infinity «Шпионаж» setting, default 1100): via OGX.api.spyProbes, else the setting itself; no module override. */
  function spyProbesSetting() {
    let v = NaN;
    try { v = OGX.api && typeof OGX.api.spyProbes === 'function' ? +OGX.api.spyProbes() : parseInt(OGX.settings.get('spy.probes'), 10); } catch (e) { v = NaN; }
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1100;
  }
  /** The body that spies the attacker (rules-6): a body with the full spy.probes count first, then an unlocked one (the attacked
   *  body is locked for normal sends), then the nearest to the attacker, then the most probes. A body with fewer than
   *  min(setting, 50) probes is never picked while another has more (a 1-probe spy is shot down and wastes the spare slot). */
  function spySource(bodies, want, isLocked, from) {
    const list = Object.values(bodies || {}).filter((b) => num(b.ships && b.ships[210]) > 0);
    if (!list.length) return null;
    const floor = Math.min(num(want), 50);
    const most = Math.max(...list.map((b) => num(b.ships[210])));
    const ok = list.filter((b) => num(b.ships[210]) >= floor || num(b.ships[210]) >= most);
    const dist = (b) => { try { return from && b.coords && OGX.fleet && OGX.fleet.gz ? num(OGX.fleet.gz.distance(b.coords, from), 0) : 0; } catch (e) { return 0; } };
    return ok.sort((a, b) => (num(b.ships[210]) >= want ? 1 : 0) - (num(a.ships[210]) >= want ? 1 : 0) || (isLocked(a.key) ? 1 : 0) - (isLocked(b.key) ? 1 : 0)
      || dist(a) - dist(b) || num(b.ships[210]) - num(a.ships[210]))[0] || null;
  }
  async function spyAttacker(w, rec, bodies, st) {
    const target = coordsObj(rec.from, 1);
    if (!target) return;
    w.decide('Слоты для шпионажа атакующего', { why: 'нужен слот сверх резерва и слота для сейва', inputs: { threat: rec.key }, chosen: 'slots', alternatives: [] });
    const slots = await w.slots();
    const reserve = Math.max(0, num(w.core('slotsReserve')));
    const free = slots && slots.known ? slots.fleet.max - slots.fleet.used : null;
    if (free === null || free - 1 <= reserve) { w.rec('spy-attacker', 'Шпионаж атакующего пропущен: нужен свободный слот сверх резерва и слота для сейва', { threat: rec.key, free, reserve, ok: false }); return; }
    // probes per spy = the suite setting spy.probes (OGX.api.spyProbes, default 1100), at most what the body has
    const src = spySource(bodies, spyProbesSetting(), (k) => !!w.locked(k), rec.from);
    if (!src) { w.rec('spy-attacker', 'Шпионаж атакующего пропущен: нет зондов', { threat: rec.key, ok: false }); return; }
    const n = Math.min(num(src.ships[210]), spyProbesSetting());
    const r = await act(w, { type: 'fleet.send', prio: 'defense', cls: w.locked(src.key) ? 'force' : 'normal', bodyId: +src.id,
      params: { target, ships: { 210: n }, mission: 6, speed: 10 }, why: 'Шпионаж атакующего ' + rec.from, dedupeKey: 'botsave:spy:' + rec.key },
    { what: 'Шпионаж атакующего ' + rec.from, why: 'состав флота атакующего', inputs: { threat: rec.key, probes: n, from: src.coords, free, reserve }, chosen: { mission: 6, ships: { 210: n } } });
    w.rec('spy-attacker', 'Шпионаж атакующего ' + rec.from + ': ' + (r.dry ? 'пробный режим' : r.ok ? 'отправлено ' + n + ' зондов' : 'не отправлено (' + (r.refused || r.error) + ')'), { threat: rec.key, ok: !!r.ok, dry: !!r.dry, refused: r.refused || null, probes: n });
  }

  // ------------------------------------------------------------------ the save
  /** Fresh state of the source body: ships, stock, fleet data for the timing (probe in live mode, estimate in dry-run). */
  async function readSource(w, body, firstTarget, why) {
    const r = await act(w, { type: 'read.fleetTable', prio: 'defense', bodyId: +body.id, params: {}, why: 'Сейв: корабли и ресурсы ' + bodyLabel(body) },
      { what: 'Прочитать флот ' + bodyLabel(body), why, chosen: 'read.fleetTable', alternatives: [] });
    if (!r || !r.ok || !r.data || !r.data.fleetTable) return { error: (r && (r.refused || r.error)) || 'read', result: r };
    const ships = {};
    for (const s of r.data.fleetTable.ships || []) if (+s.count > 0 && +s.id >= 202 && +s.id < 300 && +s.id !== 212) ships[s.id] = +s.count;
    let stock = { metal: 0, crystal: 0, deuterium: 0 };
    try { const s = OGX.fleet.gz.stock(r.data.doc); for (const k of RES) stock[k] = num(s[k]); } catch (e) { /* zeros */ }
    const out = { ships, stock, slots: r.data.slots || null, data: null, dataSrc: null, fleetroom: 0, transportRoom: 0 };
    if (!Object.keys(ships).length) return out;
    let probe = null;
    if (!w.dryRun && firstTarget) {
      const p = await act(w, { type: 'probe.target', prio: 'defense', bodyId: +body.id, params: { ships, target: firstTarget, speed: 10 }, why: 'Сейв: данные полёта (скорости, трюм)' },
        { what: 'Проба отправки на ' + coordsStr(firstTarget), why: 'точные трюм и расход (fleetStep1/2 data)', inputs: { ships }, chosen: 'probe.target', alternatives: ['оценка по каталогу'] });
      probe = p && p.ok && p.data ? p.data : null;
      const d = probe ? probe.data : null;
      if (d && d.ships && Object.keys(d.ships).length && num(d.fleetroom) > 0) { out.data = d; out.dataSrc = 'probe'; out.fleetroom = num(d.fleetroom); out.missions = probe.missions; }
    }
    if (!out.data) {
      // estimate: per-ship speeds of page=fleetTable (exact, with drive techs) + catalog fuel + server fleet speed (fleetStep1
      // gamespeed when a step-1 page was seen, else the Aeternum 7); the hold from the probe when it answered one
      const [stats, server, factors] = await Promise.all([OGX.state.shipStats(), OGX.state.server(), OGX.state.factors ? OGX.state.factors() : null]);
      const d = OGX.fleet.gz.dataFor(ships, stats || {}, server || {}, factors);
      let min = Infinity;
      for (const sh of r.data.fleetTable.ships || []) if (d.ships[sh.id] && +sh.speed > 0) d.ships[sh.id].speed = +sh.speed;
      for (const v of Object.values(d.ships)) if (+v.speed > 0) min = Math.min(min, +v.speed);
      if (Number.isFinite(min)) d.maxspeed = min;
      const pr = probe && probe.data ? num(probe.data.fleetroom) : 0;
      out.data = d;
      out.fleetroom = pr > 0 ? pr : Math.floor(OGX.calc.fleetCargo(ships, stats || {}) * 0.98);   // catalog hold: 2 % margin against step-3 overflow
      out.dataSrc = pr > 0 ? 'fleetTable+probe' : 'fleetTable';
      out.fleetSpeedKnown = !!(server && server.fleetSpeedKnown);
      if (probe && Number.isFinite(+probe.consumption)) out.probeFuel = +probe.consumption;
    }
    out.transportRoom = await transportRoomOf(ships);
    return out;
  }
  /** Hold of the Battle Transporters 217 among `ships` (core shipStats: officer / measured factor; else catalog x (1 + ShipStorage)),
   *  2 % margin like the catalog fleetroom. The only room resources may take on a save. */
  async function transportRoomOf(ships) {
    const n = num((ships || {})[TRANSPORT]);
    if (!(n > 0)) return 0;
    let per = 0;
    try { const st = await OGX.state.shipStats(); per = st && st[TRANSPORT] ? num(st[TRANSPORT].cargo) : 0; } catch (e) { per = 0; }
    if (!(per > 0)) {
      let base = 0, sf = 0;
      try { base = OGX.calc.cargoCapacity(TRANSPORT); } catch (e) { base = 40000000; }
      try { const f = OGX.state.factors ? await OGX.state.factors() : null; sf = f && Number.isFinite(+f.ShipStorage) ? +f.ShipStorage : 0; } catch (e) { sf = 0; }
      per = (base || 40000000) * (1 + sf);
    }
    return Math.floor(n * per * 0.98);
  }

  /** Non-empty debris fields within ±span systems of `src` from the galaxy cache (OGX.galaxy.cached is async), the nearest systems
   *  first, at most `max`. Read once per planning and handed to candidates(). */
  async function nearbyFields(src, { max = 3, span = 5 } = {}) {
    const o = coordsObj(src && src.coords);
    if (!o || !OGX.galaxy || typeof OGX.galaxy.cached !== 'function') return [];
    const out = [];
    for (let d = 0; d <= span && out.length < max; d++) {
      for (const s of d ? [o.system - d, o.system + d] : [o.system]) {
        if (s < 1 || s > 499) continue;
        let sys = null;
        try { sys = await OGX.galaxy.cached(o.galaxy, s); } catch (e) { sys = null; }
        for (const p of (sys && sys.positions) || []) {
          if (p && p.debris && num(p.debris.metal) + num(p.debris.crystal) > 0) out.push({ galaxy: o.galaxy, system: s, position: +p.position, type: 2, field: { metal: num(p.debris.metal), crystal: num(p.debris.crystal) } });
        }
      }
    }
    return out.slice(0, max);
  }
  /** Destination candidates in missionOrder (group = rank). opts.fields: nearbyFields() of the source (harvest). */
  function candidates(w, st, src, bodies, ships, { allowExpedition = true, fields = [] } = {}) {
    const order = Array.isArray(w.cfg('missionOrder')) && w.cfg('missionOrder').length ? w.cfg('missionOrder') : SETTINGS.missionOrder.default;
    const threatened = new Set(Object.values(st.threats).filter((r) => r.arrival > w.now() - 60000 && r.decision !== 'ignore' && +r.mission !== 10 && !r.probesOnly).map((r) => r.bodyKey));
    const own = Object.values(bodies).filter((b) => b.key !== src.key && b.coords && !w.locked(b.key) && !threatened.has(b.key));
    const moons = own.filter(isMoon); const planets = own.filter((b) => !isMoon(b));
    const out = []; let g = 0;
    const tgt = (b) => Object.assign(coordsObj(b.coords, isMoon(b) ? 3 : 1), {});
    for (const m of order) {
      const mission = MISSION_ID[m];
      if (!mission) continue;
      if (m === 'deploy') {
        if (w.cfg('moonsFirst') !== false) { for (const b of moons) out.push({ mission, target: tgt(b), label: 'луна ' + b.coords, bodyKey: b.key, group: g }); g++; for (const b of planets) out.push({ mission, target: tgt(b), label: 'планета ' + b.coords, bodyKey: b.key, group: g }); }
        else for (const b of own) out.push({ mission, target: tgt(b), label: (isMoon(b) ? 'луна ' : 'планета ') + b.coords, bodyKey: b.key, group: g });
      } else if (m === 'transport') {
        for (const b of moons.concat(planets)) out.push({ mission, target: tgt(b), label: (isMoon(b) ? 'луна ' : 'планета ') + b.coords, bodyKey: b.key, group: g + (isMoon(b) ? 0 : 0.5) });
      } else if (m === 'harvest') {
        if (!(num(ships[219]) > 0)) { g++; continue; }   // debris only with Battle Recyclers 219 (John's rule, no 209)
        for (const f of (fields || []).slice(0, 3)) out.push({ mission, target: { galaxy: f.galaxy, system: f.system, position: f.position, type: 2 }, label: 'обломки ' + coordsStr(f), group: g, needsProbe: true });
      } else if (m === 'expedition' && allowExpedition) {
        const o = coordsObj(src.coords);
        out.push({ mission, target: { galaxy: o.galaxy, system: o.system, position: EXPO_POS, type: 1 }, label: 'экспедиция ' + o.galaxy + ':' + o.system + ':' + EXPO_POS, group: g, staytime: 1, risky: true });
      }
      g++;
    }
    return out;
  }

  /** Runs the save of one body: reads, hypotheses, sends (next hypothesis on refusal), plans the recall. */
  async function doSave(w, st, sv, bodies, opts = {}) {
    const src = bodies[sv.bodyKey];
    if (!src) { sv.state = 'failed'; w.rec('save-failed', 'Сейв: тело ' + sv.bodyKey + ' не найдено', { bodyKey: sv.bodyKey, reason: 'body' }); return; }
    sv.state = 'planning'; sv.bodyId = +src.id; sv.coords = src.coords;
    await save(w, st);
    const deutKeep = num(opts.deutToLeave !== undefined ? opts.deutToLeave : w.cfg('deutToLeave')) + Math.max(0, num(w.core('deutReserve')));
    // debris fields near the body (harvest destination): the galaxy cache is async, read once here, never inside candidates()
    const order = Array.isArray(w.cfg('missionOrder')) ? w.cfg('missionOrder') : SETTINGS.missionOrder.default;
    const fields = order.includes('harvest') ? await nearbyFields(src) : [];
    const copts = Object.assign({}, opts, { fields });
    let tries = 0; let lastFail = null;
    for (let round = 0; round < 2; round++) {
      const shipsGuess = src.ships || {};
      const cands0 = candidates(w, st, src, bodies, shipsGuess, copts);
      const s = await readSource(w, src, cands0.length ? cands0[0].target : null, sv.kind === 'sleep' ? 'ночной сейв' : 'удар в ' + fmtT(sv.firstArrival));
      if (s.error) {
        sv.state = 'failed';
        w.rec('save-failed', 'Сейв ' + bodyLabel(src) + ': флот не прочитан (' + s.error + ')', { bodyKey: sv.bodyKey, reason: s.error });
        if (!['stopped', 'notLeader'].includes(s.error)) notifyFail(src, 'не удалось прочитать флот');
        return;
      }
      if (!Object.keys(s.ships).length) {
        // nothing at home now: a fleet landing before the deadline is saved after it lands; otherwise the save waits for a landing
        // (re-planned from run() on bot:fleet-returned) instead of ending for good
        sv.noShips = true; sv.skippedAt = w.now(); sv.replans = num(sv.replans) + 1;
        const landing = sv.kind === 'threat' && sv.firstArrival ? nextLanding(w.flights(), sv.bodyKey, w.now(), latestPlanAt(sv.firstArrival)) : null;
        if (landing && sv.replans <= MAX_REPLANS) {
          sv.state = 'waiting'; sv.waitFor = landing; sv.notBefore = landing + LAND_MARGIN_MS;
          w.rec('skip', 'Сейв ' + bodyLabel(src) + ': сейчас нечего спасать (нет летающих кораблей) — флот садится в ' + fmtT(landing) + ', сейв после посадки', { reason: 'noShips', bodyKey: sv.bodyKey, stock: s.stock, retryAt: sv.notBefore, landing });
          return;
        }
        sv.state = 'skipped';
        w.rec('skip', 'Сейв ' + bodyLabel(src) + ': нечего спасать (нет летающих кораблей' + (sv.kind === 'threat' ? '; посадок до удара не видно — при посадке флота сейв планируется заново' : '') + ')', { reason: 'noShips', bodyKey: sv.bodyKey, stock: s.stock, replans: sv.replans });
        return;
      }
      const cands = candidates(w, st, src, bodies, s.ships, copts);
      // harvest fields need a probe (step 2 offers 8 only for a non-empty field)
      for (const c of cands.filter((x) => x.needsProbe)) {
        if (w.dryRun) { c.unverified = true; continue; }
        const p = await act(w, { type: 'probe.target', prio: 'defense', bodyId: +src.id, params: { ships: s.ships, target: c.target, speed: 10 }, why: 'Сейв: проверка поля обломков ' + coordsStr(c.target) },
          { what: 'Проверить поле обломков ' + coordsStr(c.target), why: 'переработка возможна только на непустое поле', chosen: 'probe.target' });
        c.dead = !(p && p.ok && p.data && (p.data.missions || []).includes(8));
      }
      const start = Math.max(w.now(), sv.startAt || 0);
      const horizon = sv.kind === 'sleep' ? sv.wakeAt : (sv.lastArrival + HOME_AFTER_MS);
      const extra = randInt(20, 50);
      const minFlightSec = sv.kind === 'sleep' ? Math.max(0, (sv.wakeAt - start) / 1000) : Math.max(0, (sv.lastArrival - start) / 1000) * (1 + num(w.cfg('marginPct'), 30) / 100) + extra;
      const deutLimit = Math.max(0, s.stock.deuterium - deutKeep);
      // estimated data: scale the fuel by the server's step-2 consumption of the probe (same ships, speed 100 %, first target)
      let fuelRatio = 1;
      if (s.dataSrc !== 'probe' && Number.isFinite(s.probeFuel) && cands0.length) {
        const est = OGX.bot.flightTime({ from: src.coords, to: cands0[0].target, ships: s.ships, speed: 10, data: s.data }).fuel;
        if (est > 0) fuelRatio = Math.min(3, Math.max(0.5, s.probeFuel / est));
      }
      const flight = (target, speed) => { const f = OGX.bot.flightTime({ from: src.coords, to: target, ships: s.ships, speed, data: s.data }); return { duration: f.duration, fuel: fuelRatio === 1 ? f.fuel : Math.ceil(f.fuel * fuelRatio) }; };
      const hyps = hypotheses({ candidates: cands.filter((c) => !c.dead), flight, minFlightSec, deutLimit, fleetroom: s.fleetroom })
        .map((h) => Object.assign(h, { cargo: payload({ stock: s.stock, fuel: h.fuel, fleetroom: s.fleetroom, deutKeep, resSave: w.cfg('resSave') !== false, transportRoom: s.transportRoom }) }))
        .filter((h) => !(h.mission === 3 && h.cargo.metal + h.cargo.crystal + h.cargo.deuterium < 1));
      const inputs = { body: src.coords, bodyKey: sv.bodyKey, ships: s.ships, stock: s.stock, fleetroom: s.fleetroom, transportRoom: s.transportRoom, dataSrc: s.dataSrc, start, firstArrival: sv.firstArrival || null,
        lastArrival: sv.lastArrival || null, minFlightSec: Math.round(minFlightSec), deutLimit, slots: s.slots, round, fuelRatio, probeFuel: s.probeFuel || null, fleetSpeedKnown: s.fleetSpeedKnown !== false };
      if (w.cfg('resSave') !== false && !(s.transportRoom > 0) && RES.some((k) => num(s.stock[k]) > deutKeepOf(k, deutKeep)))
        w.rec('save-planned', 'Сейв ' + bodyLabel(src) + ': ресурсы не берутся — на теле нет Ул. трансп. (ресурсы на сейве только в 217)', { bodyKey: sv.bodyKey, warning: 'noTransport', stock: s.stock });
      const alts = hyps.slice(0, 12).map((h) => ({ mission: h.mission, target: coordsStr(h.target), speed: h.speed, duration: Math.round(h.duration), fuel: h.fuel, landing: h.landing }));
      if (!hyps.length) break;
      let retry = false;
      for (let i = 0; i < hyps.length; i++) {
        const h = hyps[i];
        tries++;
        if (h.risky) w.rec('save-planned', 'Внимание: сейв экспедицией (1/9 риск потерять флот) — других вариантов нет', { bodyKey: sv.bodyKey, target: coordsStr(h.target), warning: 'expedition' });
        const spec = { type: 'fleet.send', prio: 'defense', cls: 'force', bodyId: +src.id,
          params: { target: h.target, ships: s.ships, mission: h.mission, speed: h.speed, cargo: h.cargo, staytime: h.staytime },
          why: (sv.kind === 'sleep' ? 'Ночной сейв ' : 'Сейв ') + bodyLabel(src) + ': ' + (MISSION_RU[h.mission] || h.mission) + ' → ' + h.label + ' на ' + (h.speed * 10) + '%',
          plan: { oneWay: Math.round(h.duration), fuel: h.fuel, minFlightSec: Math.round(minFlightSec), landing: h.landing, horizon },
          deadline: sv.kind === 'sleep' ? undefined : sv.firstArrival - DEADLINE_MS, dedupeKey: 'botsave:save:' + (sv.key || sv.bodyKey) };
        const atMs = (sv.startAt || 0) - SEND_LEAD_MS;
        if (atMs > w.now()) spec.at = atMs;
        const res = await act(w, spec, {
          what: 'Сейв ' + bodyLabel(src) + ' → ' + h.label,
          why: (h.landing ? 'ни одна скорость не даёт порог ' + Math.round(h.need) + ' с: флот останется на безопасном теле' : 'первая скорость с полётом ≥ ' + Math.round(h.need) + ' с') + ', топливо ' + h.fuel,
          inputs, chosen: { mission: h.mission, target: coordsStr(h.target), speed: h.speed, oneWay: Math.round(h.duration), fuel: h.fuel, cargo: h.cargo, landing: h.landing }, alternatives: alts });
        if (res.dry) {
          sv.state = 'dry'; sv.mission = h.mission; sv.target = h.target; sv.speed = h.speed; sv.cargo = h.cargo; sv.oneWay = Math.round(h.duration);
          w.rec('save-planned', 'Пробный режим: сейв ' + bodyLabel(src) + ' → ' + h.label + ' на ' + (h.speed * 10) + '% (полёт ' + fmtDur(h.duration) + ') не отправлен', { bodyKey: sv.bodyKey, dry: true, issues: res.message || null, hypothesis: alts[0], cargo: h.cargo });
          return;
        }
        if (res.ok) {
          const d = res.data || {};
          Object.assign(sv, { state: 'sent', fleetId: d.fleetId != null ? d.fleetId : null, mission: h.mission, target: h.target, speed: h.speed, cargo: h.cargo, ships: s.ships,
            sentAt: res.at || w.now(), destArrival: d.arrival || ((res.at || w.now()) + Math.round(h.duration * 1000)), back: d.back || null, oneWay: Math.round(h.duration), landing: h.landing,
            horizon, verified: !!res.verified, fuel: d.consumption != null ? d.consumption : h.fuel });
          planRecall(w, st, sv, null);
          w.rec('save-sent', 'Флот ' + bodyLabel(src) + ' спасён: ' + (MISSION_RU[h.mission] || h.mission) + ' → ' + h.label + ', прибытие ' + fmtT(sv.destArrival) + (sv.recall && sv.recall.at ? ', отзыв в ' + fmtT(sv.recall.at) : ''),
            { bodyKey: sv.bodyKey, fleetId: sv.fleetId, mission: h.mission, target: coordsStr(h.target), speed: h.speed, arrival: sv.destArrival, back: sv.back, recallAt: sv.recall ? sv.recall.at : null, cargo: h.cargo, ships: s.ships, verified: !!res.verified, sentAt: sv.sentAt });
          if (sv.kind === 'sleep') w.rec('sleep-save', 'Ночной сейв ' + bodyLabel(src) + ' отправлен', { bodyKey: sv.bodyKey, fleetId: sv.fleetId, wakeAt: sv.wakeAt });
          return;
        }
        lastFail = res.refused || res.error || 'error';
        w.rec('save-failed', 'Сейв ' + bodyLabel(src) + ' → ' + h.label + ' не ушёл: ' + (res.refused || res.error) + (res.message ? ' (' + res.message + ')' : ''), { bodyKey: sv.bodyKey, refused: res.refused || null, error: res.error || null, message: res.message || null, hypothesis: { mission: h.mission, target: coordsStr(h.target), speed: h.speed } });
        if (['stopped', 'notLeader', 'expired', 'duplicate', 'limit'].includes(res.refused)) { sv.state = 'failed'; if (res.refused === 'expired') notifyFail(src, 'не успели до удара'); return; }
        // the executor computed the real fuel on step 1: same hypothesis once more with the exact payload
        if (['fuel', 'cargo'].includes(res.refused) && !h.fixed && res.data && Number.isFinite(+res.data.consumption) && +res.data.consumption !== h.fuel && +res.data.consumption <= deutLimit) {
          h.fixed = true; h.fuel = +res.data.consumption;
          h.cargo = payload({ stock: s.stock, fuel: h.fuel, fleetroom: s.fleetroom, deutKeep, resSave: w.cfg('resSave') !== false, transportRoom: s.transportRoom });
          i--; continue;
        }
        if (['ships', 'fuel', 'cargo'].includes(res.refused) && round === 0) { retry = true; break; }   // stock changed: read again once
        if (res.refused === 'slots') {
          // a transiently full slot table (John flies 10-15 fleets): the same save again in ~10 s, one last time before the deadline
          if (sv.kind === 'threat' && sv.firstArrival) {
            const limit = sv.firstArrival - DEADLINE_MS - LAST_TRY_MS;
            const at = Math.min(w.now() + randInt(SLOT_RETRY[0], SLOT_RETRY[1]), limit);
            if (at > w.now() + 1000) {
              sv.state = 'waiting'; sv.notBefore = at; sv.slotTries = num(sv.slotTries) + 1; sv.waitFor = null;
              w.rec('save-planned', 'Сейв ' + bodyLabel(src) + ': нет свободного слота — повтор в ' + fmtT(at) + ' (крайний срок ' + fmtT(limit) + ')', { bodyKey: sv.bodyKey, retryAt: at, slotTries: sv.slotTries, deadline: limit, message: res.message || null });
              return;
            }
          }
          break;
        }
      }
      if (!retry) break;
    }
    sv.state = 'failed';
    w.rec('save-failed', 'Флот ' + bodyLabel(src) + ' спасти нельзя (' + (lastFail || 'нет подходящей цели') + ')', { bodyKey: sv.bodyKey, reason: lastFail || 'noTarget', tries });
    notifyFail(src, lastFail || 'нет подходящей цели');
  }
  function notifyFail(src, why) {
    try { OGX.bot.notify('Флот спасти нельзя: ' + bodyLabel(src) + ' — ' + why, { level: 'alarm', sound: true }); } catch (e) { /* ignore */ }
  }

  /** (Re)arms the recall timer of a sent save; a changed horizon re-arms it (the old timer is cancelled or ignored by gen). */
  const timerHandles = new Map();
  function planRecall(w, st, sv, why) {
    if (sv.state !== 'sent') return;
    const old = sv.recall || null;
    if (w.cfg('recall') === false || sv.fleetId == null) {
      sv.recall = { state: 'skipped', at: null, reason: w.cfg('recall') === false ? 'off' : 'noFleetId', gen: (old && old.gen) || 0 };
      w.rec('recall-planned', 'Отзыв не планируется (' + (sv.recall.reason === 'off' ? 'выключен' : 'нет id флота') + ')', { bodyKey: sv.bodyKey, fleetId: sv.fleetId, reason: sv.recall.reason });
      return;
    }
    const jmin = Math.max(0, num(w.cfg('recallJitterMinSec'), 40)); const jmax = Math.max(jmin, num(w.cfg('recallJitterMaxSec'), 140));
    const jitterMs = old && old.jitterMs !== undefined ? old.jitterMs : randInt(jmin, jmax) * 1000;
    const r = recallAt({ start: sv.sentAt, destArrival: sv.destArrival, jitterMs, horizon: sv.horizon });
    if (old && old.state === 'armed' && old.at === r.at) return;
    const gen = ((old && old.gen) || 0) + 1;
    if (old && old.state === 'armed') { const h = timerHandles.get(sv.key || sv.bodyKey); if (h) { try { h.cancel(); } catch (e) { /* stale */ } } }
    if (r.at === null) {
      sv.recall = { state: 'skipped', at: null, reason: 'late', gen, jitterMs };
      const self = sv.mission === 4 ? 'флот останется на ' + coordsStr(sv.target) : 'флот вернётся сам в ' + fmtT(sv.back || 0);
      w.rec('recall-planned', 'Отзыв не нужен/невозможен до прибытия: ' + self + (why ? ' (' + why + ')' : ''), { bodyKey: sv.bodyKey, fleetId: sv.fleetId, reason: 'late', want: r.want, need: r.need, destArrival: sv.destArrival });
      return;
    }
    sv.recall = { state: 'armed', at: r.at, gen, jitterMs, want: Math.round(r.want), need: Number.isFinite(r.need) ? Math.round(r.need) : null };
    const h = OGX.bot.at(r.at, (p) => { if (handle) handle.wake('recall', now()); return p; }, { label: 'botsave:recall', payload: { bodyKey: sv.bodyKey, key: sv.key || sv.bodyKey, fleetId: sv.fleetId, gen } });
    timerHandles.set(sv.key || sv.bodyKey, h);
    w.rec('recall-planned', 'Отзыв флота ' + sv.fleetId + ' в ' + fmtT(r.at) + ' (дома ≈ ' + fmtT(2 * r.at - sv.sentAt) + ')' + (why ? ' — ' + why : ''),
      { bodyKey: sv.bodyKey, fleetId: sv.fleetId, at: r.at, homeAt: 2 * r.at - sv.sentAt, horizon: sv.horizon, gen, destArrival: sv.destArrival });
  }

  async function doRecall(w, st, sv) {
    const rc = sv.recall;
    rc.state = 'running';
    await save(w, st);
    const t = w.now();
    if (t >= sv.destArrival - 1000) {
      rc.state = 'late';
      w.rec('recall-done', 'Отзыв опоздал: флот уже у цели ' + coordsStr(sv.target), { bodyKey: sv.bodyKey, fleetId: sv.fleetId, late: true, lateMs: t - rc.at });
      sv.state = 'done';
      return;
    }
    const r = await act(w, { type: 'fleet.recall', prio: 'defense', cls: 'force', bodyId: sv.bodyId, params: { fleetId: sv.fleetId }, why: 'Отзыв сейва ' + sv.coords + ' (флот ' + sv.fleetId + ')' },
      { what: 'Отозвать флот ' + sv.fleetId, why: 'вернётся домой ≈ ' + fmtT(2 * t - sv.sentAt) + ', после последнего удара ' + fmtT(sv.horizon - HOME_AFTER_MS), inputs: { sentAt: sv.sentAt, destArrival: sv.destArrival, horizon: sv.horizon, at: rc.at }, chosen: 'fleet.recall', alternatives: ['оставить флот у цели'] });
    rc.state = r.ok ? 'done' : 'failed';
    rc.doneAt = t; rc.homeAt = 2 * t - sv.sentAt;
    if (r.ok) sv.state = 'done';
    w.rec('recall-done', r.ok ? 'Флот ' + sv.fleetId + ' отозван, дома ≈ ' + fmtT(rc.homeAt) : 'Отзыв флота ' + sv.fleetId + ' не удался: ' + (r.refused || r.error || r.message),
      { bodyKey: sv.bodyKey, fleetId: sv.fleetId, ok: !!r.ok, verified: !!r.verified, refused: r.refused || null, error: r.error || null, late: false, lateMs: Math.max(0, t - rc.at), homeAt: rc.homeAt });
    if (!r.ok && !['stopped', 'notLeader'].includes(r.refused)) { try { OGX.bot.notify('Не удалось отозвать флот ' + sv.fleetId + ' (' + (r.refused || r.error) + ')', { level: 'alarm', sound: true }); } catch (e) { /* ignore */ } }
  }

  // ------------------------------------------------------------------ sleep save
  async function sleepSave(w, st, bodies) {
    let s = null;
    try { s = OGX.bot.status(); } catch (e) { s = null; }
    if (!s || s.state !== 'sleeping' || !s.sleepUntil) return;
    const night = 'n' + Math.floor(s.sleepUntil / 60000);
    if (st.sleep[night]) return;
    st.sleep[night] = { t: w.now(), wakeAt: s.sleepUntil };
    await save(w, st);
    const onlyMoons = w.cfg('sleepSaveOnlyMoons') !== false;
    const list = Object.values(bodies).filter((b) => !onlyMoons || isMoon(b)).filter((b) => !(st.saves[b.key] && ['waiting', 'planning', 'sent'].includes(st.saves[b.key].state)));
    const cat = (id) => OGX.catalog.get(id);
    list.sort((a, b) => pointsOf(b.ships || {}, cat) - pointsOf(a.ships || {}, cat));
    w.rec('sleep-save', 'Засыпание: ночной сейв ' + list.length + ' тел(а) до ' + fmtT(s.sleepUntil), { bodies: list.map((b) => b.key), wakeAt: s.sleepUntil, onlyMoons });
    for (const b of list) {
      const sv = st.saves[b.key] = { bodyKey: b.key, kind: 'sleep', state: 'waiting', created: w.now(), startAt: w.now(), wakeAt: s.sleepUntil, firstArrival: null, lastArrival: null };
      sv.horizon = s.sleepUntil;
      await doSave(w, st, sv, bodies, { deutToLeave: num(w.cfg('sleepDeutToLeave')), allowExpedition: false });
      await save(w, st);
    }
  }

  // ------------------------------------------------------------------ panel
  function renderPanel(container) {
    const h = OGX.dom.h;
    const t = now();
    const ths = Object.values(view.threats || {}).filter((r) => r.arrival > t - 60000).sort((a, b) => a.arrival - b.arrival);
    const dec = { save: 'сейв', abm: 'перехватчики', ignore: 'без реакции', notify: 'оповещение' };
    container.appendChild(h('div', { class: 'ogx-b-h' }, 'Угрозы'));
    if (!ths.length) container.appendChild(h('div', { class: 'ogx-b-muted', dataset: { ogxBotsave: 'no-threats' } }, 'Угроз нет.'));
    for (const r of ths) {
      container.appendChild(h('div', { class: 'ogx-b-line', dataset: { ogxBotsave: 'threat', key: r.key } },
        '[' + (r.to || '?') + (r.toType === 3 ? ' Л' : '') + '] ' + (MISSION_RU[r.mission] || r.mission) + ' от ' + (r.ownerName || '?') + ', удар в ' + fmtT(r.arrival) + ' (',
        OGX.dom.countdown(r.arrival, { short: true }), ') — ', h('b', null, dec[r.decision] || r.decision), r.why ? ': ' + r.why : ''));
    }
    const saves = Object.values(view.saves || {}).filter((s) => (s.lastArrival || s.wakeAt || s.created || 0) > t - 6 * 3600000).sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
    container.appendChild(h('div', { class: 'ogx-b-h' }, 'Сейвы и отзывы'));
    if (!saves.length) container.appendChild(h('div', { class: 'ogx-b-muted' }, 'Нет.'));
    const stRu = { waiting: 'ждёт', planning: 'планирует', sent: 'флот в полёте', done: 'завершён', failed: 'не удался', skipped: 'пропущен', cancelled: 'отменён', dry: 'пробный режим' };
    for (const s of saves) {
      const parts = ['[' + (s.coords || s.bodyKey) + '] ' + (stRu[s.state] || s.state)];
      if (s.state === 'waiting' && s.startAt) parts.push('старт в ' + fmtT(s.startAt));
      if (s.target) parts.push((MISSION_RU[s.mission] || s.mission) + ' → ' + coordsStr(s.target) + ' на ' + (s.speed * 10) + '%');
      if (s.recall && s.recall.at && s.recall.state === 'armed') parts.push('отзыв в ' + fmtT(s.recall.at));
      else if (s.recall && s.recall.state) parts.push('отзыв: ' + ({ done: 'выполнен', skipped: 'не нужен', late: 'опоздал', failed: 'ошибка', running: 'выполняется' }[s.recall.state] || s.recall.state));
      container.appendChild(h('div', { class: 'ogx-b-line', dataset: { ogxBotsave: 'save', body: s.bodyKey } }, parts.join(', ')));
    }
  }
})(window.OGX);
