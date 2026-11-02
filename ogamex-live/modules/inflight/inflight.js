/* ogamex-live/modules/inflight/inflight.js — Owner: live/inflight.
 * Resources in flight, totals of all bodies, grand totals, needed vs owned Battle Transporters (217), incoming-fleet icons
 * (DESIGN §4.1.3, OL rows 7 and 8, OL §4.9, §4.11 totals, §5.3, §5.7).
 *
 * OgameX facts used:
 *   #planetList > div.smallplanet[data-planet-id]  — src/OGameX/resources/views/ingame/layouts/main.blade.php:1729, 1737-1738
 *     (row id is planet-<index>, the planet id is only in data-planet-id)
 *   a.moonlink[href*="cp=<moonId>"]                — main.blade.php:1793 (the moon id exists only in the moonlink URL)
 *   GALAXYZ: one #planetList per planet (duplicated id), planet id only in a.planetlink[href*="cp=<id>"]: rows come from
 *     OGX.dom.planetRows(), the totals block goes into the LAST #planetList (below every planet). The right column is
 *     ~137 px wide and close to the window edge: the block takes the room left up to the edge (fitWidth) and switches to a
 *     narrow two-column layout when even that is too small, so it never adds a horizontal scrollbar.
 *   GET /ajax/fleet/eventbox/fetch, /ajax/fleet/eventlist/fetch — routes/web.php:141-142 (used through OGX.flights)
 *   GET /fleet/movement                            — routes/web.php:122 (click on an incoming icon opens it)
 *   Event-list synthetic rows: return = id + 999999, hold end = id + 888888 (FleetEventsController, fleet.md §9.3);
 *   they are grouped by realMissionId in OGX.flights; synthetic returns carry no cargo and are never summed here.
 *   GALAXYZ flights: the event box of every full page (core flights.init stores it and emits `flights:updated`); outward and
 *   return are two real events with real cargo (no synthetic rows, no half-fuel fix). The module neither polls nor fetches in
 *   the background on GALAXYZ (every GET is a full page that marks the account online): only the ⟳ button (a user click)
 *   GETs page=fleetTable through OGX.flights.get({ force: true }). Arrived flights drop out locally on the 1 s tick.
 *   Hostile/foreign rows on GALAXYZ are [UPSTREAM] (never saved live). Ships per body (217 owned) come from page=fleetTable
 *   and page=imperium visits (state.bodies); 217 cargo from state.shipStats (Storage expert 607 included).
 * Data: reads core keys bodies / flights / shipStats; writes only inflight.ui (collapsed state) and settings.
 * Requests: OgameX: none of its own; OGX.flights.startPolling() (eventbox poll) and OGX.flights.get() (cached 60 s).
 *   GALAXYZ: none, except page=fleetTable on a click of ⟳.
 */
