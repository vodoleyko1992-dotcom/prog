/* shared/core/14-state.js — page snapshot, body store, data collection, refresh-all. Owner: core.
 * Store keys (single writer = this file): bodies, research, player, slots, shipStats (player scope);
 * server, titles, topScore (server scope). Newer data is never replaced by older data (per-field timestamps). */
(function (OGX) {
  'use strict';
  const state = (OGX.state = OGX.state || {});
  const log = OGX.log.create('state');
  const SRV = { scope: 'server' };
  let snap = null;
  let titlesCache = {};

  const RES_BUILDINGS = [1, 2, 3, 4, 12, 22, 23, 24];
  const isResearch = (id) => id >= 100 && id < 200;
  const isShip = (id) => id >= 200 && id < 300;
  const isDefense = (id) => id >= 400 && id < 600;

  // ------------------------------------------------------------------ snapshot
  /** Synchronous: reads the raw title attributes first (the game's Tipped strips them after document ready). */
  state.snapshotSync = function (doc = document, pageName) {
    const P = OGX.parse;
    if (P.gz && P.gz.is(doc)) return snapshotGz(doc);
    const parsedAtMs = Date.now();
    const base = doc === document ? location.href : (doc.URL && /^https?:/.test(doc.URL) ? doc.URL : location.href);
    const planets = P.planetList(doc, base);              // titles first
    const tooltips = P.resourceTooltips(doc);
    const page = pageName || (doc === document ? OGX.page.info().name : 'other');
    const s = {
      parsedAtMs, page,
      serverTimeString: P.serverTimeString(doc),
      metas: P.metas(doc),
      player: P.player(doc),
      csrf: P.csrf(doc),
      current: P.currentBody(doc, base),
      planets, tooltips,
      inline: P.inlineResources(doc),
    };
    try {
      if (['resources', 'facilities', 'research', 'shipyard', 'defense'].includes(page)) {
        s.techList = P.techList(doc);
        s.titles = P.titles(doc);
      }
      if (['overview', 'resources', 'facilities', 'research', 'shipyard', 'defense'].includes(page)) {
        s.queueBoxes = {
          building: !!doc.querySelector('#productionboxbuildingcomponent'),
          research: !!doc.querySelector('#productionboxresearchcomponent'),
          unit: !!doc.querySelector('#productionboxshipyardcomponent'),
        };
        if (s.queueBoxes.building || s.queueBoxes.research || s.queueBoxes.unit) s.queues = P.queueTimers(doc);
      }
      if (page === 'overview') s.overviewInfo = P.overviewInfo(doc);
      if (page === 'resourceSettings') s.resourceSettings = P.resourceSettings(doc);
      if (page === 'fleet') { s.fleetPage = P.fleetPage(doc); s.titles = Object.assign({}, s.titles || {}, s.fleetPage.titles); }
      if (page === 'movement') {
        s.movement = OGX.flights && OGX.flights.parseMovement ? OGX.flights.parseMovement(doc) : null;
        s.movementSlots = movementSlots(doc);
      }
    } catch (e) { log.error('page snapshot ' + page, e); }
    return s;
  };
  /**
   * GALAXYZ snapshot (specs/galaxyz/layout.md §13, PORT_PLAN §2.5). Same fields as OgameX where the datum exists, plus:
   * engine 'galaxyz', gzPage (raw ?page=, lower case), mode, step, info (message page), infoMessage, userOffsetSec, renderUnix,
   * events (event box, every full page), planetCount, empire (page=imperium), officers (page=officier).
   * The page is taken from the document itself (queryString), so fetched documents route correctly.
   */
  function snapshotGz(doc) {
    const P = OGX.parse;
    const G = P.gz;
    const parsedAtMs = Date.now();
    const r = OGX.page.routeGz(doc);
    const page = r.name;
    const raw = String(r.raw || 'overview').toLowerCase();
    const st = G.serverTime(doc);
    const s = {
      parsedAtMs, page, engine: 'galaxyz', gzPage: raw, mode: r.mode, step: r.step, info: r.info,
      serverTimeString: st.wall, userOffsetSec: st.userOffsetSec, renderUnix: st.renderUnix,
      metas: P.metas(doc), player: P.player(doc), csrf: '',
      current: P.currentBody(doc), planets: P.planetList(doc), tooltips: P.resourceTooltips(doc), inline: P.inlineResources(doc),
      planetCount: G.bodies(doc).count, events: [], infoMessage: null,
    };
    try {
      s.events = G.events(doc);
      if (r.info || raw === 'fleetstep3') s.infoMessage = G.infoMessage(doc);
      if (['buildings', 'research', 'shipyard'].includes(raw)) {
        s.techList = P.techList(doc);
        s.titles = P.titles(doc);
        const qt = P.queueTimers(doc);
        // only boxes we could read replace stored queues (an active list-page box has unknown markup)
        s.queueBoxes = { building: raw === 'buildings' && qt.known.box, research: raw === 'research' && qt.known.box, unit: raw === 'shipyard' && qt.known.unit };
        if (s.queueBoxes.building || s.queueBoxes.research || s.queueBoxes.unit) s.queues = qt;
      }
      if (raw === 'overview') s.overviewInfo = P.overviewInfo(doc);
      if (raw === 'resources') s.resourceSettings = P.resourceSettings(doc);
      if (raw === 'fleettable' || raw === 'fleetstep1' || raw === 'fleetstep2') { s.fleetPage = P.fleetPage(doc); s.titles = Object.assign({}, s.titles || {}, s.fleetPage.titles); }
      if (raw === 'imperium') s.empire = G.empire(doc);
      if (raw === 'officier') s.officers = G.officers(doc);
      if (raw === 'galaxy' && OGX.galaxy && OGX.galaxy.gz && OGX.galaxy.gz.header) {
        const hd = OGX.galaxy.gz.header(doc);   // "1/13 Fleet Slots" (#slotValue): fleet slots only
        if (hd && Number.isFinite(hd.slotsUsed) && hd.slotsMax > 0) s.galaxySlots = { used: hd.slotsUsed, max: hd.slotsMax };
      }
    } catch (e) { log.error('page snapshot ' + raw, e); }
    return s;
  }

  function movementSlots(doc) {
    const pair = (sel) => {
      const el = doc.querySelector(sel);
      if (!el) return null;
      const c = el.querySelector('.current'), a = el.querySelector('.all');
      if (c && a) return { used: +c.textContent.trim() || 0, max: +a.textContent.trim() || 0 };
      const m = /(\d+)\s*\/\s*(\d+)/.exec(el.textContent);
      return m ? { used: +m[1], max: +m[2] } : null;
    };
    return { fleet: pair('.fleetStatus .fleetSlots'), expedition: pair('.fleetStatus .expSlots') };
  }

  state.current = () => (snap ? snap.current : null);
  state.snapshot = () => snap;

  // ------------------------------------------------------------------ merge
  function emptyBody(key, type) {
    return {
      key, id: +key.slice(1), type, planetId: null, name: null, coords: null,
      diameter: null, fieldsUsed: null, fieldsMax: null, fieldsT: null, tempMin: null, tempMax: null,
      res: null, energy: null, levels: {}, levelsT: {}, ships: {}, shipsT: null, defense: {}, defenseT: null,
      percents: {}, factor: null, percentsT: null, queues: { building: null, unit: null, t: null },
      constructionFlag: false, seenAt: null, order: 0,
    };
  }
  const newer = (t, old) => old === null || old === undefined || t >= old;
  /** fieldsUsed/fieldsMax follow their own time (fieldsT): an older page (planet list, overview) never overwrites newer imperium values. */
  function setFields(b, src, T) {
    if (!src || src.fieldsUsed === null || src.fieldsUsed === undefined || !newer(T, b.fieldsT)) return;
    b.fieldsUsed = src.fieldsUsed;
    if (src.fieldsMax !== null && src.fieldsMax !== undefined) b.fieldsMax = src.fieldsMax;
    b.fieldsT = T;
  }

  /** Applies a snapshot to the stores. t = server time the page was rendered (defaults to OGX.time.renderMs). */
  state.merge = async function (s, { t } = {}) {
    if (!s) return;
    const isLive = !t;
    if (isLive) snap = s;
    const T = t || OGX.time.renderMs || OGX.time.serverNow();
    const changed = new Set();
    const cur = s.current || {};

    // bodies
    await OGX.storage.update('bodies', (old) => {
      const bodies = Object.assign({}, old || {});
      if (s.planets && s.planets.length) {
        const keep = new Set();
        s.planets.forEach((row, i) => {
          const pk = 'p' + row.planetId;
          keep.add(pk);
          const b = Object.assign(emptyBody(pk, 'planet'), bodies[pk] || {});
          Object.assign(b, { planetId: row.planetId, name: row.name, coords: row.coords, order: i, moonKey: row.moon ? 'm' + row.moon.id : null });
          if (row.building !== null && row.building !== undefined) b.constructionFlag = !!row.building; // GALAXYZ info pages: unknown
          for (const k of ['diameter', 'tempMin', 'tempMax']) if (row[k] !== null && row[k] !== undefined) b[k] = row[k];
          setFields(b, row, T);
          bodies[pk] = b;
          if (row.moon && row.moon.id) {
            const mk = 'm' + row.moon.id;
            keep.add(mk);
            const m = Object.assign(emptyBody(mk, 'moon'), bodies[mk] || {});
            Object.assign(m, { planetId: row.planetId, coords: row.coords, order: i });
            if (row.moon.name) m.name = row.moon.name;
            if (row.moon.diameter !== null && row.moon.diameter !== undefined) m.diameter = row.moon.diameter;
            setFields(m, row.moon, T);
            if (row.tempMin !== null) { m.tempMin = row.tempMin; m.tempMax = row.tempMax; }
            bodies[mk] = m;
          }
        });
        for (const k of Object.keys(bodies)) if (!keep.has(k)) delete bodies[k];
      }
      if (cur.key) {
        const b = bodies[cur.key] = Object.assign(emptyBody(cur.key, cur.isMoon ? 'moon' : 'planet'), bodies[cur.key] || {});
        if (!b.name && cur.name) b.name = cur.name;
        if (!b.coords && cur.coords) b.coords = cur.coords;
        if (isLive) b.seenAt = T;
        mergeCurrentBody(b, s, T);
      }
      return bodies;
    }, {});
    changed.add('bodies');

    // player (GALAXYZ: the id is only on some pages, so a null id never replaces a known one)
    if (s.player && (s.player.id || s.player.name)) {
      // per-field times: the header fields carry t, the officier block carries officersT, so an older officier page still
      // fills officers that are missing or older (verify-r1: messages 10:16, officier 10:05 -> officers were dropped)
      await OGX.storage.update('player', (o) => {
        const headerNewer = !(o && o.t > T);
        const offT = o && o.officers ? (o.officersT ?? o.t ?? 0) : null;
        const officersNewer = !!s.officers && (offT === null || !(offT > T));
        if (!headerNewer && !officersNewer) return o;
        const p = {};
        if (headerNewer) {
          for (const [k, v] of Object.entries(s.player)) if (v !== null && v !== undefined) p[k] = v;
          if (s.player.vacation === false) p.vacationUntil = null;   // vacation over: drop the stale end date
          p.t = T;
        }
        if (officersNewer) {
          p.officers = {};
          for (const x of s.officers.officers || []) if (x.level !== null) p.officers[x.id] = x.level;
          if (s.officers.darkMatter !== null && (headerNewer || !o || o.darkMatter === undefined || o.darkMatter === null)) p.darkMatter = s.officers.darkMatter;
          p.officersT = T;
        }
        return Object.assign({ id: null }, o || {}, p);
      }, null);
      changed.add('player');
    }

    // research
    if (s.page === 'research' || (s.queues && s.queueBoxes && s.queueBoxes.research) || (s.empire && s.empire.research)) {
      await OGX.storage.update('research', (o) => {
        const r = Object.assign({ levels: {}, t: null, queue: null, queueT: null }, o || {});
        if (s.page === 'research' && s.techList && newer(T, r.t)) {
          for (const it of s.techList) if (isResearch(it.id)) r.levels[it.id] = it.value;
          r.t = T;
        }
        if (s.empire && s.empire.research && Object.keys(s.empire.research).length && newer(T, r.t)) {
          for (const [id, lv] of Object.entries(s.empire.research)) if (lv !== null) r.levels[id] = lv;
          r.t = T;
        }
        if (s.queues && s.queueBoxes && s.queueBoxes.research && newer(T, r.queueT)) {
          const q = s.queues.research;
          r.queue = q ? { objectId: q.objectId, targetLevel: q.targetLevel, endsAt: T + q.secs * 1000 } : null;
          r.queueT = T;
        }
        return r;
      }, null);
      changed.add('research');
    }

    // server (metas + fleet speed factors from /fleet)
    await OGX.storage.update('server', (o) => {
      const n = Object.assign({}, o || {});
      if (s.metas) {
        if (s.metas.economySpeed) n.economySpeed = n.economySpeed || s.metas.economySpeed;
        if (s.metas.fleetSpeed) n.fleetSpeed = s.metas.fleetSpeed;
        if (s.metas.version) n.version = s.metas.version;
        if (s.metas.economySpeed && !(n.settingsT > 0)) n.economySpeed = s.metas.economySpeed;
      }
      if (s.engine) n.engine = s.engine;
      if (s.fleetPage && s.fleetPage.speedFactors) {
        const f = s.fleetPage.speedFactors;
        if (s.engine === 'galaxyz' && f.war) n.fleetSpeed = f.war;   // fleetStep1 data.gamespeed (one factor for every mission)
        if (f.war) n.fleetSpeedWar = f.war;
        if (f.peaceful) n.fleetSpeedPeaceful = f.peaceful;
        if (f.holding) n.fleetSpeedHolding = f.holding;
        if (s.fleetPage.maxGalaxy) n.galaxies = n.galaxies || s.fleetPage.maxGalaxy;
        if (s.fleetPage.maxSystem) n.systems = n.systems || s.fleetPage.maxSystem;
      }
      if (OGX.time.calibrated && n.tzOffsetMs === undefined) n.tzOffsetMs = OGX.time.tzOffsetMs;
      n.t = Math.max(+n.t || 0, T);
      return n;
    }, {}, SRV);
    changed.add('server');

    // titles
    if (s.titles && Object.keys(s.titles).length) {
      await OGX.storage.update('titles', (o) => Object.assign({}, o || {}, s.titles), {}, SRV);
      Object.assign(titlesCache, s.titles);
      changed.add('titles');
    }

    // slots
    // { fleet, expedition, t, fleetT, expeditionT, fleetSrc, expeditionSrc }: a page that shows one kind (galaxy: fleet only) keeps
    // the other kind with its own older time.
    const fleetSlots = s.fleetPage ? s.fleetPage.slots : s.movementSlots ? s.movementSlots.fleet : s.galaxySlots || null;
    const expSlots = s.fleetPage ? s.fleetPage.expSlots : s.movementSlots ? s.movementSlots.expedition : null;
    if (fleetSlots || expSlots) {
      const src = s.fleetPage ? (s.engine === 'galaxyz' ? 'fleetTable' : 'fleet') : s.movementSlots ? 'movement' : 'galaxy';
      await OGX.storage.update('slots', (o) => {
        if (o && o.t > T) return o;
        const kind = (k, v) => (v ? { [k]: v, [k + 'T']: T, [k + 'Src']: src }
          : { [k]: (o && o[k]) || null, [k + 'T']: (o && (o[k + 'T'] || (o[k] ? o.t : null))) || null, [k + 'Src']: (o && o[k + 'Src']) || null });
        return Object.assign({}, kind('fleet', fleetSlots), kind('expedition', expSlots), { t: T });
      }, null);
      changed.add('slots');
    }

    // GALAXYZ page=fleetTable «Bonus» table (tech x 10 + officers, in %): player scope
    const bonus = s.fleetPage && s.fleetPage.gz && s.fleetPage.gz.fleetTable && s.fleetPage.gz.fleetTable.bonus;
    if (bonus && Object.values(bonus).some((v) => Number.isFinite(+v))) {
      await OGX.storage.update('combatBonus', (o) => (o && o.t > T ? o : Object.assign({}, bonus, { t: T })), null);
      changed.add('combatBonus');
    }

    // GALAXYZ empire page: levels, ships, defense, stock and energy production of every body in one page
    if (s.empire) {
      await OGX.storage.update('bodies', (old) => mergeEmpire(Object.assign({}, old || {}), s.empire, T), {});
    }

    // flights from the movement page
    if (s.movement && OGX.flights && OGX.flights._mergeMovement) {
      await OGX.flights._mergeMovement(s.movement, T);
    }

    if (isLive) await loadTitles();
    OGX.bus.emit('state:updated', { keys: [...changed] });
  };

  /** GALAXYZ page=imperium -> bodies (columns keyed by cp; missiles 502/503 are not in the imperium and are kept). */
  function mergeEmpire(bodies, emp, T) {
    for (const col of emp.columns || []) {
      const key = bodies['p' + col.cp] ? 'p' + col.cp : bodies['m' + col.cp] ? 'm' + col.cp : null;
      const e = emp.bodies[col.cp];
      if (!key || !e) continue;
      const b = Object.assign({}, bodies[key]);
      b.levels = Object.assign({}, b.levels);
      b.levelsT = Object.assign({}, b.levelsT);
      if (newer(T, b.levelsT.resources) && newer(T, b.levelsT.facilities)) {
        for (const [id, lv] of Object.entries(e.buildings)) if (lv !== null) b.levels[id] = lv;
        b.levelsT.resources = T; b.levelsT.facilities = T;
      }
      if (newer(T, b.shipsT)) { b.ships = Object.assign({}, b.ships); for (const [id, n] of Object.entries(e.ships)) if (n !== null) b.ships[id] = n; b.shipsT = T; }
      if (newer(T, b.defenseT)) { b.defense = Object.assign({}, b.defense); for (const [id, n] of Object.entries(e.defense)) if (n !== null) b.defense[id] = n; b.defenseT = T; }
      setFields(b, col, T);
      const rs = e.resources || {};
      const RS = [['metal', 901], ['crystal', 902], ['deuterium', 903]];
      if (b.res && b.res.metal && newer(T, b.res.t)) {
        b.res = Object.assign({}, b.res, { t: T });
        for (const [k, id] of RS) if (rs[id] !== null && rs[id] !== undefined) b.res[k] = Object.assign({}, b.res[k], { amount: rs[id] });
      } else if (!(b.res && b.res.metal) && RS.some(([, id]) => rs[id] !== null && rs[id] !== undefined)) {
        // body never opened: keep the imperium stock (storage/perHour unknown = null; calc.amountAt then holds the amount flat)
        b.res = { t: T, src: 'imperium' };
        for (const [k, id] of RS) b.res[k] = { amount: rs[id] !== null && rs[id] !== undefined ? rs[id] : null, storage: null, perHour: null };
      }
      if (rs[911] !== null && rs[911] !== undefined && newer(T, b.energy && b.energy.t)) b.energy = Object.assign({ available: null, consumption: null }, b.energy || {}, { production: rs[911], t: T });
      bodies[key] = b;
    }
    return bodies;
  }

  function mergeCurrentBody(b, s, T) {
    const inl = s.inline || {};
    if (inl.metal && newer(T, b.res && b.res.t)) {
      b.res = { t: T };
      for (const k of ['metal', 'crystal', 'deuterium']) {
        const r = inl[k];
        b.res[k] = r ? { amount: r.amount, storage: r.storage, perHour: r.perHour } : { amount: 0, storage: 0, perHour: 0 };
      }
    }
    const et = s.tooltips && s.tooltips.energy;
    if ((et || inl.energy !== null && inl.energy !== undefined) && newer(T, b.energy && b.energy.t)) {
      b.energy = {
        available: inl.energy !== null && inl.energy !== undefined ? inl.energy : et ? et.available : null,
        production: et ? et.production : (b.energy ? b.energy.production : null),
        consumption: et && et.consumption !== null ? Math.abs(et.consumption) : (b.energy ? b.energy.consumption : null),
        t: T,
      };
    }
    const page = s.page;
    const list = s.techList || [];
    if (s.engine === 'galaxyz' && page === 'buildings' && newer(T, b.levelsT.resources)) {
      for (const it of list) if (!it.isUnit) b.levels[it.id] = it.value;
      b.levelsT = Object.assign({}, b.levelsT, { resources: T, facilities: T });
    }
    if (page === 'resources' && newer(T, b.levelsT.resources)) {
      for (const it of list) {
        if (RES_BUILDINGS.includes(it.id)) b.levels[it.id] = it.value;
        if (it.id === 212 || it.id === 217) b.ships[it.id] = it.value;
      }
      b.levelsT = Object.assign({}, b.levelsT, { resources: T });
    }
    if (page === 'facilities' && newer(T, b.levelsT.facilities)) {
      for (const it of list) if (!it.isUnit) b.levels[it.id] = it.value;
      b.levelsT = Object.assign({}, b.levelsT, { facilities: T });
    }
    if (page === 'shipyard' && newer(T, b.shipsT)) {
      const ships = Object.assign({}, b.ships);
      for (const it of list) if (isShip(it.id)) ships[it.id] = it.value;
      b.ships = ships; b.shipsT = T;
    }
    if (page === 'defense' && newer(T, b.defenseT)) {
      const d = {};
      for (const it of list) if (isDefense(it.id)) d[it.id] = it.value;
      b.defense = d; b.defenseT = T;
    }
    const gzFt = s.engine === 'galaxyz' && s.gzPage === 'fleettable' && s.fleetPage && s.fleetPage.gz ? s.fleetPage.gz.fleetTable : null;
    if (gzFt && (gzFt.prefill !== null || gzFt.noShips || gzFt.ships.length) && newer(T, b.shipsT)) {
      // page=fleetTable lists every ship type the body has (count > 0): a type that is not listed is 0, and an empty list
      // (or the no-ships #warning) is a known empty fleet. The solar satellite (212, no input) keeps its stored count unless listed.
      const ships = {};
      for (const id of OGX.catalog.fleetShipIds) ships[id] = 0;
      if (b.ships && b.ships[212] !== undefined) ships[212] = b.ships[212];
      for (const sh of gzFt.ships) if (sh.id) ships[sh.id] = sh.count || 0;
      b.ships = ships; b.shipsT = T;
    } else if (page === 'fleet' && s.fleetPage && !s.fleetPage.gz && newer(T, b.shipsT)) {
      const ships = {};
      for (const id of OGX.catalog.fleetShipIds) ships[id] = s.fleetPage.shipsOnPlanet[id] || 0;
      if (b.ships && b.ships[212] !== undefined) ships[212] = b.ships[212];
      if (b.ships && b.ships[217] !== undefined) ships[217] = b.ships[217];
      b.ships = ships; b.shipsT = T;
    }
    if (page === 'resourceSettings' && s.resourceSettings && newer(T, b.percentsT)) {
      b.percents = Object.assign({}, s.resourceSettings.percents);
      b.factor = s.resourceSettings.factor;
      b.percentsT = T;
    }
    if (page === 'overview' && s.overviewInfo) {
      const o = s.overviewInfo;
      for (const k of ['diameter', 'tempMin', 'tempMax']) if (o[k] !== null && o[k] !== undefined) b[k] = o[k];
      setFields(b, o, T);
    }
    if (s.queues && newer(T, b.queues && b.queues.t)) {
      const q = s.queues;
      const nq = Object.assign({ building: null, unit: null, t: null }, b.queues || {});
      const boxes = s.queueBoxes || {};
      const showsBuilding = !!boxes.building;
      const showsUnit = !!boxes.unit;
      if (showsBuilding) {
        nq.building = q.building ? {
          objectId: q.building.objectId, targetLevel: q.building.targetLevel, endsAt: T + q.building.secs * 1000, downgrade: !!q.building.downgrade,
          queued: (q.building.queued || []).map((x) => ({ objectId: x.objectId, targetLevel: x.targetLevel })),
        } : null;
      }
      if (showsUnit) {
        nq.unit = q.unit ? {
          endsAt: T + q.unit.totalSecs * 1000, nextAt: q.unit.nextSecs !== null ? T + q.unit.nextSecs * 1000 : null, remaining: q.unit.remaining,
          techId: q.unit.techId, perUnitSecs: q.unit.perUnitSecs, queued: q.unit.queued || [],
        } : null;
      }
      nq.t = T;
      b.queues = nq;
    }
  }

  // ------------------------------------------------------------------ getters
  state.bodies = async () => (await OGX.storage.get('bodies', {})) || {};
  state.body = async (key) => { const b = await state.bodies(); return b[key] || null; };
  state.bodyList = async function () {
    const b = await state.bodies();
    return Object.values(b).filter((x) => x.type === 'planet').sort((a, c) => (a.order || 0) - (c.order || 0))
      .map((p) => ({ planet: p, moon: p.moonKey && b[p.moonKey] ? b[p.moonKey] : Object.values(b).find((m) => m.type === 'moon' && m.planetId === p.planetId) || null }));
  };
  state.research = async () => Object.assign({ levels: {}, t: null, queue: null }, (await OGX.storage.get('research', null)) || {});
  state.player = async () => {
    const p = await OGX.storage.get('player', null);
    if (p) return p;
    return snap && snap.player ? Object.assign({}, snap.player, { t: null }) : null;
  };
  state.slots = async () => OGX.storage.get('slots', null);
  /** GALAXYZ page=fleetTable «Bonus» table as last seen: { attack, defense, shield, combustion, impulse, hyperspace (in %), t } | null. */
  state.combatBonus = async () => OGX.storage.get('combatBonus', null);
  state.server = async function () {
    const s = (await OGX.storage.get('server', {}, SRV)) || {};
    // GALAXYZ: until a fleetStep1 page stored data.gamespeed, the fleet speed is the Aeternum value (calc.gz.fleetSpeed)
    // and fleetSpeedKnown is false; a default of 1 would make every flight estimate 7 times too long.
    const gz = OGX.page.isGz && OGX.page.isGz();
    // GALAXYZ shows no economy/research speed on any page: null = unknown (economySpeedKnown/researchSpeedKnown false), never a
    // guessed 1. Consumers: `+srv.economySpeed || 1` keeps the old default, `srv.economySpeedKnown` tells whether to show it.
    const fs = +s.fleetSpeed || (gz ? OGX.calc.gz.fleetSpeed : 1);
    const dflt = gz ? null : 1;
    return Object.assign({ economySpeed: dflt, researchSpeed: dflt, fleetSpeed: fs, fleetSpeedWar: fs, fleetSpeedHolding: fs,
      fleetSpeedPeaceful: fs, galaxies: 9, systems: 499, debrisFleetPct: 30, debrisDefensePct: 0, debrisDeuterium: false,
      ignoreEmpty: false, ignoreInactive: false, tzOffsetMs: OGX.time.tzOffsetMs, t: null }, s,
    { fleetSpeedKnown: +s.fleetSpeed > 0, economySpeedKnown: +s.economySpeed > 0, researchSpeedKnown: +s.researchSpeed > 0,
      // galaxies/systems: false = the 2Moons defaults 9 / 499 (no page showed the real values yet)
      galaxiesKnown: +s.galaxies > 0, systemsKnown: +s.systems > 0 });
  };
  /** Officer/boost bonus sums of the player (calc.factors: ShipStorage 607, FleetSlots 611, FlyTime 613/707, ...). GALAXYZ: from
   * page=officier (player.officers { id: level }, player.boosts [id] when known); elsewhere all 0. */
  state.factors = async function () {
    const p = await state.player();
    return OGX.calc.factors({ officers: (p && p.officers) || {}, boosts: (p && Array.isArray(p.boosts) && p.boosts) || [] });
  };
  /** calc.slots with the stored research (108 computer, 124 astrophysics) and the player's officers (611 Commander +3/level).
   * -> { fleet, expedition, known: research levels seen, officersKnown: officier page seen } */
  state.calcSlots = async function () {
    const [r, p] = await Promise.all([state.research(), state.player()]);
    const lv = (id) => +(r.levels && r.levels[id]) || 0;
    const out = OGX.calc.slots({ computer: lv(108), astrophysics: lv(124), factors: await state.factors() });
    return Object.assign(out, { known: !!r.t, officersKnown: !!(p && p.officers) });
  };
  let serverInflight = null;
  state.ensureServer = async function ({ maxAgeMs = 86400000 } = {}) {
    if (OGX.page.isGz && OGX.page.isGz()) return state.server();   // GALAXYZ: no settings overlay (values come from pages)
    const cur = await OGX.storage.get('server', {}, SRV) || {};
    if (cur.settingsT && OGX.time.serverNow() - cur.settingsT < maxAgeMs) return state.server();
    if (!serverInflight) {
      serverInflight = (async () => {
        const r = await OGX.api.serverSettings({ background: true });
        if (r && !r.error) {
          const T = OGX.time.serverNow();
          await OGX.storage.update('server', (o) => Object.assign({}, o || {}, r, { settingsT: T, t: Math.max(+((o || {}).t) || 0, T) }), {}, SRV);
          OGX.bus.emit('state:updated', { keys: ['server'] });
        } else log.warn('server settings fetch failed', r && r.error);
      })().finally(() => { serverInflight = null; });
    }
    await serverInflight;
    return state.server();
  };

  state.shipStats = async function () {
    const stored = await OGX.storage.get('shipStats', null);
    const research = await state.research();
    const player = await state.player();
    const fresh = stored && stored.src === 'checkTarget' && stored.stats && OGX.time.serverNow() - stored.t < 86400000 && (!research.t || stored.t >= research.t);
    if (fresh) {
      const out = {};
      for (const [id, s] of Object.entries(stored.stats)) out[id] = Object.assign({}, s, { src: 'checkTarget', t: stored.t });
      return out;
    }
    // officers count on GALAXYZ (607 Storage expert: cargo +50 %/level, like the server's fleetroom)
    const gzMode = !!(OGX.page.isGz && OGX.page.isGz());
    const opts = gzMode ? { factors: await state.factors() } : {};
    // GALAXYZ: drive levels unknown (page=research never seen) -> from the fleetTable «Bonus» table (combustion x 10 %,
    // impulse x 20 %, hyperspace x 30 % [UPSTREAM ShowFleetTablePage:281-286]); without them the catalog base speeds are ~1.5x slow
    const levels = Object.assign({}, research.levels || {});
    if ([115, 117, 118].some((id) => levels[id] === undefined || levels[id] === null) && state.combatBonus) {
      const b = await state.combatBonus().catch(() => null);
      if (b) {
        for (const [id, k, per] of [[115, 'combustion', 10], [117, 'impulse', 20], [118, 'hyperspace', 30]]) {
          if ((levels[id] === undefined || levels[id] === null) && Number.isFinite(+b[k]) && +b[k] >= 0) levels[id] = Math.round(+b[k] / per);
        }
      }
    }
    const calc = OGX.calc.shipStats(levels, player ? player.playerClass : 'none', opts);
    const t = research.t || null;
    // GALAXYZ: a cargo factor measured from the server's own data.fleetroom (fleet.gz.measureCargo) wins over the officer calc
    // until a newer officier page shows another Storage officer level (state.cargoMeasured).
    const measured = gzMode ? await state.cargoMeasured() : null;
    const out = {};
    for (const [id, s] of Object.entries(calc)) {
      out[id] = Object.assign({}, s, { src: 'calc', t });
      if (measured) {
        const base = OGX.calc.cargoCapacity(+id);
        if (base > 0) Object.assign(out[id], { cargo: Math.round(base * measured.factor), src: 'fleetroom', t: measured.t, factor: measured.factor });
      }
    }
    return out;
  };
  /** Measured cargo factor { factor, t, ships, fleetroom, o607 } (storage cargoMeasured), or null when none or out of date: a newer
   * officier page (officersT > t) drops it only when the Storage officer (607) level differs from the level stored with the
   * measurement (o607). With no stored level the server's own measurement stays (every direct send measures again). */
  state.cargoMeasured = async function () {
    const m = await OGX.storage.get('cargoMeasured', null);
    if (!m || !(+m.factor >= 1 && +m.factor <= 10)) return null;
    const p = await state.player();
    if (p && p.officersT && +p.officersT > +m.t) {
      const cur = p.officers && p.officers[607] !== undefined && p.officers[607] !== null ? +p.officers[607] || 0 : null;
      const was = m.o607 !== undefined && m.o607 !== null ? +m.o607 : null;
      if (was !== null && cur !== null && cur !== was) return null;
    }
    return m;
  };

  /** Optimistic update after an own send (single writer of bodies): ships, cargo and fuel leave the origin, one slot is used.
   * { originId, ships: { id: n }, cargo: { metal, crystal, deuterium }, consumption } -> the body key or null. shipsT/res.t stay
   * (the next real page or imperium read still wins). */
  state.applySent = async function ({ originId, ships, cargo, consumption } = {}) {
    let hit = null;
    await OGX.storage.update('bodies', (old) => {
      const bodies = Object.assign({}, old || {});
      const key = bodies['p' + originId] ? 'p' + originId : bodies['m' + originId] ? 'm' + originId : null;
      if (!key) return old;
      hit = key;
      const b = Object.assign({}, bodies[key]);
      b.ships = Object.assign({}, b.ships);
      for (const [id, n] of Object.entries(ships || {})) if (b.ships[id] !== undefined || +n > 0) b.ships[id] = Math.max(0, (+b.ships[id] || 0) - (+n || 0));
      if (b.res) {
        b.res = Object.assign({}, b.res);
        for (const k of ['metal', 'crystal', 'deuterium']) {
          const take = ((cargo && +cargo[k]) || 0) + (k === 'deuterium' ? +consumption || 0 : 0);
          if (b.res[k] && take > 0) b.res[k] = Object.assign({}, b.res[k], { amount: Math.max(0, (+b.res[k].amount || 0) - take) });
        }
      }
      bodies[key] = b;
      return bodies;
    }, {});
    await OGX.storage.update('slots', (o) => (o && o.fleet ? Object.assign({}, o, { fleet: Object.assign({}, o.fleet, { used: Math.min(+o.fleet.max || Infinity, (+o.fleet.used || 0) + 1) }) }) : o), null);
    OGX.bus.emit('state:updated', { keys: ['bodies', 'slots'] });
    return hit;
  };

  async function loadTitles() {
    try { titlesCache = Object.assign({}, (await OGX.storage.get('titles', {}, SRV)) || {}, snap && snap.titles || {}); } catch (e) { /* ignore */ }
  }
  state.titles = async () => { await loadTitles(); return Object.assign({}, titlesCache); };
  state.titlesSync = () => titlesCache;

  let topInflight = null;
  state.ensureTopScore = async function ({ maxAgeMs = 3600000 } = {}) {
    const cur = await OGX.storage.get('topScore', null, SRV);
    // GALAXYZ: page=statistics (who=1,type=1,range=1) [UPSTREAM 2Moons markup, unverified] - a free background GET, no deuterium
    if (cur && OGX.time.serverNow() - cur.t < maxAgeMs) return cur;
    if (!topInflight) {
      topInflight = (async () => {
        const html = await OGX.api.highscore({ category: 1, type: 0, page: 1, background: true });
        if (typeof html !== 'string') return cur || null;
        const top = OGX.parse.topScore(html);
        if (!top) return cur || null;
        const rec = { points: top.points, playerId: top.playerId, t: OGX.time.serverNow() };
        await OGX.storage.set('topScore', rec, SRV);
        try { if (OGX.galaxy && OGX.galaxy.indexHighscore) await OGX.galaxy.indexHighscore(OGX.parse.highscorePlayers(html)); } catch (e) { /* optional */ }
        return rec;
      })().finally(() => { topInflight = null; });
    }
    return topInflight;
  };

  /** Body with amounts projected to `at` (calc.amountAt), arrivals applied when flights are given. */
  state.projected = function (body, at = OGX.time.serverNow(), { flights } = {}) {
    if (!body) return null;
    let b = OGX.util.clone(body);
    if (flights && b.res && OGX.flights && OGX.flights.applyArrivals) {
      b = OGX.flights.applyArrivals({ [b.key]: b }, flights, b.res.t, at)[b.key] || b;
    }
    if (b.res && b.res.t) {
      for (const k of ['metal', 'crystal', 'deuterium']) {
        const r = b.res[k];
        if (r) r.amount = OGX.calc.amountAt({ amount: r.amount, storage: r.storage, perHour: r.perHour, t: b.res.t }, at);
      }
      b.res.t = at;
    }
    return b;
  };

  const PAGE_PATH = { fleet: '/fleet', resources: '/resources', facilities: '/facilities', shipyard: '/shipyard', defense: '/defense', settings: '/resources/settings', research: '/research', empire: '/empire' };
  const PAGE_NAME = { fleet: 'fleet', resources: 'resources', facilities: 'facilities', shipyard: 'shipyard', defense: 'defense', settings: 'resourceSettings', research: 'research', empire: 'empire' };
  /** Fetches pages of every body through ?cp= (one restore at the end). Requires core.cpConfirmed for the ?cp= pages.
   * GALAXYZ 'empire' = one GET page=imperium WITHOUT cp (every body in one page): it needs no cpConfirmed and runs first. */
  /** Russian text of a refreshBodies error code for the UI (the raw code stays in errors[].error for logs and tests). */
  state.refreshErrorText = function (code) {
    const c = String(code || '');
    if (!c) return 'неизвестная ошибка';
    if (c === 'aborted') return 'отменено';
    if (c === 'cpConfirmed') return 'обновление не подтверждено';
    if (/^body mismatch/.test(c)) return 'игра показала другую планету (переключение не сработало), данные не сохранены';
    if (c === 'logged out' || c === 'csrf') return 'сессия игры завершена — войдите в игру заново';
    if (c === 'timeout') return 'сервер не ответил вовремя';
    if (/^http \d+/.test(c)) return 'ошибка сервера (' + c.replace('http', 'HTTP') + ')';
    if (/not readable/.test(c)) return 'страница не распознана';
    if (/lock "cp" busy/.test(c)) return 'другая вкладка сейчас переключает планеты — повторите позже';
    if (/cross-origin/.test(c)) return 'запрос на чужой сайт отклонён';
    return 'внутренняя ошибка (подробности в «Логи»)';
  };

  state.refreshBodies = async function ({ keys, include = ['fleet'], onProgress, signal } = {}) {
    const gzMode = !!(OGX.page.isGz && OGX.page.isGz());
    const empireDirect = gzMode && include.includes('empire');
    if (empireDirect) include = include.filter((x) => x !== 'empire');
    if (include.length && !OGX.settings.get('core.cpConfirmed')) return { done: 0, errors: [{ key: null, error: 'cpConfirmed' }], restored: false };
    const bodies = await state.bodies();
    const list = (keys || (await state.bodyList()).flatMap((x) => [x.planet.key].concat(x.moon ? [x.moon.key] : []))).filter((k) => bodies[k]);
    const jobs = [];
    let researchDone = false;
    let empireDone = false;
    for (const key of list) {
      const isMoon = bodies[key].type === 'moon';
      for (const inc of include) {
        if (inc === 'research') { if (researchDone) continue; researchDone = true; }
        if (inc === 'empire') { if (empireDone) continue; empireDone = true; }
        if (isMoon && inc === 'settings') continue;
        jobs.push({ key, inc });
      }
    }
    // GALAXYZ: mines, storage and facilities are one page (page=buildings): fetch it once per body
    if (gzMode) {
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (jobs[i].inc === 'facilities' && jobs.some((j) => j.key === jobs[i].key && j.inc === 'resources')) jobs.splice(i, 1);
      }
    }
    const errors = [];
    let done = 0;     // requests made (also the failed ones): the progress
    let ok = 0;       // requests whose page was stored: the «Обновлено N из M» of the summary
    let restored = false;
    const total = jobs.length + (empireDirect ? 1 : 0);
    const mergeDoc = async (doc, name) => {
      const s = state.snapshotSync(doc, name);
      const wall = s.serverTimeString ? OGX.time.parseServerWall(s.serverTimeString) : null;
      await state.merge(s, { t: wall || OGX.time.serverNow() });
      return s;
    };
    const withText = () => errors.map((e) => Object.assign(e, { text: state.refreshErrorText(e.error) }));
    const finish = () => { if (done) OGX.bus.emit('state:updated', { keys: ['bodies', 'research', 'slots'] }); return { done, ok, errors: withText(), restored }; };
    // GALAXYZ page=imperium: every body in one page, no planet switch
    if (empireDirect) {
      if (signal && signal.aborted) { errors.push({ key: null, error: 'aborted' }); return finish(); }
      const r = await OGX.api.page(PAGE_PATH.empire, { background: true });
      if (r.error) errors.push({ key: null, error: r.error });
      else {
        try {
          if (!state.snapshotSync(r.doc, PAGE_NAME.empire).empire) throw new Error('page=imperium not readable');
          await mergeDoc(r.doc, PAGE_NAME.empire);
          ok++;
        } catch (e) { errors.push({ key: null, error: String(e.message || e) }); }
      }
      done++;
      if (onProgress) OGX.safe(onProgress, 'refreshBodies:onProgress')(done, total, null);
      if (r.loggedOut) return finish();
    }
    if (!jobs.length) { restored = true; return finish(); }   // no ?cp= request: the selected planet never changed
    try {
      await OGX.http.withPlanet(bodies[jobs[0].key].id, async () => {
        for (const job of jobs) {
          if (signal && signal.aborted) { errors.push({ key: job.key, error: 'aborted' }); break; }
          const id = bodies[job.key].id;
          const r = await OGX.api.page(PAGE_PATH[job.inc], { cp: id, background: true });
          if (r.error) { errors.push({ key: job.key, error: r.error }); if (r.loggedOut) break; } else {
            try {
              const s = state.snapshotSync(r.doc, PAGE_NAME[job.inc]);
              if (s.current && s.current.id !== id) throw new Error('body mismatch ' + (s.current && s.current.id) + ' != ' + id);
              const wall = s.serverTimeString ? OGX.time.parseServerWall(s.serverTimeString) : null;
              await state.merge(s, { t: wall || OGX.time.serverNow() });
              ok++;
            } catch (e) { errors.push({ key: job.key, error: String(e.message || e) }); }
          }
          done++;
          if (onProgress) OGX.safe(onProgress, 'refreshBodies:onProgress')(done, total, job.key);
        }
      });
      restored = true;
    } catch (e) {
      errors.push({ key: null, error: String(e.message || e) });
    }
    OGX.bus.emit('state:updated', { keys: ['bodies', 'research', 'slots'] });
    return { done, ok, errors: withText(), restored };
  };

  state.onChange = function (keys, fn) {
    return OGX.bus.on('state:updated', (p) => {
      if (keys === '*' || !p || p.keys.some((k) => keys.includes(k))) fn(p);
    });
  };

  // ------------------------------------------------------------------ bridge captures (any page)
  state.init = function () {
    OGX.bridge.onXhr(/^\/ajax\/fleet\/dispatch\/check-target$/, async (x) => {
      const sd = x.json && x.json.shipsData;
      if (!sd || typeof sd !== 'object') return;
      await OGX.storage.set('shipStats', { src: 'checkTarget', t: OGX.time.serverNow(), stats: OGX.calc.statsFromShipsData(sd) });
      OGX.bus.emit('state:updated', { keys: ['shipStats'] });
    });
    // GALAXYZ galaxy one-click spy/recycle by the game's own page (GET page=fleetAjax&ajax=1&mission=6|8&planetID=, JSON
    // { code, mess, slots, ships }) -> 'fleet:ajax' always, plus 'fleet:sent' (source 'game', via 'fleetAjax') when code 600.
    OGX.bridge.onXhr(/^page=fleetajax\b/, (x) => {
      const ev = state._fleetAjaxEvent(x);
      if (!ev) return;
      OGX.bus.emit('fleet:ajax', ev);
      if (ev.ok) OGX.bus.emit('fleet:sent', { request: ev.request, response: ev.response, ok: true, source: 'game', via: 'fleetAjax',
        mission: ev.mission, from: null, to: ev.to, ships: null, planetId: ev.planetId, code: ev.code });
    });
    OGX.bridge.onXhr(/^\/ajax\/fleet\/dispatch\/send-fleet$/, (x) => {
      const ok = !!(x.json && x.json.success === true);
      OGX.bus.emit('fleet:sent', { request: x.form, response: x.json, ok, source: 'game' });
      if (ok && OGX.flights && OGX.flights.invalidate) OGX.flights.invalidate();
    });
    // #technologydetails replaced on list pages
    if (OGX.page.is('resources', 'facilities', 'research', 'shipyard', 'defense')) {
      const box = document.getElementById('technologydetails_content') || document.getElementById('technologydetails_wrapper');
      if (box) {
        let last = null;
        OGX.dom.observe(box, () => {
          const el = document.getElementById('technologydetails');
          if (!el || el === last) return;
          last = el;
          const btn = el.querySelector('button.upgrade[data-technology], button.downgrade[data-technology]');
          const costs = el.querySelector('.costs[data-tech-id]');   // GALAXYZ panel [UNVERIFIED]
          OGX.bus.emit('techdetails:open', { id: btn ? +btn.dataset.technology : costs ? +costs.dataset.techId : +el.dataset.technologyId || null, el });
        }, { debounce: 50 });
      }
    }
    repairSnapshot();
  };

  /** When the boot snapshot ran after the game had already moved the title attributes away (late content-script
   * timing), watch #resources / #planetList for the titles to come back (the game re-sets them on its resource
   * refresh) and merge what was missing. Stops when complete or after 15 s. */
  function repairSnapshot() {
    const s = snap;
    if (!s || s.engine === 'galaxyz') return;   // GALAXYZ tooltips are server-rendered titles, read at boot
    let needTips = !(s.tooltips && s.tooltips.metal) && !!document.getElementById('metal_box');
    let needPlanets = (s.planets || []).some((r) => r.diameter === null || r.diameter === undefined);
    if (!needTips && !needPlanets) return;
    const targets = [document.getElementById('resources'), document.getElementById('planetList')].filter(Boolean);
    if (!targets.length) return;
    let done = false;
    let timer = null;
    const mo = new MutationObserver(() => check());
    const stop = () => { done = true; mo.disconnect(); if (timer) clearTimeout(timer); };
    const check = OGX.safe(async () => {
      if (done) return;
      const patch = {};
      if (needTips) {
        const tips = OGX.parse.resourceTooltips(document);
        if (tips && tips.metal) { patch.tooltips = tips; needTips = false; }
      }
      if (needPlanets) {
        const planets = OGX.parse.planetList(document, location.href);
        if (planets.length && planets.every((r) => r.diameter !== null && r.diameter !== undefined)) { patch.planets = planets; needPlanets = false; }
      }
      if (!needTips && !needPlanets) stop();
      if (!Object.keys(patch).length) return;
      log.debug('snapshot repaired:', Object.keys(patch).join(', '));
      await state.merge(Object.assign({}, snap || s, patch));
    }, 'state:repairSnapshot');
    for (const t of targets) mo.observe(t, { attributes: true, attributeFilter: ['title'], subtree: true });
    timer = setTimeout(stop, 15000);
    check();
  }
  /** XhrEvent of page=fleetAjax -> { ok (code 600), code, message, mission, planetId, to ('g:s:p' from the message | null), slots,
   * ships ({ id: n } left on the planet), request (query), response (JSON), source: 'game' } | null when the answer is not JSON. */
  state._fleetAjaxEvent = function (x) {
    let j = x && x.json;
    if (!j && x && typeof x.responseText === 'string') { try { j = JSON.parse(x.responseText); } catch (e) { j = null; } }
    if (!j || typeof j !== 'object') return null;
    const q = Object.assign({}, x.form || {}, x.query || {});
    const code = j.code !== undefined ? +j.code : null;
    const mess = typeof j.mess === 'string' ? j.mess : null;
    const ships = {};
    if (j.ships && typeof j.ships === 'object') for (const [id, n] of Object.entries(j.ships)) ships[id] = +n || 0;
    return { ok: code === 600, code, message: mess, mission: q.mission !== undefined ? +q.mission : null,
      planetId: q.planetID !== undefined ? +q.planetID : null, to: mess ? OGX.util.coords(mess) : null,
      slots: j.slots !== undefined ? +j.slots : null, ships, request: q, response: j, source: 'game' };
  };
  state._reset = () => { snap = null; titlesCache = {}; };
})(window.OGX);
