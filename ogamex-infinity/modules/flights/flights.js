/* ogamex-infinity/modules/flights/flights.js — Owner: infinity/flights.
 * Flight visualisation (DESIGN §4.2.7; fleet.md §6, §8, §9, §12.2, §12.3, §13).
 *
 *   - Side-panel tab «Полёты» (order 70) of OGX.dom.sidePanel('infinity'): inline-SVG time axis, one lane per own body
 *     (planet-list order, moon after its planet) plus «Дальний космос»; one bar group per real mission
 *     (outbound -> hold -> return), colours by mission, hostile in red, foreign non-hostile dashed; a «сейчас» line moved
 *     on every tick; hover details (ships, cargo, from -> to, absolute times, countdown); zoom 1 ч / 6 ч / 24 ч / всё.
 *     Below: hostile incoming flights, then all flights, with «Отозвать» for own recallable missions (click + confirm).
 *   - /fleet/movement: a compact chart above #movement built from the page itself (OGX.flights.parseMovement), one row
 *     per mission with its return time.
 *   - Attack alert (setting titleAlert): «Полёты» tab badge with the hostile count and the document title prefixed «⚠ ».
 *     The «Infinity» menu badge is maintained by the panel module from the same core flight list.
 *
 * OgameX facts used:
 *   GET  /ajax/fleet/eventlist/fetch      routes/web.php:142 (through OGX.flights.get / startPolling)
 *   GET  /ajax/fleet/eventbox/fetch       routes/web.php:141 (core poller; the game's own polls are cross-checked here)
 *   POST /ajax/fleet/dispatch/recall-fleet routes/web.php:127, FleetController::dispatchRecallFleet (fleet.md §6):
 *        form fleet_mission_id=<real id>; failure = {"success":false} with HTTP 500 (through OGX.api.recall).
 *        The real id of a synthetic row is a.recallFleet[data-fleet-id] (eventrow.blade.php), resolved by core into realMissionId.
 *   /fleet/movement: div#movementcomponent.maincontent > div#movement (resources/views/ingame/fleet/movement.blade.php:15-16);
 *        rows .fleetDetails#fleet<id>, span.nextTimer[title] = return time (fleet.md §8.3).
 *   Synthetic event-list rows: hold end = id + 888888, return = id + 999999 (FleetEventsController:324-387, fleet.md §9.3).
 *   Hostile = foreign mission of type 1, 2, 6, 9, 10 (FEC::determineFriendly; core sets status 'hostile').
 *
 * GALAXYZ 1.8 (ogamex.eu/Aeternum; specs/galaxyz/fleet.md §1.2-1.3, §6; CORE_API §15):
 *   - No event-list XHR: every full page carries its event box, core stores it at boot (flights:updated). The tab shows that list;
 *     opening the tab never requests anything, ⟳ (click) GETs page=fleetTable. Own outward and return are two real events
 *     (returnFlight), a holding end is synthetic 'holdEnd'; groups that already ended are hidden (the list is as old as the page).
 *   - The core poller GETs page=fleetTable (marks the account online), so it runs only with the setting gzPoll (default off);
 *     the attack alert works on the event box of each page the user opens.
 *   - page=fleetTable has no #movement: the compact chart goes below the ship form (.fleetTablemain > form, under Continue),
 *     built from the page's own flights (OGX.flights.parseEventList(document): event box + movement rows, holds included).
 *   - Recall = OGX.fleet.recall(fleetId) (POST page=fleetTable&action=sendfleetback, click + our confirm); Hold recalled while
 *     holding returns after (arrival - departure) [UPSTREAM class.FleetFunctions.php:298-384].
 *
 * Data: reads core keys flights, bodies (and titles through core); writes settings only.
 * Requests: GET event list / event box through core caches and the core poller (only while titleAlert is on or the tab
 *   is shown), POST recall-fleet only on a confirmed click.
 */