(function (OGX) {
  'use strict';

  const NAME = 'inflight';
  const P = 'ogx-l-inflight-';
  const RES = ['metal', 'crystal', 'deuterium'];
  const RES_LABEL = { metal: 'М', crystal: 'К', deuterium: 'Д' };
  const RES_NAME = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий' };
  // every transport count uses the Battle Transporter only (player decision); core names it, 217 is the fallback
  const TR = (OGX.catalog && OGX.catalog.transportShip) || 217;
  const UI_KEY = 'ui';
  const UI_V = 1;
  const NARROW_MIN = 250;   // below this many px up to the window edge the totals use the narrow layout

  OGX.module({
    name: NAME,
    title: 'Ресурсы в полёте и прибывающие флоты',
    pages: '*',
    settings: {
      showTotals: { type: 'bool', default: true, label: 'Блок итогов под списком планет (в полёте, на планетах, всего)' },
      showIncoming: { type: 'bool', default: true, label: 'Значок прибывающих флотов у планет и лун' },
      includeMoonsInTotals: { type: 'bool', default: true, label: 'Учитывать луны в итогах' },
    },

    async init(ctx) {
      const list = OGX.dom.planetListEnd();
      if (!list) { ctx.log.debug('no #planetList, nothing to do'); return; }
      ctx.css(CSS);
      const m = new InFlight(ctx, list);
      ctx._inflight = m;
      await m.start();
    },

    dispose(ctx) {
      if (ctx._inflight) ctx._inflight.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const now = () => OGX.time.serverNow();
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  const zero = () => ({ metal: 0, crystal: 0, deuterium: 0 });

  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function setTitle(el, t) { if (el && el.getAttribute('title') !== t) el.setAttribute('title', t); }
  /** Narrow column: full numbers up to 7 digits, then the short form (exact value in the title / data-v). */
  function cellNum(n) { return Math.abs(n) >= 1e7 ? OGX.fmt.short(n) : OGX.fmt.num(Math.round(n)); }

  /** Rows of the active flights that inFlight() picks: one per own realMissionId (same rule as OGX.flights.inFlight, OL §5.7).
   * Local helper: the core returns only the sums, the module also needs the picked rows (≈ marks, tooltip). */
  function pickedRows(list) {
    const by = new Map();
    for (const f of list || []) {
      if (!f.own || f.realMissionId === null || f.realMissionId === undefined) continue;
      if (!by.has(f.realMissionId)) by.set(f.realMissionId, []);
      by.get(f.realMissionId).push(f);
    }
    const out = [];
    for (const rows of by.values()) {
      const pick = rows.find((r) => r.synthetic === null && !r.returnFlight) || rows.find((r) => r.synthetic === 'holdEnd') || rows.find((r) => r.synthetic === null && r.returnFlight);
      if (pick && pick.cargo) out.push(pick);
    }
    return out;
  }
  /** Which resources of a cargo are approximate: Mn/M/B values (>= 1e6, parse) and the outbound deuterium whose half fuel
   * could not be removed (decision 21: cargo.fuelRemoved === 0 together with approx). */
  function approxOf(cargo) {
    const a = { metal: false, crystal: false, deuterium: false };
    if (!cargo || !cargo.approx) return a;
    for (const r of RES) a[r] = (+cargo[r] || 0) >= 1e6;
    if (cargo.fuelRemoved === 0 || cargo.fuelRemoved === undefined) a.deuterium = true;
    return a;
  }

  // ------------------------------------------------------------------ main class
  class InFlight {
    constructor(ctx, list) {
      this.ctx = ctx;
      this.list = list;
      this.bodies = {};
      this.flights = [];
      this.flightsT = null;
      this.stats = {};
      this.ui = { v: UI_V, collapsed: false };
      this.offs = [];
      this.icons = [];          // [{ el, key }]
      this.hostileRows = [];
      this.totals = null;       // refs of the totals block
      this.nextArrival = Infinity;
      this.renderSoon = OGX.util.debounce(() => this.render('update'), 150);
      // B events (timed, errors with stack): full renders, refreshes, user-triggered actions.
      this.render = OGX.log.wrap(NAME, this._render.bind(this), 'render');
      this.refresh = OGX.log.wrap(NAME, this._refresh.bind(this), 'refresh');
      this.toggle = OGX.log.wrap(NAME, this._toggle.bind(this), 'toggle');
      this.openMovement = OGX.log.wrap(NAME, this._openMovement.bind(this), 'openMovement');
      this.fitSoon = OGX.util.debounce(() => this.fitWidth(), 100);
    }

    S(key) { return this.ctx.settings.get(key); }

    async start() {
      const ctx = this.ctx;
      try {
        const ui = await ctx.store.get(UI_KEY, null);
        if (ui && typeof ui === 'object') this.ui = { v: UI_V, collapsed: !!ui.collapsed };   // v1 is the only version so far
      } catch (e) { ctx.log.warn('ui state', e); }
      await this.render('init');

      this.offs.push(ctx.bus.on('flights:updated', (e) => {
        if (e && Array.isArray(e.flights)) { this.flights = e.flights; this.flightsT = e.t || now(); this.checkFlights(); }
        this.renderSoon();
      }));
      this.offs.push(ctx.bus.on('state:updated', (e) => {
        const keys = (e && e.keys) || [];
        if (keys.some((k) => k === 'bodies' || k === 'shipStats' || k === 'research' || k === 'player')) this.renderSoon();
      }));
      this.offs.push(ctx.settings.onChange(() => this.renderSoon()));
      this.offs.push(OGX.settings.onChange('planetbar.prodDisplay', () => this.renderSoon()));
      this.offs.push(OGX.storage.subscribe('bodies', (v, info) => { if (info && info.remote) this.renderSoon(); }));
      this.offs.push(OGX.storage.subscribe('flights', (v, info) => {
        if (info && info.remote && v && Array.isArray(v.flights)) { this.flights = v.flights; this.flightsT = v.t; this.renderSoon(); }
      }));

      // Flights: the core poller (eventbox every core.flightsPollSec, list re-fetched when counts change or an arrival
      // passed). Its first poll always fetches the list, so a separate get() would double the request; get() (cached 60 s)
      // is used only when the poller is off or cannot run now (hidden tab).
      if (OGX.page.isGz && OGX.page.isGz()) {
        // GALAXYZ: the page's event box already is the list (read in load()); no poller, no background request
        OGX.log.rec('B', NAME, 'poller:off', { engine: 'galaxyz' });
      } else {
        this.stopPoll = OGX.flights.startPolling();
        OGX.log.rec('B', NAME, 'poller:start', { sec: OGX.settings.get('core.flightsPollSec') });
        const pollSec = +OGX.settings.get('core.flightsPollSec') || 0;
        if (!pollSec || document.hidden) this.fetchFlights(false);
      }

      this.offs.push(ctx.on(window, 'resize', () => this.fitSoon()));
      ctx.every(1000, (t) => this.tick(t));
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* gone */ } }
      this.offs = [];
      if (this.renderSoon.cancel) this.renderSoon.cancel();
      if (this.fitSoon.cancel) this.fitSoon.cancel();
      if (this.stopPoll) { try { this.stopPoll(); } catch (e) { /* gone */ } this.stopPoll = null; }
      this.clearInjected();
      if (this.host) this.host.classList.remove(P + 'host');
    }

    async fetchFlights(force) {
      const r = await OGX.flights.get({ force: !!force });
      if (r && r.error) {
        this.ctx.log.warn('flights.get failed', r.error);
        this.setStatus('Не удалось загрузить список флотов: ' + r.error, true);
      } else if (r && Array.isArray(r.flights)) {
        this.flights = r.flights; this.flightsT = r.t;
        this.checkFlights();
        this.renderSoon();
      }
      return r && r.error ? { ok: false, error: r.error } : { ok: true, n: r && r.flights ? r.flights.length : 0 };
    }

    async _refresh() {
      this.setStatus('обновление…', false);
      const r = await this.fetchFlights(true);
      if (r.ok) this.setStatus(null);
      return r;
    }

    async _toggle() {
      this.ui = { v: UI_V, collapsed: !this.ui.collapsed };
      if (this.totals) this.totals.root.classList.toggle(P + 'collapsed', this.ui.collapsed);
      await this.ctx.store.set(UI_KEY, this.ui);
      return { collapsed: this.ui.collapsed };
    }

    _openMovement(key) {
      OGX.page.go('/fleet/movement');
      return { key };
    }

    async load() {
      this.bodies = (await OGX.state.bodies()) || {};
      if (!this.flightsT) {
        const fl = await OGX.flights.cached();   // core: stored list, no request
        if (fl && Array.isArray(fl.flights)) { this.flights = fl.flights; this.flightsT = fl.t || null; this.checkFlights(); }
      }
      try { this.stats = (await OGX.state.shipStats()) || {}; } catch (e) { this.stats = {}; this.ctx.log.warn('shipStats failed', e); }
      const c = this.stats[TR] && this.stats[TR].cargo;
      if (c !== undefined) OGX.learn.value('inflight.cargo' + TR, +c, { min: 1 });
    }

    /** Sanity checks on parsed flights (once per update, never per tick): raise learning alerts on drift. */
    checkFlights() {
      const list = this.flights || [];
      OGX.learn.value('inflight.flights', list.length, { min: 0, int: true });
      let unmapped = 0;
      const own = new Set(Object.values(this.bodies || {}).map((b) => b && b.coords).filter(Boolean));
      for (const f of list) {
        OGX.learn.check('inflight.flight', { arrival: f.arrival, metal: f.cargo && f.cargo.metal, crystal: f.cargo && f.cargo.crystal, deuterium: f.cargo && f.cargo.deuterium, count: f.units });
        if (!fin(f.arrival) || f.arrival <= 0) OGX.learn.value('inflight.arrival', NaN);
        if (!f.destKey && f.to && own.has(f.to) && (f.toType === 1 || f.toType === 3)) unmapped++;
      }
      if (unmapped) {
        // flights to own coordinates that did not map to a stored body: the planet list or body store drifted
        this.ctx.log.warn('flights to own coordinates without a body key:', unmapped);
        OGX.log.rec('B', NAME, 'unmapped-dest', { n: unmapped });
      }
    }

    clearInjected() {
      for (const el of document.querySelectorAll('.' + P + 'in, .' + P + 'totals')) el.remove();
      for (const ic of this.icons) { try { ic.detach(); } catch (e) { /* gone */ } }
      this.icons = [];
      for (const row of document.querySelectorAll('.smallplanet.' + P + 'hostile, .smallplanet.' + P + 'row')) row.classList.remove(P + 'hostile', P + 'row');
      this.totals = null;
    }

    activeFlights(t) { return (this.flights || []).filter((f) => f && fin(f.arrival) && f.arrival > t); }

    // ---------------------------------------------------------------- full render
    async _render(reason) {
      await this.load();
      this.clearInjected();
      const t = now();
      const active = this.activeFlights(t);
      this.nextArrival = active.reduce((m, f) => Math.min(m, f.arrival), Infinity);
      let icons = 0, hostile = 0;
      if (this.S('showIncoming')) {
        const r = this.renderIncoming(active, t);
        icons = r.icons; hostile = r.hostile;
      }
      if (this.S('showTotals')) this.renderTotals();
      this.tick(t);
      return { reason, flights: active.length, icons, hostile, totals: !!this.totals };
    }

    // ---------------------------------------------------------------- incoming icons (OL row 8)
    renderIncoming(active, t) {
      const by = OGX.flights.incomingByBody(active);
      const hostileIds = new Set(OGX.flights.hostile(active).map((f) => f.rowId));
      let icons = 0, hostile = 0;
      for (const { row, planetId: pid, moonLink: moonA, moonId: mid } of OGX.dom.planetRows()) {
        if (!(pid > 0)) { OGX.learn.value('inflight.rowPlanetId', NaN); continue; }
        if (moonA && !mid) OGX.learn.value('inflight.moonId', NaN);
        let rowHostile = false;
        for (const [key, isMoon] of [['p' + pid, false], mid ? ['m' + mid, true] : null].filter(Boolean)) {
          const fl = by[key];
          if (!fl || !fl.length) continue;
          const nHost = fl.filter((f) => hostileIds.has(f.rowId)).length;
          if (nHost) rowHostile = true;
          hostile += nHost;
          const el = h('span', {
            class: [P + 'in', isMoon ? P + 'in-moon' : P + 'in-planet', nHost && P + 'in-hostile'],
            tabindex: '0', role: 'button',
            dataset: { key, n: fl.length, hostile: nHost, ogxAct: 'inflight:open-movement' },
            'aria-label': 'Прибывающие флоты: ' + fl.length + (nHost ? ', враждебных: ' + nHost : ''),
            onClick: () => this.openMovement(key),
          }, nHost ? '⚠' : '➜', h('span', { class: P + 'in-n' }, String(fl.length)));
          const body = this.bodies[key];
          const detach = OGX.dom.tooltip(el, () => this.tooltipFor(key, body, fl, hostileIds), { side: 'left' });
          row.classList.add(P + 'row');
          if (isMoon && moonA) moonA.appendChild(el); else row.appendChild(el);
          this.icons.push({ el, key, detach });
          icons++;
        }
        if (rowHostile) row.classList.add(P + 'hostile');
      }
      return { icons, hostile };
    }

    tooltipFor(key, body, fl, hostileIds) {
      const name = body ? (body.name || '') + ' ' + OGX.fmt.coords(body.coords, body.type === 'moon' ? 3 : 1) : key;
      const t = now();
      const tbody = h('tbody');
      for (const f of fl) {
        if (!(f.arrival > t)) continue;
        const hostile = hostileIds.has(f.rowId);
        const mission = OGX.catalog.missionName(f.missionType) + (f.returnFlight ? ' (возврат)' : f.synthetic === 'holdEnd' ? ' (конец удержания)' : '');
        const who = f.own ? 'свой' : hostile ? 'враг' : 'чужой';
        const c = f.cargo || zero();
        const ap = approxOf(c);
        const cargo = f.synthetic === 'return'
          ? h('span', { class: P + 'muted' }, 'груз станет известен после прибытия')
          : RES.map((r) => h('span', { class: [P + 'c', P + 'r-' + r] }, RES_LABEL[r] + ' ' + (ap[r] ? '≈' : '') + OGX.fmt.num(+c[r] || 0)));
        const rowCls = [P + 'tip-row', hostile && P + 'hostile-row', f.own && P + 'own-row'];
        tbody.appendChild(h('tr', { class: rowCls, dataset: { row: f.rowId, mission: f.missionType } },
          h('td', null, mission),
          h('td', null, who),
          h('td', null, OGX.fmt.coords(f.from, f.fromType)),
          h('td', null, OGX.dom.countdown(f.arrival, { doneText: 'прибыл' }), ' ', h('span', { class: P + 'muted' }, OGX.fmt.time(f.arrival))),
          h('td', { title: 'Кораблей во флоте' }, (f.units ? OGX.fmt.num(f.units) : ''))));
        tbody.appendChild(h('tr', { class: [P + 'tip-cargo'], dataset: { cargoOf: f.rowId } }, h('td', { colspan: '5', class: P + 'cargo' }, 'Груз: ', cargo)));
      }
      return h('div', { class: P + 'tip' },
        h('div', { class: P + 'tip-h' }, 'Прибывают на ' + name),
        h('table', { class: P + 'tip-t' },
          h('thead', null, h('tr', null, h('th', null, 'Задание'), h('th', null, 'Чей'), h('th', null, 'Откуда'), h('th', null, 'Прибытие'), h('th', null, 'Флот'))),
          tbody),
        h('div', { class: P + 'muted' }, OGX.page.isGz && OGX.page.isGz() ? 'Щелчок — открыть «Флот» (список полётов)' : 'Щелчок — открыть «Передвижения флота»'));
    }

    // ---------------------------------------------------------------- totals block (OL row 7)
    renderTotals() {
      const mkRow = (id, label, title) => {
        const cells = {};
        const tr = h('div', { class: [P + 'line', P + 'l-' + id], dataset: { row: id }, title },
          h('span', { class: P + 'lbl' }, label));
        for (const r of [...RES, 'sum']) {
          cells[r] = h('span', { class: [P + 'v', P + 'r-' + r], dataset: { res: r } });
          tr.appendChild(cells[r]);
        }
        return { tr, cells };
      };
      const inflight = mkRow('inflight', 'В полёте', 'Ресурсы на борту своих флотов (по одной строке на задание; возвраты без груза не считаются)');
      const bodies = mkRow('bodies', 'На планетах', 'Сумма запасов всех тел с данными (проекция на текущий момент)');
      const prod = mkRow('prod', 'Выработка', 'Суммарная выработка планет');
      const grand = mkRow('grand', 'Итого', 'На планетах + в полёте');
      const needT = h('span', { class: P + 'need', dataset: { ship: TR } });
      const status = h('div', { class: P + 'status', hidden: true });
      const note = h('div', { class: [P + 'note', P + 'muted'] });
      const btnRefresh = h('button', { type: 'button', class: P + 'btn', title: OGX.page.isGz && OGX.page.isGz() ? 'Обновить список флотов (один запрос страницы «Флот»)' : 'Обновить список флотов', dataset: { ogxAct: 'inflight:refresh' }, onClick: () => this.refresh() }, '⟳');
      const btnToggle = h('button', { type: 'button', class: P + 'btn', title: 'Свернуть / развернуть', dataset: { ogxAct: 'inflight:toggle' }, onClick: () => this.toggle() }, '▾');
      const head = h('div', { class: P + 'head' },
        h('span', { class: P + 'title' }, 'Итоги'),
        h('span', { class: P + 'cols' }, ...RES.map((r) => h('span', { class: [P + 'ch', P + 'r-' + r] }, RES_LABEL[r])), h('span', { class: P + 'ch' }, 'Σ')),
        btnRefresh, btnToggle);
      const root = h('div', { class: [P + 'totals', this.ui.collapsed && P + 'collapsed'] },
        head,
        h('div', { class: P + 'body' }, inflight.tr, bodies.tr, prod.tr, grand.tr,
          h('div', { class: [P + 'line', P + 'l-need'] }, h('span', { class: P + 'lbl' }, 'Транспорт'), needT),
          note, status));
      if (OGX.dom.$('#cutty') || OGX.dom.$('#planetList > .smallplanet.smaller')) root.classList.add(P + 'compact');
      // The game CSS gives every div z-index 1; #planetbarcomponent is a stacking context that the later banner column
      // covers. The block is wider than the list, so lift our host above it (own class only, removed on dispose).
      this.host = OGX.dom.$('#planetbarcomponent');
      if (this.host) this.host.classList.add(P + 'host');
      this.list.appendChild(root);
      this.totals = { root, inflight, bodies, prod, grand, needT, status, note };
      this.fitWidth();
    }

    /** Keep the block inside the window: full width when it fits, else the room up to the right edge, else the narrow
     * layout in the column width (GALAXYZ right column at 1280-1366 px windows). */
    fitWidth() {
      const root = this.totals && this.totals.root;
      if (!root || !root.isConnected) return null;
      const left = root.parentElement ? root.parentElement.getBoundingClientRect().left : 0;
      let edge = document.documentElement.clientWidth - 8;
      // GALAXYZ: the fixed scroll-to-top button (.gototop, right 50px, 50px wide) shows over the page once it is
      // scrolled; keep the block left of it instead of letting the button cover the right-hand numbers
      const top = OGX.dom.$('body > .gototop, .gototop');
      if (top && getComputedStyle(top).position === 'fixed') {
        // without .visible it waits 30px further right (margin-right -30px) and slides in when shown: use the shown place
        const rr = top.getBoundingClientRect();
        const shown = rr.left + Math.min(0, parseFloat(getComputedStyle(top).marginRight) || 0);
        if (rr.width > 0 && shown > left) edge = Math.min(edge, shown - 4);
      }
      const room = Math.floor(edge - left);
      const full = root.classList.contains(P + 'compact') ? 300 : 340;
      const narrow = room < NARROW_MIN;
      root.classList.toggle(P + 'narrow', narrow);
      const w = narrow || room >= full ? '' : room + 'px';
      if (root.style.width !== w) root.style.width = w;
      return { room, narrow };
    }

    setStatus(text, bad) {
      if (!this.totals) return;
      const s = this.totals.status;
      s.hidden = !text;
      s.textContent = text || '';
      s.classList.toggle(P + 'bad', !!bad);
    }

    /** All numbers of the totals block at time t (exposed for tests via the DOM data-v attributes). */
    compute(t) {
      const active = this.activeFlights(t);
      const inF = OGX.flights.inFlight(active);
      const picked = pickedRows(active);
      const inApprox = { metal: false, crystal: false, deuterium: false };
      for (const f of picked) { const a = approxOf(f.cargo); for (const r of RES) inApprox[r] = inApprox[r] || a[r]; }
      const withMoons = this.S('includeMoonsInTotals');
      const perDay = OGX.settings.get('planetbar.prodDisplay') === 'day';
      const stock = zero(), prod = zero();
      let known = 0, unknown = 0, shipsKnown = 0;
      const owned = { [TR]: 0 };
      for (const b of Object.values(this.bodies || {})) {
        if (!b || !b.key) continue;
        const isMoon = b.type === 'moon';
        if (isMoon && !withMoons) continue;
        if (b.shipsT) { shipsKnown++; owned[TR] += +(b.ships || {})[TR] || 0; }
        if (!b.res) { unknown++; continue; }
        let pr;
        try { pr = OGX.state.projected(b, t, { flights: this.flights }); } catch (e) { pr = OGX.state.projected(b, t); }
        if (!pr || !pr.res) { unknown++; continue; }
        known++;
        for (const r of RES) {
          stock[r] += +((pr.res[r] || {}).amount) || 0;
          if (!isMoon) prod[r] += +((b.res[r] || {}).perHour) || 0;
        }
      }
      const grand = {};
      for (const r of RES) grand[r] = stock[r] + inF[r];
      const sum = (o) => o.metal + o.crystal + o.deuterium;
      const cap = this.stats[TR] ? +this.stats[TR].cargo || 0 : 0;
      const gSum = sum(grand);
      return {
        inF: { metal: inF.metal, crystal: inF.crystal, deuterium: inF.deuterium, sum: sum(inF) }, inApprox, missions: picked.length,
        stock: Object.assign({}, stock, { sum: sum(stock) }),
        prod: Object.assign({}, prod, { sum: sum(prod) }), perDay,
        grand: Object.assign({}, grand, { sum: gSum }),
        need: { [TR]: cap > 0 ? Math.ceil(gSum / cap) : null },
        caps: { [TR]: cap },
        owned: shipsKnown ? owned : null, shipsKnown, known, unknown, withMoons,
      };
    }

    // ---------------------------------------------------------------- per tick: texts and titles only
    tick(t) {
      t = t || now();
      // an arrival passed: drop it from icons/totals now; the core poller re-fetches the list (arrival passed -> refetch)
      if (t >= this.nextArrival) { this.nextArrival = Infinity; this.renderSoon(); }
      if (!this.totals) return;
      const c = this.compute(t);
      const T = this.totals;
      const fill = (row, vals, approx, prefix, suffix) => {
        let anyApprox = false;
        for (const r of [...RES, 'sum']) {
          const el = row.cells[r];
          const v = vals[r];
          const ap = r === 'sum' ? anyApprox : !!(approx && approx[r]);
          if (ap) anyApprox = true;
          setText(el, (ap ? '≈' : '') + (prefix && v > 0 ? prefix : '') + cellNum(v));
          if (el.dataset.v !== String(Math.round(v))) el.dataset.v = String(Math.round(v));
          el.classList.toggle(P + 'approx', ap);
          setTitle(el, (r === 'sum' ? 'Всего' : RES_NAME[r]) + ': ' + (ap ? 'около ' : '') + OGX.fmt.num(Math.round(v)) + (suffix || ''));
        }
      };
      fill(T.inflight, c.inF, c.inApprox);
      setTitle(T.inflight.tr, 'Ресурсы на борту своих флотов: ' + c.missions + ' ' + OGX.fmt.plural(c.missions, ['задание', 'задания', 'заданий']) +
        ' (возвраты без груза не считаются)' + (c.inApprox.deuterium ? '\n≈ дейтерий включает половину топлива полёта туда' : '') +
        (this.flightsT ? '\nСписок флотов: ' + OGX.fmt.ago(this.flightsT) : '\nСписок флотов ещё не загружен'));
      fill(T.bodies, c.stock, null);
      const prodVals = c.perDay ? { metal: c.prod.metal * 24, crystal: c.prod.crystal * 24, deuterium: c.prod.deuterium * 24, sum: c.prod.sum * 24 } : c.prod;
      fill(T.prod, prodVals, null, '+', c.perDay ? '/сут' : '/ч');
      setText(T.prod.tr.firstChild, c.perDay ? 'Выраб./сут' : 'Выраб./ч');
      fill(T.grand, c.grand, c.inApprox);

      for (const [id, el] of [[TR, T.needT]]) {
        const need = c.need[id];
        const have = c.owned ? c.owned[id] : null;
        const lbl = OGX.catalog.shortName(id) || 'Ул. трансп.';
        setText(el, lbl + ' ' + (have === null ? '?' : OGX.fmt.num(have)) + '/' + (need === null ? '?' : OGX.fmt.num(need)));
        el.dataset.need = need === null ? '' : String(need);
        el.dataset.have = have === null ? '' : String(have);
        el.className = P + 'need ' + P + (have === null || need === null ? 'muted' : have < need ? 'bad' : 'ok');
        setTitle(el, OGX.catalog.name(id) + ': есть ' + (have === null ? 'неизвестно (откройте «Флот» на планетах или обновите все планеты в меню)' : OGX.fmt.num(have) + ' (сумма по ' + c.shipsKnown + ' ' + OGX.fmt.plural(c.shipsKnown, ['телу', 'телам', 'телам']) + ')') +
          ', нужно ' + (need === null ? 'неизвестно' : OGX.fmt.num(need)) + ' для ' + OGX.fmt.num(Math.round(c.grand.sum)) + ' ресурсов (вместимость ' + OGX.fmt.num(c.caps[id]) + ')');
      }
      const noteTxt = (c.unknown ? 'Нет данных о ресурсах: ' + c.unknown + ' ' + OGX.fmt.plural(c.unknown, ['тело', 'тела', 'тел']) + '. ' : '') + (c.withMoons ? '' : 'Луны не учитываются.');
      setText(T.note, noteTxt.trim());
      T.note.hidden = !noteTxt.trim();
    }
  }

  const CSS = `
.${P}totals { position: relative; box-sizing: border-box; clear: both; margin: 4px 0 2px; width: 340px; padding: 2px 3px; border: 1px solid #2b3846; border-radius: 3px;
  background: rgba(13,16,20,.9); font: 10px/13px Verdana, Arial, sans-serif; color: #cfd8e3; text-align: left; white-space: nowrap; z-index: 4; }
.${P}totals * { box-sizing: border-box; }
#planetbarcomponent.${P}host { z-index: 3; }
/* The block can be wider than the right column and reach the game's fixed scroll-to-top button (1366 px windows): keep the button on top. */
body .gototop { z-index: 20; }
.${P}totals.${P}compact { width: 300px; }
.${P}totals.${P}narrow { width: auto; min-width: 0; }
.${P}narrow .${P}cols { display: none; }
.${P}narrow .${P}title { flex: 1 1 auto; }
.${P}narrow .${P}line { flex-wrap: wrap; column-gap: 0; }
.${P}narrow .${P}lbl { flex: 0 0 100%; color: #cfd8e3; }
.${P}narrow .${P}v, .${P}narrow .${P}need { flex: 0 0 50%; }
.${P}narrow .${P}v::before { color: #8593a3; font-weight: normal; }
.${P}narrow .${P}v.${P}r-metal::before { content: 'М '; } .${P}narrow .${P}v.${P}r-crystal::before { content: 'К '; }
.${P}narrow .${P}v.${P}r-deuterium::before { content: 'Д '; } .${P}narrow .${P}v.${P}r-sum::before { content: 'Σ '; }
.${P}head { display: flex; align-items: center; gap: 2px; border-bottom: 1px solid #2b3846; margin-bottom: 1px; }
.${P}title { flex: 0 0 70px; font-weight: bold; color: #fff; }
.${P}cols { flex: 1 1 auto; display: flex; }
.${P}ch { flex: 1 1 0; text-align: right; font-weight: bold; color: #8593a3; }
.${P}btn { flex: none; width: 14px; height: 13px; padding: 0; border: 1px solid #2b3846; border-radius: 2px; background: #161c24; color: #8593a3; font: 9px/11px Verdana, Arial, sans-serif; cursor: pointer; }
.${P}btn:hover { color: #fff; border-color: #6f9fd8; }
.${P}collapsed .${P}body { display: none; }
.${P}line { display: flex; align-items: center; gap: 3px; min-height: 13px; }
.${P}lbl { flex: 0 0 70px; color: #8593a3; overflow: hidden; text-overflow: ellipsis; }
.${P}v { flex: 1 1 0; min-width: 0; text-align: right; color: #fff; overflow: hidden; text-overflow: ellipsis; }
.${P}l-grand .${P}v { font-weight: bold; }
.${P}l-prod .${P}v { color: #8fbf8f; }
.${P}l-inflight .${P}v { color: #79c2e8; }
.${P}v.${P}approx { font-style: italic; }
.${P}ch.${P}r-metal { color: #a9b5c4; } .${P}ch.${P}r-crystal { color: #79c2e8; } .${P}ch.${P}r-deuterium { color: #7fe0b4; }
.${P}l-need { justify-content: space-between; }
.${P}need { flex: 1 1 0; text-align: right; }
.${P}need.${P}ok { color: #8fbf8f; } .${P}need.${P}bad { color: #f44336; } .${P}need.${P}muted, .${P}muted { color: #8593a3; }
.${P}note { white-space: normal; font-size: 9px; line-height: 11px; }
.${P}status { white-space: normal; color: #f2d16b; } .${P}status.${P}bad { color: #f44336; }
.smallplanet.${P}row { position: relative; }
.${P}in { position: absolute; z-index: 6; display: inline-flex; align-items: center; gap: 1px; height: 12px; padding: 0 2px; border-radius: 6px;
  background: rgba(36,72,110,.92); border: 1px solid #6f9fd8; color: #fff; font: bold 9px/10px Verdana, Arial, sans-serif; cursor: pointer; }
.${P}in-planet { left: 1px; top: 1px; }
.${P}in-moon { right: -4px; top: -4px; }
.smallplanet.smaller .${P}in-planet { top: 0; left: 0; }
.${P}in.${P}in-hostile { background: rgba(160,20,20,.95); border-color: #ff6b6b; animation: ${P}blink 1.2s ease-in-out infinite; }
@keyframes ${P}blink { 50% { opacity: .55; } }
.smallplanet.${P}hostile { box-shadow: inset 0 0 0 1px rgba(244,67,54,.85); }
.${P}tip { font: 11px/14px Verdana, Arial, sans-serif; }
.${P}tip-h { font-weight: bold; margin-bottom: 3px; }
.${P}tip-t { border-collapse: collapse; }
.${P}tip-t th, .${P}tip-t td { padding: 1px 3px; text-align: left; white-space: nowrap; }
.${P}tip-t th { color: #8593a3; font-weight: normal; border-bottom: 1px solid #2b3846; }
.${P}tip-row.${P}hostile-row td { color: #ff6b6b; font-weight: bold; }
.${P}tip-row.${P}own-row td { color: #a5d6a7; }
.${P}c { margin-right: 6px; }
.${P}tip-t td.${P}cargo { padding: 0 5px 3px 14px; color: #cfd8e3; font-size: 10px; }
`;
})(window.OGX);
