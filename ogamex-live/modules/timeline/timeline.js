/* ogamex-live/modules/timeline/timeline.js — Owner: live/timeline.
 * Flights timeline (DESIGN §4.1.7, OL row 18, OL §4.14, fleet.md §8, §9.3, §12.2).
 *
 * div#ogx-l-timeline under the left menu (#left, after #toolbarcomponent) or under the planet list (#rechts, after
 * #planetList), setting `position`. Header: reload icon, fleet slots used/max, expedition slots used/max (overmark when
 * full). Rows sorted by arrival: arrival time, countdown, mission icon, origin -> destination with the body type, unit
 * count, three cargo fill bars (cargo / fleetCargo(ships)), hostile rows highlighted. One row per realMissionId and
 * direction; outbound expeditions are skipped by default (OGame Live behaviour, awesomeFlightsDisplay.js:44-195).
 *
 * OgameX facts used:
 *   #left > #toolbarcomponent > #links                 — resources/views/ingame/layouts/main.blade.php:496, 512-513
 *   #right #rechts ... #planetList                      — main.blade.php:1715, 1729
 *   #left is 160px wide (#left{float:left;width:160px}, public/build/assets/ingame-*.css), #links 173px.
 *   Mission icons /img/fleet/<type>.gif (1-10, 15)      — public/img/fleet/*.gif; used by the event list
 *     (resources/views/ingame/fleetevents/eventrow.blade.php, fleet.md §9.3 `td.missionFleet img`).
 *   GET /ajax/fleet/eventlist/fetch                     — routes/web.php:141 (through OGX.flights.get / OGX.api.eventList)
 *   GET /fleet/movement                                 — routes/web.php:122 (row click opens it)
 *   Event-list synthetic ids: hold end = id + 888888, return = id + 999999 (FleetEventsController:324-387); the core
 *     parser sets synthetic/realMissionId. Synthetic returns carry zero cargo (the real cargo is known only on arrival).
 *   Used slots = own active missions except missiles (type 10); expedition slots = own active type-15 missions
 *     (app/Services/PlayerService.php:540-556, 587-597). Max = 1 + computer (+2 General), floor(sqrt(astro)) + bonus
 *     (+2 Discoverer) (PlayerService.php:565-578, 605-620) -> OGX.calc.slots; the /fleet or /fleet/movement values
 *     (OGX.state.slots) win when they are at least as new as the flight list.
 * GALAXYZ (ogamex.eu, 2Moons fork; real overview / fleetTable / fleetStep1-3 / galaxy pages):
 *   - mount 'auto' (default) / 'right': after the LAST #planetList (one per planet, duplicated id), as since the core port;
 *     'left': inside #links right after ul#menuTable (the left menu column, 173 px, floated: nothing moves). Info pages
 *     (transport) and fleetStep3 have no #rechts, so every setting uses the left column there.
 *   - flights: the event box of every full page (core flights.init stores it, `flights:updated`). The module never polls
 *     and never fetches in the background (every GET is a full page that marks the account online); only the reload icon
 *     (a user click) GETs page=fleetTable through OGX.flights.get({ force: true }). Arrived rows drop out locally.
 *   - outward and return are two real events (no synthetic returns, cargo known on both); `holding` = holdEnd.
 *   - no /img/fleet/<n>.gif on the fork: the mission icon is a coloured text badge.
 *   - slot max: stored page=fleetTable values ("Fleet 1 / 13", "0 / 2 expedition"), else OGX.state.calcSlots() when the
 *     research is known (Commander 611 included); otherwise '?'. No player classes.
 * Data: reads core keys flights / slots / shipStats / bodies / research / player; writes timeline.ui (collapsed) and settings.
 * Requests: OgameX: GET /ajax/fleet/eventlist/fetch through OGX.flights.get() (cached 60 s, forced by the reload icon).
 *   GALAXYZ: none, except page=fleetTable on a click of the reload icon.
 */
