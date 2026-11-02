/* shared/core/15-flights.js — event list / movement parsing, flight cache, in-flight resources, arrival projection.
 * Owner: core. Store key: flights (player scope) = { t: ServerMs, flights: Flight[], src: 'eventlist'|'movement'|'game'|'page' }.
 * Synthetic event-list ids: hold end = mission id + 888888, return = mission id + 999999 (fleet.md §9.3).
 * GALAXYZ (specs/galaxyz/fleet.md §1.2, §6): the event box of every full page (parse.gz.events) is the list; the outward,
 * holding and return legs are separate events with the same fleet id, so there are no synthetic return rows (a 'holding'
 * event is marked synthetic 'holdEnd'). page=fleetTable adds the recall ids and the flights the box skips (Deploy outward). */
(function (OGX) {
  'use strict';
  const flights = (OGX.flights = OGX.flights || {});
  const log = OGX.log.create('flights');
  const HOSTILE = [1, 2, 6, 9, 10];

  const coords = (s) => OGX.util.coords(s);
  const num = (s) => OGX.util.parseGameNumberEx(String(s || '').trim());
  const isGz = () => !!(OGX.page && OGX.page.isGz && OGX.page.isGz());
  const toDoc = (d) => (typeof d === 'string' ? new DOMParser().parseFromString(d, 'text/html') : d);
  const isGzDoc = (d) => !!(d && OGX.parse.gz && OGX.parse.gz.is(d));

  /** Fleet tooltip HTML -> { shipsByTitle, cargo: Res & { approx } } (the LAST three td.value are M/C/D). */
  function parseFleetTooltip(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const vals = Array.from(doc.querySelectorAll('table.fleetinfo td.value'));
    const out = { shipsByTitle: {}, cargo: { metal: 0, crystal: 0, deuterium: 0, approx: false } };
    if (vals.length >= 3) {
      const [m, c, d] = vals.slice(-3).map((td) => num(td.textContent));
      out.cargo = { metal: m.value, crystal: c.value, deuterium: d.value, approx: m.approx || c.approx || d.approx };
    }
    for (const td of vals.slice(0, Math.max(0, vals.length - 3))) {
      const label = td.previousElementSibling ? td.previousElementSibling.textContent.replace(/:\s*$/, '').trim() : '';
      if (label) out.shipsByTitle[label] = num(td.textContent).value;
    }
    return out;
  }
  flights._parseFleetTooltip = parseFleetTooltip;

  function shipsFromTitles(byTitle, titles) {
    const ships = {};
    const unknown = {};
    for (const [t, n] of Object.entries(byTitle || {})) {
      let id = titles && titles[t] !== undefined ? +titles[t] : null;
      if (!id) id = OGX.catalog.idFromTitle(t);
      if (id) ships[id] = (ships[id] || 0) + n; else unknown[t] = n;
    }
    return { ships, unknown };
  }

  /** Own body lookup: coords + type (1 planet, 3 moon) -> BodyKey. */
  function bodyIndex(bodies) {
    const idx = new Map();
    for (const b of Object.values(bodies || {})) {
      if (!b || !b.coords) continue;
      idx.set(b.coords + '#' + (b.type === 'moon' ? 3 : 1), b.key);
    }
    return idx;
  }
  const keyFor = (idx, c, type) => (c && (type === 1 || type === 3) ? idx.get(c + '#' + type) || null : null);
  function ownSet(opts) {
    if (opts.ownCoords) return opts.ownCoords instanceof Set ? opts.ownCoords : new Set(opts.ownCoords);
    const s = new Set();
    for (const b of Object.values(opts.bodies || {})) if (b && b.coords) s.add(b.coords);
    return s;
  }

  /** Event list HTML -> Flight[] (fleet.md §12.2). */
  flights.parseEventList = function (html, opts = {}) {
    const doc = typeof html === 'string' ? new DOMParser().parseFromString(html, 'text/html') : html;
    if (isGzDoc(doc)) return flights.parseGz(doc, opts);
    const rows = Array.from(doc.querySelectorAll('#eventContent > tbody > tr.eventFleet:not(.partnerInfo)'));
    const ids = new Set(rows.map((tr) => tr.id.replace('eventRow-', '')));
    const own = ownSet(opts);
    const idx = bodyIndex(opts.bodies);
    const out = rows.map((tr) => {
      const rawId = tr.id.replace('eventRow-', '');
      const isUnion = rawId.startsWith('union');
      const id = isUnion ? null : parseInt(rawId, 10);
      const ret = tr.dataset.returnFlight === 'true';
      const recall = tr.querySelector('a.recallFleet');
      let realMissionId = recall ? +recall.dataset.fleetId : id;
      let synthetic = null;
      if (!isUnion && ret && id > 999999 && (ids.has(String(id - 999999)) || ids.has(String(id - 999999 + 888888)))) { synthetic = 'return'; realMissionId = id - 999999; }
      else if (!isUnion && !ret && id > 888888 && ids.has(String(id - 888888 + 999999))) { synthetic = 'holdEnd'; realMissionId = id - 888888; }
      const txt = (sel) => { const e = tr.querySelector(sel); return e ? e.textContent : ''; };
      const type = (sel) => {
        const f = tr.querySelector(sel + ' figure.planetIcon');
        if (f) return f.classList.contains('moon') ? 3 : f.classList.contains('tf') ? 2 : 1;
        return tr.querySelector(sel + ' .deep-space-text') ? 4 : null;
      };
      const left = coords(txt('td.coordsOrigin a'));
      const right = coords(txt('td.destCoords a'));
      const tipEl = tr.querySelector('td.icon_movement > span[title], td.icon_movement_reserve > span[title]');
      const tip = tipEl ? parseFleetTooltip(tipEl.getAttribute('title')) : { shipsByTitle: {}, cargo: { metal: 0, crystal: 0, deuterium: 0, approx: false } };
      const { ships, unknown } = shipsFromTitles(tip.shipsByTitle, opts.titles);
      const missionType = +tr.dataset.missionType;
      const isOwn = own.has(left);
      const from = ret ? right : left;
      const to = ret ? left : right;
      const fromType = ret ? type('td.destFleet') : type('td.originFleet');
      const toType = ret ? type('td.originFleet') : type('td.destFleet');
      return {
        rowId: isUnion ? rawId : id, realMissionId, synthetic, isUnion, missionType, returnFlight: ret,
        arrival: (+tr.dataset.arrivalTime) * 1000,
        from, fromType, to, toType,
        originKey: keyFor(idx, from, fromType), destKey: keyFor(idx, to, toType),
        units: parseInt(txt('td.detailsFleet span'), 10) || 0,
        ships, unknownShips: Object.keys(unknown).length ? unknown : undefined,
        cargo: tip.cargo, recallable: !!recall, own: isOwn,
        status: isOwn ? 'friendly' : HOSTILE.includes(missionType) ? 'hostile' : 'neutral',
        departure: null,
      };
    });
    fillDepartures(out);
    return out;
  };

  /** departure = outbound arrival - one-way time, where one-way = synthetic return arrival - (hold end or outbound arrival). */
  function fillDepartures(list) {
    const by = new Map();
    for (const f of list) {
      if (f.realMissionId === null || f.realMissionId === undefined) continue;
      if (!by.has(f.realMissionId)) by.set(f.realMissionId, []);
      by.get(f.realMissionId).push(f);
    }
    for (const rows of by.values()) {
      // GALAXYZ: the return leg is a real event (synthetic null) next to the outward one
      const ret = rows.find((r) => r.synthetic === 'return') || rows.find((r) => r.synthetic === null && r.returnFlight);
      const hold = rows.find((r) => r.synthetic === 'holdEnd');
      const out = rows.find((r) => r.synthetic === null && !r.returnFlight);
      if (!ret || (!out && !hold)) continue;
      const oneWay = ret.arrival - (hold ? hold.arrival : out.arrival);
      if (!(oneWay > 0)) continue;
      if (out) { const dep = out.arrival - oneWay; for (const r of rows) r.departure = dep; }
    }
  }

  /** Movement page -> Flight-like rows (fleet.md §12.3) plus movement-only fields: id, missionClass, timer, returnArrival, origin, destination. */
  flights.parseMovement = function (doc, opts = {}) {
    if (typeof doc === 'string') doc = new DOMParser().parseFromString(doc, 'text/html');
    if (isGzDoc(doc)) return gzMovement(doc, opts);
    const own = ownSet(Object.keys(opts).length ? opts : { bodies: null, ownCoords: ownFromDoc() });
    const idx = bodyIndex(opts.bodies);
    const wall = (t) => (t ? OGX.time.parseServerWall(t) : null);
    return Array.from(doc.querySelectorAll('#movement .fleetDetails[id^="fleet"]')).map((el) => {
      const id = +el.id.slice(5);
      const ret = el.dataset.returnFlight === '1';
      const typeIn = (sel) => {
        const f = el.querySelector(sel + ' figure.planetIcon');
        if (f) return f.classList.contains('moon') ? 3 : f.classList.contains('tf') ? 2 : 1;
        return el.querySelector(sel + ' .deep-space-text') ? 4 : null;
      };
      const origin = coords((el.querySelector('.originCoords a') || {}).textContent);
      const destination = coords((el.querySelector('.destinationCoords a') || {}).textContent);
      const oType = typeIn('.originPlanet'), dType = typeIn('.destinationPlanet');
      const missionSpan = el.querySelector('span.mission');
      const missionClass = missionSpan ? ['hostile', 'neutral', 'friendly'].find((c) => missionSpan.classList.contains(c)) || null : null;
      const tipEl = el.querySelector('#bl' + id + ' .htmlTooltip');
      const tip = tipEl ? parseFleetTooltip(tipEl.outerHTML) : { shipsByTitle: {}, cargo: { metal: 0, crystal: 0, deuterium: 0, approx: false } };
      const { ships } = shipsFromTitles(tip.shipsByTitle, opts.titles);
      const timerEl = el.querySelector('span.timer');
      const nextEl = el.querySelector('span.nextTimer');
      const recall = el.querySelector('a.recallFleet');
      const missionType = +el.dataset.missionType;
      const isOwn = own.has(origin);
      const from = ret ? destination : origin, to = ret ? origin : destination;
      const fromType = ret ? dType : oType, toType = ret ? oType : dType;
      return {
        id, rowId: id, realMissionId: id, synthetic: null, isUnion: false, missionType, returnFlight: ret,
        arrival: (+el.dataset.arrivalTime) * 1000,
        timer: wall(timerEl && timerEl.getAttribute('title')), returnArrival: wall(nextEl && nextEl.getAttribute('title')),
        origin, destination, missionClass,
        from, fromType, to, toType, originKey: keyFor(idx, from, fromType), destKey: keyFor(idx, to, toType),
        units: Object.values(ships).reduce((a, b) => a + b, 0), ships, cargo: tip.cargo,
        recallable: !!recall && isOwn, recallId: recall ? +recall.dataset.fleetId : null,
        own: isOwn, status: isOwn ? 'friendly' : HOSTILE.includes(missionType) ? 'hostile' : 'neutral', departure: null,
      };
    });
  };
  function ownFromDoc() {
    try { return new Set(OGX.parse.planetList(document).map((r) => r.coords)); } catch (e) { return new Set(); }
  }

  /** Movement rows -> event-list-shaped flights (hold-end and synthetic return rows added). */
  function movementToFlights(list) {
    const out = [];
    for (const m of list) {
      const base = Object.assign({}, m);
      delete base.id; delete base.timer; delete base.returnArrival; delete base.origin; delete base.destination; delete base.missionClass; delete base.recallId;
      const inHold = m.timer && m.timer !== m.arrival && m.timer > m.arrival;
      if (!inHold) out.push(base);
      if (inHold) {
        out.push(Object.assign({}, base, { rowId: m.id + 888888, synthetic: 'holdEnd', arrival: m.timer }));
      }
      if (!m.returnFlight && m.returnArrival && m.own) {
        out.push(Object.assign({}, base, {
          rowId: m.id + 999999, synthetic: 'return', returnFlight: true, arrival: m.returnArrival,
          from: m.destination, fromType: base.toType, to: m.origin, toType: base.fromType, originKey: base.destKey, destKey: base.originKey,
          cargo: { metal: 0, crystal: 0, deuterium: 0, approx: false }, recallable: false,
        }));
      }
    }
    out.sort((a, b) => a.arrival - b.arrival);
    fillDepartures(out);
    return out;
  }
  flights._movementToFlights = movementToFlights;

  /** Decision 21: the outbound tooltip deuterium is cargo + deuterium_consumption / 2 (FleetMissionService::getResources).
   * For own outbound rows whose one-way time is known (departure from the synthetic return row) the speed setting is
   * recovered by matching the observed duration (1..10, step 0.5, +-1 s); the server-variant consumption is then
   * recomputed and half of it removed (cargo.fuelRemoved). Rows that cannot be recomputed keep the value and get
   * cargo.approx = true. Mutates and returns `list`. ctx = { stats, server, playerClass }. */
  flights.fixOutboundFuel = function (list, { stats, server = {}, playerClass } = {}) {
    if (!stats || isGz()) return list;   // GALAXYZ: the event cargo is the real load (fuel is not in it)
    const C = OGX.calc;
    const holdEnds = new Map();
    for (const f of list) if (f.synthetic === 'holdEnd') holdEnds.set(f.realMissionId, f);
    for (const f of list) {
      if (!f.own || f.synthetic !== null || f.returnFlight || !f.cargo || f.cargo.fuelRemoved !== undefined) continue;
      if (!(f.cargo.deuterium > 0)) continue;
      let fixed = false;
      const ships = f.ships || {};
      const known = Object.keys(ships).length && !f.unknownShips && Object.keys(ships).every((id) => stats[id] && stats[id].speed > 0);
      if (known && f.departure && f.from && f.to) {
        const oneWay = Math.round((f.arrival - f.departure) / 1000);
        const distance = C.distance(f.from, f.to, { galaxies: server.galaxies || 9, systems: server.systems || 499 });
        const maxSpeed = C.fleetMaxSpeed(ships, stats);
        const factor = C.missionSpeedFactor(f.missionType, server);
        let pct = null;
        for (let p = 10; p >= 1; p -= 0.5) {
          if (Math.abs(C.flightDuration({ distance, maxSpeed, speedPct: p, speedFactor: factor }) - oneWay) <= 1) { pct = p; break; }
        }
        if (pct !== null) {
          const he = holdEnds.get(f.realMissionId);
          const holdingHours = he ? Math.round((he.arrival - f.arrival) / 3600000) : 0;
          const fuel = C.fuel({ ships, stats, distance, duration: oneWay, speedFactor: factor, holdingHours, playerClass, variant: 'server', fleetSpeed: server.fleetSpeed || 1, speedPct: pct });
          const half = fuel / 2;
          if (half <= f.cargo.deuterium + 1) {
            f.cargo = Object.assign({}, f.cargo, { deuterium: Math.max(0, Math.round(f.cargo.deuterium - half)), fuelRemoved: Math.round(half) });
            fixed = true;
          }
        }
      }
      if (!fixed) f.cargo = Object.assign({}, f.cargo, { approx: true, fuelRemoved: 0 });
    }
    return list;
  };


  // ------------------------------------------------------------------ GALAXYZ
  /** "8290 Recycler; 5 Spy Probe" (own, ungrouped) | "<approaching> 12 <ships>: Recycler; Light Fighter" (foreign, espionage < 8)
   * | "No fleet data" -> { ships: { id: n }, unknown: { title: n|null }, units: number|null } [fleet.md §6, UPSTREAM FlyingFleetsTable]. */
  function gzShips(text, titles) {
    const out = { ships: {}, unknown: {}, units: null };
    if (!text) return out;
    let body = text;
    const colon = text.lastIndexOf(':');
    if (colon >= 0) {
      const head = /(\d[\d.]*)/.exec(text.slice(0, colon));
      out.units = head ? OGX.util.parseGzNumber(head[1]) : null;
      body = text.slice(colon + 1);
    }
    const byTitle = {};
    let counted = false;
    for (const part of body.split(';')) {
      const p = part.trim();
      if (!p) continue;
      const m = /^(\d[\d.]*)\s+(.+)$/.exec(p);
      if (m) { counted = true; byTitle[m[2].trim()] = (byTitle[m[2].trim()] || 0) + OGX.util.parseGzNumber(m[1]); }
      else if (colon >= 0) byTitle[p] = null;   // type known, count hidden
    }
    for (const [t, n] of Object.entries(byTitle)) {
      let id = titles && titles[t] !== undefined ? +titles[t] : null;
      if (!id) id = OGX.catalog.idFromTitle(t);
      if (id && n !== null) out.ships[id] = (out.ships[id] || 0) + n; else out.unknown[t] = n;
    }
    if (counted && out.units === null) out.units = Object.values(byTitle).reduce((a, b) => a + (b || 0), 0);
    return out;
  }
  flights._gzShips = gzShips;

  /** "Ressources: 7382 Metal; 0 Crystal; 0 Deuterium[; 5 Dark Matter]" -> Res (order, not words: Lang is a user setting). */
  function gzCargo(text) {
    const nums = String(text || '').slice(String(text || '').indexOf(':') + 1).split(';').map((p) => (/(\d[\d.]*)/.exec(p) || [])[1]).map((n) => (n ? OGX.util.parseGzNumber(n) : 0));
    const c = { metal: nums[0] || 0, crystal: nums[1] || 0, deuterium: nums[2] || 0, approx: false };
    if (nums[3]) c.darkmatter = nums[3];
    return c;
  }
  flights._gzCargo = gzCargo;

  /** Target type from the mission (event links carry no planet type): Recycle -> debris (2), Expedition -> deep space (4), else planet. */
  const gzTargetType = (mission) => (mission === 8 ? 2 : mission === 15 ? 4 : mission === 9 ? 3 : 1);

  /** parse.gz.events rows (+ parse.gz.fleetTable flights) -> Flight[]; rowId = 'fleettime_<end><fleetId>' (the event id). */
  function gzFlights(events, table, opts = {}) {
    const idx = bodyIndex(opts.bodies);
    const recallIds = table ? new Set(table.filter((r) => r.recallable && r.fleetId).map((r) => r.fleetId)) : null;
    const out = (events || []).map((e) => {
      const ret = e.status === 'return';
      const tType = gzTargetType(e.mission);
      const from = ret ? e.to : e.from, to = ret ? e.from : e.to;
      const fromType = ret ? tType : 1, toType = ret ? 1 : tType;
      const sh = gzShips(e.shipsText, opts.titles);
      const own = !!e.own;
      return {
        rowId: 'fleettime_' + e.key, fleetId: e.fleetId, realMissionId: e.fleetId !== null ? e.fleetId : e.key,
        synthetic: e.status === 'holding' ? 'holdEnd' : null, isUnion: e.style === 'federation', missionType: e.mission, returnFlight: ret,
        arrival: OGX.time.fromUnix(e.endUnix),
        from, fromType, to, toType, originKey: keyFor(idx, from, fromType), destKey: keyFor(idx, to, toType),
        units: sh.units || 0, ships: sh.ships, unknownShips: Object.keys(sh.unknown).length ? sh.unknown : undefined,
        // no resource part = nothing loaded [UPSTREAM CreateFleetPopupedMissionLink]; foreign fleets were never seen live
        cargo: e.cargoText ? gzCargo(e.cargoText) : { metal: 0, crystal: 0, deuterium: 0, approx: !own },
        recallable: own && !ret && (recallIds ? recallIds.has(e.fleetId) : true), own,
        status: own ? 'friendly' : e.hostile ? 'hostile' : 'neutral', departure: null,
      };
    });
    // fleetTable rows the box does not show (Deploy outward, fleet.md §6): outward rows whose id has no event
    for (const r of table || []) {
      if (r.returning || !r.origin || !r.target) continue;
      if (r.fleetId !== null && out.some((f) => f.fleetId === r.fleetId)) continue;
      if (r.fleetId === null && out.some((f) => f.own && f.returnFlight && r.timerUnix && f.arrival === OGX.time.fromUnix(r.timerUnix))) continue;
      const arrival = OGX.time.parseGameDate(r.arrivalText);
      if (arrival === null) continue;
      const tType = gzTargetType(r.missionId);
      const sh = gzShips(Object.entries(r.ships || {}).map(([t, n]) => n + ' ' + t).join('; '), opts.titles);
      out.push({
        rowId: 'fleet_' + (r.fleetId !== null ? r.fleetId : r.index), fleetId: r.fleetId, realMissionId: r.fleetId !== null ? r.fleetId : 'row' + r.index,
        synthetic: null, isUnion: false, missionType: r.missionId, returnFlight: false, arrival,
        from: r.origin, fromType: 1, to: r.target, toType: tType, originKey: keyFor(idx, r.origin, 1), destKey: keyFor(idx, r.target, tType),
        units: r.amount || sh.units || 0, ships: sh.ships, unknownShips: Object.keys(sh.unknown).length ? sh.unknown : undefined,
        cargo: { metal: 0, crystal: 0, deuterium: 0, approx: true }, recallable: !!r.recallable, own: true, status: 'friendly', departure: null,
      });
    }
    out.sort((a, b) => a.arrival - b.arrival);
    fillDepartures(out);
    return out;
  }
  flights._gzFlights = gzFlights;

  const hasEventBox = (doc) => !!doc.querySelector('#messages_collapsed, .OvfleetEvents_');
  const isFleetTableDoc = (doc) => !!doc.querySelector('.fleetTablemain, form[action*="page=fleetStep1"]');

  /** GALAXYZ document (any full page) -> Flight[]; page=fleetTable also contributes recall ids and Deploy outward rows. */
  flights.parseGz = function (doc, opts = {}) {
    doc = toDoc(doc);
    const G = OGX.parse.gz;
    return gzFlights(G.events(doc), isFleetTableDoc(doc) ? G.fleetTable(doc).flights : null, opts);
  };

  /** page=fleetTable movement list -> the movement row shape (fleet.md §1.2). Times: timer = the row countdown (return, or arrival for Deploy). */
  function gzMovement(doc, opts = {}) {
    const idx = bodyIndex(opts.bodies);
    return OGX.parse.gz.fleetTable(doc).flights.map((r) => {
      const ret = !!r.returning;
      const tType = gzTargetType(r.missionId);
      const sh = gzShips(Object.entries(r.ships || {}).map(([t, n]) => n + ' ' + t).join('; '), opts.titles);
      const timer = r.timerUnix ? OGX.time.fromUnix(r.timerUnix) : null;
      const arrival = ret ? timer : OGX.time.parseGameDate(r.arrivalText);
      const back = /\d/.test(r.returnText || '') ? OGX.time.parseGameDate(r.returnText) : null;
      const from = ret ? r.target : r.origin, to = ret ? r.origin : r.target;
      const fromType = ret ? tType : 1, toType = ret ? 1 : tType;
      return {
        id: r.fleetId, rowId: r.fleetId !== null ? r.fleetId : 'row' + r.index, fleetId: r.fleetId, realMissionId: r.fleetId, synthetic: null, isUnion: false,
        missionType: r.missionId, returnFlight: ret, arrival, timer, returnArrival: ret ? null : back,
        origin: r.origin, destination: r.target, missionClass: null,
        from, fromType, to, toType, originKey: keyFor(idx, from, fromType), destKey: keyFor(idx, to, toType),
        units: r.amount || sh.units || 0, ships: sh.ships, cargo: null,
        recallable: !!r.recallable, recallId: r.recallable ? r.fleetId : null, own: true, status: 'friendly', departure: null,
      };
    });
  }

  // ------------------------------------------------------------------ cache
  let inflight = null;
  async function store(list, src, t) {
    const T = t || OGX.time.serverNow();
    await OGX.storage.set('flights', { t: T, flights: list, src });
    OGX.bus.emit('flights:updated', { t: T, flights: list });
  }
  async function ctxOpts() {
    const bodies = await OGX.state.bodies();
    const titles = await OGX.state.titles();
    return { bodies, titles };
  }
  async function fuelCtx() {
    try {
      const [stats, server, player] = await Promise.all([OGX.state.shipStats(), OGX.state.server(), OGX.state.player()]);
      return { stats, server, playerClass: player ? player.playerClass : 'none' };
    } catch (e) { log.debug('fuel context', e); return {}; }
  }
  flights.get = async function ({ maxAgeMs = 60000, force = false, background = false } = {}) {
    const cached = await OGX.storage.get('flights', null);
    if (!force && cached && cached.t && OGX.time.serverNow() - cached.t < maxAgeMs) return { t: cached.t, flights: cached.flights || [] };
    if (!inflight) {
      inflight = (async () => {
        const html = await OGX.api.eventList({ background });   // GALAXYZ: page=fleetTable (event box + recall ids)
        if (typeof html !== 'string') return { error: html && html.error || 'eventlist' };
        const list = flights.fixOutboundFuel(flights.parseEventList(html, await ctxOpts()), await fuelCtx());
        const T = OGX.time.serverNow();
        await store(list, 'eventlist', T);
        return { t: T, flights: list };
      })().catch((e) => { log.error('get', e); return { error: String(e.message || e) }; }).finally(() => { inflight = null; });
    }
    return inflight;
  };
  /** The stored list with no network call on either engine: { t, flights, src } | null (t = 0 after invalidate()). */
  flights.cached = async function () {
    const c = await OGX.storage.get('flights', null);
    return c && Array.isArray(c.flights) ? { t: c.t || 0, flights: c.flights, src: c.src || null } : null;
  };
  /** GALAXYZ: stores the event box (+ recall ids on fleetTable) of a fetched full page, e.g. the fleetTable page a recall POST
   * answers, and emits flights:updated. -> the list | null when the page has no event box. */
  flights._storeFromDoc = async function (doc, src = 'doc', t) {
    doc = toDoc(doc);
    if (!doc || !hasEventBox(doc)) return null;
    const list = flights.parseGz(doc, await ctxOpts());
    await store(list, src, t || OGX.time.serverNow());
    return list;
  };
  flights.invalidate = async function () {
    await OGX.storage.update('flights', (o) => (o ? Object.assign({}, o, { t: 0 }) : o), null);
  };
  flights._mergeMovement = async function (list, T) {
    const cached = await OGX.storage.get('flights', null);
    if (cached && cached.t && cached.t >= T) return;
    const opts = await ctxOpts();
    const fixed = list.map((m) => {
      const idx = bodyIndex(opts.bodies);
      return Object.assign({}, m, { originKey: keyFor(idx, m.from, m.fromType), destKey: keyFor(idx, m.to, m.toType) });
    });
    await store(flights.fixOutboundFuel(movementToFlights(fixed), await fuelCtx()), 'movement', T);
  };

  // ------------------------------------------------------------------ polling (one per tab, driven by the core tick)
  let pollOff = null;
  let lastPoll = 0, lastCounts = null, polling = false, lastGzPoll = null;
  /** GALAXYZ polling policy (no cheap probe exists: every request is a full page that keeps the account online).
   * Re-poll only while the tab is visible AND one of: 'ended' = a stored flight's time passed after the list was taken (an arrival or
   * a return changes the list); 'invalidated' = flights.invalidate() ran (own send/recall, game fleetAjax 600); 'noBox' = this page has
   * no event box (info/fleetStep3-less pages) and the list is older than 10 x the interval (min 10 min). Otherwise nothing: the event
   * box of every page the user opens refreshes the list for free. core.flightsPollSec (0 = off) is the minimum spacing.
   * -> 'ended' | 'invalidated' | 'noBox' | 'empty' | null */
  flights.gzPollReason = function (cached, { now = OGX.time.serverNow(), sec = 60, hasBox = true, hidden = false } = {}) {
    if (!sec || hidden) return null;
    if (!cached) return hasBox ? null : 'empty';
    if (!cached.t) return 'invalidated';
    if ((cached.flights || []).some((f) => f.arrival > cached.t && f.arrival <= now)) return 'ended';
    if (!hasBox && now - cached.t >= Math.max(600, sec * 10) * 1000) return 'noBox';
    return null;
  };
  flights._lastGzPoll = () => lastGzPoll;
  flights.startPolling = function () {
    if (pollOff) return pollOff;
    const off = OGX.bus.on('tick', async (now) => {
      let sec = 60;
      try { sec = +OGX.settings.get('core.flightsPollSec'); } catch (e) { sec = 60; }
      if (!sec || polling || document.hidden) return;
      if (Date.now() - lastPoll < sec * 1000) return;
      lastPoll = Date.now();
      polling = true;
      try {
        if (isGz()) {
          // Every GET of a game page marks the account online, so GALAXYZ re-polls page=fleetTable only on a reason (gzPollReason).
          const cached = await OGX.storage.get('flights', null);
          const why = flights.gzPollReason(cached, { now: OGX.time.serverNow(), sec, hasBox: hasEventBox(document), hidden: document.hidden });
          if (why) { lastGzPoll = { t: Date.now(), why }; await flights.get({ force: true, background: true }); }
          return;
        }
        const box = await OGX.api.eventBox({ background: true });
        if (box.error) return;
        const counts = [box.hostile, box.neutral, box.friendly].join('/');
        const cached = await OGX.storage.get('flights', null);
        const passed = cached && (cached.flights || []).some((f) => f.arrival <= now && f.arrival > (cached.t || 0));
        if (counts !== lastCounts || passed || !cached) {
          lastCounts = counts;
          await flights.get({ force: true });
        }
      } finally { polling = false; }
    });
    pollOff = () => { off(); pollOff = null; };
    return pollOff;
  };

  // ------------------------------------------------------------------ derived views
  /** Own missions only, one row per realMissionId (OL §5.7): outbound, else hold end, else the real return. */
  flights.inFlight = function (list) {
    const out = { metal: 0, crystal: 0, deuterium: 0, byMission: {} };
    const by = new Map();
    for (const f of list || []) {
      if (!f.own || f.realMissionId === null || f.realMissionId === undefined) continue;
      if (!by.has(f.realMissionId)) by.set(f.realMissionId, []);
      by.get(f.realMissionId).push(f);
    }
    for (const rows of by.values()) {
      const pick = rows.find((r) => r.synthetic === null && !r.returnFlight) || rows.find((r) => r.synthetic === 'holdEnd') || rows.find((r) => r.synthetic === null && r.returnFlight);
      if (!pick || !pick.cargo) continue;
      const m = (out.byMission[pick.missionType] = out.byMission[pick.missionType] || { metal: 0, crystal: 0, deuterium: 0 });
      for (const k of ['metal', 'crystal', 'deuterium']) { out[k] += pick.cargo[k] || 0; m[k] += pick.cargo[k] || 0; }
    }
    return out;
  };
  flights.incomingByBody = function (list) {
    const out = {};
    for (const f of list || []) {
      if (!f.destKey) continue;
      (out[f.destKey] = out[f.destKey] || []).push(f);
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.arrival - b.arrival);
    return out;
  };
  flights.hostile = (list) => (list || []).filter((f) => f.status === 'hostile' && !f.returnFlight);

  /** Applies arrivals in (from, to] to clones of the bodies (OL §5.7 table). */
  flights.applyArrivals = function (bodies, list, from, to) {
    const out = {};
    for (const [k, b] of Object.entries(bodies || {})) out[k] = OGX.util.clone(b);
    const addRes = (b, c) => {
      if (!b.res || !c) return;
      for (const k of ['metal', 'crystal', 'deuterium']) if (b.res[k]) b.res[k].amount += c[k] || 0;
    };
    const addShips = (b, ships) => {
      b.ships = Object.assign({}, b.ships || {});
      for (const [id, n] of Object.entries(ships || {})) b.ships[id] = (b.ships[id] || 0) + n;
    };
    for (const f of (list || []).slice().sort((a, b) => a.arrival - b.arrival)) {
      if (!(f.arrival > (from || 0) && f.arrival <= to)) continue;
      const b = f.destKey ? out[f.destKey] : null;
      if (!b) continue;
      if (f.own) {
        if (f.synthetic === 'return') addShips(b, f.ships);
        else if (f.synthetic === null && f.returnFlight) { addRes(b, f.cargo); addShips(b, f.ships); }
        else if (f.synthetic === null && !f.returnFlight && (f.missionType === 3 || f.missionType === 4)) {
          addRes(b, f.cargo);
          if (f.missionType === 4) addShips(b, f.ships);
        }
      } else if (f.missionType === 3 && !f.returnFlight) {
        addRes(b, f.cargo);
      }
    }
    return out;
  };

  flights.init = function () {
    if (isGz()) {
      // Every full page carries the event box: store it (an empty box = no flights); fleetTable adds recall ids.
      if (hasEventBox(document)) {
        (async () => {
          const list = flights.parseGz(document, await ctxOpts());
          await store(list, 'page', OGX.time.serverNow());
        })().catch((e) => log.error('init', e));
      }
      // galaxy one-click spy/recycle (fleetAjax, code 600 = sent) changes the list
      OGX.bridge.onXhr(/^page=fleetajax\b/, (x) => {
        const j = x.json || (() => { try { return JSON.parse(x.responseText); } catch (e) { return null; } })();
        if (j && +j.code === 600) flights.invalidate();
      });
      return;
    }
    // The game's own event-list loads are free data.
    OGX.bridge.onXhr(/^\/ajax\/fleet\/eventlist\/fetch$/, async (x) => {
      if (x.status !== 200 || !x.responseText) return;
      const list = flights.fixOutboundFuel(flights.parseEventList(x.responseText, await ctxOpts()), await fuelCtx());
      await store(list, 'game', OGX.time.serverNow());
    });
  };
})(window.OGX);