(function (OGX) {
  'use strict';

  const NAME = 'flights';
  const P = 'ogx-i-flights-';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const DEEP = 'deep';
  const OTHER = 'other';
  const HOUR = 3600000;
  const ZOOMS = { '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR, all: null };
  const ZOOM_LABEL = { '1h': '1 ч', '6h': '6 ч', '24h': '24 ч', all: 'всё' };
  const EXPEDITION = 15;
  const RES = ['metal', 'crystal', 'deuterium'];
  const RES_RU = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий' };
  const COLORS = {
    1: '#ff8a3d', 2: '#ffab6b', 3: '#42a5f5', 4: '#66bb6a', 5: '#26a69a', 6: '#e0c341',
    7: '#ab47bc', 8: '#a1887f', 9: '#ec407a', 10: '#9e9e9e', 11: '#d4a5ff', 15: '#7e7cf0',
  };
  const HOSTILE_COLOR = '#f44336';
  const isGz = () => !!(OGX.page.isGz && OGX.page.isGz());
  const ALERT_PREFIX = '⚠ ';

  const now = () => OGX.time.serverNow();
  const h = (...a) => OGX.dom.h(...a);
  const rec = (s, k, w, d) => { try { OGX.log.rec(s, k, w, d); } catch (e) { /* journal off */ } };
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const color = (m) => COLORS[+m] || '#90a4ae';
  const hm = (ms) => OGX.fmt.time(ms).slice(0, 5);

  // ------------------------------------------------------------------ pure helpers (exported for tests as OGX._flightsViz)

  /** SVG element helper (OGX.dom.h creates HTML elements only). */
  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) if (dv !== null && dv !== undefined) el.dataset[dk] = String(dv); }
      else el.setAttribute(k, String(v));
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  }

  /** Event-list flights -> one group per real mission: { id, missionType, own, status, lane, segments: [{ kind, start|null, end }], ... }. */
  function groupFlights(list) {
    const by = new Map();
    for (const f of list || []) {
      if (!f) continue;
      const key = f.realMissionId !== null && f.realMissionId !== undefined ? String(f.realMissionId) : String(f.rowId);
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(f);
    }
    const out = [];
    for (const [id, rows] of by) {
      const outRow = rows.find((r) => r.synthetic === null && !r.returnFlight);
      const hold = rows.find((r) => r.synthetic === 'holdEnd');
      const ret = rows.find((r) => r.synthetic === 'return') || rows.find((r) => r.synthetic === null && r.returnFlight);
      const base = outRow || hold || ret;
      if (!base) continue;
      const departure = rows.map((r) => r.departure).find((d) => fin(d)) || null;
      const segments = [];
      if (outRow) segments.push({ kind: 'out', start: departure, end: outRow.arrival });
      if (hold) segments.push({ kind: 'hold', start: outRow ? outRow.arrival : null, end: hold.arrival });
      if (ret) {
        const st = hold ? hold.arrival : outRow ? outRow.arrival : null;
        segments.push({ kind: 'ret', start: st, end: ret.arrival });
      }
      const own = !!base.own;
      const status = rows.some((r) => r.status === 'hostile') ? 'hostile' : own ? 'friendly' : 'neutral';
      // Home side: own outbound -> origin, own return -> destination; foreign -> the own target.
      const home = own ? (outRow || hold ? (outRow || hold).originKey : ret.destKey) : base.destKey;
      const target = own ? (outRow || hold ? { c: (outRow || hold).to, t: (outRow || hold).toType } : { c: ret.from, t: ret.fromType }) : { c: base.from, t: base.fromType };
      const homeC = own ? (outRow || hold ? { c: (outRow || hold).from, t: (outRow || hold).fromType } : { c: ret.to, t: ret.toType }) : { c: base.to, t: base.toType };
      const deep = base.missionType === EXPEDITION || target.t === 4;
      const shipsRow = outRow || hold || ret;
      const cargoRow = outRow || hold || (ret && ret.synthetic === null ? ret : null);
      const recallRow = rows.find((r) => r.recallable);
      out.push({
        id, realMissionId: base.realMissionId, missionType: +base.missionType, own, status, isUnion: !!base.isUnion,
        lane: deep ? DEEP : home || OTHER, homeKey: home || null,
        home: homeC, target, onlyReturn: !outRow && !hold,
        segments, departure,
        arrival: segments[0].end, end: segments[segments.length - 1].end,
        ships: shipsRow.ships || {}, units: shipsRow.units || 0,
        cargo: cargoRow ? cargoRow.cargo : null,
        recallable: own && !!recallRow, recallId: recallRow ? recallRow.realMissionId : null,
      });
    }
    out.sort((a, b) => a.arrival - b.arrival);
    return out;
  }

  /** Movement-page rows -> groups (each row has its own return time, fleet.md §8.3). */
  function groupMovement(rows) {
    return (rows || []).map((m) => {
      const segments = [];
      const holdEnd = fin(m.timer) && m.timer > m.arrival ? m.timer : null;
      let departure = null;
      if (!m.returnFlight && fin(m.returnArrival)) {
        const oneWay = m.returnArrival - (holdEnd || m.arrival);
        if (oneWay > 0) departure = m.arrival - oneWay;
      }
      if (m.returnFlight) segments.push({ kind: 'ret', start: null, end: m.arrival });
      else {
        segments.push({ kind: 'out', start: departure, end: m.arrival });
        if (holdEnd) segments.push({ kind: 'hold', start: m.arrival, end: holdEnd });
        if (fin(m.returnArrival)) segments.push({ kind: 'ret', start: holdEnd || m.arrival, end: m.returnArrival });
      }
      return {
        id: String(m.id), realMissionId: m.id, missionType: +m.missionType, own: !!m.own, status: m.status,
        lane: String(m.id), home: { c: m.origin }, target: { c: m.destination }, onlyReturn: !!m.returnFlight,
        segments, departure, arrival: m.arrival, end: segments[segments.length - 1].end,
        returnArrival: fin(m.returnArrival) ? m.returnArrival : null, holdEnd,
        ships: m.ships || {}, units: m.units || 0, cargo: m.cargo || null, recallable: false, recallId: null,
      };
    });
  }

  /** Time window [t0, t1] for a zoom (ms span or null = everything). */
  function windowFor(groups, zoom, t) {
    const span = ZOOMS[zoom] === undefined ? ZOOMS['6h'] : ZOOMS[zoom];
    if (span) return { t0: t - span * 0.1, t1: t + span * 0.9 };
    let lo = t, hi = t + 10 * 60000;
    for (const g of groups) for (const sg of g.segments) {
      if (fin(sg.start)) lo = Math.min(lo, sg.start);
      if (fin(sg.end)) hi = Math.max(hi, sg.end);
    }
    const pad = Math.max(60000, (hi - lo) * 0.04);
    return { t0: lo - pad, t1: hi + pad };
  }

  /** Tick step (ms) giving about `want` ticks over the span. */
  function tickStep(span, want) {
    const steps = [60000, 300000, 600000, 900000, 1800000, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 48 * HOUR, 168 * HOUR];
    for (const st of steps) if (span / st <= want) return st;
    return steps[steps.length - 1];
  }

  OGX._flightsViz = { groupFlights, groupMovement, windowFor, tickStep };

  // ------------------------------------------------------------------ module
  OGX.module({
    name: NAME,
    title: 'Полёты: визуализация',
    pages: '*',
    settings: {
      defaultZoom: {
        type: 'enum', default: '6h', label: 'Масштаб графика полётов',
        options: [{ value: '1h', label: '1 час' }, { value: '6h', label: '6 часов' }, { value: '24h', label: '24 часа' }, { value: 'all', label: 'все полёты' }],
      },
      titleAlert: { type: 'bool', default: true, label: 'Предупреждать об атаке (значок «⚠» в заголовке вкладки)' },
      showOnMovement: { type: 'bool', default: true, label: 'График полётов на странице «Передвижение флотов»', hint: 'GALAXYZ: над списком полётов страницы «Флот»' },
      gzPoll: { type: 'bool', default: false, label: 'GALAXYZ: обновлять полёты в фоне', hint: 'Каждое обновление — запрос страницы «Флот», он держит аккаунт онлайн. Выключено: список берётся из блока событий каждой открытой страницы' },
    },
    async init(ctx) {
      ctx.css(CSS);
      const m = new Flights(ctx);
      ctx._flights = m;
      await m.start();
    },
    dispose(ctx) { if (ctx._flights) ctx._flights.dispose(); },
  });

  class Flights {
    constructor(ctx) {
      this.ctx = ctx;
      this.log = ctx.log;
      this.flights = [];
      this.flightsT = null;
      this.bodies = {};
      this.lanes = [];
      this.offs = [];
      this.detach = [];
      this.tabVisible = false;
      this.charts = [];       // { svg, x(t), t0, t1, nowLine, nowLabel }
      this.baseTitle = null;
      this.alertOn = false;
      this.lastHostile = -1;
      this.lastChartAt = 0;
      this.stopPoll = null;
      // B events (timed, errors with stacks) for every action this module performs.
      this.fetch = OGX.log.wrap(NAME, this._fetch.bind(this), 'fetch');
      this.recall = OGX.log.wrap(NAME, this._recall.bind(this), 'recall');
      this.setZoom = OGX.log.wrap(NAME, this._setZoom.bind(this), 'zoom');
      this.buildMovement = OGX.log.wrap(NAME, this._buildMovement.bind(this), 'movementChart');
      // ticks every second: the journal records only a change of { n, title } (quiet wrap), not each no-op tick
      this.applyAlert = OGX.log.wrap(NAME, this._applyAlert.bind(this), 'alert', { quiet: true });
    }

    S(k) { try { return this.ctx.settings.get(k); } catch (e) { return undefined; } }

    async start() {
      const ctx = this.ctx;
      this.refreshSoon = OGX.util.debounce(OGX.safe(() => this.refresh(), 'flights:refresh'), 150);
      await this.loadData();

      this.panel = OGX.dom.sidePanel('infinity', { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
      this.tab = this.panel.addTab({
        id: 'flights', label: 'Полёты', order: 70,
        render: (c) => this.renderTab(c),
        onShow: () => { this.tabVisible = true; this.ensureFresh(); },
        onHide: () => { this.tabVisible = false; this.clearDetach(); this.charts = this.charts.filter((c) => c.where !== 'tab'); },
      });

      this.offs.push(ctx.bus.on('flights:updated', (e) => {
        if (e && Array.isArray(e.flights)) { this.flights = e.flights; this.flightsT = e.t || now(); this.check(); }
        this.refreshSoon();
      }));
      this.offs.push(OGX.storage.subscribe('flights', (v, info) => {
        if (info && info.remote && v && Array.isArray(v.flights)) { this.flights = v.flights; this.flightsT = v.t || null; this.check(); this.refreshSoon(); }
      }));
      this.offs.push(ctx.bus.on('state:updated', (e) => {
        const keys = (e && e.keys) || [];
        if (keys.includes('bodies')) this.loadBodies().then(() => this.refreshSoon()).catch((err) => this.log.warn('bodies', err));
      }));
      this.offs.push(ctx.settings.onChange((key) => {
        rec('B', NAME, 'setting', { key });
        if (key === 'titleAlert' || key === 'gzPoll') { this.ensurePolling(); this.applyAlert(now()); }
        if (key === 'defaultZoom') this.refreshSoon();
        if (key === 'showOnMovement') this.buildMovement();
      }));
      // Cross-check: the game's own event-box poll (FEC:29-124) counts hostile missions by ownership, like core does.
      // GALAXYZ has no event-box XHR (the box is part of every full page).
      if (!isGz()) {
        try {
          this.offs.push(OGX.bridge.onXhr(/^\/ajax\/fleet\/eventbox\/fetch$/, (x) => this.onEventBox(x)));
        } catch (e) { this.log.debug('bridge', e); }
      }

      this.check();
      if (OGX.page.is('movement')) this.buildMovement();
      this.ensurePolling();
      this.applyAlert(now());
      ctx.every(1000, (t) => this.tick(t));
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* gone */ } }
      this.offs = [];
      this.clearDetach();
      if (this.refreshSoon && this.refreshSoon.cancel) this.refreshSoon.cancel();
      if (this.stopPoll) { try { this.stopPoll(); } catch (e) { /* gone */ } this.stopPoll = null; }
      this.restoreTitle();
    }

    clearDetach() {
      for (const d of this.detach) { try { d(); } catch (e) { /* gone */ } }
      this.detach = [];
    }

    // ---------------------------------------------------------------- data
    async loadData() {
      try {
        const fl = await OGX.flights.cached();   // core: stored list, no request
        if (fl && Array.isArray(fl.flights)) { this.flights = fl.flights; this.flightsT = fl.t || null; }
      } catch (e) { this.log.warn('flights store', e); }
      await this.loadBodies();
    }

    async loadBodies() {
      try {
        this.bodies = (await OGX.state.bodies()) || {};
        const list = (await OGX.state.bodyList()) || [];
        const lanes = [];
        for (const { planet, moon } of list) {
          lanes.push({ key: planet.key, label: planet.name || 'Планета', coords: planet.coords, moon: false });
          if (moon) lanes.push({ key: moon.key, label: moon.name || 'Луна', coords: moon.coords, moon: true });
        }
        this.lanes = lanes;
      } catch (e) { this.log.warn('bodies', e); this.lanes = []; }
    }

    /** Sanity checks on the parsed flight list (L 'implausible' alerts through OGX.learn). */
    check() {
      const t = now();
      for (const f of this.flights || []) {
        OGX.learn.value('flights.units', +f.units, { min: 0, int: true });
        OGX.learn.value('flights.arrivalHoursFromNow', (f.arrival - t) / HOUR, { min: -48, max: 24 * 90 });
        if (f.cargo) OGX.learn.check('flights.cargo', { metal: f.cargo.metal, crystal: f.cargo.crystal, deuterium: f.cargo.deuterium });
      }
      for (const g of groupFlights(this.flights)) {
        for (const sg of g.segments) if (fin(sg.start)) OGX.learn.value('flights.segmentMinutes', (sg.end - sg.start) / 60000, { min: 0 });
      }
    }

    async _fetch(force) {
      const r = await OGX.flights.get({ force: !!force, maxAgeMs: 60000 });
      if (r && r.error) {
        this.log.warn('flights.get failed', r.error);
        this.status = 'Не удалось загрузить список флотов: ' + r.error;
        this.refreshSoon();
        return { ok: false, error: r.error };
      }
      this.status = null;
      if (r && Array.isArray(r.flights)) { this.flights = r.flights; this.flightsT = r.t || now(); this.check(); this.refreshSoon(); }
      return { ok: true, n: r && r.flights ? r.flights.length : 0 };
    }

    ensureFresh() {
      // GALAXYZ: the list is the event box of this page (stored at boot); a GET would be page=fleetTable: only on the ⟳ click
      if (isGz()) return;
      if (this.flightsT && now() - this.flightsT < 60000) return;
      Promise.resolve(this.fetch(false)).catch((e) => this.log.warn('fetch', e));
    }

    /** The shared core poller (one per tab) keeps the hostile count fresh for the attack alert. */
    ensurePolling() {
      const want = !!this.S('titleAlert') && (!isGz() || !!this.S('gzPoll'));
      if (!want) {
        if (this.stopPoll) { try { this.stopPoll(); } catch (e) { /* gone */ } this.stopPoll = null; rec('B', NAME, 'poller:stop', {}); }
        return;
      }
      if (!this.stopPoll) {
        this.stopPoll = OGX.flights.startPolling();
        rec('B', NAME, 'poller:start', { sec: OGX.settings.get('core.flightsPollSec') });
      }
    }

    onEventBox(x) {
      if (!x || x.status !== 200 || !x.json) return;
      const theirs = +x.json.hostile;
      if (!fin(theirs)) return;
      OGX.learn.value('flights.eventbox.hostile', theirs, { min: 0, int: true });
      const ours = this.hostileGroups(now()).length;
      if (theirs !== ours) {
        this.log.debug('hostile count differs from the event box', { eventbox: theirs, list: ours });
        rec('B', NAME, 'hostile-mismatch', { eventbox: theirs, list: ours });
        if (theirs > ours) Promise.resolve(this.fetch(true)).catch((e) => this.log.warn('fetch', e));
      }
    }

    groups() {
      const all = groupFlights(this.flights);
      if (!isGz()) return all;
      // GALAXYZ: the stored list is the event box of the last page; missions that ended since are gone on the server
      const t = now();
      return all.filter((g) => g.end > t);
    }

    hostileGroups(t) {
      return this.groups().filter((g) => g.status === 'hostile' && !g.onlyReturn && g.arrival > t);
    }

    // ---------------------------------------------------------------- tick / alert
    tick(t) {
      for (const c of this.charts) this.moveNow(c, t);
      // every second: the unwrapped call (the wrapped one journals each call, which flooded «Логи для разбора» with one
      // 'flights alert' event per second while a hostile fleet was shown); a change of the count is journaled as 'hostile'
      this._applyAlert(t);
      // The window follows the clock: redraw the charts every 30 s.
      if (this.tabVisible && Date.now() - this.lastChartAt > 30000) this.redrawTabChart();
    }

    _applyAlert(t) {
      const n = this.hostileGroups(t).length;
      if (n !== this.lastHostile) {
        this.lastHostile = n;
        if (this.tab) this.tab.setBadge(n ? String(n) : null);
        rec('B', NAME, 'hostile', { n });
      }
      const want = n > 0 && !!this.S('titleAlert');
      const cur = document.title || '';
      if (want) {
        if (!cur.startsWith(ALERT_PREFIX)) { this.baseTitle = cur; document.title = ALERT_PREFIX + cur; }
        this.alertOn = true;
      } else if (this.alertOn) this.restoreTitle();
      return { n, title: want };
    }

    restoreTitle() {
      if (!this.alertOn) return;
      this.alertOn = false;
      const cur = document.title || '';
      if (cur.startsWith(ALERT_PREFIX)) document.title = cur.slice(ALERT_PREFIX.length);
    }

    // ---------------------------------------------------------------- tab
    refresh() {
      if (this.tab) this.tab.refresh();
      if (OGX.page.is('movement') && !OGX.dom.$('#' + P + 'movement')) this.buildMovement();
    }

    zoom() {
      const z = this.S('defaultZoom');
      return ZOOMS[z] === undefined ? '6h' : z;
    }

    async _setZoom(z) {
      if (ZOOMS[z] === undefined) return { ok: false };
      await this.ctx.settings.set('defaultZoom', z);
      this.refreshSoon();
      return { ok: true, zoom: z };
    }

    renderTab(c) {
      this.clearDetach();
      this.charts = this.charts.filter((x) => x.where !== 'tab');
      this.tabVisible = true;
      const t = now();
      const groups = this.groups();
      const root = h('div', { class: P + 'tab' });
      c.appendChild(root);

      // Toolbar: zoom + reload + data age.
      const zoom = this.zoom();
      const bar = h('div', { class: P + 'toolbar' },
        h('span', { class: P + 'zoomlabel' }, 'Масштаб:'),
        Object.keys(ZOOMS).map((z) => h('button', {
          type: 'button', class: ['ogx-btn', P + 'zoom', z === zoom && 'ogx-btn-primary'], dataset: { zoom: z, ogxAct: 'flights:zoom:' + z },
          title: z === 'all' ? 'Показать все полёты' : 'Показать ' + ZOOM_LABEL[z] + ' от текущего момента',
          onClick: () => this.setZoom(z),
        }, ZOOM_LABEL[z])),
        h('button', {
          type: 'button', class: ['ogx-btn', 'ogx-btn-icon', P + 'reload'], title: isGz() ? 'Обновить список полётов (загрузит страницу «Флот»)' : 'Обновить список полётов', dataset: { ogxAct: 'flights:reload' },
          onClick: () => this.fetch(true),
        }, OGX.dom.icon('refresh')),
        h('span', { class: P + 'age', title: isGz() ? 'Список — блок событий последней открытой страницы игры' : null }, this.flightsT ? 'данные: ' + OGX.fmt.ago(this.flightsT) : 'данных ещё нет'));
      root.appendChild(bar);
      if (this.status) root.appendChild(h('div', { class: [P + 'status', 'ogx-bad'] }, this.status));

      if (!groups.length) {
        root.appendChild(h('div', { class: P + 'empty' }, this.flightsT ? 'Флотов в полёте нет.' : 'Загрузка списка полётов…'));
        return;
      }

      this.chartBox = h('div', { class: P + 'chartbox' });
      root.appendChild(this.chartBox);
      this.drawTabChart(this.chartBox, groups, t);
      root.appendChild(this.legend(groups));

      // Hostile first.
      const hostile = this.hostileGroups(t);
      if (hostile.length) {
        root.appendChild(h('h3', { class: [P + 'h', P + 'h-hostile'] }, 'Враждебные флоты (' + hostile.length + ')'));
        root.appendChild(this.listTable(hostile, t, true));
      }
      root.appendChild(h('h3', { class: P + 'h' }, 'Все полёты (' + groups.length + ')'));
      const sorted = groups.slice().sort((a, b) => this.nextEvent(a, t) - this.nextEvent(b, t));
      root.appendChild(this.listTable(sorted, t, false));
    }

    redrawTabChart() {
      if (!this.chartBox || !this.chartBox.isConnected) return;
      this.clearDetach();
      this.charts = this.charts.filter((x) => x.where !== 'tab');
      this.chartBox.textContent = '';
      this.drawTabChart(this.chartBox, this.groups(), now());
    }

    drawTabChart(box, groups, t) {
      this.lastChartAt = Date.now();
      // Lanes: own bodies in planet-list order, then deep space, then «other» only when used.
      const used = new Set(groups.map((g) => g.lane));
      const lanes = this.lanes.map((l) => Object.assign({}, l));
      for (const k of used) {
        if (k === DEEP || k === OTHER || lanes.some((l) => l.key === k)) continue;
        const b = this.bodies[k];
        lanes.push({ key: k, label: b ? b.name : k, coords: b ? b.coords : '', moon: b ? b.type === 'moon' : false });
      }
      lanes.push({ key: DEEP, label: 'Дальний космос', coords: '', deep: true });
      if (used.has(OTHER)) lanes.push({ key: OTHER, label: 'Прочее', coords: '' });
      const width = Math.max(320, Math.round(box.clientWidth || (this.panel && this.panel.body && this.panel.body.clientWidth) || 400) - 4);
      const win = windowFor(groups, this.zoom(), t);
      const chart = this.chart({ groups, lanes, t, win, width, compact: false });
      chart.where = 'tab';
      box.appendChild(chart.svg);
      this.charts.push(chart);
    }

    /**
     * Builds one SVG chart. lanes: [{ key, label, coords, moon?, deep? }]; groups carry lane = lane key.
     * Several groups in one lane are stacked in sub-rows when their spans overlap.
     */
    chart({ groups, lanes, t, win, width, compact }) {
      const LABEL = compact ? 150 : 96;
      const RIGHT = compact ? 92 : 8;
      const ROW = compact ? 14 : 12;
      const GAP = 3;
      const AXIS = 18;
      const plotW = Math.max(60, width - LABEL - RIGHT);
      const { t0, t1 } = win;
      const x = (ms) => LABEL + ((ms - t0) / (t1 - t0)) * plotW;
      const clampX = (ms) => Math.max(LABEL, Math.min(LABEL + plotW, x(ms)));

      // Sub-row packing per lane.
      const laneRows = new Map();
      const placed = [];
      for (const lane of lanes) laneRows.set(lane.key, []);
      for (const g of groups) {
        if (!laneRows.has(g.lane)) continue;
        const rows = laneRows.get(g.lane);
        const start = Math.min(...g.segments.map((sg) => (fin(sg.start) ? sg.start : t)));
        let r = rows.findIndex((endMs) => endMs + (t1 - t0) * 0.01 < start);
        if (r < 0) { rows.push(g.end); r = rows.length - 1; } else rows[r] = g.end;
        placed.push({ g, row: r });
      }
      let y = AXIS;
      const laneY = new Map();
      const laneEls = [];
      for (const lane of lanes) {
        const n = Math.max(1, laneRows.get(lane.key).length);
        const hgt = n * ROW + (n + 1) * GAP;
        laneY.set(lane.key, y);
        laneEls.push({ lane, y, hgt });
        y += hgt;
      }
      const H = y + 2;

      const svg = s('svg', { class: [P + 'chart', compact && P + 'chart-compact'], width: width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'img', 'aria-label': 'График полётов' });
      // Lanes + labels.
      laneEls.forEach(({ lane, y: ly, hgt }, i) => {
        const label = (lane.moon ? '☾ ' : '') + (lane.label || '') + (lane.coords ? ' [' + lane.coords + ']' : '');
        svg.appendChild(s('rect', { class: [P + 'lane', i % 2 && P + 'lane-alt'], x: 0, y: ly, width: width, height: hgt, dataset: { lane: lane.key } }, s('title', {}, label)));
        svg.appendChild(s('text', { class: [P + 'lanelabel', lane.deep && P + 'lanelabel-deep'], x: 4, y: ly + Math.min(hgt, ROW + 2 * GAP) / 2 + 4 }, label));
      });
      // Axis ticks.
      const step = tickStep(t1 - t0, Math.max(2, Math.floor(plotW / 60)));
      const tzShift = (OGX.time && OGX.time.tzOffsetMs) || 0;
      for (let tk = Math.ceil((t0 + tzShift) / step) * step - tzShift; tk <= t1; tk += step) {
        const xx = x(tk);
        if (xx < LABEL || xx > LABEL + plotW) continue;
        svg.appendChild(s('line', { class: P + 'grid', x1: xx, x2: xx, y1: AXIS - 3, y2: H }));
        svg.appendChild(s('text', { class: P + 'tick', x: xx, y: 11, 'text-anchor': 'middle' }, step >= 24 * HOUR ? OGX.fmt.dateTime(tk).slice(0, 5) : hm(tk)));
      }
      // Bars.
      for (const { g, row } of placed) {
        const by = laneY.get(g.lane) + GAP + row * (ROW + GAP);
        const hostile = g.status === 'hostile';
        const col = hostile ? HOSTILE_COLOR : color(g.missionType);
        const grp = s('g', {
          class: [P + 'group', hostile && P + 'hostile', g.own ? P + 'own' : P + 'foreign', g.onlyReturn && P + 'onlyret'],
          dataset: { mission: g.id, missionType: g.missionType, lane: g.lane }, tabindex: '0',
        });
        let drawn = 0;
        for (const sg of g.segments) {
          const st = fin(sg.start) ? sg.start : t;
          if (sg.end < t0 || st > t1 || !(sg.end > st - 1)) continue;
          const x1 = clampX(st), x2 = Math.max(clampX(sg.end), x1 + 2);
          const r = s('rect', {
            class: [P + 'seg', P + 'seg-' + sg.kind, !fin(sg.start) && P + 'seg-open'],
            x: x1.toFixed(1), y: by, width: (x2 - x1).toFixed(1), height: ROW, rx: 2,
            fill: col, stroke: col, dataset: { kind: sg.kind, start: fin(sg.start) ? Math.round(sg.start) : '', end: Math.round(sg.end) },
          });
          grp.appendChild(r);
          drawn++;
          if (sg.end > t1) grp.appendChild(s('path', { class: P + 'more', d: `M${LABEL + plotW - 5},${by + 1} l5,${ROW / 2 - 1} l-5,${ROW / 2 - 1} z`, fill: col }));
          if (sg.kind === 'out' && x(sg.end) >= LABEL && x(sg.end) <= LABEL + plotW) {
            grp.appendChild(s('line', { class: P + 'arrive', x1: x(sg.end), x2: x(sg.end), y1: by - 1, y2: by + ROW + 1, stroke: col }));
          }
        }
        if (!drawn) {
          // Outside the window: a small marker at the edge keeps the mission visible and hoverable.
          const edgeRight = g.segments[0].end > t1;
          const ex = edgeRight ? LABEL + plotW - 6 : LABEL;
          grp.appendChild(s('rect', { class: [P + 'seg', P + 'seg-edge'], x: ex, y: by, width: 6, height: ROW, fill: col, stroke: col, dataset: { kind: 'edge' } }));
        }
        if (compact) {
          const ret = g.returnArrival;
          const txt = ret ? 'возврат ' + hm(ret) : 'прибытие ' + hm(g.arrival);
          grp.appendChild(s('text', { class: [P + 'rettext', ret && P + 'hasret'], x: width - RIGHT + 4, y: by + ROW - 3 }, txt));
        }
        svg.appendChild(grp);
        this.detach.push(OGX.dom.tooltip(grp, () => this.tip(g)));
      }
      // Now line.
      const nowLine = s('line', { class: P + 'now', x1: x(t), x2: x(t), y1: AXIS - 4, y2: H });
      const nowLabel = s('text', { class: P + 'nowlabel', x: x(t) + 2, y: H - 3 }, 'сейчас');
      svg.appendChild(nowLine);
      svg.appendChild(nowLabel);
      return { svg, x, t0, t1, LABEL, plotW, nowLine, nowLabel };
    }

    moveNow(c, t) {
      if (!c.svg.isConnected) return;
      const xx = c.x(t);
      const hide = xx < c.LABEL || xx > c.LABEL + c.plotW;
      for (const el of [c.nowLine, c.nowLabel]) {
        if (hide) el.setAttribute('visibility', 'hidden');
        else el.removeAttribute('visibility');
      }
      c.nowLine.setAttribute('x1', xx.toFixed(3));
      c.nowLine.setAttribute('x2', xx.toFixed(3));
      c.nowLabel.setAttribute('x', (xx + 2).toFixed(3));
      c.svg.dataset.now = String(Math.round(t));
    }

    legend(groups) {
      const types = [...new Set(groups.map((g) => g.missionType))].sort((a, b) => a - b);
      return h('div', { class: P + 'legend' },
        types.map((m) => h('span', { class: P + 'legend-item' }, h('i', { class: P + 'dot', style: { background: color(m) } }), OGX.catalog.missionName(m))),
        groups.some((g) => g.status === 'hostile') ? h('span', { class: P + 'legend-item' }, h('i', { class: P + 'dot', style: { background: HOSTILE_COLOR } }), 'враждебный') : null,
        h('span', { class: [P + 'legend-item', P + 'legend-muted'] }, 'светлее — удержание, штрих — возврат, пунктир — чужой флот'));
    }

    nextEvent(g, t) {
      const next = g.segments.map((sg) => sg.end).find((e) => e > t);
      return next || g.end;
    }

    place(p) {
      if (!p || !p.c) return '—';
      return OGX.fmt.coords(p.c, p.t === 3 ? 3 : p.t === 2 ? 2 : undefined) + (p.t === 4 ? ' (дальний космос)' : '');
    }

    /** Direction of travel: own outbound home -> target; returns and foreign fleets target side -> home side. */
    route(g) {
      return g.onlyReturn || !g.own ? this.place(g.target) + ' → ' + this.place(g.home) : this.place(g.home) + ' → ' + this.place(g.target);
    }

    shipsText(g) {
      const parts = Object.entries(g.ships || {}).filter(([, n]) => n > 0).map(([id, n]) => OGX.catalog.shortName(+id) + ' ' + OGX.fmt.num(n));
      return parts.length ? parts.join(', ') : (g.units ? OGX.fmt.num(g.units) + ' ед.' : '—');
    }

    cargoTotal(g) {
      if (!g.cargo) return 0;
      return RES.reduce((a, k) => a + (+g.cargo[k] || 0), 0);
    }

    tip(g) {
      const t = now();
      const rows = [];
      const row = (k, v) => rows.push(h('tr', {}, h('td', { class: P + 'tk' }, k), h('td', {}, v)));
      row('Миссия', OGX.catalog.missionName(g.missionType) + (g.onlyReturn ? ' (возврат)' : '') + (g.own ? '' : g.status === 'hostile' ? ' — враждебный флот' : ' — чужой флот'));
      row('Откуда → куда', this.route(g));
      row('Флот', this.shipsText(g));
      if (g.cargo) {
        const approx = g.cargo.approx ? '≈' : '';
        row('Груз', RES.map((k) => RES_RU[k][0] + ' ' + (+g.cargo[k] ? approx : '') + OGX.fmt.num(+g.cargo[k] || 0)).join(' · '));
      }
      if (fin(g.departure)) row('Вылет', OGX.fmt.dateTime(g.departure));
      for (const sg of g.segments) {
        const lbl = sg.kind === 'out' ? 'Прибытие' : sg.kind === 'hold' ? 'Конец удержания' : 'Возвращение';
        row(lbl, OGX.fmt.dateTime(sg.end) + (sg.end > t ? ' (через ' + OGX.fmt.duration((sg.end - t) / 1000) + ')' : ''));
      }
      return h('div', { class: P + 'tip' }, h('table', {}, rows));
    }

    listTable(groups, t, hostileOnly) {
      const head = h('tr', {}, ['Миссия', 'Маршрут', 'Флот', 'Груз', 'Прибытие', ''].map((x) => h('th', {}, x)));
      const body = groups.map((g) => {
        const out = g.segments.find((sg) => sg.kind === 'out' || sg.kind === 'hold') || g.segments[0];
        const ret = g.segments.find((sg) => sg.kind === 'ret');
        const route = this.route(g);
        const total = this.cargoTotal(g);
        const cargoTitle = g.cargo ? RES.map((k) => RES_RU[k] + ': ' + OGX.fmt.num(+g.cargo[k] || 0)).join('\n') : '';
        const btn = g.recallable && g.recallId && out && out.end > t && !g.onlyReturn
          ? h('button', {
            type: 'button', class: ['ogx-btn', P + 'recall'], dataset: { ogxAct: 'flights:recall', mission: g.recallId },
            title: 'Отозвать флот (вернётся через ' + (fin(g.departure) ? OGX.fmt.duration((t - g.departure) / 1000) : 'время, уже проведённое в полёте') + ')',
            onClick: (ev) => this.recall(g, ev.currentTarget),
          }, 'Отозвать')
          : null;
        return h('tr', { class: [P + 'row', g.status === 'hostile' && P + 'row-hostile', !g.own && P + 'row-foreign'], dataset: { mission: g.id } },
          h('td', {}, h('i', { class: P + 'dot', style: { background: g.status === 'hostile' ? HOSTILE_COLOR : color(g.missionType) } }),
            OGX.catalog.missionName(g.missionType) + (g.onlyReturn ? ' (возврат)' : '')),
          h('td', { class: P + 'route' }, route),
          h('td', { class: 'ogx-right', title: this.shipsText(g) }, OGX.fmt.num(g.units)),
          h('td', { class: 'ogx-right', title: cargoTitle }, g.cargo ? (g.cargo.approx ? '≈' : '') + OGX.fmt.short(total) : '—'),
          h('td', { class: P + 'when' }, h('span', { class: P + 'abs' }, OGX.fmt.time(out.end)), ' ', OGX.dom.countdown(out.end, { short: true }),
            ret && ret !== out ? h('div', { class: P + 'ret', title: 'Возвращение ' + OGX.fmt.dateTime(ret.end), dataset: { ret: Math.round(ret.end) } }, '↩ ' + OGX.fmt.time(ret.end)) : null),
          h('td', {}, btn));
      });
      return h('div', { class: P + 'listwrap' }, h('table', { class: ['ogx-table', P + 'list', hostileOnly && P + 'list-hostile'] }, h('thead', {}, head), h('tbody', {}, body)));
    }

    /** Recall an own mission: confirm, POST recall-fleet (OGX.api.recall), then re-fetch the event list. Click only. */
    async _recall(g, btn) {
      const id = g.recallId;
      const t = now();
      const out = g.segments.find((sg) => sg.kind === 'out');
      // 2Moons: a Hold fleet recalled while holding flies back the outward time (fleet_start_time - start_time)
      const flown = fin(g.departure) ? (isGz() && out && out.end <= t ? out.end - g.departure : t - g.departure) : null;
      const back = flown !== null ? 'Флот вернётся примерно ' + OGX.fmt.dateTime(t + flown) + '.' : 'Обратный путь займёт столько же, сколько флот уже летит.';
      const ok = await OGX.dom.confirm(h('div', {},
        h('p', {}, 'Отозвать флот «' + OGX.catalog.missionName(g.missionType) + '» ' + this.route(g) + '?'),
        h('p', {}, back)), { okLabel: 'Отозвать', danger: true, title: 'Отзыв флота' });
      if (!ok) { rec('U', 'click', 'flights:recall:cancel', { id }); return { cancelled: true, id }; }
      if (btn) btn.disabled = true;
      let r;
      try {
        // GALAXYZ: POST page=fleetTable&action=sendfleetback (core; confirmed above); OgameX: recall-fleet
        r = isGz() ? await OGX.fleet.recall(id, { confirm: false }) : await OGX.api.recall(id);
      } finally { if (btn && btn.isConnected) btn.disabled = false; }
      if (r && r.success) {
        OGX.dom.toast('Флот отозван', { type: 'ok' });
        if (r.flightsUpdated) await this.fetch(false);   // GALAXYZ: core stored the fleetTable page the POST answered: no second GET
        else { await OGX.flights.invalidate(); await this.fetch(true); }
      } else {
        OGX.dom.toast('Не удалось отозвать флот' + (r && r.status ? ' (HTTP ' + r.status + ')' : '') + ': миссия не найдена, уже обработана или чужая', { type: 'error', ms: 6000 });
        this.log.warn('recall failed', { id, status: r && r.status });
      }
      return { success: !!(r && r.success), status: r && r.status, id };
    }

    // ---------------------------------------------------------------- /fleet/movement
    _buildMovement() {
      const old = document.getElementById(P + 'movement');
      if (old) old.remove();
      this.charts = this.charts.filter((c) => c.where !== 'movement');
      if (!OGX.page.is('movement') || !this.S('showOnMovement')) return { built: false };
      if (isGz()) return this.buildMovementGz();
      const movement = OGX.dom.$('#movementcomponent > #movement') || OGX.dom.$('#movement');   // movement.blade.php:15-16
      if (!movement) return { built: false, reason: 'no #movement' };
      OGX.dom.$$('#movement .fleetDetails[id^="fleet"]');   // counted for self-learning; parsed by core below
      let rows = [];
      try {
        rows = OGX.flights.parseMovement(document, { bodies: this.bodies, titles: OGX.state.titlesSync ? OGX.state.titlesSync() : undefined,
          ownCoords: Object.values(this.bodies || {}).map((b) => b && b.coords).filter(Boolean) });
      } catch (e) { this.log.error('parseMovement', e); }
      if (!rows.length && Object.keys(this.bodies || {}).length === 0) {
        try { rows = OGX.flights.parseMovement(document); } catch (e) { /* none */ }
      }
      for (const m of rows) {
        OGX.learn.value('flights.movement.arrival', m.arrival / 1000, { min: 1e9, int: true });
        if (m.returnArrival !== null && m.returnArrival !== undefined) OGX.learn.value('flights.movement.returnAfterArrival', (m.returnArrival - m.arrival) / 1000, { min: 0 });
      }
      if (!rows.length) return { built: false, rows: 0 };
      const groups = groupMovement(rows);
      const t = now();
      const lanes = groups.map((g) => ({
        key: g.lane,
        label: OGX.catalog.missionName(g.missionType) + (g.onlyReturn ? ' (возвр.)' : ''),
        coords: g.onlyReturn ? (g.target.c || '?') + '→' + (g.home.c || '?') : (g.home.c || '?') + '→' + (g.target.c || '?'),
      }));
      const box = h('div', { id: P + 'movement', class: ['ogx-root', P + 'movement'] },
        h('div', { class: P + 'mhead' }, h('b', {}, 'OgameX Infinity: полёты'), h('span', { class: P + 'age' }, ' ' + rows.length + ' ' + OGX.fmt.plural(rows.length, ['миссия', 'миссии', 'миссий']))));
      movement.parentNode.insertBefore(box, movement);
      const width = Math.max(360, Math.round(movement.clientWidth || box.clientWidth || 640));
      const chart = this.chart({ groups, lanes, t, win: windowFor(groups, 'all', t), width, compact: true });
      chart.where = 'movement';
      chart.svg.classList.add(P + 'mchart');
      box.appendChild(chart.svg);
      for (const el of chart.svg.querySelectorAll('.' + P + 'group')) el.classList.add(P + 'mrow');
      this.charts.push(chart);
      return { built: true, rows: rows.length };
    }
  }

  /** GALAXYZ page=fleetTable: chart below the ship form (under the game's Continue button), from the page's own flights (event box + movement rows). */
  Flights.prototype.buildMovementGz = function () {
    const main = OGX.dom.$('.fleetTablemain');
    const table = main ? Array.from(main.children).find((e) => e.tagName === 'TABLE' && e.classList.contains('listOfOthers')) : null;
    if (!table) return { built: false, reason: 'no movement table' };
    let list = [];
    try {
      list = OGX.flights.parseEventList(document, { bodies: this.bodies, titles: OGX.state.titlesSync ? OGX.state.titlesSync() : undefined,
        ownCoords: Object.values(this.bodies || {}).map((b) => b && b.coords).filter(Boolean) });
    } catch (e) { this.log.error('parseEventList', e); }
    const t = now();
    const groups = groupFlights(list.filter((f) => f.own)).filter((g) => g.end > t);
    for (const g of groups) {
      const ret = g.segments.find((sg) => sg.kind === 'ret');
      g.returnArrival = ret ? ret.end : null;
      g.lane = 'm' + g.id;
      OGX.learn.value('flights.movement.arrival', g.arrival / 1000, { min: 1e9, int: true });
    }
    if (!groups.length) return { built: false, rows: 0 };
    const lanes = groups.map((g) => ({
      key: g.lane,
      label: OGX.catalog.missionName(g.missionType) + (g.onlyReturn ? ' (возвр.)' : ''),
      coords: g.onlyReturn ? (g.target.c || '?') + '→' + (g.home.c || '?') : (g.home.c || '?') + '→' + (g.target.c || '?'),
    }));
    const box = h('div', { id: P + 'movement', class: ['ogx-root', P + 'movement', P + 'movement-gz'] },
      h('div', { class: P + 'mhead' }, h('b', {}, 'OgameX Infinity: полёты'), h('span', { class: P + 'age' }, ' ' + groups.length + ' ' + OGX.fmt.plural(groups.length, ['миссия', 'миссии', 'миссий']))));
    // below the ship form (not above the movement table): the page's own Continue button must stay where it is, or the
    // fixed #siteFooter covers it on a 900 px high screen (verify-r1)
    const form = Array.from(main.children).filter((e) => e.tagName === 'FORM').pop();
    if (form) form.after(box); else main.appendChild(box);
    const width = Math.max(360, Math.round(box.clientWidth || table.clientWidth || 640) - 14);
    const chart = this.chart({ groups, lanes, t, win: windowFor(groups, 'all', t), width, compact: true });
    chart.where = 'movement';
    chart.svg.classList.add(P + 'mchart');
    box.appendChild(chart.svg);
    for (const el of chart.svg.querySelectorAll('.' + P + 'group')) el.classList.add(P + 'mrow');
    this.charts.push(chart);
    return { built: true, rows: groups.length };
  };

  const CSS = `
.${P}tab { font: 11px/1.4 Verdana, Arial, sans-serif; color: var(--ogx-text, #ddd); }
.${P}toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.${P}toolbar .ogx-btn { padding: 1px 6px; }
.${P}age { color: var(--ogx-muted, #8a96a3); margin-left: auto; font-size: 10px; }
.${P}status { margin: 4px 0; }
.${P}empty { padding: 12px; color: var(--ogx-muted, #8a96a3); text-align: center; }
.${P}chartbox { overflow-x: auto; }
svg.${P}chart { display: block; background: rgba(0,0,0,.25); border: 1px solid var(--ogx-border, #2c3440); border-radius: 3px; font: 9px Verdana, Arial, sans-serif; }
.${P}lane { fill: transparent; }
.${P}lane-alt { fill: rgba(255,255,255,.035); }
.${P}lanelabel { fill: var(--ogx-text, #ccd); font-size: 9px; }
.${P}lanelabel-deep { fill: #9fa8da; font-style: italic; }
.${P}grid { stroke: rgba(255,255,255,.08); stroke-width: 1; }
.${P}tick { fill: var(--ogx-muted, #8a96a3); font-size: 9px; }
.${P}group { cursor: default; outline: none; }
.${P}seg { stroke-width: 1; fill-opacity: .85; }
.${P}seg-hold { fill-opacity: .4; }
.${P}seg-ret { fill-opacity: .45; stroke-dasharray: 3 2; }
.${P}seg-open { stroke-dasharray: 1 2; }
.${P}foreign .${P}seg { fill-opacity: .25; stroke-dasharray: 4 2; stroke-width: 1.5; }
.${P}hostile .${P}seg { fill-opacity: .9; stroke: #ff8a80; stroke-dasharray: none; }
.${P}hostile .${P}seg-out { animation: ${P}blink 1.2s ease-in-out infinite; }
@keyframes ${P}blink { 50% { fill-opacity: .45; } }
.${P}group:hover .${P}seg, .${P}group:focus .${P}seg { stroke: #fff; }
.${P}arrive { stroke-width: 2; }
.${P}now { stroke: #ffeb3b; stroke-width: 1.5; pointer-events: none; }
.${P}nowlabel { fill: #ffeb3b; font-size: 9px; pointer-events: none; }
.${P}grid, .${P}tick, .${P}lanelabel, .${P}rettext, .${P}arrive { pointer-events: none; }
.${P}rettext { fill: var(--ogx-muted, #8a96a3); font-size: 9px; }
.${P}rettext.${P}hasret { fill: #9ccc65; }
.${P}legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 4px 0 8px; font-size: 10px; }
.${P}legend-muted { color: var(--ogx-muted, #8a96a3); }
.${P}dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.${P}h { margin: 8px 0 4px; font-size: 11px; color: var(--ogx-accent, #6cb4ff); }
.${P}h-hostile { color: var(--ogx-bad, #f44336); }
.${P}list { width: 100%; }
.${P}list td, .${P}list th { padding: 2px 3px; }
.${P}row-hostile td { background: rgba(244,67,54,.18); }
.${P}row-foreign td { font-style: italic; }
.${P}route { white-space: normal; }
.${P}listwrap { overflow-x: auto; }
.${P}list { font-size: 10px; }
.${P}list td:first-child { white-space: nowrap; }
.${P}ret { color: #9ccc65; font-size: 10px; }
.${P}when { white-space: nowrap; }
.${P}abs { color: var(--ogx-muted, #8a96a3); }
.${P}recall { padding: 0 4px; font-size: 10px; }
.${P}tip table td { padding: 0 4px; vertical-align: top; }
.${P}tip .${P}tk { color: var(--ogx-muted, #8a96a3); white-space: nowrap; }
.${P}movement { margin: 6px 0 8px; padding: 6px; background: var(--ogx-panel, #161b22); border: 1px solid var(--ogx-border, #2c3440); border-radius: 4px; color: var(--ogx-text, #ddd); font: 11px Verdana, Arial, sans-serif; }
.${P}mhead { margin-bottom: 4px; }
.${P}movement-gz { width: 650px; margin: 8px 0 8px 8px; box-sizing: border-box; text-align: left; }
`;
})(window.OGX);