(function (OGX) {
  'use strict';

  const NAME = 'timeline';
  const ID = 'ogx-l-timeline';
  const P = 'ogx-l-timeline-';
  const RES = ['metal', 'crystal', 'deuterium'];
  const RES_NAME = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий' };
  const EXPEDITION = 15;
  const MISSILE = 10;
  const ICON_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15];   // public/img/fleet/<n>.gif
  const UI_KEY = 'ui';
  const UI_V = 1;
  // GALAXYZ text badges (no mission gifs on the fork): short label + colour per 2Moons mission id
  const GZ_ICON = {
    1: ['Атк', '#b23b3b'], 2: ['САБ', '#b23b3b'], 3: ['Тр', '#3f7f3f'], 4: ['Ост', '#2f6f8f'], 5: ['Држ', '#6f5f2f'], 6: ['Шп', '#7a4f9a'],
    7: ['Кол', '#2f7f6f'], 8: ['Пер', '#5f6f2f'], 9: ['Унч', '#8f2f2f'], 10: ['Рак', '#8f2f2f'], 11: ['ТМ', '#4f4f9a'], 15: ['Эксп', '#24486e'],
  };
  const isGz = () => !!(OGX.page.isGz && OGX.page.isGz());

  OGX.module({
    name: NAME,
    title: 'Хронология полётов',
    pages: '*',
    settings: {
      position: {
        type: 'enum', default: 'auto', label: 'Расположение',
        options: [{ value: 'auto', label: 'автоматически (GALAXYZ: справа под списком планет; OgameX: слева под меню)' },
          { value: 'left', label: 'слева, под меню' }, { value: 'right', label: 'справа, под списком планет' }, { value: 'off', label: 'не показывать' }],
      },
      skipOutboundExpeditions: { type: 'bool', default: true, label: 'Не показывать экспедиции на пути туда (как OGame Live)' },
      maxRows: { type: 'int', default: 30, min: 5, max: 100, label: 'Сколько строк показывать' },
    },

    async init(ctx) {
      // Not ctx.css(): it creates <style id="ogx-l-timeline">, the same id as the timeline div required by DESIGN §4.1.7.
      OGX.dom.injectStyle(ID + '-css', CSS);
      const m = new Timeline(ctx);
      ctx._timeline = m;
      await m.start();
    },

    dispose(ctx) {
      if (ctx._timeline) ctx._timeline.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const now = () => OGX.time.serverNow();
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);

  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }

  /** Body type -> short Russian suffix (fmt.coords covers moon/debris; deep space has no coordinates of its own). */
  function placeText(c, type) {
    if (!c) return '—';
    const base = OGX.fmt.coords(c, type);
    return type === 4 ? base + ' к' : base;
  }
  function typeName(type) {
    return type === 3 ? 'луна' : type === 2 ? 'поле обломков' : type === 4 ? 'глубокий космос' : type === 1 ? 'планета' : '';
  }

  /** Key of "one row per realMissionId and direction". Union rows (realMissionId null) keep their own row id. */
  function groupKey(f) {
    const id = f.realMissionId !== null && f.realMissionId !== undefined ? 'm' + f.realMissionId : 'r' + f.rowId;
    return id + (f.returnFlight ? '|R' : '|O');
  }

  /**
   * Active flights -> timeline rows (pure; exported for tests as OGX.timeline.rows).
   * - arrival > t only;
   * - skipOutboundExpeditions: mission 15 with returnFlight false (outbound arrival row and hold-end row) is dropped;
   * - one row per realMissionId and direction: the earliest arrival wins (an expedition before arrival has both its
   *   outbound row and its hold-end row; the hold end is kept as `holdEnd` on the shown row);
   * - sorted by arrival, then by row id.
   */
  function buildRows(list, t, { skipOutboundExpeditions = true } = {}) {
    const groups = new Map();
    let skipped = 0;
    for (const f of list || []) {
      if (!f || !fin(f.arrival) || f.arrival <= t) continue;
      if (skipOutboundExpeditions && +f.missionType === EXPEDITION && !f.returnFlight) { skipped++; continue; }
      const k = groupKey(f);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    const rows = [];
    for (const [key, fl] of groups) {
      fl.sort((a, b) => a.arrival - b.arrival);
      const shown = fl[0];
      const hold = fl.find((x) => x.synthetic === 'holdEnd' && x !== shown);
      rows.push({ key, f: shown, holdEnd: hold ? hold.arrival : null, merged: fl.length });
    }
    rows.sort((a, b) => (a.f.arrival - b.f.arrival) || (String(a.f.rowId) < String(b.f.rowId) ? -1 : 1));
    return { rows, skipped };
  }

  /** Used slots from the flight list (PlayerService::getFleetSlotsInUse / getExpeditionSlotsInUse). */
  function slotsFromFlights(list, t) {
    const fleet = new Set(), exp = new Set();
    for (const f of list || []) {
      if (!f || !f.own || !fin(f.arrival) || f.arrival <= t) continue;
      const id = f.realMissionId !== null && f.realMissionId !== undefined ? f.realMissionId : f.rowId;
      if (+f.missionType !== MISSILE) fleet.add(id);
      if (+f.missionType === EXPEDITION) exp.add(id);
    }
    return { fleet: fleet.size, expedition: exp.size };
  }

  OGX.timeline = { rows: buildRows, slotsFromFlights };

  // ------------------------------------------------------------------ main class
  class Timeline {
    constructor(ctx) {
      this.ctx = ctx;
      this.flights = [];
      this.flightsT = null;
      this.stats = {};
      this.bodies = {};
      this.slots = null;
      this.calcSlots = null;
      this.ui = { v: UI_V, collapsed: false };
      this.offs = [];
      this.root = null;
      this.nextArrival = Infinity;
      this.renderSoon = OGX.util.debounce(() => this.render('update'), 150);
      // B events (timed, errors with stack)
      this.render = OGX.log.wrap(NAME, this._render.bind(this), 'render');
      this.reload = OGX.log.wrap(NAME, this._reload.bind(this), 'reload');
      this.toggle = OGX.log.wrap(NAME, this._toggle.bind(this), 'toggle');
      this.openMovement = OGX.log.wrap(NAME, this._openMovement.bind(this), 'openMovement');
    }

    S(key) { return this.ctx.settings.get(key); }

    async start() {
      const ctx = this.ctx;
      try {
        const ui = await ctx.store.get(UI_KEY, null);
        if (ui && typeof ui === 'object') this.ui = { v: UI_V, collapsed: !!ui.collapsed };
      } catch (e) { ctx.log.warn('ui state', e); }

      await this.loadData();
      await this.render('init');

      this.offs.push(ctx.bus.on('flights:updated', (e) => {
        if (e && Array.isArray(e.flights)) { this.flights = e.flights; this.flightsT = e.t || now(); this.checkFlights(); }
        this.renderSoon();
      }));
      this.offs.push(ctx.bus.on('state:updated', (e) => {
        const keys = (e && e.keys) || [];
        if (keys.some((k) => ['slots', 'shipStats', 'research', 'player', 'bodies'].includes(k))) {
          this.loadData().then(() => this.renderSoon()).catch((err) => ctx.log.warn('reload data', err));
        }
      }));
      this.offs.push(ctx.settings.onChange((key) => {
        OGX.log.rec('B', NAME, 'setting', { key });
        this.ensureFlights();
        this.renderSoon();
      }));
      this.offs.push(OGX.storage.subscribe('slots', (v, info) => {
        if (info && info.remote) { this.slots = v || null; this.renderSoon(); }   // /fleet opened in another tab
      }));
      this.offs.push(OGX.storage.subscribe('flights', (v, info) => {
        if (info && info.remote && v && Array.isArray(v.flights)) { this.flights = v.flights; this.flightsT = v.t; this.renderSoon(); }
      }));

      this.ensureFlights();
      ctx.every(1000, (t) => this.tick(t));
    }

    /** Flights source while the timeline is shown: the core eventbox poller (a singleton shared with other modules)
     * plus one cached get() when polling is off and the stored list is missing or older than 60 s. */
    ensureFlights() {
      if (this.S('position') === 'off' || this.stopPoll) return;
      // GALAXYZ: the page's own event box is the list (stored by the core at boot); no poller, no background GET.
      if (isGz()) return;
      this.stopPoll = OGX.flights.startPolling();
      OGX.log.rec('B', NAME, 'poller:start', { sec: OGX.settings.get('core.flightsPollSec') });
      // The poller's first round fetches the list itself; get() (cached 60 s) only when the poller cannot run now.
      const pollSec = +OGX.settings.get('core.flightsPollSec') || 0;
      if ((!pollSec || document.hidden) && (!this.flightsT || now() - this.flightsT > 60000)) this.fetchFlights(false);
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* gone */ } }
      this.offs = [];
      if (this.renderSoon.cancel) this.renderSoon.cancel();
      if (this.stopPoll) { try { this.stopPoll(); } catch (e) { /* gone */ } this.stopPoll = null; }
      this.remove();
    }

    remove() {
      if (this.root) {
        for (const d of this.detach || []) { try { d(); } catch (e) { /* gone */ } }
        this.detach = [];
        this.root.remove();
      }
      this.root = null;
      for (const stale of document.querySelectorAll('div#' + ID)) stale.remove();
    }

    async loadData() {
      if (!this.flightsT) {
        const fl = await OGX.flights.cached();   // core: stored list, no request
        if (fl && Array.isArray(fl.flights)) { this.flights = fl.flights; this.flightsT = fl.t || null; this.checkFlights(); }
      }
      try { this.stats = (await OGX.state.shipStats()) || {}; } catch (e) { this.stats = {}; this.ctx.log.warn('shipStats failed', e); }
      try { this.bodies = (await OGX.state.bodies()) || {}; } catch (e) { this.bodies = {}; }
      try { this.slots = await OGX.state.slots(); } catch (e) { this.slots = null; }
      // core slots: page=fleetTable (fleet + expedition) and the page=galaxy header "1/13 Fleet Slots" (fleet only, fleetSrc 'galaxy')
      try {
        if (OGX.state.calcSlots) {
          // core: calc.slots with computer 108 / astrophysics 124 + Commander 611 (GALAXYZ) or the class bonus (OgameX)
          const cs = await OGX.state.calcSlots();
          this.calcSlots = cs && cs.known && fin(+cs.fleet) && fin(+cs.expedition) ? { fleet: +cs.fleet, expedition: +cs.expedition } : null;
        } else {
        const r = await OGX.state.research();
        const p = await OGX.state.player();
        const srv = OGX.state.server ? await OGX.state.server() : null;
        if (r && r.t && r.levels) {
          this.calcSlots = OGX.calc.slots({
            computer: +r.levels[108] || 0, astrophysics: +r.levels[124] || 0,
            playerClass: p && p.playerClass, bonusExpeditionSlots: (srv && +srv.bonusExpeditionSlots) || 0,
          });
        } else this.calcSlots = null;
        }
      } catch (e) { this.calcSlots = null; }
      if (this.slots) {
        for (const k of ['fleet', 'expedition']) {
          const s = this.slots[k];
          if (s) { OGX.learn.value('timeline.slots.' + k + '.used', +s.used, { min: 0, int: true, max: 500 }); OGX.learn.value('timeline.slots.' + k + '.max', +s.max, { min: 0, int: true, max: 500 }); }
        }
      }
    }

    async fetchFlights(force) {
      const r = await OGX.flights.get({ force: !!force });
      if (r && r.error) {
        this.ctx.log.warn('flights.get failed', r.error);
        this.setStatus('Не удалось загрузить список флотов: ' + r.error, true);
        return { ok: false, error: r.error };
      }
      if (r && Array.isArray(r.flights)) {
        this.flights = r.flights; this.flightsT = r.t;
        this.checkFlights();
        this.renderSoon();
      }
      return { ok: true, n: r && r.flights ? r.flights.length : 0 };
    }

    async _reload() {
      this.setStatus('обновление…', false);
      if (this.btnReload) this.btnReload.classList.add(P + 'spin');
      try {
        const r = await this.fetchFlights(true);
        if (r.ok) { this.setStatus(null); await this.loadData(); await this.render('reload'); }
        return r;
      } finally {
        if (this.btnReload) this.btnReload.classList.remove(P + 'spin');
      }
    }

    async _toggle() {
      this.ui = { v: UI_V, collapsed: !this.ui.collapsed };
      if (this.root) this.root.classList.toggle(P + 'collapsed', this.ui.collapsed);
      await this.ctx.store.set(UI_KEY, this.ui);
      return { collapsed: this.ui.collapsed };
    }

    _openMovement(rowId) {
      OGX.page.go('/fleet/movement');
      return { rowId };
    }

    /** Sanity checks on the parsed flights (once per update): learning alerts on drift. */
    checkFlights() {
      const list = this.flights || [];
      OGX.learn.value('timeline.flights', list.length, { min: 0, int: true, max: 2000 });
      for (const f of list) {
        if (!f) continue;
        OGX.learn.check('timeline.flight', { arrival: f.arrival, units: f.units, metal: f.cargo && f.cargo.metal, crystal: f.cargo && f.cargo.crystal, deuterium: f.cargo && f.cargo.deuterium });
        OGX.learn.value('timeline.arrival', +f.arrival, { min: 1e12 });   // ServerMs (an unparsed data-arrival-time gives NaN/0)
        OGX.learn.value('timeline.missionType', +f.missionType, { min: 1, max: 18, int: true });
        if (!f.from || !f.to) OGX.learn.value('timeline.coords', NaN);
      }
    }

    /** Mount point per setting; null when the page has no such column. */
    /** Mount point per setting -> { where, el, col: 'left'|'right' } (col = the column it really went to); null when the
     * page has neither column. 'auto' = right column on GALAXYZ (as since the core port), left menu on OgameX. */
    mountPoint(pos) {
      if (pos === 'auto') pos = isGz() ? 'right' : 'left';
      if (isGz()) {
        // GALAXYZ: #links (floated left menu column) holds ul#menuTable; 'right' = after the LAST #planetList (one per planet).
        // Info pages and fleetStep3 have no #rechts: both settings use the left column there.
        const menu = OGX.dom.anchors().menuEnd;
        const lists = OGX.dom.$('#rechts') ? OGX.dom.planetLists() : [];
        if (pos === 'right' && lists.length) return { where: 'after', el: lists[lists.length - 1], col: 'right' };
        if (menu) return { where: 'after', el: menu, col: 'left' };
        if (lists.length) return { where: 'after', el: lists[lists.length - 1], col: 'right' };
        return null;
      }
      if (pos === 'left') {
        const a = OGX.dom.anchors();
        const tb = a.menuEnd;                                 // #left > #toolbarcomponent, main.blade.php:512
        if (tb) return { where: 'after', el: tb, col: 'left' };
        const left = a.leftColumn;                            // #left, main.blade.php:496
        if (left) return { where: 'append', el: left, col: 'left' };
      }
      if (pos === 'right' || pos === 'left') {
        // main.blade.php:1729
        const lists = OGX.dom.$$('#rechts #planetList');
        if (lists.length) return { where: 'after', el: lists[lists.length - 1], col: pos === 'right' ? 'right' : 'left' };
      }
      return null;
    }

    build(pos) {
      const btnReload = h('button', { type: 'button', class: [P + 'btn', P + 'reload'], title: isGz() ? 'Обновить список полётов (один запрос страницы «Флот»)' : 'Обновить список полётов', 'aria-label': 'Обновить', dataset: { ogxAct: 'timeline:reload' }, onClick: () => this.reload() }, '⟳');
      const btnToggle = h('button', { type: 'button', class: [P + 'btn', P + 'toggle'], title: 'Свернуть / развернуть', dataset: { ogxAct: 'timeline:toggle' }, onClick: () => this.toggle() }, '▾');
      const slotFleet = h('span', { class: [P + 'slots', P + 'slots-fleet'], dataset: { slots: 'fleet' } });
      const slotExp = h('span', { class: [P + 'slots', P + 'slots-exp'], dataset: { slots: 'expedition' } });
      const head = h('div', { class: P + 'head' },
        btnReload,
        h('span', { class: P + 'title' }, 'Полёты'),
        slotFleet, slotExp, btnToggle);
      const status = h('div', { class: P + 'status', hidden: true });
      const list = h('div', { class: P + 'list' });
      const foot = h('div', { class: [P + 'foot', P + 'muted'], hidden: true });
      const root = h('div', { id: ID, class: [P + 'root', P + 'pos-' + pos, isGz() && P + 'gz', this.ui.collapsed && P + 'collapsed'] }, head, h('div', { class: P + 'body' }, status, list, foot));
      this.btnReload = btnReload;
      this.refs = { head, slotFleet, slotExp, status, list, foot };
      return root;
    }

    setStatus(text, bad) {
      if (!this.refs) return;
      const s = this.refs.status;
      s.hidden = !text;
      s.textContent = text || '';
      s.classList.toggle(P + 'bad', !!bad);
    }

    // ---------------------------------------------------------------- render
    async _render(reason) {
      const pos = this.S('position');
      if (pos === 'off') { this.remove(); return { reason, pos, rows: 0 }; }
      const mp = this.mountPoint(pos);
      if (!mp) { this.remove(); this.ctx.log.debug('no mount point for', pos); return { reason, pos, rows: 0, mounted: false }; }

      const statusText = this.refs && !this.refs.status.hidden ? [this.refs.status.textContent, this.refs.status.classList.contains(P + 'bad')] : null;
      this.remove();
      this.col = mp.col;
      const root = this.build(isGz() ? mp.col : pos === 'auto' ? 'left' : pos);
      if (mp.where === 'after') mp.el.after(root); else mp.el.appendChild(root);
      this.root = root;
      this.detach = [];
      if (statusText && reason !== 'reload') this.setStatus(statusText[0], statusText[1]);

      const t = now();
      const { rows, skipped } = buildRows(this.flights, t, { skipOutboundExpeditions: !!this.S('skipOutboundExpeditions') });
      const max = +this.S('maxRows') || 30;
      const shown = rows.slice(0, max);
      const list = this.refs.list;
      for (const r of shown) list.appendChild(this.rowEl(r, t));
      if (!rows.length) list.appendChild(h('div', { class: [P + 'empty', P + 'muted'] }, this.flightsT ? 'Нет полётов' : 'Список полётов ещё не загружен'));
      const notes = [];
      if (rows.length > shown.length) notes.push('ещё ' + (rows.length - shown.length) + ' ' + OGX.fmt.plural(rows.length - shown.length, ['полёт', 'полёта', 'полётов']));
      if (skipped) notes.push('скрыто экспедиций туда: ' + skipped);
      setText(this.refs.foot, notes.join(' · '));
      this.refs.foot.hidden = !notes.length;
      this.refs.foot.title = this.flightsT ? 'Список флотов: ' + OGX.fmt.ago(this.flightsT) : '';

      this.nextArrival = rows.reduce((m, r) => Math.min(m, r.f.arrival, r.holdEnd || Infinity), Infinity);
      this.updateSlots(t);
      return { reason, pos, rows: shown.length, total: rows.length, skipped, hostile: shown.filter((r) => this.isHostile(r.f)).length };
    }

    isHostile(f) { return f.status === 'hostile' && !f.returnFlight; }

    rowEl(r, t) {
      const f = r.f;
      const hostile = this.isHostile(f);
      const mt = +f.missionType;
      const mission = OGX.catalog.missionName(mt);
      const dirTxt = f.returnFlight ? ' (возврат)' : f.synthetic === 'holdEnd' ? ' (конец удержания)' : '';
      const gzIcon = isGz() ? GZ_ICON[mt] : null;
      const icon = gzIcon
        ? h('span', { class: [P + 'icon', P + 'icon-txt', P + 'icon-gz'], style: { background: gzIcon[1] }, title: mission }, gzIcon[0])
        : isGz() ? h('span', { class: [P + 'icon', P + 'icon-txt', P + 'icon-gz'], title: mission }, mission.slice(0, 3))
        : ICON_TYPES.includes(mt)
        ? h('img', { class: P + 'icon', src: '/img/fleet/' + mt + '.gif', alt: '', width: '16', height: '16', onError: (ev) => { ev.target.replaceWith(h('span', { class: [P + 'icon', P + 'icon-txt'] }, mission.slice(0, 2))); } })
        : h('span', { class: [P + 'icon', P + 'icon-txt'] }, mission.slice(0, 2));
      const dirMark = h('span', { class: [P + 'dir', f.returnFlight ? P + 'dir-ret' : P + 'dir-out'], title: f.returnFlight ? 'Возвращается' : 'Летит к цели' }, f.returnFlight ? '↩' : '→');

      // capacity & fill bars
      const cap = OGX.calc.fleetCargo(f.ships || {}, this.stats || {});
      const cargo = f.cargo || { metal: 0, crystal: 0, deuterium: 0 };
      const unknownCargo = f.synthetic === 'return';
      const bars = h('div', { class: [P + 'bars', unknownCargo && P + 'bars-unknown'] });
      for (const res of RES) {
        const v = +cargo[res] || 0;
        const frac = cap > 0 ? v / cap : 0;
        if (cap > 0 && !unknownCargo) OGX.learn.value('timeline.cargoFill', frac, { min: 0, max: 1.6 });   // > 1 only by the half fuel
        const pct = Math.max(0, Math.min(1, frac)) * 100;
        bars.appendChild(h('div', { class: [P + 'bar', P + 'bar-' + res], dataset: { res, v: String(Math.round(v)), pct: pct.toFixed(1) } },
          h('div', { class: P + 'fill', style: { width: pct.toFixed(1) + '%' } })));
      }
      const sum = RES.reduce((a, k) => a + (+cargo[k] || 0), 0);
      bars.dataset.cap = String(cap);
      bars.dataset.fill = cap > 0 ? (sum / cap).toFixed(4) : '';

      const fromTxt = placeText(f.from, f.fromType);
      const toTxt = placeText(f.to, f.toType);
      const el = h('div', {
        class: [P + 'row', hostile && P + 'hostile', f.own ? P + 'own' : P + 'foreign', f.returnFlight && P + 'ret', f.synthetic && P + 'syn-' + f.synthetic],
        dataset: { row: String(f.rowId), mission: String(f.realMissionId != null ? f.realMissionId : ''), missionType: String(mt), returnFlight: f.returnFlight ? '1' : '0', arrival: String(f.arrival), ogxAct: 'timeline:row' },
        tabindex: '0', role: 'button',
        onClick: () => this.openMovement(f.rowId),
      },
      h('div', { class: P + 'l1' },
        icon,
        h('span', { class: P + 'time' }, OGX.fmt.time(f.arrival)),
        h('span', { class: P + 'cd' }, OGX.dom.countdown(f.arrival, { doneText: 'прибыл' }))),
      h('div', { class: P + 'l2' },
        h('span', { class: P + 'from' }, fromTxt), dirMark, h('span', { class: P + 'to' }, toTxt),
        h('span', { class: P + 'units', title: 'Кораблей во флоте' }, f.units ? OGX.fmt.num(f.units) : '')),
      bars);
      this.detach.push(OGX.dom.tooltip(el, () => this.tooltipFor(r, { mission: mission + dirTxt, hostile, cap, cargo, unknownCargo, sum }), { side: this.col === 'right' ? 'left' : 'right' }));
      return el;
    }

    bodyName(key) {
      const b = key && this.bodies ? this.bodies[key] : null;
      return b && b.name ? b.name : '';
    }

    tooltipFor(r, o) {
      const f = r.f;
      const who = f.own ? 'свой флот' : o.hostile ? 'враждебный флот' : 'чужой флот';
      const lines = [];
      const row = (label, value, cls) => lines.push(h('tr', { class: cls }, h('th', null, label), h('td', null, value)));
      row('Задание', o.mission);
      row('Чей', who, o.hostile ? P + 'tip-bad' : null);
      const place = (c, type, key) => [placeText(c, type), typeName(type) ? ' ' + typeName(type) : '', this.bodyName(key) ? ' «' + this.bodyName(key) + '»' : ''].join('');
      row('Откуда', place(f.from, f.fromType, f.originKey));
      row('Куда', place(f.to, f.toType, f.destKey));
      row('Прибытие', OGX.fmt.dateTime(f.arrival));
      if (r.holdEnd) row('Конец удержания', OGX.fmt.dateTime(r.holdEnd));
      if (f.departure) row('Вылет', OGX.fmt.dateTime(f.departure));
      const shipsTxt = Object.entries(f.ships || {}).filter(([, n]) => n > 0).map(([id, n]) => (OGX.catalog.shortName(+id) || OGX.catalog.name(+id) || id) + ' ' + OGX.fmt.num(n));
      for (const [title, n] of Object.entries(f.unknownShips || {})) shipsTxt.push(title + ' ' + OGX.fmt.num(n));
      row('Корабли', shipsTxt.length ? shipsTxt.join(', ') : (f.units ? OGX.fmt.num(f.units) + ' шт.' : '—'));
      if (o.unknownCargo) row('Груз', 'станет известен после прибытия');
      else {
        for (const res of RES) {
          const v = +o.cargo[res] || 0;
          const approx = o.cargo.approx && (res === 'deuterium' || v >= 1e6);
          row(RES_NAME[res], (approx ? '≈' : '') + OGX.fmt.num(v) + (o.cap > 0 ? ' (' + OGX.fmt.pct(v / o.cap) + ')' : ''));
        }
      }
      row('Вместимость', o.cap > 0 ? OGX.fmt.num(o.cap) + (o.unknownCargo ? '' : ', заполнено ' + OGX.fmt.pct(o.sum / o.cap)) : 'неизвестна');
      const src = isGz() ? (this.flightsT ? 'Список — из блока событий страницы, ' + OGX.fmt.ago(this.flightsT) + '. ' : '') + 'Щелчок — открыть «Флот» (список полётов)' : 'Щелчок — открыть «Передвижения флота»';
      return h('div', { class: P + 'tip' }, h('table', null, h('tbody', null, lines)), h('div', { class: P + 'muted' }, src));
    }

    /** Slot counters: stored /fleet values when at least as new as the flight list, else counted from the flights. */
    computeSlots(t) {
      const fromFl = this.flightsT ? slotsFromFlights(this.flights, t) : null;
      const out = {};
      for (const k of ['fleet', 'expedition']) {
        const st = this.slots && this.slots[k] ? this.slots[k] : null;
        const stT = this.slots ? (this.slots[k + 'T'] || this.slots.t || 0) : 0;
        const stSrc = this.slots && this.slots[k + 'Src'] === 'galaxy' ? 'galaxy' : 'fleet';
        let used = null, max = null, src = null;
        if (st && fin(+st.used) && (!fromFl || stT >= this.flightsT - 2000)) { used = +st.used; src = stSrc; } else if (fromFl) { used = fromFl[k]; src = 'flights'; }
        if (st && fin(+st.max)) max = +st.max; else if (this.calcSlots) max = this.calcSlots[k];
        out[k] = { used, max, src };
      }
      return out;
    }

    updateSlots(t) {
      if (!this.refs) return;
      const s = this.computeSlots(t);
      const put = (el, label, longLabel, v) => {
        const txt = label + ' ' + (v.used === null ? '?' : v.used) + '/' + (v.max === null ? '?' : v.max);
        setText(el, txt);
        el.dataset.used = v.used === null ? '' : String(v.used);
        el.dataset.max = v.max === null ? '' : String(v.max);
        const full = v.used !== null && v.max !== null && v.used >= v.max;
        el.classList.toggle('overmark', full);
        el.classList.toggle(P + 'full', full);
        const title = longLabel + ': занято ' + (v.used === null ? '?' : v.used) + ' из ' + (v.max === null ? '? (откройте «Флот» или «Исследования»)' : v.max) +
          (v.src === 'flights' ? ' (по списку полётов)' : v.src === 'fleet' ? ' (со страницы «Флот»)' : v.src === 'galaxy' ? ' (со страницы «Галактика»)' : '');
        if (el.title !== title) el.title = title;
      };
      put(this.refs.slotFleet, 'Ф', 'Слоты флотов', s.fleet);
      put(this.refs.slotExp, 'Э', 'Слоты экспедиций', s.expedition);
    }

    tick(t) {
      t = t || now();
      if (t >= this.nextArrival) { this.nextArrival = Infinity; this.renderSoon(); }
    }
  }

  const CSS = `
div#${ID} { position: relative; clear: both; width: 165px; margin: 4px 0 6px; padding: 2px 3px 3px; border: 1px solid #2b3846; border-radius: 3px;
  background: rgba(13,16,20,.92); font: 10px/13px Verdana, Arial, sans-serif; color: #cfd8e3; text-align: left; z-index: 4; box-sizing: border-box; }
div#${ID} * { box-sizing: border-box; }
div#${ID}.${P}pos-right { width: 137px; margin-left: 8px; }
div#${ID}.${P}gz.${P}pos-right { width: 165px; margin-left: 0; }   /* GALAXYZ right column: same box as since the core port */
div#${ID}.${P}gz.${P}pos-left { width: 165px; margin: 6px 0 6px 4px; }
.${P}head { display: flex; align-items: center; gap: 3px; border-bottom: 1px solid #2b3846; padding-bottom: 1px; margin-bottom: 2px; white-space: nowrap; }
.${P}title { flex: 1 1 auto; font-weight: bold; color: #fff; overflow: hidden; text-overflow: ellipsis; }
.${P}slots { flex: none; color: #8fbf8f; font-weight: bold; cursor: default; }
.${P}slots.${P}full, .${P}slots.overmark { color: #f44336; }
.${P}btn { flex: none; width: 15px; height: 14px; padding: 0; border: 1px solid #2b3846; border-radius: 2px; background: #161c24; color: #8593a3;
  font: 10px/12px Verdana, Arial, sans-serif; cursor: pointer; }
.${P}btn:hover { color: #fff; border-color: #6f9fd8; }
.${P}spin { animation: ${P}spin 1s linear infinite; }
@keyframes ${P}spin { to { transform: rotate(360deg); } }
.${P}collapsed .${P}body { display: none; }
.${P}collapsed .${P}toggle { transform: rotate(-90deg); }
.${P}row { padding: 2px 1px; border-bottom: 1px solid rgba(43,56,70,.6); cursor: pointer; }
.${P}row:last-child { border-bottom: 0; }
.${P}row:hover, .${P}row:focus { background: rgba(111,159,216,.12); outline: none; }
.${P}row.${P}hostile { background: rgba(160,20,20,.35); box-shadow: inset 2px 0 0 #f44336; }
.${P}row.${P}hostile .${P}time, .${P}row.${P}hostile .${P}cd { color: #ff6b6b; }
.${P}row.${P}foreign:not(.${P}hostile) { box-shadow: inset 2px 0 0 #f2d16b; }
.${P}row.${P}ret { opacity: .85; }
.${P}l1, .${P}l2 { display: flex; align-items: center; gap: 3px; white-space: nowrap; min-height: 13px; }
.${P}icon { flex: none; width: 16px; height: 16px; }
.${P}icon-txt { display: inline-block; text-align: center; font-size: 8px; line-height: 16px; background: #24486e; border-radius: 2px; color: #fff; }
.${P}icon.${P}icon-gz { width: auto; min-width: 22px; height: 13px; padding: 0 2px; font: bold 8px/13px Verdana, Arial, sans-serif; }
.${P}time { flex: 1 1 auto; color: #fff; }
.${P}cd { flex: none; color: #9cd3ff; font-weight: bold; }
.${P}cd .ogx-countdown.ogx-done { color: #8593a3; font-weight: normal; }
.${P}l2 { font-size: 9px; color: #a9b5c4; }
.${P}from, .${P}to { overflow: hidden; text-overflow: ellipsis; }
.${P}dir { flex: none; color: #8593a3; }
.${P}dir-ret { color: #8fbf8f; }
.${P}units { flex: 1 1 auto; text-align: right; color: #cfd8e3; }
.${P}bars { display: flex; gap: 2px; margin-top: 1px; }
.${P}bar { flex: 1 1 0; height: 3px; background: rgba(255,255,255,.08); border-radius: 1px; overflow: hidden; }
.${P}fill { height: 100%; }
.${P}bar-metal .${P}fill { background: #a9b5c4; }
.${P}bar-crystal .${P}fill { background: #79c2e8; }
.${P}bar-deuterium .${P}fill { background: #7fe0b4; }
.${P}bars-unknown .${P}bar { background: repeating-linear-gradient(90deg, rgba(255,255,255,.08) 0 3px, transparent 3px 5px); }
.${P}muted { color: #8593a3; }
.${P}empty { padding: 2px 0; }
.${P}foot { font-size: 9px; line-height: 11px; padding-top: 2px; white-space: normal; }
.${P}status { white-space: normal; color: #f2d16b; } .${P}status.${P}bad { color: #f44336; }
.${P}tip { font: 11px/14px Verdana, Arial, sans-serif; }
.${P}tip table { border-collapse: collapse; }
.${P}tip th { text-align: left; font-weight: normal; color: #8593a3; padding: 0 6px 0 0; white-space: nowrap; vertical-align: top; }
.${P}tip td { padding: 0; max-width: 260px; }
.${P}tip .${P}tip-bad td { color: #ff6b6b; font-weight: bold; }
`;
})(window.OGX);
