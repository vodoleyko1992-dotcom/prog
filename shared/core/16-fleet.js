/* shared/core/16-fleet.js — fleet selection math, flight estimates, guarded send, dispatch prefill. Owner: core.
 * Store key: prefill (player scope, 2-minute expiry). Nothing here submits a fleet without an explicit user click:
 * send() must be called from a click handler and confirms when core.confirmActions; the prefill never submits.
 * GALAXYZ (specs/galaxyz/fleet.md §2): dispatch = three form POSTs fleetStep1 -> fleetStep2 -> fleetStep3 that share the token
 * created by step 1; fleet.gz builds each body exactly like the game's forms, step by step, and reads the step-3 result.
 * The prefill uses the native fleetTable link and fills the forms of fleetTable, step 1 (speed) and step 2 (mission, cargo). */
(function (OGX) {
  'use strict';
  const fleet = (OGX.fleet = OGX.fleet || {});
  const log = OGX.log.create('fleet');
  const PREFILL_MS = 120000;
  const isGz = () => !!(OGX.page && OGX.page.isGz && OGX.page.isGz());

  /** Cargo ships for `amount` resources from what is available, preferring the order in `prefer`. */
  fleet.pickCargoShips = function (amount, available, stats, { prefer = [OGX.catalog.transportShip || 217], reservePct = 0 } = {}) {
    const need = Math.max(0, Math.ceil((+amount || 0) * (1 + (reservePct || 0) / 100)));
    const ships = {};
    let rem = need;
    const cap = (id) => (stats && stats[id] && stats[id].cargo) || 0;
    const avail = (id) => Math.max(0, Math.floor((available && available[id]) || 0));
    for (const id of prefer) {
      if (rem <= 0 || cap(id) <= 0) continue;
      const n = Math.min(avail(id), Math.floor(rem / cap(id)));
      if (n > 0) { ships[id] = n; rem -= n * cap(id); }
    }
    if (rem > 0) {
      // cover the remainder with the smallest ship type that still has spare units
      for (const id of prefer.slice().sort((a, b) => cap(a) - cap(b))) {
        if (rem <= 0 || cap(id) <= 0) continue;
        const spare = avail(id) - (ships[id] || 0);
        if (spare <= 0) continue;
        const n = Math.min(spare, Math.ceil(rem / cap(id)));
        ships[id] = (ships[id] || 0) + n;
        rem -= n * cap(id);
      }
    }
    const capacity = Object.entries(ships).reduce((s, [id, n]) => s + cap(id) * n, 0);
    return { ships, capacity, short: Math.max(0, rem) };
  };

  /** Distance, duration, fuel (client and server variants), cargo and times for a planned flight. */
  fleet.estimate = async function ({ from, to, ships, mission, speedPct = 10, holdingHours = 0 }) {
    if (isGz()) return estimateGz({ from, to, ships, speedPct, holdingHours });
    const [server, stats, player] = await Promise.all([OGX.state.server(), OGX.state.shipStats(), OGX.state.player()]);
    const pc = player ? player.playerClass : 'none';
    const distance = OGX.calc.distance(from, to, { galaxies: server.galaxies || 9, systems: server.systems || 499 });
    const maxSpeed = OGX.calc.fleetMaxSpeed(ships, stats);
    const speedFactor = OGX.calc.missionSpeedFactor(mission, server);
    const duration = OGX.calc.flightDuration({ distance, maxSpeed, speedPct, speedFactor });
    const fuelClient = Number.isFinite(duration) ? OGX.calc.fuel({ ships, stats, distance, duration, speedFactor, holdingHours, playerClass: pc, variant: 'client' }) : 0;
    const fuelServer = Number.isFinite(duration) ? OGX.calc.fuel({ ships, stats, distance, duration, speedFactor, holdingHours, playerClass: pc, variant: 'server', fleetSpeed: server.fleetSpeed || 1, speedPct }) : 0;
    const now = OGX.time.serverNow();
    return {
      distance, duration, maxSpeed, speedFactor, fuelClient, fuelServer, fuelBudget: Math.max(fuelClient, fuelServer),
      cargo: OGX.calc.fleetCargo(ships, stats),
      arrival: Number.isFinite(duration) ? now + duration * 1000 : null,
      back: Number.isFinite(duration) ? now + (2 * duration + holdingHours * 3600) * 1000 : null,
    };
  };

  const MISSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 15];
  const MISSIONS_GZ = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 15];   // 11 = DM expedition [UPSTREAM]; 10 (missiles) is not a fleetStep mission
  function validate(req) {
    const errs = [];
    const sp = +req.speed || 10;
    if (isGz()) { if (!(sp >= 1 && sp <= 10 && Math.round(sp) === sp)) errs.push('Скорость должна быть от 10% до 100% с шагом 10%'); }
    else if (!(sp >= 1 && sp <= 10 && Math.round(sp * 2) === sp * 2)) errs.push('Скорость должна быть от 10% до 100% с шагом 5%');
    if (!(isGz() ? MISSIONS_GZ : MISSIONS).includes(+req.mission)) errs.push('Неизвестная миссия');
    const ships = Object.entries(req.ships || {}).filter(([, n]) => +n > 0);
    if (!ships.length) errs.push('Не выбраны корабли');
    for (const k of ['galaxy', 'system', 'position']) if (!(+req[k] > 0)) errs.push('Неверные координаты');
    for (const k of ['metal', 'crystal', 'deuterium']) if (req.cargo && +req.cargo[k] < 0) errs.push('Отрицательный груз');
    return [...new Set(errs)];
  }
  fleet._validate = validate;

  /** Guarded send. Must be called from a user click handler. Returns { success, message }. The core dialog is shown when
   * core.confirmActions is on or the pre-check has warnings (multi-flight sends with their own dialog use fleet.sendBatch). */
  fleet.send = async function (req) {
    const errs = validate(req);
    if (errs.length) return { success: false, message: errs.join('; ') };
    const cur = OGX.state.current() || {};
    const originId = req.originId || cur.id || null;
    const warnings = [];
    try {
      const bodies = await OGX.state.bodies();
      const origin = Object.values(bodies).find((b) => b.id === originId);
      if (origin && origin.shipsT) {
        for (const [id, n] of Object.entries(req.ships)) if ((origin.ships[id] || 0) < n) warnings.push(`${OGX.catalog.name(+id)}: на планете ${OGX.fmt.num(origin.ships[id] || 0)} из ${OGX.fmt.num(n)}`);
      }
      if (origin && origin.coords) {
        const target = `${req.galaxy}:${req.system}:${req.position}`;
        const est = await fleet.estimate({ from: origin.coords, to: target, ships: req.ships, mission: +req.mission, speedPct: +req.speed || 10, holdingHours: +req.holdingtime || 0 });
        const p = origin.res ? OGX.state.projected(origin).res : null;
        const deut = p && p.deuterium ? p.deuterium.amount : null;
        const needD = est.fuelBudget + ((req.cargo && +req.cargo.deuterium) || 0);
        if (deut !== null && deut < needD) warnings.push(`Дейтерия может не хватить: нужно ~${OGX.fmt.num(needD)}, есть ${OGX.fmt.num(deut)}`);
        const load = ['metal', 'crystal', 'deuterium'].reduce((s, k) => s + ((req.cargo && +req.cargo[k]) || 0), 0);
        if (load > est.cargo) warnings.push(`Груз ${OGX.fmt.num(load)} больше вместимости ${OGX.fmt.num(est.cargo)}`);
      }
    } catch (e) { log.warn('pre-check failed', e); }
    let confirmNeeded = true;
    try { confirmNeeded = OGX.settings.get('core.confirmActions') !== false; } catch (e) { confirmNeeded = true; }
    if (confirmNeeded || warnings.length) {
      const shipsTxt = Object.entries(req.ships).filter(([, n]) => +n > 0).map(([id, n]) => `${OGX.catalog.shortName(+id)} ${OGX.fmt.num(+n)}`).join(', ');
      const body = OGX.dom.h('div', { class: 'ogx-confirm-text' },
        OGX.dom.h('div', null, `${OGX.catalog.missionName(+req.mission)} → ${OGX.fmt.coords(`${req.galaxy}:${req.system}:${req.position}`, +req.type || 1)}`),
        OGX.dom.h('div', null, `Корабли: ${shipsTxt}`),
        req.cargo ? OGX.dom.h('div', null, `Груз: ${OGX.fmt.res(req.cargo)}`) : null,
        OGX.dom.h('div', null, `Скорость: ${Math.round((+req.speed || 10) * 10)}%`),
        warnings.map((w) => OGX.dom.h('div', { class: 'ogx-warn-text' }, '⚠ ' + w)));
      const ok = await OGX.dom.confirm(body, { okLabel: 'Отправить', title: 'Отправка флота' });
      if (!ok) return { success: false, message: 'Отменено', cancelled: true };
    }
    // the origin is always named (cp): a refresh in this tab or another tab may have moved the server's selected planet
    const fromId = originId || cur.id || undefined;
    const send = () => (isGz() ? gz.dispatch(req, { cp: fromId, fit: true }) : OGX.api.sendFleet(req, { cp: fromId }));
    let res;
    try {
      res = originId && cur.id && originId !== cur.id ? await OGX.http.withPlanet(originId, send) : await send();
    } catch (e) {
      res = { success: false, message: String(e.message || e) };
    }
    OGX.bus.emit('fleet:sent', { request: req, response: res, ok: !!res.success, source: req.source || 'ogx' });
    if (res.success) {
      await applySentOf(fromId, req, res);
      OGX.safe(() => OGX.flights.invalidate(), 'fleet:invalidate')();
    }
    return { success: !!res.success, message: res.message || '' };
  };

  /** state.applySent for a successful own send: the request's ships (the server sends exactly those or refuses), the cargo
   * really posted (fit) and the step-2 consumption. */
  async function applySentOf(originId, req, res) {
    if (!originId || !OGX.state.applySent) return;
    try {
      const fit = res && res.fit;
      const consumption = fit && Number.isFinite(+fit.consumption) ? +fit.consumption : (res && res.result && +res.result.consumption) || 0;
      await OGX.state.applySent({ originId, ships: req.ships || {}, cargo: (res && res.cargo) || req.cargo || {}, consumption });
    } catch (e) { log.warn('applySent failed', e); }
  }

  /** Fills `room` with `avail` in `order`: 'dcm' (deuterium, crystal, metal; default), 'cmd', 'mcd' (2Moons maxResources()),
   * 'prop' (proportional to avail, the remainder in dcm order) or an array of resource names. Never more than avail[k]. */
  const FILL_ORDERS = { dcm: ['deuterium', 'crystal', 'metal'], cmd: ['crystal', 'metal', 'deuterium'], mcd: ['metal', 'crystal', 'deuterium'] };
  fleet.fillByOrder = function (avail, room, order = 'dcm') {
    const R = ['metal', 'crystal', 'deuterium'];
    const out = { metal: 0, crystal: 0, deuterium: 0 };
    const a = (k) => { const n = Math.floor(+(avail && avail[k]) || 0); return n > 0 ? n : 0; };
    let free = Math.max(0, Math.floor(+room || 0));
    if (order === 'prop') {
      const sum = R.reduce((x, k) => x + a(k), 0);
      if (sum > 0 && free > 0) {
        const share = Math.min(1, free / sum);
        for (const k of R) { out[k] = Math.min(a(k), Math.floor(a(k) * share)); }
        free -= R.reduce((x, k) => x + out[k], 0);
      }
      order = 'dcm';
    }
    const seq = Array.isArray(order) ? order : FILL_ORDERS[order] || FILL_ORDERS.dcm;
    for (const k of seq) {
      const n = Math.max(0, Math.min(a(k) - out[k], free));
      out[k] += n;
      free -= n;
    }
    return out;
  };

  const gapMs = () => { try { return +OGX.settings.get('core.httpGapMs') || 400; } catch (e) { return 400; } };
  const rec = (src, what, data) => { try { return OGX.log.rec(src, 'fleet', what, data); } catch (e) { return null; } };

  /** Sends several flights one after another (GALAXYZ: fleetStep1/2/3 POSTs with the room check, OgameX: api.sendFleet), each
   * POST naming its origin (cp), under ONE http.withPlanet (one restore at the end), core.httpGapMs between flights.
   * flights: [{ originId, galaxy, system, position, type, mission, ships, speed, cargo, order?, keepDeut?, keepRes?, key?, source? }].
   * Refuses unless confirmed === true (the caller showed its own dialog inside a click chain). Goes on after a clean, recognised
   * per-source refusal of step 1/2 (no ships, no slot, an info message, no room) and stops on signal.aborted, on 3 such refusals in a
   * row with the same key, and on the FIRST failure that is not one: any step-3 failure after its POST (the server may have accepted
   * the fleet: result.unknown = true unless the page was a recognised refusal), an HTTP error/status 0, an unrecognised page,
   * a logged-out session or an exception. -> { results, sent, failed, aborted, abortReason?, unknown, refused? } */
  fleet.sendBatch = async function (flights, { confirmed, signal, onEach } = {}) {
    const list = Array.isArray(flights) ? flights.filter(Boolean) : [];
    if (confirmed !== true) return { results: [], sent: 0, failed: 0, aborted: false, refused: true, message: 'Нет подтверждения пользователя' };
    const results = [];
    let sent = 0, failed = 0, aborted = false, lastKey = null, same = 0, abortReason = null, unknown = 0;
    if (!list.length) return { results, sent, failed, aborted, unknown };
    const one = async (f) => {
      const errs = validate(f);
      if (errs.length) return { success: false, step: 0, message: errs.join('; ') };
      try {
        return isGz() ? await gz.dispatch(f, { cp: f.originId, fit: true }) : await OGX.api.sendFleet(f, { cp: f.originId });
      } catch (e) { return { success: false, exception: true, message: String(e && e.message || e) }; }
    };
    const run = async () => {
      for (let i = 0; i < list.length; i++) {
        if (signal && signal.aborted) { aborted = true; break; }
        if (i > 0) {
          await OGX.util.sleep(gapMs());
          if (signal && signal.aborted) { aborted = true; break; }
        }
        const f = list[i];
        const t0 = Date.now();
        const res = (await one(f)) || { success: false, exception: true, message: 'нет ответа' };
        res.ms = Date.now() - t0;
        if (!res.message && !res.success) res.message = 'шаг ' + (res.step || '?') + ': неизвестная ошибка';
        results.push(res);
        const fit = res.fit || null;
        const r3 = res.result || {};
        rec('B', 'dispatch', { i, originId: f.originId, to: `${f.galaxy}:${f.system}:${f.position}:${+f.type || 1}`, ships: f.ships,
          cargoAsked: fit ? fit.asked : f.cargo || null, cargoSent: res.cargo || (fit ? fit.sent : null), clamped: fit ? fit.clamped : [],
          fleetroom: fit ? fit.fleetroom : null, consumption: fit ? fit.consumption : null, stock: fit ? fit.stock : null,
          ok: !!res.success, step: res.step || null, message: res.message || '', arrival: r3.arrival || null, back: r3.back || null,
          fleetId: r3.fleetId != null ? r3.fleetId : null, ms: res.ms });
        OGX.bus.emit('fleet:sent', { request: f, response: res, ok: !!res.success, source: f.source || 'ogx', via: 'batch', originId: f.originId });
        let fatal = null;
        if (res.success) { sent++; same = 0; lastKey = null; await applySentOf(f.originId, f, res); } else {
          failed++;
          fatal = batchFatal(res);
          if (fatal === 'step3' && res.kind !== 'refusal') {
            res.unknown = true;
            unknown++;
            res.message = 'неизвестно, проверьте флот: ' + res.message;
          }
          const key = failKey(res);
          same = key === lastKey ? same + 1 : 1;
          lastKey = key;
          if (!fatal && same >= 3) fatal = 'repeat';
        }
        if (onEach) OGX.safe(onEach, 'fleet:sendBatch:onEach')(i, res, f);
        if (fatal) {
          if (i < list.length - 1) { aborted = true; abortReason = fatal; }
          rec('B', 'batch:abort', { i, reason: fatal, step: res.step || null, status: res.status !== undefined ? res.status : null, message: res.message || '', left: list.length - 1 - i });
          break;
        }
      }
    };
    try {
      const cur = OGX.state.current() || {};
      if (list.some((f) => f.originId && f.originId !== cur.id)) await OGX.http.withPlanet(list[0].originId, run);
      else await run();
    } catch (e) {
      log.warn('sendBatch failed', e);
      aborted = true;
      abortReason = abortReason || 'exception';
      results.push({ success: false, message: String(e && e.message || e) });
    }
    if (sent || unknown) OGX.safe(() => OGX.flights.invalidate(), 'fleet:invalidate')();
    const out = { results, sent, failed, aborted, unknown };
    if (abortReason) out.abortReason = abortReason;
    return out;
  };
  /** null = a clean per-source refusal (the batch goes on), else why the batch must stop. */
  function batchFatal(res) {
    if (res.loggedOut || /logged out|csrf|сессия/i.test(String(res.message || ''))) return 'loggedOut';
    if (res.step === 0) return null;                                        // validation: nothing was POSTed
    if (res.exception) return 'exception';
    if (!res.step) return /^http\b/i.test(String(res.message || '')) ? 'http' : null;   // OgameX JSON answer: a refusal
    if (res.step === 3 && res.posted) return 'step3';
    if (res.kind === 'http' || (res.status !== undefined && res.status !== null && +res.status !== 200)) return 'http';
    if (res.kind === 'unrecognized') return 'unrecognized';
    return null;
  }
  /** Stable failure key for the «same failure in a row» guard (no byte counts or URLs). */
  function failKey(res) {
    const kind = res.kind || 'refusal';
    return (res.step || 0) + ':' + kind + (kind === 'refusal' ? ':' + String(res.message || '') : res.status !== undefined ? ':' + res.status : '');
  }
  fleet._batchFatal = batchFatal;


  // ------------------------------------------------------------------ GALAXYZ dispatch (fleet.md §2)
  const gz = (fleet.gz = fleet.gz || {});
  const int = (v) => Math.max(0, Math.floor(+v || 0));
  const speed10 = (v) => Math.max(1, Math.min(10, Math.round(+v || 10)));
  const fire = (el) => { for (const t of ['input', 'change', 'keyup']) el.dispatchEvent(new Event(t, { bubbles: true })); };

  /** Step 1 body = the fleetTable form: galaxy, system, planet, type, target_mission, ship<ID> (ships > 0 only). */
  gz.step1Form = function ({ galaxy, system, position, type = 1, mission = 0, ships }) {
    const f = { galaxy: +galaxy, system: +system, planet: +position, type: +type || 1, target_mission: +mission || 0 };
    for (const [id, n] of Object.entries(ships || {})) if (int(n) > 0) f['ship' + id] = int(n);
    return f;
  };
  /** Step 2 body = the fleetStep1 form: token (of the step-1 page), fleet_group, target_mission, galaxy, system, planet, type, speed (10 = 100 %).
   * Target fields default to the step-1 form values. step1 = parse.gz.fleetStep1(doc). */
  gz.step2Form = function (step1, { galaxy, system, position, type, mission, speed = 10, union } = {}) {
    if (!step1 || !step1.token) throw new Error('fleetStep2: no token from step 1');
    const t = step1.target || {};
    const pick = (v, d) => (v === undefined || v === null || v === '' ? d : +v);
    return {
      token: step1.token, fleet_group: pick(union, step1.fleetGroup || 0), target_mission: pick(mission, step1.targetMission || 0),
      galaxy: pick(galaxy, t.galaxy), system: pick(system, t.system), planet: pick(position, t.planet), type: pick(type, t.type || 1), speed: speed10(speed),
    };
  };
  /** Step 3 body = the fleetStep2 form: token, mission (must be one of the offered radios), metal, crystal, deuterium [, staytime].
   * staytime = the option whose hours match holdingtime (expedition hours = value / halt_speed), else the first option. */
  gz.step3Form = function (step2, { mission, cargo, holdingtime } = {}) {
    if (!step2 || !step2.token) throw new Error('fleetStep3: no token from step 2');
    if (!step2.missions.some((m) => m.id === +mission)) throw new Error('mission ' + mission + ' not offered (' + step2.missions.map((m) => m.id).join(',') + ')');
    const c = cargo || {};
    const f = { token: step2.token, mission: +mission, metal: int(c.metal), crystal: int(c.crystal), deuterium: int(c.deuterium) };
    // The step-2 form has <select name="staytime"> whenever Hold / DM / Expedition is among the OFFERED missions (Hold is offered
    // for every foreign planet), whatever mission is chosen [UPSTREAM page.fleetStep2.default.tpl:57-63, FleetFunctions::
    // GetAvailableMissions]: a browser then always submits it (first option by default), so the bot does the same.
    if (step2.stayOptions && step2.stayOptions.length) {
      const h = +holdingtime || 0;
      const opt = step2.stayOptions.find((o) => o.hours === h) || step2.stayOptions.find((o) => o.value === h) || step2.stayOptions[0];
      f.staytime = opt.value;
    }
    return f;
  };

  /** Step-3 result page -> { success, message, missionId, missionName, distance, maxSpeed, consumption, from, to,
   * arrival, back (ServerMs | null; the event box's stored times when it lists the fleet), fleetId?, ships: { id: n }, unknownShips? }. */
  gz.parseResult = function (doc) {
    if (typeof doc === 'string') doc = new DOMParser().parseFromString(doc, 'text/html');
    const r = OGX.parse.gz.fleetStep3(doc);
    if (!r.success) return { success: false, message: r.message || 'fleetStep3: no result' };
    const ships = {}, unknown = {};
    for (const [t, n] of Object.entries(r.ships || {})) { const id = OGX.catalog.idFromTitle(t); if (id) ships[id] = (ships[id] || 0) + n; else unknown[t] = n; }
    const out = Object.assign({}, r, { message: r.title || '', arrival: r.arrivalText ? OGX.time.parseGameDate(r.arrivalText) : null,
      back: r.returnText ? OGX.time.parseGameDate(r.returnText) : null, ships });
    if (Object.keys(unknown).length) out.unknownShips = unknown;
    // The result table prints arrival + one rounded leg as the return time; the server stores round(T + 2 d_raw), which can be
    // 1 s later (fleetStep3: table 10:30:54, event box 10:30:55). Take the stored times from this page's event box when it has the fleet.
    try {
      if (out.arrival !== null && OGX.flights && OGX.flights.parseGz) {
        const fl = OGX.flights.parseGz(doc, {});
        let best = null;
        for (const f of fl) {
          if (!f.own || f.returnFlight || f.fleetId === null || f.from !== r.from || f.to !== r.to) continue;
          const d = Math.abs(f.arrival - out.arrival);
          if (d <= 5000 && (!best || d < best.d)) best = { d, f };
        }
        if (best) {
          out.fleetId = best.f.fleetId;
          out.arrival = best.f.arrival;
          const ret = fl.find((f) => f.returnFlight && f.fleetId === best.f.fleetId);
          if (ret && Number.isFinite(ret.arrival)) out.back = ret.arrival;
        }
      }
    } catch (e) { /* keep the table times */ }
    return out;
  };

  /** Never-empty text of a failed step page: the info message, the first .mainRS text, the <title>, or a description. */
  function failText(r, step) {
    const doc = r && r.doc;
    try {
      if (doc) {
        const info = OGX.parse.gz.infoMessage(doc);
        if (info) return info;
        const main = doc.querySelector('.mainRS');
        const mt = main ? String(main.textContent || '').replace(/\s+/g, ' ').trim() : '';
        if (mt) return mt.slice(0, 200);
        const title = String(doc.title || '').trim();
        if (title) return title.slice(0, 200);
      }
    } catch (e) { /* fall through */ }
    const size = r && typeof r.text === 'string' ? r.text.length : r && r.doc && r.doc.documentElement ? r.doc.documentElement.outerHTML.length : 0;
    return 'шаг ' + step + ': страница не распознана (' + size + ' байт, ' + ((r && r.url) || '?') + ')';
  }
  gz._failText = failText;
  /** kind: 'http' (no page / status != 200 / logged out), 'refusal' (a recognised reason: the caller's message or the page's info
   * message), 'unrecognized' (a page with no known answer: .mainRS, <title> or the size fallback). */
  const stepFail = (step, message, extra) => {
    const r0 = extra && extra.r;
    let kind = extra && extra.kind;
    if (!kind) {
      if (r0 && (!r0.ok && r0.ok !== undefined || !r0.doc || r0.loggedOut)) kind = 'http';
      else if (message) kind = 'refusal';
      else if (r0) { let info = null; try { info = r0.doc ? OGX.parse.gz.infoMessage(r0.doc) : null; } catch (e) { info = null; } kind = info ? 'refusal' : 'unrecognized'; }
      else kind = 'refusal';
    }
    const m = message || (r0 ? failText(r0, step) : '') || 'шаг ' + step + ': неизвестная ошибка';
    const x = Object.assign({ kind }, extra || {});
    if (x.r) { x.url = x.url || x.r.url; x.status = x.r.status; if (x.r.loggedOut) x.loggedOut = true; delete x.r; }
    return Object.assign({ ok: false, success: false, step, message: m, errors: [{ message: m, error: step }] }, x);
  };
  gz._stepFail = stepFail;
  const post = (pageName, form, cp) => OGX.http.post(pageName, form, { cp, expect: 'doc' });
  /** POST fleetStep1 (ships + target) -> { ok, token, target, data, colonies, url } | failure. Never called by the core itself. */
  gz.step1 = async function (req, { cp } = {}) {
    const r = await post('fleetStep1', gz.step1Form(req), cp);
    if (!r.ok || !r.doc) return stepFail(1, r.error || (r.loggedOut ? 'logged out' : 'http ' + r.status), { r, kind: 'http' });
    const s = OGX.parse.gz.fleetStep1(r.doc);
    // no form: redirected to fleetTable (no ships, no free slot) or an info page
    if (!s || !s.token) {
      let msg = OGX.parse.gz.infoMessage(r.doc);
      if (!msg && (r.doc.querySelector('form[action*="page=fleetStep1"], #warning') || /page=fleetTable/i.test(String(r.url || '')))) {
        let ft = null;
        try { ft = OGX.parse.gz.fleetTable(r.doc); } catch (e) { ft = null; }
        if (ft && ft.noFreeSlots) msg = 'нет свободных слотов флота';
        else if (ft) msg = 'корабли не найдены на планете (их меньше, чем запрошено?)';
      }
      return stepFail(1, msg, { r });
    }
    const d = s.data || {};
    const ships = {};
    for (const [id, x] of Object.entries(d.ships || {})) ships[id] = +(x && x.amount) || 0;
    const room = { fleetroom: d.fleetroom !== undefined ? +d.fleetroom : null, ships };
    return Object.assign({ ok: true, step: 1, url: r.url, room }, s);
  };
  /** POST fleetStep2 (token, target, speed) -> { ok, token, missions, stayOptions, consumption, data } | failure. */
  gz.step2 = async function (step1, req, { cp } = {}) {
    let form;
    try { form = gz.step2Form(step1, req); } catch (e) { return stepFail(2, e.message); }
    const r = await post('fleetStep2', form, cp);
    if (!r.ok || !r.doc) return stepFail(2, r.error || (r.loggedOut ? 'logged out' : 'http ' + r.status), { r, kind: 'http' });
    const s = OGX.parse.gz.fleetStep2(r.doc);
    if (!s) return stepFail(2, null, { r });
    // the POST answer is a full page of the origin: its header stock is the stock now
    const d = s.data || {};
    const room = { fleetroom: d.fleetroom !== undefined ? +d.fleetroom : null, consumption: d.consumption !== undefined ? +d.consumption : (Number.isFinite(+s.consumption) ? +s.consumption : null) };
    // one token per dispatch: the step-2 form repeats the step-1 token [REAL fleetStep1/2.html]
    return Object.assign({ ok: true, step: 2, url: r.url }, s, { token: s.token || step1.token, stock: gz.stock(r.doc), room });
  };
  /** POST fleetStep3 (mission, cargo, staytime) -> parseResult(...) & { ok, step: 3 } | failure. */
  gz.step3 = async function (step2, req, { cp } = {}) {
    let form;
    try { form = gz.step3Form(step2, req); } catch (e) { return stepFail(3, e.message, { missions: (step2 && step2.missions || []).map((m) => m.id) }); }
    const r = await post('fleetStep3', form, cp);
    if (!r.ok || !r.doc) return stepFail(3, r.error || (r.loggedOut ? 'logged out' : 'http ' + r.status), { r, posted: true, kind: 'http' });
    const res = gz.parseResult(r.doc);
    if (!res.success) {
      let info = null;
      try { info = OGX.parse.gz.infoMessage(r.doc); } catch (e) { info = null; }
      return stepFail(3, res.message && res.message !== 'fleetStep3: no result' ? res.message : null, { r, posted: true, kind: info ? 'refusal' : 'unrecognized' });
    }
    return Object.assign({ ok: true, step: 3 }, res);
  };
  /** Cargo that fits the server's room (pure): stock clamp (deuterium minus the consumption, keepDeut and keepRes), then the room
   * fleetroom - consumption refilled in `order`, never above the asked amount. -> { asked, sent, clamped, free, fleetroom,
   * consumption, stock } | { error } when the fuel alone fills the fleet. [UPSTREAM 2Moons ShowFleetStep3Page: deuterium cargo <=
   * planet deuterium - consumption; cargo above fleetroom - consumption is refused] */
  gz.fitCargo = function ({ cargo, fleetroom, consumption, stock, order = 'dcm', keepDeut = 0, keepRes = null }) {
    const R = ['metal', 'crystal', 'deuterium'];
    const asked = {};
    for (const k of R) asked[k] = int(cargo && cargo[k]);
    const fr = +fleetroom, cons = Math.max(0, +consumption || 0);
    const free = Number.isFinite(fr) ? fr - cons : Infinity;
    const base = { asked, fleetroom: Number.isFinite(fr) ? fr : null, consumption: cons, stock: stock || null, free: Number.isFinite(free) ? free : null };
    if (free <= 0) return Object.assign(base, { error: 'Нет места: топливо больше вместимости', sent: { metal: 0, crystal: 0, deuterium: 0 }, clamped: R.filter((k) => asked[k] > 0) });
    const lim = {};
    for (const k of R) {
      const st = stock && stock[k] !== null && stock[k] !== undefined && Number.isFinite(+stock[k]) ? +stock[k] : Infinity;
      let v = st - int(keepRes && keepRes[k]);
      if (k === 'deuterium') v -= cons + int(keepDeut);
      lim[k] = Math.max(0, Math.min(asked[k], v));
    }
    const sent = fleet.fillByOrder(lim, Number.isFinite(free) ? free : R.reduce((x, k) => x + lim[k], 0), order);
    return Object.assign(base, { sent, clamped: R.filter((k) => sent[k] < asked[k]) });
  };

  /** Stores the cargo factor fleetroom / base cargo of `ships` (props cargo without officers) when it is plausible (1..10). */
  gz.measureCargo = async function (ships, fleetroom, { src = 'dispatch' } = {}) {
    let base = 0;
    for (const [id, n] of Object.entries(ships || {})) { try { base += OGX.calc.cargoCapacity(+id) * (+n || 0); } catch (e) { /* unknown id */ } }
    const fr = +fleetroom;
    if (!(base > 0) || !(fr > 0)) return null;
    const factor = Math.round(fr / base * 1e6) / 1e6;
    if (!(factor >= 1 && factor <= 10)) return null;
    // the Storage officer (607) level in effect now: a newer officier page drops the measurement only when that level changed
    let o607 = null;
    try { const p = await OGX.state.player(); if (p && p.officers && p.officers[607] !== undefined && p.officers[607] !== null) o607 = +p.officers[607] || 0; } catch (e) { o607 = null; }
    const m = { factor, t: OGX.time.serverNow(), ships, fleetroom: fr, src, o607 };
    try {
      const old = await OGX.storage.get('cargoMeasured', null);
      await OGX.storage.set('cargoMeasured', m);
      if (OGX.learn && OGX.learn.value) OGX.learn.value('fleet.cargoFactor', factor, { min: 1, max: 10 });
      rec('B', 'cargo:measured', { factor, fleetroom: fr, base, src });
      if (!old || old.factor !== factor) OGX.bus.emit('state:updated', { keys: ['shipStats'] });
    } catch (e) { log.warn('cargo measure failed', e); }
    return m;
  };

  /** The three steps in a row (SendFleetRequest) -> { success, step, message, errors, missions?, result?, fit?, cargo } (api.sendFleet
   * shape). fit (default false): between step 2 and step 3 the cargo is cut to the server's room and stock (gz.fitCargo with
   * req.order, req.keepDeut, req.keepRes); with no room at all step 3 is never POSTed. Only from a user click (fleet.send /
   * fleet.sendBatch) or an explicit bot setting. */
  gz.dispatch = async function (req, { cp, fit = false } = {}) {
    const s1 = await gz.step1(req, { cp });
    if (!s1.ok) return s1;
    if (s1.room && s1.room.fleetroom > 0) await gz.measureCargo(s1.room.ships && Object.keys(s1.room.ships).length ? s1.room.ships : req.ships, s1.room.fleetroom);
    const s2 = await gz.step2(s1, req, { cp });
    if (!s2.ok) return s2;
    let sendReq = req;
    let fitInfo = null;
    if (fit) {
      const fr = s2.room && Number.isFinite(s2.room.fleetroom) ? s2.room.fleetroom : s1.room ? s1.room.fleetroom : null;
      const cons = s2.room && Number.isFinite(s2.room.consumption) ? s2.room.consumption : 0;
      if (Number.isFinite(fr)) {
        fitInfo = gz.fitCargo({ cargo: req.cargo, fleetroom: fr, consumption: cons, stock: s2.stock, order: req.order || 'dcm', keepDeut: req.keepDeut, keepRes: req.keepRes });
        if (fitInfo.error) return stepFail(2, fitInfo.error, { fit: fitInfo });
        sendReq = Object.assign({}, req, { cargo: fitInfo.sent });
      }
    }
    const s3 = await gz.step3(s2, sendReq, { cp });
    if (!s3.ok) return Object.assign(s3, { fit: fitInfo, cargo: sendReq.cargo || null });
    return { success: true, step: 3, message: s3.message, errors: [], result: s3, fit: fitInfo, cargo: sendReq.cargo || null };
  };


  // ------------------------------------------------------------------ GALAXYZ dispatch forms on the open page (public DOM API)
  // The user's own dispatch pages: fleetTable (step 0: ships), fleetStep1 (target, speed), fleetStep2 (mission, cargo, stay time),
  // fleetStep3 (result). These helpers only fill the game's form fields and fire input/change/keyup (the game's inline handlers
  // updateVars()/calculateTransportCapacity() recompute their own numbers); they NEVER submit. Each returns { ok, step, ... } or
  // { ok: false, step, error } (error: 'step' = wrong page for this field, 'notOffered', 'noForm').
  const FORM_OF = { 0: 'page=fleetStep1', 1: 'page=fleetStep2', 2: 'page=fleetStep3' };
  const RES3 = ['metal', 'crystal', 'deuterium'];
  const toDocument = (doc) => (typeof doc === 'string' ? new DOMParser().parseFromString(doc, 'text/html') : doc || document);
  /** Which dispatch page `doc` is: 0 fleetTable, 1 fleetStep1, 2 fleetStep2, 3 fleetStep3 result, null = none. */
  gz.step = function (doc = document) {
    doc = toDocument(doc);
    for (const s of [0, 1, 2]) if (doc.querySelector('form[action*="' + FORM_OF[s] + '"]')) return s;
    return doc.querySelector('th.success') && OGX.parse.gz.fleetStep3(doc).success ? 3 : null;
  };
  const formOf = (step, doc = document) => doc.querySelector('form[action*="' + FORM_OF[step] + '"]');
  const wrong = (want, have) => ({ ok: false, step: have, error: 'step', message: 'Поле на другом шаге отправки (нужен шаг ' + want + ', открыт ' + (have === null ? '—' : have) + ')' });
  const setField = (el, v) => { if (!el) return false; el.value = String(v); fire(el); return true; };
  const numVal = (el) => { const n = parseInt(String(el && el.value || '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 0; };
  /** Planet stock shown in the header (#current_<res> data-real = what the game's maxResource uses), floored; null if absent. */
  gz.stock = function (doc = document) {
    const out = {};
    for (const k of RES3) {
      const el = toDocument(doc).getElementById('current_' + k);
      const v = el ? parseFloat(el.getAttribute('data-real')) : NaN;
      out[k] = Number.isFinite(v) ? Math.floor(v) : null;
    }
    return out;
  };

  // Ships of step 1 by its token: step 2 carries the same token but no ship list. Synchronous page-origin localStorage (one record,
  // the last step 1 seen; the token ties it to its own step 2), so gz.state() stays synchronous.
  const SHIPS_KEY = 'ogx:gzFleetShips';
  function rememberShips(token, ships) {
    if (!token || !ships || !Object.keys(ships).length) return;
    try { localStorage.setItem(SHIPS_KEY, JSON.stringify({ token, ships, t: Date.now() })); } catch (e) { /* storage blocked */ }
  }
  function rememberedShips(token) {
    if (!token) return null;
    try {
      const r = JSON.parse(localStorage.getItem(SHIPS_KEY) || 'null');
      return r && r.token === token && r.ships ? Object.assign({}, r.ships) : null;
    } catch (e) { return null; }
  }

  /** Snapshot of the dispatch page. -> { ok, step, page, token, ships: { id: n } (selected / in flight), available: { id: n } (step 0),
   * target: { galaxy, system, position, type }, mission (step 0 hidden target_mission, step 2 checked radio, step 3 result), missions: [{ id, name, checked }],
   * speed (1..10, step 1), distance, duration (s), consumption, capacity (data.fleetroom: cargo incl. officers), free (capacity - consumption - cargo),
   * cargo { metal, crystal, deuterium } (step 2), stayOptions, staytime, data (inline data=), result (step 3 parseResult),
   * step 2 also: fleetPoints (span#fleetPoints = expedition points), ships = the ships step 1 showed under the same token
   * (shipsSrc 'fleetStep1'; {} with shipsSrc null when that step 1 was not seen), compat lanedirt fields
   * shipsToSend, speedPercent, cargoMetal/Crystal/Deuterium, currentPage } | { ok: false, step: null, error: 'noForm' }. */
  gz.state = function (doc = document) {
    doc = toDocument(doc);
    const G = OGX.parse.gz;
    const step = gz.step(doc);
    if (step === null) return { ok: false, step: null, error: 'noForm' };
    const out = { ok: true, engine: 'galaxyz', step, page: ['fleetTable', 'fleetStep1', 'fleetStep2', 'fleetStep3'][step], token: null, ships: {}, available: null,
      target: null, mission: null, missions: null, speed: null, distance: null, duration: null, consumption: null, capacity: null, free: null,
      cargo: null, stayOptions: null, staytime: null, data: null, result: null };
    if (step === 0) {
      const ft = G.fleetTable(doc);
      const form = formOf(0, doc);
      out.available = {};
      for (const s of ft.ships) if (s.id) out.available[s.id] = s.count || 0;
      for (const inp of form.querySelectorAll('input[name^="ship"]')) {
        const m = /^ship(\d+)$/.exec(inp.name);
        if (m && numVal(inp) > 0) out.ships[m[1]] = numVal(inp);
      }
      const hv = (n) => { const e = form.querySelector('input[name="' + n + '"]'); return e ? +e.value || 0 : null; };
      out.target = { galaxy: hv('galaxy'), system: hv('system'), position: hv('planet'), type: hv('type') || 1 };
      out.mission = hv('target_mission') || null;
      out.slots = ft.slots; out.expeditions = ft.expeditions;
      let cap = 0;
      for (const [id, n] of Object.entries(out.ships)) { try { cap += OGX.calc.cargoCapacity(+id) * n; } catch (e) { /* unknown id */ } }
      out.capacityEstimate = Math.floor(cap);   // base cargo without officers; the server value appears on step 1 (data.fleetroom)
    } else if (step === 1) {
      const s1 = G.fleetStep1(doc);
      const form = formOf(1, doc);
      const d = s1.data || {};
      out.token = s1.token; out.data = s1.data;
      const v = (n) => { const e = form.querySelector('[name="' + n + '"]'); return e ? +e.value || 0 : null; };
      out.target = { galaxy: v('galaxy'), system: v('system'), position: v('planet'), type: v('type') || 1 };
      out.mission = s1.targetMission || null;
      out.speed = v('speed') || 10;
      for (const [id, s] of Object.entries(d.ships || {})) out.ships[id] = +s.amount || 0;
      out.capacity = d.fleetroom !== undefined ? +d.fleetroom : null;
      const p = d.planet;
      if (p && d.maxspeed > 0) {
        out.distance = gz.distance(`${p.galaxy}:${p.system}:${p.planet}`, `${out.target.galaxy}:${out.target.system}:${out.target.position}`);
        out.duration = gz.duration(d, out.distance, out.speed);
        out.consumption = gz.consumption(d, out.distance, out.duration);
        if (out.capacity !== null) out.free = out.capacity - out.consumption;
      }
      out.colonies = s1.colonies;
      if (doc === document) rememberShips(out.token, out.ships);
    } else if (step === 2) {
      const s2 = G.fleetStep2(doc);
      const form = formOf(2, doc);
      const d = s2.data || {};
      out.token = s2.token; out.data = s2.data; out.missions = s2.missions; out.stayOptions = s2.stayOptions;
      const checked = s2.missions.find((m) => m.checked);
      out.mission = checked ? checked.id : null;
      out.cargo = {};
      for (const k of RES3) out.cargo[k] = numVal(form.querySelector('input[name="' + k + '"]'));
      out.capacity = d.fleetroom !== undefined ? +d.fleetroom : null;
      out.consumption = d.consumption !== undefined ? +d.consumption : s2.consumption;
      if (out.capacity !== null) out.free = out.capacity - (out.consumption || 0) - RES3.reduce((a, k) => a + out.cargo[k], 0);
      const stay = form.querySelector('select[name="staytime"]');
      out.staytime = stay ? +stay.value : null;
      const h2 = doc.querySelector('#inhalt h2');
      out.origin = h2 ? OGX.util.coords(h2.textContent) : null;
      // span#fleetPoints = the 2Moons expedition points of the fleet (150 for 1 colony ship = calc.expeditionPoints)
      const fp = doc.querySelector('#fleetPoints');
      const fpv = fp ? OGX.util.parseGameNumber(fp.textContent.trim()) : NaN;
      out.fleetPoints = Number.isFinite(fpv) ? fpv : null;
      // step 2 lists no ships: the ones step 1 showed under the same token (remembered in this tab's sessionStorage)
      const known = rememberedShips(out.token);
      if (known) out.ships = known;
      out.shipsSrc = known ? 'fleetStep1' : null;
    } else {
      const r = gz.parseResult(doc);
      out.result = r; out.mission = r.missionId || null; out.ships = r.ships || {}; out.consumption = r.consumption;
      out.distance = r.distance;
      const t = OGX.util.coordsArr(r.to);
      out.target = t ? { galaxy: t[0], system: t[1], position: t[2], type: null } : null;
    }
    // lanedirt fleetDispatcher-shaped aliases (bridge 'fleet.state' callers)
    out.shipsToSend = out.ships; out.speedPercent = out.speed; out.currentPage = out.page;
    out.cargoMetal = out.cargo ? out.cargo.metal : null; out.cargoCrystal = out.cargo ? out.cargo.crystal : null; out.cargoDeuterium = out.cargo ? out.cargo.deuterium : null;
    out.targetPlanet = out.target;
    return out;
  };

  /** fleetTable: ship inputs. ships { id: n } (n > available -> clamped, reported in short); reset (default true) zeroes the others.
   * -> { ok, step: 0, ships: { id: n } as filled, short: [{ id, want, have }], capacityEstimate } */
  gz.fillShips = function (ships, { reset = true } = {}) {
    const step = gz.step();
    if (step !== 0) return wrong(0, step);
    const form = formOf(0);
    const ft = OGX.parse.gz.fleetTable(document);
    const have = (id) => (ft.ships.find((s) => s.id === +id) || {}).count || 0;
    const want = {};
    for (const [id, n] of Object.entries(ships || {})) if (int(n) > 0) want[+id] = int(n);
    const filled = {}, short = [];
    for (const inp of form.querySelectorAll('input[name^="ship"]')) {
      const m = /^ship(\d+)$/.exec(inp.name);
      if (!m) continue;
      const id = +m[1];
      if (want[id] === undefined) { if (reset && numVal(inp) !== 0) setField(inp, 0); continue; }
      const n = Math.min(want[id], have(id));
      setField(inp, n);
      if (n > 0) filled[id] = n;
      if (n < want[id]) short.push({ id, want: want[id], have: have(id) });
    }
    for (const id of Object.keys(want)) if (!form.querySelector('input[name="ship' + id + '"]')) short.push({ id: +id, want: want[id], have: 0 });
    return { ok: true, step: 0, ships: filled, short, capacityEstimate: gz.state().capacityEstimate };
  };
  /** fleetTable hidden target fields or fleetStep1 visible inputs. t = { galaxy, system, position, type }. */
  gz.setTarget = function (t) {
    const step = gz.step();
    if (step !== 0 && step !== 1) return wrong(1, step);
    if (!t) return { ok: false, step, error: 'target' };
    const form = formOf(step);
    const put = (n, v) => { if (v !== undefined && v !== null) setField(form.querySelector('[name="' + n + '"]'), +v); };
    put('galaxy', t.galaxy); put('system', t.system); put('planet', t.position !== undefined ? t.position : t.planet); put('type', t.type || 1);
    return { ok: true, step, target: gz.state().target };
  };
  /** fleetStep1 speed select: 1..10 (10 = 100 %). */
  gz.setSpeed = function (speed) {
    const step = gz.step();
    if (step !== 1) return wrong(1, step);
    const sel = formOf(1).querySelector('select[name="speed"]');
    if (!sel) return { ok: false, step, error: 'noForm' };
    setField(sel, speed10(speed));
    const st = gz.state();
    return { ok: true, step, speed: st.speed, duration: st.duration, consumption: st.consumption, free: st.free };
  };
  /** fleetStep2 mission radio (only offered ones), or the fleetTable hidden target_mission (the game may preselect it later). */
  gz.selectMission = function (mission) {
    const step = gz.step();
    if (step === 0) { setField(formOf(0).querySelector('input[name="target_mission"]'), +mission || 0); return { ok: true, step, mission: +mission || 0 }; }
    if (step !== 2) return wrong(2, step);
    const form = formOf(2);
    const radio = form.querySelector('input[type="radio"][name="mission"][value="' + (+mission) + '"]');
    const offered = Array.from(form.querySelectorAll('input[type="radio"][name="mission"]')).map((r) => +r.value);
    if (!radio) return { ok: false, step, error: 'notOffered', missions: offered, message: `Миссия «${OGX.catalog.missionName(+mission)}» недоступна для этой цели` };
    radio.checked = true;
    fire(radio);
    try { radio.dispatchEvent(new Event('click', { bubbles: true })); } catch (e) { /* ignore */ }
    return { ok: true, step, mission: +mission, missions: offered };
  };
  /** fleetStep2 cargo. res { metal, crystal, deuterium } (missing keys are left as they are; reset: true treats them as 0 and clears
   * them first). clamp (default true): each value is cut to the planet stock (deuterium minus the flight's consumption, like
   * maxResource) and to the free capacity, in the order metal, crystal, deuterium. -> { ok, step: 2, cargo, free, clamped: [res...] } */
  gz.fillCargo = function (res, { clamp = true, reset = false } = {}) {
    const step = gz.step();
    if (step !== 2) return wrong(2, step);
    const form = formOf(2);
    const st = gz.state();
    const stock = gz.stock();
    const clamped = [];
    const cargo = Object.assign({}, st.cargo);
    if (reset) {
      res = Object.assign({}, res || {});
      for (const k of RES3) {
        if (res[k] === undefined || res[k] === null) res[k] = 0;
        cargo[k] = 0;
      }
    }
    for (const k of RES3) {
      if (!res || res[k] === undefined || res[k] === null) continue;
      let v = int(res[k]);
      if (clamp) {
        const used = RES3.filter((x) => x !== k).reduce((a, x) => a + cargo[x], 0);
        const room = st.capacity === null ? Infinity : Math.max(0, st.capacity - (st.consumption || 0) - used);
        let have = stock[k] === null ? Infinity : stock[k];
        if (k === 'deuterium' && Number.isFinite(have)) have = Math.max(0, have - (st.consumption || 0));
        const c = Math.min(v, room, have);
        if (c < v) { clamped.push(k); v = c; }
      }
      cargo[k] = v;
      setField(form.querySelector('input[name="' + k + '"]'), v);
    }
    const after = gz.state();
    return { ok: true, step, cargo: after.cargo, free: after.free, clamped };
  };
  /** fleetStep2: load as much as fits, like the game's maxResources() (metal, then crystal, then deuterium, or `order`). */
  gz.maxCargo = function ({ order = RES3 } = {}) {
    const step = gz.step();
    if (step !== 2) return wrong(2, step);
    for (const k of order) gz.fillCargo({ [k]: Number.MAX_SAFE_INTEGER });
    const after = gz.state();
    return { ok: true, step, cargo: after.cargo, free: after.free };
  };
  /** fleetStep2 stay time select (Hold, Expedition, DM expedition): the option whose hours match, else the option value. */
  gz.setStaytime = function (hours) {
    const step = gz.step();
    if (step !== 2) return wrong(2, step);
    const sel = formOf(2).querySelector('select[name="staytime"]');
    if (!sel) return { ok: false, step, error: 'noStaytime' };
    const opts = OGX.parse.gz.fleetStep2(document).stayOptions;
    const o = opts.find((x) => x.hours === +hours) || opts.find((x) => x.value === +hours);
    if (!o) return { ok: false, step, error: 'staytime', options: opts };
    setField(sel, o.value);
    return { ok: true, step, staytime: o.value, hours: o.hours };
  };

  /** Bridge methods 'fleet.*' on GALAXYZ (OGX.bridge.call routes them here; the MAIN-world hook has no fleetDispatcher on GALAXYZ).
   * Same names and arguments as the lanedirt ones; results are the GALAXYZ shapes above. goStep/submit never act (full page loads, user click). */
  gz.bridge = {
    'fleet.state': () => gz.state(),
    'fleet.selectShips': (ships) => gz.fillShips(ships),
    'fleet.setTarget': (t) => gz.setTarget(t),
    'fleet.selectMission': (m) => gz.selectMission(m),
    'fleet.setCargo': (c) => gz.fillCargo(c),
    'fleet.setSpeed': (s) => gz.setSpeed(s),
    'fleet.setDuration': (h) => gz.setStaytime(h),
    'fleet.goStep': () => ({ ok: false, error: 'manual', message: 'GALAXYZ: шаги отправки — отдельные страницы, нажмите «Далее» сами' }),
    'fleet.submit': () => ({ ok: false, error: 'manual', message: 'Отправка только по нажатию пользователя' }),
  };

  // ------------------------------------------------------------------ GALAXYZ flight math (fleet.md §4, verified on the real pages)
  /** No circular galaxies/systems. a, b = 'g:s:p'. */
  gz.distance = function (a, b) {
    const x = OGX.util.coordsArr(a), y = OGX.util.coordsArr(b);
    if (!x || !y) return null;
    if (x[0] !== y[0]) return Math.abs(x[0] - y[0]) * 20000;
    if (x[1] !== y[1]) return Math.abs(x[1] - y[1]) * 95 + 2700;
    if (x[2] !== y[2]) return Math.abs(x[2] - y[2]) * 5 + 1000;
    return 5;
  };
  /** fleetStep1 `data` shape: { gamespeed, fleetspeedfactor, maxspeed, ships: { id: { speed, consumption, amount } }, fleetMinDuration }. */
  /** Unrounded one-way seconds (FleetFunctions::GetMissionDuration [UPSTREAM]). The server stores arrival = round(T + d) and
   * return = round(T + 2 d + hold), so the return time must be derived from this value, not from 2 x round(d). */
  gz.durationRaw = function (data, distance, speed = 10) {
    if (!(data.maxspeed > 0)) return Infinity;
    const sec = (3500 / (speed10(speed) * 0.1) * Math.sqrt(distance * 10 / data.maxspeed) + 10) / (data.gamespeed || 1) * (data.fleetspeedfactor || 1);
    return Math.max(sec, data.fleetMinDuration || 5);
  };
  gz.duration = function (data, distance, speed = 10) {
    if (!(data.maxspeed > 0)) return Infinity;
    const sec = Math.round((3500 / (speed10(speed) * 0.1) * Math.sqrt(distance * 10 / data.maxspeed) + 10) / (data.gamespeed || 1)) * (data.fleetspeedfactor || 1);
    return Math.max(sec, data.fleetMinDuration || 5);
  };
  gz.consumption = function (data, distance, sec) {
    let c = 0;
    for (const s of Object.values(data.ships || {})) {
      if (!(+s.speed > 0)) continue;
      const spd = 35000 / (sec * (data.gamespeed || 1) - 10) * Math.sqrt(distance * 10 / +s.speed);
      c += +s.consumption * +s.amount * distance / 35000 * (spd / 10 + 1) ** 2;
    }
    return Math.round(c) + 1;
  };
  /** ships + ship stats + stored game speed (+ calc.factors of the player: FlyTime 613 General / 707 boost) -> the fleetStep1 `data`
   * shape (approximation until the page's own data is seen). fleetspeedfactor = max(0, 1 + FlyTime) [UPSTREAM ShowFleetStep1Page]. */
  gz.dataFor = function (ships, stats, server = {}, factors = null) {
    const fly = factors && Number.isFinite(+factors.FlyTime) ? Math.max(0, 1 + +factors.FlyTime) : 1;
    const d = { gamespeed: +server.fleetSpeed || 1, fleetspeedfactor: fly, fleetMinDuration: 5, ships: {}, maxspeed: 0 };
    let min = Infinity;
    for (const [id, n] of Object.entries(ships || {})) {
      if (!(+n > 0)) continue;
      const st = (stats && stats[id]) || {};
      d.ships[id] = { speed: +st.speed || 0, consumption: +(st.fuel ?? st.fuelConsumption) || 0, amount: +n };
      if (+st.speed > 0) min = Math.min(min, +st.speed);
    }
    d.maxspeed = Number.isFinite(min) ? min : 0;
    return d;
  };
  async function estimateGz({ from, to, ships, speedPct = 10, holdingHours = 0, data }) {
    const [server, stats, factors] = await Promise.all([OGX.state.server(), OGX.state.shipStats(), OGX.state.factors ? OGX.state.factors() : null]);
    const d = data || gz.dataFor(ships, stats, server, factors);
    const distance = gz.distance(from, to);
    const duration = distance === null ? Infinity : gz.duration(d, distance, speedPct);
    const durationRaw = distance === null ? Infinity : gz.durationRaw(d, distance, speedPct);
    const fuel = Number.isFinite(duration) ? gz.consumption(d, distance, duration) : 0;   // holding costs no extra fuel here
    const now = OGX.time.serverNow();
    return {
      distance, duration, maxSpeed: d.maxspeed, speedFactor: d.gamespeed, fuelClient: fuel, fuelServer: fuel, fuelBudget: fuel,
      cargo: OGX.calc.fleetCargo(ships, stats),
      arrival: Number.isFinite(duration) ? now + duration * 1000 : null,
      back: Number.isFinite(durationRaw) ? now + Math.round(2 * durationRaw + holdingHours * 3600) * 1000 : null,
      gameSpeedKnown: !!server.fleetSpeedKnown,
    };
  }
  fleet._estimateGz = estimateGz;

  // ------------------------------------------------------------------ fleet status, recall
  /** Slots, ships on the body, speeds, bonus and own flights from page=fleetTable: this page when it is fleetTable, else one GET
   * (bodyId other than the current body -> http.withPlanet). -> { slots, expeditions, extraCounters, ships: { id: n }, speeds: { id: v },
   * bonus, flights (movement rows), t } | { error }. GALAXYZ only. merge: true stores a fetched page through state.merge. */
  fleet.status = async function ({ bodyId, background = false, merge = false } = {}) {
    if (!isGz()) return { error: 'unsupported', unsupported: true };
    const cur = OGX.state.current() || {};
    let doc = null;
    const raw = String(OGX.page.info().raw || '').toLowerCase();
    if (raw === 'fleettable' && (!bodyId || bodyId === cur.id)) doc = document;
    else {
      const get = (cp) => OGX.http.get('fleetTable', { expect: 'doc', background, cp });
      const r = bodyId && bodyId !== cur.id ? await OGX.http.withPlanet(bodyId, get) : await get();
      if (!r.ok || !r.doc) return { error: r.error || 'http ' + r.status, status: r.status, loggedOut: r.loggedOut };
      doc = r.doc;
      // merge: store the fetched page (slots, ships of the body it shows) like a page the user opened
      if (merge) {
        try {
          const snap = OGX.state.snapshotSync(doc, 'fleet');
          const wall = snap.serverTimeString ? OGX.time.parseServerWall(snap.serverTimeString) : null;
          await OGX.state.merge(snap, { t: wall || OGX.time.serverNow() });
        } catch (e) { log.warn('status merge failed', e); }
      }
    }
    const ft = OGX.parse.gz.fleetTable(doc);
    const ships = {}, speeds = {};
    for (const s of ft.ships) if (s.id) { ships[s.id] = s.count || 0; if (s.speed) speeds[s.id] = s.speed; }
    return { slots: ft.slots, expeditions: ft.expeditions, extraCounters: ft.extraCounters, ships, speeds, bonus: ft.bonus,
      flights: OGX.flights.parseMovement(doc, { bodies: await OGX.state.bodies(), titles: await OGX.state.titles() }), t: OGX.time.serverNow() };
  };

  /** Recall (GALAXYZ: POST fleetTable&action=sendfleetback fleetID; OgameX: recall-fleet). Must be called from a user click;
   * confirms when core.confirmActions unless { confirm: false }. -> { success, message, cancelled? } */
  fleet.recall = async function (fleetId, { confirm } = {}) {
    if (!(+fleetId > 0)) return { success: false, message: 'Нет id флота' };
    let ask = confirm;
    if (ask === undefined) { try { ask = OGX.settings.get('core.confirmActions') !== false; } catch (e) { ask = true; } }
    if (ask) {
      const ok = await OGX.dom.confirm(`Отозвать флот ${fleetId}?`, { okLabel: 'Отозвать', title: 'Отзыв флота', danger: true });
      if (!ok) return { success: false, message: 'Отменено', cancelled: true };
    }
    let r;
    try { r = await OGX.api.recall(+fleetId); } catch (e) { r = { success: false, message: String(e.message || e) }; }
    OGX.bus.emit('fleet:recalled', { fleetId: +fleetId, ok: !!r.success });
    let flightsUpdated = false;
    if (r.doc && isGz()) {
      // GALAXYZ: the POST answers with the full fleetTable page: store its event box (flights:updated), no second GET needed
      let stored = null;
      try { stored = await OGX.flights._storeFromDoc(r.doc, 'recall'); } catch (e) { log.warn('recall: store flights', e); }
      flightsUpdated = !!stored;
      if (!stored && r.success) OGX.safe(() => OGX.flights.invalidate(), 'fleet:invalidate')();
    } else if (r.success) OGX.safe(() => OGX.flights.invalidate(), 'fleet:invalidate')();
    return { success: !!r.success, message: r.message || (r.success ? '' : 'Флот не отозван'), flightsUpdated };
  };

  // ------------------------------------------------------------------ prefill
  fleet.prefill = fleet.prefill || {};
  fleet.prefill.open = async function (spec) {
    if (!spec || !spec.target) throw new Error('OGX.fleet.prefill.open: target required');
    await OGX.storage.set('prefill', { spec, expires: Date.now() + PREFILL_MS, t: OGX.time.serverNow() });
    await OGX.storage.flush();
    const t = spec.target;
    OGX.page.go('/fleet', { cp: spec.originId || undefined, galaxy: t.galaxy, system: t.system, position: t.position, type: t.type || 1, mission: spec.mission });
  };
  /** Drops a pending prefill (walk stop / reset, collect target change, batch send). */
  fleet.prefill.clear = async function (why) {
    const had = await OGX.storage.get('prefill', null);
    await OGX.storage.remove('prefill');
    if (had) rec('B', 'prefill:clear', { why: why || null });
    return !!had;
  };

  /** Label of the dispatch form's own submit button («Continue», «Отправить», ... - Lang dependent), with a neutral fallback. */
  function submitLabel(step) {
    const form = formOf(step);
    const b = form && form.querySelector('input[type="submit"], button[type="submit"]');
    const v = b ? String(b.value || b.textContent || '').trim() : '';
    return v || (step === 2 ? 'Отправить' : 'Далее');
  }
  fleet._submitLabel = submitLabel;

  function banner(text, extra) {
    const old = document.getElementById('ogx-fleet-prefill');
    if (old) old.remove();
    const el = OGX.dom.h('div', { id: 'ogx-fleet-prefill', class: 'ogx-root ogx-banner', role: 'status' }, text, extra || null,
      OGX.dom.h('button', { class: 'ogx-btn ogx-btn-icon', title: 'Закрыть', onClick: () => el.remove() }, OGX.dom.icon('close')));
    const host = document.getElementById('fleetdispatchcomponent') || document.getElementById('inhalt') || document.body;
    host.insertBefore(el, host.firstChild);
    return el;
  }
  fleet._banner = banner;

  /** Origin of a pending prefill is not the open body: a banner with a button to the right planet (the record is kept). */
  async function mismatchBanner(spec, cur) {
    const bodies = await OGX.state.bodies().catch(() => ({}));
    const label = (id) => { const b = Object.values(bodies || {}).find((x) => x.id === id); return b ? `${b.name || '?'} ${OGX.fmt.coords(b.coords, b.type === 'moon' ? 3 : 1)}` : String(id); };
    const want = spec.originId, have = cur ? cur.id : null;
    rec('B', 'prefill:mismatch', { want, have });
    const t = spec.target || {};
    const go = OGX.dom.h('button', { class: 'ogx-btn ogx-btn-primary', 'data-ogx-act': 'fleet:prefill-go',
      onClick: () => OGX.page.go('/fleet', { cp: want, galaxy: t.galaxy, system: t.system, position: t.position, type: t.type || 1, mission: spec.mission }) }, 'Перейти на ' + label(want));
    banner('Флот подготовлен для «' + label(want) + '», а открыта «' + (have ? label(have) : '?') + '». ', go);
  }


  /** GALAXYZ: fleetTable (ships), fleetStep1 (speed), fleetStep2 (mission, cargo, stay time). Never submits; the record follows the
   * dispatch by stage and the step-1 token and is removed after step 2 (or on a mismatch / expiry). */
  async function initPrefillGz() {
    const rec = await OGX.storage.get('prefill', null);
    if (!rec || !rec.spec) return;
    if (!(rec.expires > Date.now())) { await OGX.storage.remove('prefill'); return; }
    const spec = rec.spec, t = spec.target, G = OGX.parse.gz;
    const step = OGX.page.info().step || 0;
    const sameTarget = (x) => x && +x.galaxy === +t.galaxy && +x.system === +t.system && +x.planet === +t.position && (+x.type || 1) === (+t.type || 1);
    const next = (patch) => OGX.storage.set('prefill', Object.assign({}, rec, patch, { expires: Date.now() + PREFILL_MS }));
    if (step === 0) {
      const ft = G.fleetTable(document);
      if (!ft.prefill || !sameTarget(ft.prefill)) return;
      const cur = OGX.state.current();
      if (spec.originId && cur && cur.id !== spec.originId) { log.warn('prefill origin mismatch', spec.originId, cur && cur.id); await mismatchBanner(spec, cur); return; }
      const r = gz.fillShips(spec.ships || {}, { reset: false });
      const missing = (r.short || []).map((x) => (x.have ? `${OGX.catalog.shortName(x.id)} ${OGX.fmt.num(x.have)}/${OGX.fmt.num(x.want)}` : OGX.catalog.shortName(x.id)));
      await next({ stage: 1 });
      banner('Флот подготовлен' + (spec.note ? ': ' + spec.note : '') + (missing.length ? '. Не хватает: ' + missing.join(', ') : '') + '. Проверьте и нажмите «' + submitLabel(0) + '».');
    } else if (step === 1 && rec.stage === 1) {
      const s1 = G.fleetStep1(document);
      if (!s1 || !sameTarget(s1.target)) { await OGX.storage.remove('prefill'); return; }
      if (spec.speed) gz.setSpeed(spec.speed);
      await next({ stage: 2, token: s1.token });
      banner('Цель и скорость подготовлены. Проверьте и нажмите «' + submitLabel(1) + '».');
    } else if (step === 2 && rec.stage === 2) {
      const s2 = G.fleetStep2(document);
      await OGX.storage.remove('prefill');
      if (!s2 || s2.token !== rec.token) return;
      const m = spec.mission ? gz.selectMission(spec.mission) : null;
      if (spec.cargo) gz.fillCargo(spec.cargo);
      if (spec.holdingHours) gz.setStaytime(spec.holdingHours);
      banner(m && !m.ok ? `Миссия «${OGX.catalog.missionName(+spec.mission)}» недоступна для этой цели.` : 'Миссия и груз подготовлены. Проверьте и нажмите «' + submitLabel(2) + '».');
    }
  }

  // ------------------------------------------------------------------ game-sourced sends (GALAXYZ)
  /** fleet:sent payload of a fleetStep3 result page the USER submitted (source 'game', via 'fleetStep3'):
   * { request: { mission, galaxy, system, position, type: null, ships }, response: parseResult, ok: true, source: 'game', via: 'fleetStep3',
   *   mission, from, to, ships: { id: n }, consumption, distance, arrival, back (ServerMs | null), fleetId (from the event box | null) } | null */
  gz.sentEvent = function (doc = document) {
    const r = gz.parseResult(doc);
    if (!r.success) return null;
    const t = OGX.util.coordsObj(r.to) || {};
    const fleetId = r.fleetId != null ? r.fleetId : null;   // parseResult matched the event box
    return { request: { mission: r.missionId, galaxy: t.galaxy || null, system: t.system || null, position: t.position || null, type: null, ships: r.ships },
      response: r, ok: true, source: 'game', via: 'fleetStep3', mission: r.missionId, from: r.from, to: r.to, ships: r.ships,
      consumption: r.consumption, distance: r.distance, arrival: r.arrival, back: r.back, fleetId };
  };
  let step3Done = false;
  function initGameSendGz() {
    if (step3Done || gz.step() !== 3) return;
    step3Done = true;
    const ev = gz.sentEvent(document);
    if (!ev) return;
    // once per result page (a reload/back to the same result must not count twice)
    const key = 'ogx:fleetStep3:' + [ev.from, ev.to, ev.arrival, ev.mission].join('|');
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { /* storage blocked: emit anyway */ }
    const emit = () => OGX.bus.emit('fleet:sent', ev);
    // own send by the game's form: the origin body loses the ships and a slot (optimistic until the next page read). The result
    // page's header was rendered after the server took the cargo and the fuel [UPSTREAM 2Moons ShowFleetStep3Page] and boot has
    // merged it already, so no resource is subtracted here (it would count the fuel twice).
    OGX.safe(async () => {
      const bodies = await OGX.state.bodies();
      const cur = OGX.state.current() || {};
      const origin = Object.values(bodies || {}).find((b) => b.coords === ev.from && (cur.coords !== ev.from || b.id === cur.id));
      if (origin && OGX.state.applySent) await OGX.state.applySent({ originId: origin.id, ships: ev.ships || {}, cargo: {}, consumption: 0 });
    }, 'fleet:step3:applySent')();
    // boot emits 'ready' after the modules' init: subscribers registered there get the event
    if (document.documentElement.getAttribute('data-ogx-' + OGX.ext) === 'ready') emit(); else OGX.bus.once('ready', emit);
  }
  fleet._initGameSendGz = () => { step3Done = false; initGameSendGz(); };

  /** Called by boot on every page; acts only on /fleet with a matching, unexpired prefill. Never submits. */
  fleet.initPrefill = async function () {
    if (!OGX.page.is('fleet')) return;
    if (isGz()) {
      OGX.safe(initGameSendGz, 'fleet:step3')();
      if (gz.step() === 1) {
        const st1 = OGX.safe(() => gz.state(document), 'fleet:step1Ships')();   // remembers the step-1 ships for step 2
        if (st1 && st1.capacity > 0) await OGX.safe(() => gz.measureCargo(st1.ships, st1.capacity, { src: 'fleetStep1' }), 'fleet:measure')();
      }
      return initPrefillGz();
    }
    const rec = await OGX.storage.get('prefill', null);
    if (!rec || !rec.spec) return;
    if (!(rec.expires > Date.now())) { await OGX.storage.remove('prefill'); return; }
    const spec = rec.spec;
    const q = OGX.page.info().query;
    const t = spec.target;
    if (+q.get('galaxy') !== +t.galaxy || +q.get('system') !== +t.system || +q.get('position') !== +t.position) return;
    const cur = OGX.state.current();
    if (spec.originId && cur && cur.id !== spec.originId) { log.warn('prefill origin mismatch', spec.originId, cur && cur.id); await mismatchBanner(spec, cur); return; }
    await OGX.storage.remove('prefill');
    const box = await OGX.dom.waitFor('#fleet1', { timeout: 10000 });
    if (!box) return;
    const B = OGX.bridge;
    try {
      await B.call('fleet.selectShips', spec.ships || {});
      await B.call('fleet.setTarget', { galaxy: t.galaxy, system: t.system, position: t.position, type: t.type || 1 });
      if (spec.mission) await B.call('fleet.selectMission', spec.mission);
      await B.call('fleet.goStep', 2);
      if (spec.cargo) await B.call('fleet.setCargo', spec.cargo);
      if (spec.speed) await B.call('fleet.setSpeed', spec.speed);
      if (spec.holdingHours) await B.call('fleet.setDuration', spec.holdingHours);
      banner('Флот подготовлен' + (spec.note ? ': ' + spec.note : '') + '. Проверьте и нажмите «Отправить».');
    } catch (e) {
      log.warn('prefill failed', e.message || e);
      banner('Не удалось подготовить флот автоматически. Выберите корабли вручную.');
    }
  };
})(window.OGX);
