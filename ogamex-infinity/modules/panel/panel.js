/* ogamex-infinity/modules/panel/panel.js — Owner: infinity/panel.
 * Control panel shell and planet list (DESIGN §4.2.1):
 *   - menu entry "Infinity" in ul#menuTableTools that toggles the shared side panel OGX.dom.sidePanel('infinity');
 *   - panel header: player, class (Russian), rank, dark matter, server clock, attack indicator;
 *   - tab "Планеты" (order 10): one row per planet (+ its moon, indented): name, coords, fields bar, temperature,
 *     projected M/C/D with fill colour, production per hour, active building with countdown, ships, data age;
 *     footer with totals, production, in-flight sum and grand total. Row click switches the body (?cp=),
 *     Ctrl/Cmd/middle click opens a new tab; small links to resources / facilities / fleet / galaxy;
 *   - optional fields badges "used/max" under each #planetList .smallplanet (skipped when OgameX Live runs: html[data-ogx-live]);
 *   - tab "Логи" (OGX.diag.addPanelTab) so the user can hand over the diagnostic journal from the game page.
 *
 * OgameX markup used (src/OGameX/resources/views/ingame/layouts/main.blade.php):
 *   ul#menuTableTools (empty list made for tool links)        main:766-768   (layout.md §12)
 *   #planetList > div.smallplanet[data-planet-id]              main:1737-1738 (id attr is planet-<index>, not the planet id)
 *   #attack_alert.soon | .noAttack                             main:394       (layout.md §9.2)
 *   Planet-list links keep every query param and replace cp     main:1733-1735 (http_build_query) — we do the same.
 *   ?cp=<id> switches the current body for every later request  app/Http/Middleware/GlobalGame.php:43-46
 * Player, class, rank, DM come from OGX.state.player() (core parse.player: #characterclass .sprite, #bar highscore "(37)",
 * #resources_darkmatter[data-raw]); planet data from OGX.state (bodies) and flights from the core 'flights' store.
 * The only request this module may cause is OGX.flights.get() (GET /ajax/fleet/eventlist/fetch, routes/web.php) when the
 * planets tab is shown and the stored flight list is older than 5 minutes (OgameX only).
 *
 * GALAXYZ (ogamex.eu, 2Moons fork; specs/galaxyz/layout.md, CORE_API §22):
 *   - menu entry in the left ul#menuTable (OGX.dom.anchors().menu; detached under OgameX Suite, which mirrors its badge);
 *   - no player classes: the header shows the officers instead (state.player().officers, stored when page=officier is
 *     opened; «откройте «Офицеры»» link while unknown) and the vacation mode (state.player().vacation / vacationUntil);
 *   - planet list: one #planetList per planet, ids only in a.planetlink cp= (OGX.dom.planetRows());
 *   - bodies only seen on page=imperium have a stock without storage/production (res.src 'imperium', storage/perHour null):
 *     shown as «—» with a hint, never as 0 or as a full storage; totals say how many planets are known;
 *   - flights: the event box of every full page is stored by the core (flights:updated); the module never fetches
 *     page=fleetTable itself (every GALAXYZ GET is a full page that marks the account online);
 *   - links: page=buildings holds mines, storage and facilities (one «Постройки» link), page=shipyard, page=fleetTable,
 *     page=galaxy (title warns that a galaxy view costs deuterium);
 *   - body switch keeps the page like the game's selector (base.js:282 '?' + queryString + '&cp='), except fleetStep*,
 *     info pages and the galaxy (a galaxy view costs deuterium): those switch on page=fleetTable / overview.
 */
(function (OGX) {
  'use strict';

  const NAME = 'panel';
  const P = 'ogx-i-panel-';
  const PANEL_ID = 'infinity';
  const RES = ['metal', 'crystal', 'deuterium'];
  const RES_SHORT = { metal: 'М', crystal: 'К', deuterium: 'Д' };
  const RES_NAME = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий' };
  const CLASS_RU = { miner: 'Коллекционер', warrior: 'Генерал', explorer: 'Первооткрыватель', none: 'без класса' };
  const OFFICER_IDS = [601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 612, 613, 614, 615];
  const HOUR = 3600000;
  const FLIGHTS_MAX_AGE = 5 * 60000;

  OGX.module({
    name: NAME,
    title: 'Панель управления',
    pages: '*',
    settings: {
      openOnLoad: { type: 'bool', default: false, label: 'Открывать панель при загрузке страницы' },
      planetbarFields: { type: 'bool', default: true, label: 'Поля «занято/всего» в списке планет', hint: 'Не показываются, если работает OgameX Live' },
      showOfficers: { type: 'bool', default: true, label: 'Офицеры в заголовке панели (GALAXYZ)', hint: 'На GALAXYZ нет классов игрока; уровни офицеров берутся со страницы «Офицеры»' },
      showMoons: { type: 'bool', default: true, label: 'Показывать луны во вкладке «Планеты»' },
    },

    async init(ctx) {
      const p = new Panel(ctx);
      ctx._panel = p;
      await p.start();
    },

    dispose(ctx) {
      if (ctx._panel) ctx._panel.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const now = () => OGX.time.serverNow();
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  const num = (n) => OGX.fmt.num(Math.floor(+n || 0));
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function setTitle(el, t) { if (el && el.getAttribute('title') !== t) el.setAttribute('title', t); }
  function toggleCls(el, cls, on) { if (el && el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); }
  /** Fill class of a stock: 90% warn, 100% bad (same rule as the game's resource bar, layout.md §6.1). */
  function fillClass(amount, storage) {
    if (!(storage > 0)) return amount > 0 ? 'bad' : 'ok';
    if (amount >= storage) return 'bad';
    if (amount >= 0.9 * storage) return 'warn';
    return 'ok';
  }
  function fieldsClass(used, max) {
    if (!(max > 0)) return 'ok';
    if (used >= max) return 'bad';
    if (max - used <= 2 || used / max >= 0.9) return 'warn';
    return 'ok';
  }
  /** Ships on a body without solar satellites / crawlers (212/217 are not fleet ships). */
  function shipsTotal(ships) {
    if (!ships) return 0;
    let n = 0;
    for (const id of OGX.catalog.fleetShipIds) n += +ships[id] || 0;
    return n;
  }
  const isGz = () => { try { return !!(OGX.page.isGz && OGX.page.isGz()); } catch (e) { return false; } };
  /** Same page with cp replaced, like the game's selector (core page.bodyUrl: fleetStep1-3 -> fleetTable, info/galaxy -> overview). */
  const samePageUrl = (id) => OGX.page.bodyUrl(id);
  function pageUrl(path, id) {
    try { return OGX.page.url(path, { cp: id }); } catch (e) { return location.origin + path + '?cp=' + encodeURIComponent(id); }
  }
  /**
   * Local helper (core gap): core parse.planetList's fallback regex /(-?\d+)\D+(-?\d+)°C/ swallows the minus of a negative
   * maximum ("-61 to -21°C" -> -61 / 21). OgameX always creates planets with temp_min = temp_max - 40
   * (app/Services/PlanetMoveService.php:170-171, same rule in PlanetService), so a pair whose span is not 40 but becomes 40
   * with a negated maximum is that parser bug: show the corrected value.
   */
  function fixTemp(min, max) {
    if (!fin(min) || !fin(max) || isGz()) return { min, max, fixed: false };   // GALAXYZ: tooltip "-10°C to 30°C" parsed with signs
    if (max > 0 && max - min !== 40 && -max - min === 40) return { min, max: -max, fixed: true };
    return { min, max, fixed: false };
  }
  const rec = (src, what, data) => { try { OGX.log.rec(src, NAME, what, data); } catch (e) { /* journal unavailable */ } };

  // ------------------------------------------------------------------ main class
  class Panel {
    constructor(ctx) {
      this.ctx = ctx;
      this.log = ctx.log;
      this.bodies = {};
      this.list = [];             // [{ planet, moon }]
      this.player = null;
      this.flights = null;        // Flight[] | null
      this.flightsT = 0;
      this.rows = [];             // [{ key, body, refs }]
      this.totalRefs = null;
      this.headRefs = null;
      this.offs = [];
      this.badges = [];
      this.flightsRequested = false;
      this.refreshSoon = OGX.util.debounce(() => this.reload('update'), 200);
      // B events: user-visible actions and full renders are journaled (timed, errors with stack).
      this.toggle = OGX.log.wrap(NAME, this._toggle.bind(this), 'toggle');
      this.navigate = OGX.log.wrap(NAME, this._navigate.bind(this), 'navigate');
      this.renderBadges = OGX.log.wrap(NAME, this._renderBadges.bind(this), 'badges');
      this.fetchFlights = OGX.log.wrap(NAME, this._fetchFlights.bind(this), 'fetchFlights');
    }

    S(key) { return this.ctx.settings.get(key); }

    async start() {
      const ctx = this.ctx;
      ctx.css(CSS);
      await this.load();

      // Shared side panel (get-or-create: other Infinity modules add their tabs to the same panel).
      this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
      if (this.panel.setTitle) this.panel.setTitle('OgameX Infinity');
      this.buildHeader();
      this.tab = this.panel.addTab({
        id: 'planets', label: 'Планеты', order: 10,
        render: (c) => this.renderPlanets(c),
        onShow: () => this.maybeFetchFlights(),
      });
      try { if (OGX.diag && typeof OGX.diag.addPanelTab === 'function') OGX.diag.addPanelTab(this.panel); } catch (e) { this.log.warn('diag tab', e); }

      // Menu entry (OgameX layout.md §12: ul#menuTableTools, main:766-768; GALAXYZ: ul#menuTable, galaxyz/layout.md §10).
      // Under OgameX Suite the entry is built detached (OGX.dom.menuOwner) and the suite entry mirrors its badge.
      const ul = OGX.dom.anchors().menu;
      if (ul) {
        this.entry = OGX.dom.menuEntry({
          id: P + 'entry', label: 'Infinity', iconText: '∞',
          title: 'OgameX Infinity: панель управления', onClick: () => this.toggle(),
        });
        const a = this.entry.li.querySelector('a');
        if (a) a.dataset.ogxAct = 'panel:toggle';
      } else {
        this.log.debug('game menu not found: no menu entry on this page');
      }

      if (this.S('openOnLoad') && !this.panel.isOpen()) { this.panel.open(); rec('B', 'open-on-load'); }

      this.renderBadges();
      this.updateHeader(now());

      this.offs.push(ctx.bus.on('state:updated', (e) => {
        const keys = (e && e.keys) || [];
        if (keys.some((k) => k === 'bodies' || k === 'player' || k === 'shipStats')) this.refreshSoon();
      }));
      this.offs.push(ctx.bus.on('flights:updated', (e) => {
        if (e && Array.isArray(e.flights)) { this.flights = e.flights; this.flightsT = e.t || now(); }
        this.refreshSoon();
      }));
      this.offs.push(ctx.settings.onChange((key) => {
        if (key === 'planetbarFields') this.renderBadges();
        if (key === 'showMoons') this.tab.refresh();
        if (key === 'showOfficers' && this.headRefs) { delete this.headRefs.off.dataset.key; this.updateHeader(now()); }
      }));
      this.offs.push(OGX.storage.subscribe('bodies', (v, info) => { if (info && info.remote) this.refreshSoon(); }));
      ctx.every(0, (t) => this.tick(t));
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* gone */ } }
      this.offs = [];
      if (this.refreshSoon.cancel) this.refreshSoon.cancel();
    }

    async load() {
      this.bodies = (await OGX.state.bodies()) || {};
      this.list = (await OGX.state.bodyList()) || [];
      this.player = await OGX.state.player();
      const fl = await OGX.flights.cached();   // core: stored list, no request
      if (fl && Array.isArray(fl.flights)) { this.flights = fl.flights; this.flightsT = +fl.t || 0; }
      if (this.player) {
        OGX.learn.check('panel.player', { darkMatter: this.player.darkMatter, rank: this.player.rank });
      }
    }

    async reload(reason) {
      await this.load();
      this.updateHeader(now());
      this.renderBadges();
      if (this.tab) this.tab.refresh();
      return reason;
    }

    // ---------------------------------------------------------------- actions
    _toggle() {
      this.panel.toggle();
      const open = this.panel.isOpen();
      if (this.entry) this.entry.setActive(open);
      return { open };
    }

    /** Switch to another body. newTab: open in a background tab (Ctrl/Cmd/middle click). */
    async _navigate(id, { newTab = false, path = null } = {}) {
      const url = path ? pageUrl(path, id) : samePageUrl(id);
      if (newTab) { window.open(url, '_blank'); return { id, newTab, path }; }
      // Pending settings writes (panel open state, tab) are coalesced for 100 ms: write them before leaving the page.
      try { await Promise.race([OGX.storage.flush(), OGX.util.sleep(400)]); } catch (e) { /* leave anyway */ }
      location.assign(url);
      return { id, newTab, path };
    }

    async _fetchFlights() {
      const r = await OGX.flights.get({ maxAgeMs: FLIGHTS_MAX_AGE });
      if (r && !r.error && Array.isArray(r.flights)) { this.flights = r.flights; this.flightsT = r.t || now(); }
      return { ok: !!(r && !r.error), n: r && r.flights ? r.flights.length : 0, error: r && r.error };
    }

    maybeFetchFlights() {
      if (this.flightsRequested) return;
      // GALAXYZ: every full page stores its event box (flights:updated); a fetch would GET page=fleetTable (a full page that
      // marks the account online): never from here.
      if (isGz()) return;
      if (this.flights && now() - this.flightsT < FLIGHTS_MAX_AGE) return;
      this.flightsRequested = true;
      // Wrapped: B event + error with stack; the panel stays usable without flights.
      Promise.resolve(this.fetchFlights()).then(() => { this.updateTotals(now()); this.updateHeader(now()); }).catch((e) => this.log.warn('flights', e));
    }

    // ---------------------------------------------------------------- header
    buildHeader() {
      const el = this.panel.el;
      const old = el.querySelector('#' + P + 'head');
      if (old) old.remove();
      const r = {};
      r.name = h('span', { class: P + 'pname' });
      r.cls = h('span', { class: P + 'pcls' });
      r.off = h('span', { class: P + 'poff' });
      r.vac = h('span', { class: P + 'pvac', hidden: true });
      r.rank = h('span', { class: P + 'prank' });
      r.dm = h('span', { class: P + 'pdm' });
      r.clock = h('span', { class: P + 'clock', title: 'Время сервера' });
      r.attack = h('span', { class: P + 'attack', dataset: { ogxAct: 'panel:attack' } });
      const head = h('div', { id: P + 'head', class: P + 'head' },
        h('div', { class: P + 'hline' }, r.name, r.cls, r.rank, r.vac),
        h('div', { class: [P + 'hline', P + 'offline'] }, r.off),
        h('div', { class: P + 'hline' }, r.dm, r.clock, r.attack));
      // Under the core header (title + close), above the tab bar.
      const after = this.panel.header && this.panel.header.parentNode === el ? this.panel.header : null;
      if (after) after.after(head); else el.insertBefore(head, el.firstChild);
      r.attack.addEventListener('click', OGX.safe(() => {
        if (!r.attack.classList.contains(P + 'attack-on')) return;
        this.navigateMovement();
      }, 'panel:attack'));
      this.headRefs = r;
    }

    navigateMovement() {
      rec('B', 'open-movement');
      location.assign(OGX.page.url('/fleet/movement'));
    }

    hostileFlights(t) {
      try { return OGX.flights.hostile(this.flights || []).filter((f) => !(f.arrival > 0) || f.arrival > t); } catch (e) { return []; }
    }

    updateHeader(t) {
      const r = this.headRefs;
      if (!r) return;
      const p = this.player || {};
      setText(r.name, p.name || '—');
      if (isGz()) {
        // GALAXYZ has no player classes (CORE_API §22.1): officers instead
        r.cls.hidden = true;
        this.updateOfficers(r.off, p);
      } else {
        r.cls.hidden = false;
        r.off.parentNode.hidden = true;
        const cls = OGX.calc.normClass(p.playerClass || 'none');
        setText(r.cls, CLASS_RU[cls] || CLASS_RU.none);
      }
      r.vac.hidden = !p.vacation;
      if (p.vacation) {
        setText(r.vac, 'режим отпуска');
        setTitle(r.vac, 'Аккаунт в режиме отпуска' + (p.vacationUntil ? ': ' + p.vacationUntil : ''));
      }
      setText(r.rank, fin(p.rank) ? 'место ' + num(p.rank) : 'место —');
      setTitle(r.rank, 'Место в общем рейтинге');
      setText(r.dm, 'ТМ ' + (fin(p.darkMatter) ? num(p.darkMatter) : '—'));
      setTitle(r.dm, 'Тёмная материя');
      setText(r.clock, OGX.fmt.time(t));
      // Attack: hostile flights from the stored event list, or the game's own alert (#attack_alert.soon, main:394).
      const hostile = this.hostileFlights(t);
      const domAlert = this.domAttack();
      const on = hostile.length > 0 || domAlert;
      toggleCls(r.attack, P + 'attack-on', on);
      if (on) {
        const next = hostile.slice().sort((a, b) => a.arrival - b.arrival)[0];
        const txt = hostile.length ? 'Атака! ' + hostile.length + (next && next.arrival > t ? ' · ' + OGX.fmt.duration((next.arrival - t) / 1000) : '') : 'Атака!';
        setText(r.attack, txt);
        setTitle(r.attack, hostile.length
          ? hostile.map((f) => (OGX.catalog.missionName(f.missionType) || ('миссия ' + f.missionType)) + ': ' + (f.from || '?') + ' → ' + (f.to || '?') +
              (f.arrival ? ', прибытие ' + OGX.fmt.dateTime(f.arrival) : '')).join('\n') + '\nНажмите, чтобы открыть «Передвижение флотов»'
          : 'Игра сообщает о приближающейся атаке. Нажмите, чтобы открыть «Передвижение флотов»');
      } else {
        setText(r.attack, 'Атак нет');
        setTitle(r.attack, 'Враждебных флотов не обнаружено' + (this.flightsT ? ' (данные ' + OGX.fmt.ago(this.flightsT) + ')' : ''));
      }
      if (this.entry) {
        this.entry.setBadge(hostile.length ? String(hostile.length) : (domAlert ? '!' : null));
        this.entry.setActive(this.panel.isOpen());
      }
    }

    /** GALAXYZ header line: officer levels from page=officier (state.player().officers), a link to that page while unknown. */
    updateOfficers(el, p) {
      const line = el.parentNode;
      if (this.S('showOfficers') === false) { line.hidden = true; return; }
      line.hidden = false;
      const off = p && p.officers && typeof p.officers === 'object' ? p.officers : null;
      const key = off ? JSON.stringify(off) : 'none';
      if (el.dataset.key === key) return;
      el.dataset.key = key;
      el.textContent = '';
      if (!off) {
        el.appendChild(document.createTextNode('Офицеры: неизвестно — '));
        el.appendChild(h('a', { class: P + 'offlink', href: OGX.page.url('officier'), dataset: { ogxAct: 'panel:officers' },
          title: 'Уровни офицеров видны только на странице «Офицеры»: откройте её один раз' }, 'откройте «Офицеры»'));
        setTitle(el, '');
        return;
      }
      const active = OFFICER_IDS.filter((id) => +off[id] > 0);
      const name = (id) => OGX.catalog.name(id) || ('#' + id);
      el.appendChild(h('span', { class: P + 'offlabel' }, 'Офицеры: '));
      if (!active.length) el.appendChild(h('span', { class: 'ogx-muted' }, 'нет'));
      active.forEach((id, i) => {
        if (i) el.appendChild(document.createTextNode(' · '));
        el.appendChild(h('span', { class: P + 'officer', dataset: { id: String(id), level: String(+off[id]) } }, name(id) + ' ' + (+off[id])));
      });
      setTitle(el, 'Офицеры (страница «Офицеры»' + (p.t ? ', данные ' + OGX.fmt.ago(p.t) : '') + '):\n' +
        OFFICER_IDS.filter((id) => off[id] !== undefined).map((id) => name(id) + ': ' + (+off[id] || 0)).join('\n'));
    }

    domAttack() {
      if (this._domAttack === undefined) {
        // Only valid for the page as rendered; checked once.
        const el = OGX.dom.$('#attack_alert');
        this._domAttack = !!(el && el.classList.contains('soon'));
      }
      return this._domAttack;
    }

    // ---------------------------------------------------------------- planet list badges
    _renderBadges() {
      for (const b of document.querySelectorAll('.' + P + 'fields-badge')) b.remove();
      this.badges = [];
      if (!this.S('planetbarFields')) return { shown: 0, reason: 'off' };
      if (document.documentElement.hasAttribute('data-ogx-live')) return { shown: 0, reason: 'live' };
      // OgameX: one #planetList (data-planet-id); GALAXYZ: one #planetList per planet, id in a.planetlink cp= (dom.planetRows)
      const rows = OGX.dom.planetRows();
      let shown = 0;
      for (const { row, planetId } of rows) {
        const pid = +planetId;
        if (!(pid > 0)) { OGX.learn.value('panel.rowPlanetId', NaN); continue; }
        const b = this.bodies['p' + pid];
        if (!b || !fin(b.fieldsUsed) || !fin(b.fieldsMax)) continue;
        const cls = fieldsClass(b.fieldsUsed, b.fieldsMax);
        const el = h('span', {
          class: [P + 'fields-badge', P + cls],
          title: 'Поля: занято ' + b.fieldsUsed + ' из ' + b.fieldsMax + ', свободно ' + Math.max(0, b.fieldsMax - b.fieldsUsed),
        }, b.fieldsUsed + '/' + b.fieldsMax);
        row.appendChild(el);
        this.badges.push(el);
        shown++;
      }
      return { shown, rows: rows.length };
    }

    // ---------------------------------------------------------------- planets tab
    renderPlanets(container) {
      this.rows = [];
      const t = now();
      const showMoons = this.S('showMoons');
      const cur = OGX.state.current() || {};
      const wrap = h('div', { class: P + 'planets' });
      if (!this.list.length) {
        wrap.appendChild(h('div', { class: 'ogx-empty' }, 'Список планет пуст: откройте любую страницу игры.'));
        container.appendChild(wrap);
        return;
      }
      for (const { planet, moon } of this.list) {
        wrap.appendChild(this.buildRow(planet, false, cur, t));
        if (moon && showMoons) wrap.appendChild(this.buildRow(moon, true, cur, t));
      }
      wrap.appendChild(this.buildTotals());
      container.appendChild(h('div', { class: P + 'hint' }, 'Щелчок — перейти на планету, Ctrl/колёсико — в новой вкладке'));
      container.appendChild(wrap);
      this.tick(t);
      rec('B', 'render-planets', { rows: this.rows.length });
    }

    buildRow(body, isMoon, cur, t) {
      const id = body.id;
      const refs = { res: {} };
      const isCurrent = cur && cur.key === body.key;
      // sanity checks on stored values (L 'implausible')
      if (body.fieldsUsed !== null && body.fieldsUsed !== undefined) OGX.learn.value('panel.fieldsUsed', +body.fieldsUsed, { min: 0, int: true });
      if (body.fieldsMax !== null && body.fieldsMax !== undefined) OGX.learn.value('panel.fieldsMax', +body.fieldsMax, { min: 1, int: true });
      if (!isMoon && fin(body.tempMin)) OGX.learn.value('panel.tempMax', +body.tempMax, { min: -300, max: 300, int: true });

      const name = h('a', { class: P + 'name', href: samePageUrl(id), title: (isMoon ? 'Луна ' : 'Планета ') + (body.name || '') + ' — перейти', dataset: { ogxAct: 'panel:goto' } },
        isMoon ? '☾ ' + (body.name || 'Луна') : (body.name || '—'));
      const coords = h('span', { class: P + 'coords' }, body.coords ? OGX.fmt.coords(body.coords, isMoon ? 3 : 1) : '');

      // fields bar
      let fields = null;
      if (fin(body.fieldsUsed) && fin(body.fieldsMax) && body.fieldsMax > 0) {
        const cls = fieldsClass(body.fieldsUsed, body.fieldsMax);
        fields = h('span', { class: P + 'fields', title: 'Поля: занято ' + body.fieldsUsed + ' из ' + body.fieldsMax + ', свободно ' + Math.max(0, body.fieldsMax - body.fieldsUsed) },
          OGX.dom.bar(body.fieldsUsed / body.fieldsMax, { cls: 'ogx-' + cls }),
          h('span', { class: P + 'fields-txt' }, body.fieldsUsed + '/' + body.fieldsMax));
      } else {
        fields = h('span', { class: [P + 'fields', 'ogx-muted'] }, '?/?');
      }
      let temp = null;
      if (!isMoon && fin(body.tempMin) && fin(body.tempMax)) {
        const tt = fixTemp(body.tempMin, body.tempMax);
        if (tt.fixed && !this.tempFixLogged) {
          this.tempFixLogged = true;
          this.log.info('core planetList lost the sign of tempMax; shown corrected', body.key, body.tempMin, body.tempMax);
          rec('B', 'temp-fix', { key: body.key, min: body.tempMin, max: body.tempMax });
        }
        temp = h('span', { class: P + 'temp', title: 'Температура: от ' + tt.min + ' до ' + tt.max + ' °C' }, tt.min + '…' + tt.max + ' °C');
      }
      refs.age = h('span', { class: P + 'age' });

      const r1 = h('div', { class: P + 'r1' }, name, coords, fields, temp, refs.age);

      // resources
      const r2 = h('div', { class: P + 'r2' });
      if (body.res) {
        OGX.learn.check('panel.res', { metal: body.res.metal && body.res.metal.amount, crystal: body.res.crystal && body.res.crystal.amount, deuterium: body.res.deuterium && body.res.deuterium.amount });
        for (const r of RES) {
          const val = h('b', { class: P + 'val' });
          const fill = h('span', { class: P + 'fill' });
          const rate = isMoon ? null : h('small', { class: P + 'rate' });
          const cell = h('span', { class: [P + 'res', P + 'r-' + r], dataset: { res: r } }, fill, h('span', { class: P + 'lbl' }, RES_SHORT[r]), val, rate);
          r2.appendChild(cell);
          refs.res[r] = { cell, val, fill, rate };
        }
      } else {
        r2.appendChild(h('span', { class: 'ogx-muted' }, 'нет данных о ресурсах — откройте ' + (isMoon ? 'эту луну' : 'эту планету')));
      }

      // build queue, ships, links
      const r3 = h('div', { class: P + 'r3' });
      const q = body.queues && body.queues.building;
      if (q && q.endsAt > t) {
        const bname = OGX.catalog.name(q.objectId) || ('#' + q.objectId);
        OGX.learn.value('panel.buildLevel', +q.targetLevel, { min: 0, int: true });
        r3.appendChild(h('span', { class: [P + 'build', q.downgrade && P + 'down'], title: (q.downgrade ? 'Снос: ' : 'Строится: ') + bname + ' → ур. ' + q.targetLevel + ', завершится ' + OGX.fmt.dateTime(q.endsAt) },
          (q.downgrade ? '↓ ' : '⚒ ') + bname + ' ' + q.targetLevel + ' ', OGX.dom.countdown(q.endsAt, { doneText: 'готово' })));
      } else if (!isMoon && body.constructionFlag) {
        r3.appendChild(h('span', { class: [P + 'build', P + 'stale'], title: 'В списке планет есть значок строительства, но очередь неизвестна: откройте обзор этой планеты' }, '⚒ строится (?)'));
      }
      const u = body.queues && body.queues.unit;
      if (u && u.endsAt > t) {
        r3.appendChild(h('span', { class: P + 'build', title: 'Верфь: осталось ' + (u.remaining || '?') + ' ед.' + (u.techId ? ' (' + OGX.catalog.name(u.techId) + ')' : '') },
          '🛠 ', OGX.dom.countdown(u.endsAt, { doneText: 'готово' })));
      }
      if (body.shipsT) {
        const n = shipsTotal(body.ships);
        OGX.learn.value('panel.ships', n, { min: 0, int: true });
        r3.appendChild(h('span', { class: P + 'ships', title: 'Кораблей (без спутников и гусеничников), данные ' + OGX.fmt.ago(body.shipsT), dataset: { ships: n } }, '✈ ' + num(n)));
      } else {
        r3.appendChild(h('span', { class: [P + 'ships', 'ogx-muted'], title: 'Флот неизвестен: откройте «Флот» на этой ' + (isMoon ? 'луне' : 'планете') + (isGz() ? ' или «Империю»' : '') }, '✈ ?'));
      }
      // GALAXYZ: page=buildings holds mines, storage and facilities (page.gzRoute('/resources').shared): one link
      const links = isGz()
        ? [['/resources', 'Постройки (рудники, склады, фабрики)', 'П'], ['/shipyard', 'Верфь', 'В'], ['/fleet', 'Флот', 'Фл'], ['/galaxy', 'Галактика (просмотр галактики стоит дейтерий)', 'Г']]
        : [['/resources', 'Сырьё', 'Р'], ['/facilities', 'Фабрики', 'Ф'], ['/fleet', 'Флот', 'Фл'], ['/galaxy', 'Галактика', 'Г']];
      r3.appendChild(h('span', { class: P + 'links' }, links.map(([path, title, label]) =>
        h('a', { class: P + 'link', href: pageUrl(path, id), title: title + ((isMoon ? ' (луна)' : '')), dataset: { ogxAct: 'panel:link' + path.replace('/', '-') } }, label))));

      const row = h('div', {
        class: [P + 'row', isMoon ? P + 'moon' : P + 'planet', isCurrent && P + 'current'],
        dataset: { key: body.key, id, ogxAct: 'panel:row' },
        title: '',
      }, r1, r2, r3);
      row.addEventListener('click', OGX.safe((ev) => {
        if (ev.target.closest('a')) return;   // anchors keep their native behaviour (incl. Ctrl/middle click)
        if (ev.button !== 0) return;
        this.navigate(id, { newTab: ev.ctrlKey || ev.metaKey || ev.shiftKey });
      }, 'panel:rowClick'));
      row.addEventListener('auxclick', OGX.safe((ev) => {
        if (ev.button !== 1 || ev.target.closest('a')) return;
        ev.preventDefault();
        this.navigate(id, { newTab: true });
      }, 'panel:rowAux'));
      this.rows.push({ key: body.key, body, isMoon, refs });
      return row;
    }

    buildTotals() {
      const mk = (label, title) => {
        const cells = {};
        const line = h('div', { class: P + 'tline', title: title || '' }, h('span', { class: P + 'tlabel' }, label));
        for (const r of RES) { cells[r] = h('span', { class: [P + 'tval', P + 'r-' + r] }); line.appendChild(cells[r]); }
        cells.sum = h('span', { class: [P + 'tval', P + 'tsum'] });
        line.appendChild(cells.sum);
        return { line, cells };
      };
      const bodies = mk('На планетах', 'Сумма текущих запасов (с учётом выработки с момента последнего обновления)');
      const prod = mk('Выработка/ч', 'Сумма выработки планет в час');
      const fly = mk('В полёте', 'Ресурсы на борту своих флотов (каждая миссия один раз)');
      const total = mk('Итого', 'На планетах + в полёте');
      this.shipsTotalEl = h('span', { class: P + 'tships' });
      this.totalRefs = { bodies, prod, fly, total };
      return h('div', { class: P + 'totals' },
        h('div', { class: P + 'tline' }, h('span', { class: P + 'tlabel' }, ''),
          RES.map((r) => h('span', { class: [P + 'tval', P + 'thead', P + 'r-' + r] }, RES_NAME[r])), h('span', { class: [P + 'tval', P + 'thead'] }, 'Σ')),
        bodies.line, prod.line, fly.line, total.line,
        h('div', { class: P + 'tline' }, h('span', { class: P + 'tlabel' }, 'Корабли'), this.shipsTotalEl),
        this.prodNoteEl = h('div', { class: P + 'tnote' }));
    }

    // ---------------------------------------------------------------- per tick: texts, widths, classes only
    tick(t) {
      t = t || now();
      if (!this.panel || !this.panel.isOpen()) { if (this.entry) this.entry.setActive(false); return; }
      this.updateHeader(t);
      // Live may boot after us: remove our badges as soon as html[data-ogx-live] appears (coexistence, DESIGN §3.12).
      if (this.badges.length && document.documentElement.hasAttribute('data-ogx-live')) this.renderBadges();
      if (this.panel.currentTab() !== 'planets' || !this.rows.length) return;
      for (const row of this.rows) this.updateRow(row, t);
      this.updateTotals(t);
    }

    projected(body, t) {
      try { return OGX.state.projected(body, t, { flights: this.flights || undefined }); } catch (e) { return OGX.state.projected(body, t); }
    }

    updateRow(row, t) {
      const body = row.body;
      const seen = (body.res && body.res.t) || body.seenAt;
      if (!seen) {
        setText(row.refs.age, 'нет данных');
        toggleCls(row.refs.age, P + 'old', true);
      } else if (t - seen > HOUR) {
        setText(row.refs.age, OGX.fmt.ago(seen));
        setTitle(row.refs.age, 'Данные устарели: последнее обновление ' + OGX.fmt.dateTime(seen));
        toggleCls(row.refs.age, P + 'old', true);
      } else {
        setText(row.refs.age, '');
      }
      if (!body.res) return;
      const pr = this.projected(body, t);
      if (!pr || !pr.res) return;
      for (const r of RES) {
        const ref = row.refs.res[r];
        if (!ref) continue;
        const res = pr.res[r] || {};
        const amount = +res.amount || 0;
        // GALAXYZ bodies seen only on page=imperium: storage and production unknown (null), never 0 / «full»
        const src = (body.res[r] || {});
        const storageKnown = res.storage !== null && res.storage !== undefined && fin(+res.storage);
        const rateKnown = src.perHour !== null && src.perHour !== undefined && fin(+src.perHour);
        const storage = storageKnown ? +res.storage : 0;
        const perHour = rateKnown ? +src.perHour : 0;
        const cls = storageKnown ? fillClass(amount, storage) : 'none';
        for (const c of ['ok', 'warn', 'bad']) toggleCls(ref.cell, P + c, c === cls);
        toggleCls(ref.cell, P + 'nostore', !storageKnown);
        setText(ref.val, OGX.fmt.short(amount));
        const w = (storage > 0 ? Math.min(1, amount / storage) * 100 : 0).toFixed(1) + '%';
        if (ref.fill.style.width !== w) ref.fill.style.width = w;
        ref.cell.dataset.amount = String(Math.floor(amount));
        if (ref.rate) {
          setText(ref.rate, rateKnown ? (perHour >= 0 ? '+' : '') + OGX.fmt.short(perHour) + '/ч' : '—/ч');
          ref.cell.dataset.perHour = rateKnown ? String(perHour) : '';
        }
        let title;
        if (!storageKnown || !rateKnown) {
          title = RES_NAME[r] + ': ' + num(amount) + (storageKnown ? ' из ' + num(storage) : '') +
            '\nЗапас со страницы «Империя» (' + OGX.fmt.ago(body.res.t) + '). Хранилище и выработка неизвестны: откройте эту ' + (row.isMoon ? 'луну' : 'планету') + ' в игре.';
        } else {
          let full = '';
          if (storage > 0 && amount >= storage) full = 'хранилище заполнено';
          else {
            const secs = OGX.calc.secondsUntilFull({ amount, storage, perHour, t }, t);
            full = fin(secs) ? 'заполнится через ' + OGX.fmt.duration(secs) : 'не заполнится';
          }
          title = RES_NAME[r] + ': ' + num(amount) + ' из ' + num(storage) + ' (' + OGX.fmt.pct(storage > 0 ? amount / storage : 0) + '), ' + full +
            (row.isMoon ? '' : '\nВыработка: ' + OGX.fmt.signed(Math.floor(perHour)) + '/ч, ' + OGX.fmt.signed(Math.floor(perHour * 24)) + '/сут');
        }
        setTitle(ref.cell, title);
      }
    }

    computeTotals(t) {
      const showMoons = this.S('showMoons');
      const bodies = { metal: 0, crystal: 0, deuterium: 0 };
      const prod = { metal: 0, crystal: 0, deuterium: 0 };
      let ships = 0, shipsKnown = 0, planets = 0, prodKnown = 0;
      for (const { planet, moon } of this.list) {
        for (const b of [planet, showMoons ? moon : null]) {
          if (!b) continue;
          if (b.shipsT) { ships += shipsTotal(b.ships); shipsKnown++; }
          if (b.type === 'planet') planets++;
          if (!b.res) continue;
          const pr = this.projected(b, t);
          // GALAXYZ page=imperium stock: production unknown (null) -> not counted, the line says how many are known
          const rateKnown = RES.every((r) => b.res[r] && b.res[r].perHour !== null && b.res[r].perHour !== undefined);
          if (b.type === 'planet' && rateKnown) prodKnown++;
          for (const r of RES) {
            bodies[r] += +((pr && pr.res && pr.res[r] && pr.res[r].amount) || 0);
            if (b.type === 'planet' && rateKnown) prod[r] += +((b.res[r] || {}).perHour) || 0;
          }
        }
      }
      let fly = { metal: 0, crystal: 0, deuterium: 0 };
      let approx = false;
      if (this.flights) {
        try { fly = OGX.flights.inFlight(this.flights); } catch (e) { this.log.warn('inFlight', e); }
        approx = this.flights.some((f) => f.own && f.cargo && f.cargo.approx);
      }
      const total = {};
      for (const r of RES) total[r] = bodies[r] + (+fly[r] || 0);
      return { bodies, prod, fly, total, approx, ships, shipsKnown, planets, prodKnown };
    }

    updateTotals(t) {
      const tr = this.totalRefs;
      if (!tr || !tr.bodies.line.isConnected) return;
      const v = this.computeTotals(t || now());
      OGX.learn.check('panel.totals', { metal: v.total.metal, crystal: v.total.crystal, deuterium: v.total.deuterium });
      const put = (refs, res, { prefix = '', unknown = false } = {}) => {
        let sum = 0;
        for (const r of RES) {
          sum += +res[r] || 0;
          setText(refs.cells[r], unknown ? '?' : prefix + num(res[r]));
          refs.cells[r].dataset.value = String(Math.floor(+res[r] || 0));
        }
        setText(refs.cells.sum, unknown ? '?' : prefix + num(sum));
        refs.cells.sum.dataset.value = String(Math.floor(sum));
      };
      put(tr.bodies, v.bodies);
      put(tr.prod, v.prod, { prefix: '+', unknown: v.planets > 0 && !v.prodKnown });
      const plabel = tr.prod.line.querySelector('.' + P + 'tlabel');
      setText(plabel, v.prodKnown < v.planets ? 'Выработка/ч*' : 'Выработка/ч');
      setText(this.prodNoteEl, v.prodKnown < v.planets ? '* выработка известна для ' + v.prodKnown + ' из ' + v.planets + ' планет: откройте остальные в игре (в «Империи» её нет)' : '');
      setTitle(tr.prod.line, 'Сумма выработки планет в час' + (v.prodKnown < v.planets
        ? ' — известна для ' + v.prodKnown + ' из ' + v.planets + ' планет (остальные видны только в «Империи»: откройте их в игре)' : ''));
      put(tr.fly, v.fly, { prefix: v.approx ? '≈' : '', unknown: !this.flights });
      setTitle(tr.fly.line, this.flights ? 'Ресурсы на борту своих флотов (каждая миссия один раз)' + (v.approx ? '; ≈ — топливо учтено приблизительно' : '') +
        (this.flightsT ? '. Данные ' + OGX.fmt.ago(this.flightsT) : '') : 'Список полётов ещё не загружен');
      put(tr.total, v.total, { prefix: v.approx ? '≈' : '' });
      setText(this.shipsTotalEl, v.shipsKnown ? num(v.ships) + (v.shipsKnown < this.countBodies() ? ' (известно для ' + v.shipsKnown + ' из ' + this.countBodies() + ')' : '') : 'неизвестно — откройте «Флот»');
    }

    countBodies() {
      const showMoons = this.S('showMoons');
      let n = 0;
      for (const { moon } of this.list) n += 1 + (moon && showMoons ? 1 : 0);
      return n;
    }
  }

  const CSS = `
.${P}head { padding: 4px 10px 6px; border-bottom: 1px solid var(--ogx-border, #2b3846); font-size: 12px; }
.${P}hline { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 18px; }
.${P}pname { font-weight: bold; color: var(--ogx-text, #e3e9f0); }
.${P}pcls, .${P}prank, .${P}pdm { color: var(--ogx-muted, #8593a3); }
.${P}poff { color: var(--ogx-muted, #8593a3); }
.${P}officer { color: var(--ogx-text, #e3e9f0); white-space: nowrap; }
.${P}offlink { color: var(--ogx-accent, #6f9fd8); }
.${P}pvac { color: var(--ogx-warn, #ff9800); }
.${P}hline[hidden], .${P}pcls[hidden], .${P}pvac[hidden] { display: none; }
.${P}clock { font-variant-numeric: tabular-nums; color: var(--ogx-text, #e3e9f0); }
.${P}attack { margin-left: auto; padding: 0 6px; border-radius: 3px; color: var(--ogx-ok, #8fbf8f); border: 1px solid transparent; }
.${P}attack.${P}attack-on { color: #fff; background: var(--ogx-bad, #c62828); border-color: #ff5252; cursor: pointer; animation: ogx-i-panel-blink 1.2s ease-in-out infinite; }
@keyframes ogx-i-panel-blink { 50% { opacity: .55; } }
.${P}hint { font-size: 10px; color: var(--ogx-muted, #8593a3); margin: 0 0 4px; }
.${P}planets { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
.${P}row { padding: 3px 5px; border: 1px solid var(--ogx-border, #2b3846); border-radius: 3px; background: rgba(255,255,255,.02); cursor: pointer; }
.${P}row:hover { border-color: var(--ogx-accent, #6f9fd8); background: rgba(111,159,216,.08); }
.${P}row.${P}moon { margin-left: 16px; }
.${P}row.${P}current { border-color: var(--ogx-accent, #6f9fd8); box-shadow: inset 3px 0 0 var(--ogx-accent, #6f9fd8); }
.${P}r1, .${P}r2, .${P}r3 { display: flex; align-items: center; gap: 6px; min-height: 15px; }
.${P}r2 { margin: 2px 0; }
.${P}name { font-weight: bold; color: var(--ogx-text, #e3e9f0); text-decoration: none; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${P}name:hover { text-decoration: underline; }
.${P}coords { color: var(--ogx-muted, #8593a3); white-space: nowrap; }
.${P}fields { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.${P}fields .ogx-bar { width: 44px; }
.${P}temp { color: var(--ogx-muted, #8593a3); white-space: nowrap; }
.${P}age { margin-left: auto; color: var(--ogx-muted, #8593a3); font-size: 10px; white-space: nowrap; }
.${P}age.${P}old { color: var(--ogx-warn, #ff9800); }
.${P}res { position: relative; flex: 1 1 0; min-width: 0; padding: 1px 3px; line-height: 12px; text-overflow: ellipsis; border-radius: 2px; background: #1c242e; overflow: hidden; white-space: nowrap; }
.${P}fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: rgba(76,175,80,.35); }
.${P}res.${P}warn .${P}fill { background: rgba(255,152,0,.5); }
.${P}res.${P}bad .${P}fill { background: rgba(244,67,54,.55); }
.${P}res.${P}nostore .${P}fill { display: none; }
.${P}res > *:not(.${P}fill) { position: relative; }
.${P}lbl { font-weight: bold; margin-right: 3px; }
.${P}r-metal .${P}lbl, .${P}tval.${P}r-metal { color: var(--ogx-metal, #a9b5c4); }
.${P}r-crystal .${P}lbl, .${P}tval.${P}r-crystal { color: var(--ogx-crystal, #79c2e8); }
.${P}r-deuterium .${P}lbl, .${P}tval.${P}r-deuterium { color: var(--ogx-deuterium, #7fe0b4); }
.${P}val { color: #fff; font-weight: normal; }
.${P}rate { display: block; color: #8fbf8f; font-size: 9px; line-height: 10px; }
.${P}r3 { font-size: 10px; }
.${P}build { color: #6f9fd8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.${P}build.${P}down { color: var(--ogx-warn, #ff9800); }
.${P}build.${P}stale { color: var(--ogx-muted, #8593a3); font-style: italic; }
.${P}build .ogx-countdown { color: #fff; }
.${P}ships { white-space: nowrap; }
.${P}links { margin-left: auto; display: inline-flex; gap: 3px; }
.${P}link { padding: 0 3px; border: 1px solid var(--ogx-border, #2b3846); border-radius: 2px; color: var(--ogx-muted, #8593a3); text-decoration: none; }
.${P}link:hover { color: #fff; border-color: var(--ogx-accent, #6f9fd8); }
.${P}totals { margin-top: 6px; padding-top: 4px; border-top: 1px solid var(--ogx-border, #2b3846); }
.${P}tline { display: flex; gap: 4px; min-height: 15px; align-items: center; }
.${P}tlabel { flex: 0 0 82px; color: var(--ogx-muted, #8593a3); }
.${P}tval { flex: 1 1 0; min-width: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.${P}thead { font-size: 10px; }
.${P}tsum { color: #fff; }
.${P}tnote { font-size: 10px; color: var(--ogx-muted, #8593a3); }
.${P}tnote:empty { display: none; }
.${P}tships { flex: 1 1 auto; text-align: right; }
#planetList .smallplanet > .${P}fields-badge { position: absolute; left: 2px; bottom: 0; z-index: 4; padding: 0 2px; font: 9px/10px Verdana, Arial, sans-serif;
  color: #8fbf8f; background: rgba(13,16,20,.75); border-radius: 2px; pointer-events: auto; }
#planetList .smallplanet > .${P}fields-badge.${P}warn { color: #ff9800; }
#planetList .smallplanet > .${P}fields-badge.${P}bad { color: #f44336; }
`;
})(window.OGX);
