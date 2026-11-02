/* ogamex-live/modules/fleetinfo/fleetinfo.js — Owner: live/fleetinfo.
 * Fleet page info (DESIGN §4.1.5, OL rows 14 and 15, OL §4.13 first part, OL §5.8).
 *
 *  1. Table #ogx-l-fleetinfo right after #allornone: selected ship count, total cargo, slowest speed; when a target
 *     is set (step 2, URL prefill, or a check-target seen): target, mission, speed %, distance, flight duration,
 *     deuterium consumption (client variant = what the game page shows, fleet.md §2.7) and arrival/return times.
 *  2. A speed badge on every ship icon (li.technology .icon) and a tooltip with speed, cargo, fuel consumption,
 *     fuel tank, structure, shield and attack.
 *
 * OgameX markup used (src/OGameX/resources/views/ingame/fleet/index.blade.php = idx):
 *   #fleet1                                             idx:483 (step 1)
 *   #fleet1 #technologies li.technology[data-technology] idx:891-906 (military), 915-933 (civil); the class holds class_name
 *   li span.icon (sprite) > span.amount[data-value]     idx:897-902, 922-928 (ships on the body, raw integer)
 *   li input[type=text][name=<class_name>]              idx:904, 931 (no id; disabled when 0; game listens keyup/focusout)
 *   #allornone                                          idx:940 (our table goes right after it, like OL #moreInfoTable)
 *   #sendall, #resetall                                 idx:944, 949
 *   #fleet2 (display:none until step 2)                 idx:981; #galaxy/#system/#position hold the junk 7/158/10 until the
 *                                                       game JS writes targetPlanet into them (fleet.md §2.5), so they are read
 *                                                       only while #fleet2 is visible. input#type (hidden) next to them.
 *   select#holdingtime / select#expeditiontime          fleet.md §2.5 (idx:1297-1314)
 *   #speedPercentage[value]                             idx:1426 (1..10)
 *   inline vars targetPlanet / currentPlanet / mission  idx:226-239, 260 (parsed by core: OGX.state.snapshot().fleetPage)
 * Page world (game JS): OGX.bridge.call('fleet.state') -> fleetDispatcher.shipsToSend / targetPlanet / mission /
 * speedPercent / holdingTime / expeditionTime / currentPage (fleet.md §2.6). Without game JS the call answers { ok:false }.
 * check-target (POST /ajax/fleet/dispatch/check-target, FleetController::dispatchCheckTarget) is captured by core into
 * state.shipStats; here we only read its emptySystems / inactiveSystems / targetPlanet (fleet.md §3.2) for the distance.
 *
 * Structure / shield / attack: base props from the catalog (objects.jsonl) + intdiv(base * 10 * level, 100) for armour (111),
 * shielding (110) and weapons (109) technology (app/GameObjects/Services/Properties/Abstracts/ObjectPropertyService.php:39-44,
 * StructuralIntegrityPropertyService / ShieldPropertyService / AttackPropertyService).
 *
 * GALAXYZ (real fleetTable / fleetStep1 / fleetStep2 pages): ships are chosen on page=fleetTable in
 *   form[action*="page=fleetStep1"] > table: per ship td#ship<ID>_value (count on the body) + input#ship<ID>_input, the
 *   ship's real speed in the name tooltip (parse.gz.fleetTable ships[].speed, preferred over the calculated one). The
 *   selection is read through OGX.fleet.gz.state() (step 0: ships / available), the inputs are the fallback. The table
 *   goes right after that ship table; there is no target on this page (fleetStep1 shows distance, duration, arrival,
 *   return, consumption, max speed and cargo itself, so the module stays out of fleetStep1/2/3). No page bridge, no
 *   check-target. The speed badge is a pill after the ship name, absolutely placed from a zero-width anchor so the game's
 *   column widths stay as they are (the name cell has the game's own Speed tooltip
 *   on span.tooltip, so our stats tooltip sits on the pill only). Structure / shield / attack use the page's own
 *   «Bonus» table (Weapons/Defense/Shield +N %, tech x 10 + officer factor; parse.gz.fleetTable bonus; «Defense» is the
 *   110 bonus and applies to shields, «Shield» is the 111 bonus and applies to structure):
 *   base x (1 + N / 100) [UPSTREAM 2Moons combat: 1 + 0.1 x tech + factor].
 * The style element is OGX.dom.injectStyle('ogx-l-fleetinfo-css'): ctx.css() would create <style id="ogx-l-fleetinfo">,
 *   the same id as the table box, and removeTable() (getElementById) would then remove the style instead of the box.
 * Data: reads shipStats, server, research, player, bodies (state); makes no HTTP requests.
 * Writes only `fleetinfo.ui` ({ v: 1, collapsed }) through ctx.store.
 */
(function (OGX) {
  'use strict';

  const NAME = 'fleetinfo';
  const P = 'ogx-l-fleetinfo-';
  const BONUS = { structural: 111, shield: 110, attack: 109 };
  // parse.gz.fleetTable bonus keys. 2Moons names them by the tech, not by the stat [UPSTREAM ShowFleetTablePage:281-283,
  // calculateAttack.php:90-92]: «Defense» = 110 (Shield Technology) x 10 + factor -> shields, «Shield» = 111 (Armour
  // Technology) x 10 + factor -> hull/structure. Same pairing as BONUS above (structural 111, shield 110).
  const GZ_BONUS = { structural: 'shield', shield: 'defense', attack: 'attack' };
  const STYLE_ID = 'ogx-l-fleetinfo-css';

  OGX.module({
    name: NAME,
    title: 'Информация о флоте',
    pages: ['fleet'],
    settings: {
      showSpeedBadges: { type: 'bool', default: true, label: 'Скорость на иконках кораблей и подсказка с характеристиками' },
      showTable: { type: 'bool', default: true, label: 'Таблица выбранного флота (грузоподъёмность, скорость, время, топливо)' },
    },

    async init(ctx) {
      if (OGX.page.isGz && OGX.page.isGz()) {
        const form = gzShipForm();
        if (!form) { ctx.log.debug('GALAXYZ: no ship selection form (fleetStep1/2 show the fleet values themselves)'); return; }
        OGX.dom.injectStyle(STYLE_ID, CSS);
        const fi = new FleetInfo(ctx, form, true);
        ctx._fi = fi;
        await fi.start();
        return;
      }
      const fleet1 = OGX.dom.$('#fleet1');
      if (!fleet1) { ctx.log.debug('no #fleet1, nothing to do'); return; }
      OGX.dom.injectStyle(STYLE_ID, CSS);
      const fi = new FleetInfo(ctx, fleet1);
      ctx._fi = fi;
      await fi.start();
    },

    dispose(ctx) {
      if (ctx._fi) ctx._fi.dispose();
      const st = document.getElementById(STYLE_ID);
      if (st) st.remove();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const now = () => OGX.time.serverNow();
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);

  /**
   * GALAXYZ pill placement inside the name cell (td overflow:hidden, 35 px rows): centred under the ship name when it
   * fits there, else right of the name, else under it anyway. Only left/top of our own pill change; the game's cells
   * keep their size because the anchor has no width or height.
   */
  function placePill(anchor, pill, name) {
    try {
      const td = anchor.closest('td');
      const a = anchor.getBoundingClientRect(), p = pill.getBoundingClientRect();
      if (!td || !p.width) return;
      const c = td.getBoundingClientRect();
      const n = name ? name.getBoundingClientRect() : { left: a.left, right: a.left, top: a.top - 6, bottom: a.top + 6 };
      const below = n.bottom + 1 + p.height <= c.bottom;
      const right = n.right + 5 + p.width <= c.right - 2;
      let left, top;
      if (below || !right) {
        left = Math.max(c.left + 2, Math.min(c.right - 2 - p.width, (n.left + n.right) / 2 - p.width / 2));
        top = Math.min(n.bottom + 1, c.bottom - p.height);
      } else { left = n.right + 5; top = (n.top + n.bottom) / 2 - p.height / 2; }
      pill.style.right = 'auto';
      pill.style.left = Math.round(left - a.left) + 'px';
      pill.style.top = Math.round(top - a.top) + 'px';
    } catch (e) { /* keep the CSS default */ }
  }

  /**
   * Current speed (1..10, half steps allowed) of the #speedPercentage PercentageBar without the page bridge.
   * The value="10" attribute is static markup: PercentageBar.setValue (js:39657) only updates its JS object
   * and, in updateBar, marks .step[data-step=value] as .selected. So read the selected step; if the game JS
   * rendered steps but none is selected, the speed is unknown -> null (speed-dependent numbers are skipped).
   * Without rendered steps there is no game JS that could change the speed, so the attribute is trusted.
   */
  function readSpeedFromBar(bar) {
    if (!bar) return 10;
    const ok = (v) => fin(v) && v >= 0.5 && v <= 10;
    const steps = bar.querySelectorAll('.step');
    if (steps.length) {
      const st = bar.querySelector('.step.selected[data-step]');
      const v = st ? parseFloat(st.getAttribute('data-step')) : NaN;
      return ok(v) ? v : null;
    }
    const v = parseFloat(bar.getAttribute('value'));
    return ok(v) ? v : 10;
  }
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  /** GALAXYZ page=fleetTable ship selection form (it posts to fleetStep1 and holds input#ship<ID>_input). */
  function gzShipForm() {
    return OGX.dom.$$('form[action*="page=fleetStep1"]').find((f) => f.querySelector('input[id^="ship"][id$="_input"]')) || null;
  }
  function toggle(el, cls, on) { if (el && el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); }

  /** OgameX icon overlay (tiny, on the ship sprite): 950, 5,4к, 19,5к, 160М (ru decimal comma). */
  function compact(n) {
    if (!fin(n)) return '—';
    const a = Math.abs(n);
    const f = (v, d) => v.toFixed(d).replace(/\.?0+$/, '').replace('.', ',');
    if (a < 10000) return String(Math.round(a));
    if (a < 100000) return f(a / 1000, 1) + 'к';
    if (a < 1e6) return Math.round(a / 1000) + 'к';
    if (a < 1e7) return f(a / 1e6, 2) + 'М';
    if (a < 1e9) return Math.round(a / 1e6) + 'М';
    return f(a / 1e9, 1) + 'Б';
  }
  /** GALAXYZ inline pill: the suite's short format (OGX.fmt.short, as in the planet bar and totals): 6 000, 19,5 тыс.,
   * 220 млн, 1,2 млрд; the exact value is in data-v and the tooltip. */
  function pillNum(n) {
    if (!fin(n)) return '—';
    return OGX.fmt.short(Math.round(n));
  }
  /** Absolute moment: time only within the next 24 h, otherwise date + time. */
  function when(ms) {
    return ms - now() < 86400000 ? OGX.fmt.time(ms) : OGX.fmt.dateTime(ms);
  }
  function coordsOf(o) {
    if (!o) return null;
    const g = +o.galaxy, s = +o.system, p = +o.position;
    return g > 0 && s > 0 && p > 0 ? `${g}:${s}:${p}` : null;
  }
  function shipsSig(ships) {
    return Object.keys(ships).sort((a, b) => a - b).map((k) => k + 'x' + ships[k]).join(',');
  }
  function visible(el) {
    if (!el) return false;
    if (el.style && el.style.display === 'none') return false;
    try { return getComputedStyle(el).display !== 'none'; } catch (e) { return true; }
  }

  // ------------------------------------------------------------------ main
  class FleetInfo {
    constructor(ctx, fleet1, gz) {
      this.ctx = ctx;
      this.fleet1 = fleet1;         // OgameX #fleet1; GALAXYZ the fleetTable ship form
      this.gz = !!gz;
      this.items = [];              // [{ id, li, icon, input, avail }]
      this.stats = {};
      this.statsSrc = null;
      this.statsT = null;
      this.research = { levels: {}, t: null };
      this.server = {};
      this.body = null;
      this.fp = null;               // core boot parse of the fleet page (inline vars)
      this.bridgeOk = false;
      this.bridgeBusy = false;
      this.bridgeState = null;
      this.ct = null;               // last check-target: { coords, emptySystems, inactiveSystems, name, t }
      this.ui = { v: 1, collapsed: false };
      this.box = null;
      this.cells = {};
      this.badgeOffs = [];
      this.offs = [];
      this.lastSelSig = null;
      this.lastTargetSig = null;
      this.warned = {};
      this.renderBadges = OGX.log.wrap(NAME, this._renderBadges.bind(this), 'renderBadges');
      this.renderTable = OGX.log.wrap(NAME, this._renderTable.bind(this), 'renderTable');
      this.toggleCollapsed = OGX.log.wrap(NAME, this._toggleCollapsed.bind(this), 'toggleCollapsed');
      this.onCheckTarget = OGX.log.wrap(NAME, this._onCheckTarget.bind(this), 'checkTargetSeen');
      this.scheduleUpdate = OGX.util.debounce(OGX.safe(() => this.update(), NAME + ':update'), 60);
    }

    async start() {
      const ctx = this.ctx;
      const snap = OGX.state.snapshot && OGX.state.snapshot();
      this.fp = (snap && snap.fleetPage) || null;
      this.collectItems();
      try {
        const ui = await ctx.store.get('ui', null);
        if (ui && ui.v === 1) this.ui = ui;
      } catch (e) { ctx.log.warn('store read failed', e); }
      await this.reload();

      if (ctx.settings.get('showSpeedBadges')) this.renderBadges();
      if (ctx.settings.get('showTable')) this.renderTable();

      // selection changes: inputs (delegated on #fleet1), icon clicks, select all / none
      const tech = (!this.gz && OGX.dom.$('#fleet1 #technologies')) || this.fleet1;
      for (const type of ['keyup', 'input', 'change', 'focusout']) {
        this.offs.push(ctx.on(tech, type, (e) => { if (e.target && e.target.tagName === 'INPUT') this.scheduleUpdate(); }));
      }
      this.offs.push(ctx.on(tech, 'click', () => this.scheduleUpdate()));
      for (const sel of ['#sendall', '#resetall']) {
        const a = OGX.dom.$(sel);
        if (a) this.offs.push(ctx.on(a, 'click', () => this.scheduleUpdate()));
      }
      // step 2 inputs / mission / speed / duration (only meaningful with the game JS)
      const fleet2 = OGX.dom.$('#fleet2');
      if (fleet2) {
        for (const type of ['change', 'keyup', 'click']) this.offs.push(ctx.on(fleet2, type, () => this.scheduleUpdate()));
      }

      // check-target seen (game JS or anybody): core already stored shipsData as shipStats; we keep the distance inputs
      if (!this.gz) this.offs.push(OGX.bridge.onXhr(/^\/ajax\/fleet\/dispatch\/check-target$/, (x) => this.onCheckTarget(x)));
      this.offs.push(OGX.state.onChange(['shipStats', 'research', 'player', 'server', 'bodies'], () => this.reloadAndRender()));
      this.offs.push(ctx.settings.onChange((key) => {
        if (key === 'showSpeedBadges') {
          if (ctx.settings.get('showSpeedBadges')) this.renderBadges(); else this.removeBadges();
        } else if (key === 'showTable') {
          if (ctx.settings.get('showTable')) this.renderTable(); else this.removeTable();
        }
      }));

      if (this.gz) this.bridgeOk = false;   // no fleetDispatcher on GALAXYZ: the inputs are the selection
      else try { this.bridgeOk = await OGX.bridge.available(); } catch (e) { this.bridgeOk = false; }
      ctx.every(1000, () => { this.update(); this.pollBridge(); });
      this.pollBridge();
      this.update();
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* ignore */ } }
      this.offs = [];
      this.removeBadges();
      if (this.scheduleUpdate.cancel) this.scheduleUpdate.cancel();
    }

    // -------------------------------------------------------------- data
    collectItems() {
      if (this.gz) return this.collectItemsGz();
      const lis = OGX.dom.$$('#fleet1 #technologies li.technology[data-technology]');
      this.items = [];
      for (const li of lis) {
        const id = parseInt(li.getAttribute('data-technology'), 10);
        if (!(id > 0)) continue;
        const icon = li.querySelector('span.icon') || li.querySelector('.icon');
        const input = li.querySelector('input[type=text]') || li.querySelector('input');
        const am = li.querySelector('span.amount[data-value]');
        const avail = am ? parseInt(am.getAttribute('data-value'), 10) : NaN;
        this.items.push({ id, li, icon, input, avail: fin(avail) ? avail : null });
      }
      if (lis.length && !this.items.some((it) => it.input)) this.warnOnce('noinputs', 'ship inputs not found in #fleet1 li.technology');
      for (const it of this.items) {
        if (it.avail !== null) OGX.learn.value('fleetinfo.available', it.avail, { min: 0, int: true });
      }
    }

    /** GALAXYZ fleetTable rows: input#ship<ID>_input, count in td#ship<ID>_value, the ship image cell carries the badge. */
    collectItemsGz() {
      this.items = [];
      this.pageSpeed = {};
      const fp = this.fp && this.fp.gz && this.fp.gz.fleetTable;
      for (const s of (fp && fp.ships) || []) if (s && s.id && fin(s.speed) && s.speed > 0) this.pageSpeed[s.id] = s.speed;
      for (const input of this.fleet1.querySelectorAll('input[id^="ship"][id$="_input"]')) {
        const id = parseInt(input.id.slice(4), 10);
        if (!(id > 0)) continue;
        const valTd = document.getElementById('ship' + id + '_value');
        const avail = valTd ? Math.floor(OGX.util.parseGameNumber(valTd.textContent.trim())) : NaN;
        const row = input.closest('tr');
        const icon = row ? row.querySelector('td') : null;
        // the badge goes right after the ship name (span.tooltip "Speed:  N" of the game, else the cell's text)
        const name = icon ? icon.querySelector('span.tooltip') : null;
        this.items.push({ id, li: row, icon, name, input, avail: fin(avail) ? avail : null });
      }
      this.bonus = (fp && fp.bonus) || null;
      for (const it of this.items) if (it.avail !== null) OGX.learn.value('fleetinfo.available', it.avail, { min: 0, int: true });
    }

    async reload() {
      const ctx = this.ctx;
      try {
        this.stats = (await OGX.state.shipStats()) || {};
        // GALAXYZ: the speed the game prints for this body (engine research applied server side) wins over the estimate
        for (const [id, sp] of Object.entries(this.pageSpeed || {})) this.stats[id] = Object.assign({}, this.stats[id], { speed: sp });
        const any = Object.values(this.stats)[0];
        this.statsSrc = any ? any.src : null;
        this.statsT = any ? any.t : null;
        OGX.learn.check('fleetinfo.shipStats', this.stats);
      } catch (e) { this.stats = {}; ctx.log.warn('shipStats failed', e); }
      try { this.research = (await OGX.state.research()) || { levels: {}, t: null }; } catch (e) { this.research = { levels: {}, t: null }; }
      try { this.server = (await OGX.state.server()) || {}; } catch (e) { this.server = {}; }
      try {
        const cur = OGX.state.current();
        this.body = cur && cur.key ? await OGX.state.body(cur.key) : null;
      } catch (e) { this.body = null; }
    }

    async reloadAndRender() {
      await this.reload();
      if (this.ctx.settings.get('showSpeedBadges')) this.renderBadges();
      this.lastSelSig = null;
      this.update();
    }

    async pollBridge() {
      if (!this.bridgeOk || this.bridgeBusy || document.hidden) return;
      this.bridgeBusy = true;
      try {
        const st = await OGX.bridge.call('fleet.state');
        this.bridgeState = st && st.ok ? st : null;
        if (!st || !st.ok) this.bridgeOk = false;   // no fleetDispatcher on this page: stop polling
      } catch (e) {
        this.bridgeState = null;
      } finally {
        this.bridgeBusy = false;
      }
    }

    _onCheckTarget(x) {
      const j = x && x.json;
      if (!j || typeof j !== 'object') return { ok: false };
      const tp = j.targetPlanet || {};
      const f = x.form || {};
      const coords = coordsOf(tp) || coordsOf(f);
      this.ct = {
        coords, type: +tp.type || +f.type || 1, name: tp.name || null,
        emptySystems: +j.emptySystems || 0, inactiveSystems: +j.inactiveSystems || 0, t: now(),
      };
      OGX.learn.value('fleetinfo.emptySystems', this.ct.emptySystems, { min: 0, int: true });
      OGX.learn.value('fleetinfo.inactiveSystems', this.ct.inactiveSystems, { min: 0, int: true });
      this.scheduleUpdate();
      return { ok: true, coords, emptySystems: this.ct.emptySystems, inactiveSystems: this.ct.inactiveSystems };
    }

    /** Selected ships: the game's dispatcher when it reports a selection, else the inputs (clamped to the amount on the body). */
    readSelection() {
      if (this.gz) {
        let st = null;
        try { st = OGX.fleet && OGX.fleet.gz && OGX.fleet.gz.state ? OGX.fleet.gz.state() : null; } catch (e) { st = null; }
        if (st && st.ok && st.step === 0 && st.ships && typeof st.ships === 'object') {
          const ships = {};
          for (const [id, n] of Object.entries(st.ships)) {
            const it = this.items.find((x) => x.id === +id);
            let v = Math.floor(+n);
            if (it && it.avail !== null) v = Math.min(v, it.avail);
            if (v > 0) ships[+id] = v;
          }
          return { ships, src: 'page' };
        }
      }
      const fromInputs = {};
      for (const it of this.items) {
        if (!it.input) continue;
        const raw = String(it.input.value || '').trim();
        if (!raw) continue;
        let n = OGX.util.parseGameNumber(raw);
        if (!fin(n) || n <= 0) continue;
        n = Math.floor(n);
        if (it.avail !== null) n = Math.min(n, it.avail);
        if (n > 0) fromInputs[it.id] = n;
      }
      const bs = this.bridgeState;
      if (bs && Array.isArray(bs.shipsToSend) && bs.shipsToSend.length) {
        const fromGame = {};
        for (const s of bs.shipsToSend) if (s && +s.id > 0 && +s.number > 0) fromGame[+s.id] = Math.floor(+s.number);
        if (Object.keys(fromGame).length) return { ships: fromGame, src: 'game' };
      }
      return { ships: fromInputs, src: 'inputs' };
    }

    /** Origin, target, mission, speed % and holding hours. target = null when none is set. */
    readFlight() {
      const fp = this.fp || {};
      const cur = OGX.state.current();
      if (this.gz) return { origin: cur && cur.coords, target: null, type: 1, mission: 0, speedPct: 10, hold: 0, src: null, name: null };
      const originObj = fp.currentPlanet || null;
      const origin = coordsOf(originObj) || (cur && cur.coords) || null;
      const bs = this.bridgeState;
      let target = null, type = 1, mission = +fp.mission || 0, speedPct = 10, hold = 0, src = null, name = null;

      if (bs) {
        const tc = coordsOf(bs.targetPlanet);
        const onStep2 = bs.currentPage === 'fleet2';
        if (tc && (onStep2 || tc !== origin || (+bs.targetPlanet.type || 1) !== (+(originObj && originObj.type) || 1))) {
          target = tc; type = +bs.targetPlanet.type || 1; name = bs.targetPlanet.name || null; src = onStep2 ? 'step2' : 'game';
        }
        if (+bs.mission > 0) mission = +bs.mission;
        if (+bs.speedPercent >= 1 && +bs.speedPercent <= 10) speedPct = +bs.speedPercent;
        if (mission === 15) hold = +bs.expeditionTime || 0;
        else if (mission === 5) hold = +bs.holdingTime || 0;
      } else {
        const f2 = OGX.dom.$('#fleet2');
        if (f2 && visible(f2)) {
          const g = OGX.dom.$('#fleet2 #galaxy'), s = OGX.dom.$('#fleet2 #system'), p = OGX.dom.$('#fleet2 #position');
          const tc = coordsOf({ galaxy: g && g.value, system: s && s.value, position: p && p.value });
          if (tc) {
            target = tc; src = 'step2';
            const ti = OGX.dom.$('#fleet2 input#type');
            type = (ti && +ti.value) || 1;
          }
          // OgameX toggles .selected on the <a> inside li#buttonN (js:33940/33963), never on the <li>
          const selA = OGX.dom.$('#fleet2 #missions > li > a.selected');
          const selLi = selA && selA.parentElement;
          if (selLi && /^button\d+$/.test(selLi.id || '')) mission = parseInt(selLi.id.slice(6), 10) || mission;
          speedPct = readSpeedFromBar(OGX.dom.$('#speedPercentage'));
          const hs = OGX.dom.$(mission === 15 ? '#fleet2 select#expeditiontime' : '#fleet2 select#holdingtime');
          if (hs && (mission === 15 || mission === 5)) hold = +hs.value || 0;
        }
        if (!target && fp.targetPlanet) {
          const tc = coordsOf(fp.targetPlanet);
          // URL prefill (FleetController::index, idx:233-239): targetPlanet differs from currentPlanet
          if (tc && tc !== origin) { target = tc; type = +fp.targetPlanet.type || 1; src = 'prefill'; }
        }
      }
      if (!target && this.ct && this.ct.coords && this.ct.coords !== origin) {
        target = this.ct.coords; type = this.ct.type; src = 'checkTarget';
      }
      if (target && this.ct && this.ct.coords === target && this.ct.name) name = this.ct.name;
      if (mission === 15 && hold < 1 && target) hold = 1;   // expedition: at least 1 h (select#expeditiontime starts at 1)
      return { origin, target, type, mission, speedPct, hold, src, name };
    }

    // -------------------------------------------------------------- compute
    compute() {
      const sel = this.readSelection();
      const ships = sel.ships;
      const stats = this.stats;
      const ids = Object.keys(ships).map(Number);
      const count = ids.reduce((s, id) => s + ships[id], 0);
      const cargo = OGX.calc.fleetCargo(ships, stats);
      const maxSpeed = OGX.calc.fleetMaxSpeed(ships, stats);
      let slowest = null;
      for (const id of ids) {
        const sp = stats[id] && stats[id].speed;
        if (sp > 0 && sp === maxSpeed && (slowest === null || id < slowest)) slowest = id;
      }
      const out = { ships, src: sel.src, count, types: ids.length, cargo, maxSpeed, slowest, flight: this.readFlight() };
      const fl = out.flight;
      if (fl.target && fl.origin && count > 0 && maxSpeed > 0) {
        const srv = this.server || {};
        const fp = this.fp || {};
        const sameCt = this.ct && this.ct.coords === fl.target;
        const distance = OGX.calc.distance(fl.origin, fl.target, {
          galaxies: srv.galaxies || fp.maxGalaxy || 9, systems: srv.systems || fp.maxSystem || 499,
          emptySystems: sameCt ? this.ct.emptySystems : 0, inactiveSystems: sameCt ? this.ct.inactiveSystems : 0,
        });
        const speedFactor = OGX.calc.missionSpeedFactor(fl.mission, srv);
        // speedPct === null: speed unknown (no bridge, bar state unreadable) -> no duration/fuel/arrival instead of guessing 100%
        const duration = fl.speedPct ? OGX.calc.flightDuration({ distance, maxSpeed, speedPct: fl.speedPct, speedFactor }) : NaN;
        // client variant = the number the game shows in #consumption (check-target fuelConsumption already holds the class factor)
        const fuel = fin(duration) ? OGX.calc.fuel({ ships, stats, distance, duration, speedFactor, holdingHours: fl.hold, variant: 'client' }) : null;
        const t = now();
        out.est = {
          distance, duration, fuel, speedFactor,
          arrival: fin(duration) ? t + duration * 1000 : null,
          back: fin(duration) ? t + (2 * duration + fl.hold * 3600) * 1000 : null,
        };
        OGX.learn.value('fleetinfo.distance', distance, { min: 5, int: true });
        if (fin(duration)) OGX.learn.value('fleetinfo.duration', duration, { min: 1, int: true });
        if (fuel !== null) OGX.learn.value('fleetinfo.fuel', fuel, { min: 0, int: true });
      }
      OGX.learn.value('fleetinfo.cargo', cargo, { min: 0, int: true });
      return out;
    }

    deuteriumOnBody() {
      try {
        if (this.body && this.body.res && this.body.res.deuterium) {
          const p = OGX.state.projected(this.body);
          const d = p && p.res && p.res.deuterium ? p.res.deuterium.amount : null;
          if (fin(d)) return d;
        }
      } catch (e) { /* ignore */ }
      const r = this.fp && this.fp.resources;
      return r && fin(r.deuterium) ? r.deuterium : null;
    }

    // -------------------------------------------------------------- stats per ship (tooltip)
    shipInfo(id) {
      const s = this.stats[id] || {};
      const o = OGX.catalog.get(id);
      const props = (o && o.props) || {};
      const lv = (rid) => +((this.research && this.research.levels && this.research.levels[rid]) || 0);
      const gzPct = (k) => (this.gz && this.bonus && fin(+this.bonus[GZ_BONUS[k]]) ? +this.bonus[GZ_BONUS[k]] : null);
      const eff = (k) => {
        const base = +props[k] || 0;
        const pct = gzPct(k);
        if (pct !== null) return Math.floor(base * (1 + pct / 100));   // the page's own bonus (tech + officers)
        return base + Math.trunc((base * 10 * lv(BONUS[k])) / 100);
      };
      return {
        speed: s.speed, cargo: s.cargo, fuel: s.fuelConsumption ?? s.fuel, fuelCapacity: s.fuelCapacity,
        structural: eff('structural'), shield: eff('shield'), attack: eff('attack'),
      };
    }

    statsSourceText() {
      if (this.gz) {
        return 'Скорость — со страницы «Флот» (с двигателями); грузоподъёмность и расход — расчёт по исследованиям и офицерам' +
          (this.research && this.research.t ? ' (' + OGX.fmt.ago(this.research.t) + ')' : ' (исследования ещё не открывались)');
      }
      if (this.statsSrc === 'checkTarget') return 'Данные сервера (проверка цели)' + (this.statsT ? ', ' + OGX.fmt.ago(this.statsT) : '');
      return this.research && this.research.t ? 'Расчёт по исследованиям (' + OGX.fmt.ago(this.research.t) + ')' : 'Расчёт без данных об исследованиях — откройте «Исследования» или выберите цель';
    }

    tooltipNode(id) {
      const i = this.shipInfo(id);
      const row = (label, v, cls) => h('tr', null, h('td', { class: P + 'tl' }, label), h('td', { class: P + 'tv' + (cls ? ' ' + cls : '') }, v));
      const hasResearch = !!(this.research && this.research.t) || !!(this.gz && this.bonus);
      return h('div', { class: P + 'tip' },
        h('div', { class: P + 'tip-title' }, OGX.catalog.name(id) || ('#' + id)),
        h('table', null, h('tbody', null,
          row('Скорость', fin(i.speed) ? OGX.fmt.num(i.speed) : '—'),
          row('Грузоподъёмность', fin(i.cargo) ? OGX.fmt.num(i.cargo) : '—'),
          row('Расход топлива', fin(i.fuel) ? OGX.fmt.num(i.fuel) : '—'),
          row('Топливный бак', fin(i.fuelCapacity) ? OGX.fmt.num(i.fuelCapacity) : '—'),
          row('Структура', OGX.fmt.num(i.structural)),
          row('Щиты', OGX.fmt.num(i.shield)),
          row('Атака', OGX.fmt.num(i.attack)))),
        h('div', { class: P + 'tip-src' }, this.statsSourceText() + (this.gz && this.bonus ? '; броня/щиты/атака с бонусом из таблицы «Bonus»' : hasResearch ? '' : '; броня/щиты/атака без бонуса технологий')));
    }

    // -------------------------------------------------------------- badges
    _renderBadges() {
      this.removeBadges();
      let n = 0;
      for (const it of this.items) {
        if (!it.icon) continue;
        const sp = this.stats[it.id] && this.stats[it.id].speed;
        if (sp !== undefined) OGX.learn.value('fleetinfo.speed.' + it.id, sp, { min: 0 });
        if (this.gz) {
          // pill after the name; our stats tooltip on the pill (the name keeps the game's tooltip). The pill hangs from a
          // zero-width anchor (absolute), so the game's ship table keeps its column widths and row heights.
          const badge = h('span', { class: [P + 'speed', P + 'speed-gz'], 'data-ship': String(it.id), 'data-v': fin(sp) ? String(sp) : '',
            tabindex: '0', 'aria-label': 'Скорость ' + (fin(sp) ? OGX.fmt.num(sp) : 'неизвестна') },
          h('span', { class: P + 'speed-k' }, 'скор.'), ' ', pillNum(sp));
          const anchor = h('span', { class: P + 'speed-anchor' }, badge);
          if (it.name) it.name.after(anchor); else it.icon.appendChild(anchor);
          const place = () => { if (anchor.isConnected) placePill(anchor, badge, it.name); };
          place();
          // again once the page's styles / fonts are in (the cell box can still change after document_end)
          if (document.readyState !== 'complete') window.addEventListener('load', place, { once: true });
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(place, () => {});
          it.badge = anchor;
          this.badgeOffs.push(OGX.dom.tooltip(badge, () => this.tooltipNode(it.id), { side: 'right' }));
          n++;
          continue;
        }
        const badge = h('span', { class: P + 'speed', 'data-ship': String(it.id), 'data-v': fin(sp) ? String(sp) : '', title: 'Скорость: ' + (fin(sp) ? OGX.fmt.num(sp) : '—') }, compact(sp));
        it.icon.classList.add(P + 'hasbadge');
        it.icon.appendChild(badge);
        it.badge = badge;
        this.badgeOffs.push(OGX.dom.tooltip(it.icon, () => this.tooltipNode(it.id)));
        n++;
      }
      return { ok: true, badges: n, src: this.statsSrc };
    }

    removeBadges() {
      for (const off of this.badgeOffs) { try { off(); } catch (e) { /* ignore */ } }
      this.badgeOffs = [];
      for (const it of this.items) {
        if (it.badge) { it.badge.remove(); it.badge = null; }
        if (it.icon) it.icon.classList.remove(P + 'hasbadge');
      }
      for (const el of this.fleet1.querySelectorAll('.' + P + 'speed-anchor, .' + P + 'speed')) el.remove();
    }

    // -------------------------------------------------------------- table
    _renderTable() {
      this.removeTable();
      const anchor = this.gz ? this.fleet1.querySelector('table') : OGX.dom.$('#allornone');
      if (!anchor) { this.warnOnce('allornone', '#allornone not found, table not shown'); return { ok: false, reason: 'no #allornone' }; }
      const c = this.cells = {};
      const row = (key, label) => {
        c[key] = h('td', { class: P + 'v' });
        c[key + 'Row'] = h('tr', { class: P + 'row-' + key }, h('th', null, label), c[key]);
        return c[key + 'Row'];
      };
      const btn = h('button', {
        type: 'button', class: P + 'toggle', 'data-ogx-act': 'fleetinfo:toggle', title: 'Свернуть / развернуть',
        onClick: () => this.toggleCollapsed(),
      }, this.ui.collapsed ? '▸' : '▾');
      c.toggle = btn;
      c.src = h('span', { class: P + 'src' });
      c.body = h('tbody', null,
        row('count', 'Выбрано кораблей'),
        row('cargo', 'Грузоподъёмность'),
        row('speed', 'Скорость флота'),
        row('target', 'Цель'),
        row('distance', 'Расстояние'),
        row('duration', 'Время полёта'),
        row('fuel', 'Расход дейтерия'),
        row('arrival', 'Прибытие'),
        row('back', 'Возвращение'),
        row('hint', ''));
      // the hint spans the whole row (its label cell would squeeze the text into the value column)
      c.hintRow.firstChild.remove();
      c.hint.colSpan = 2;
      this.box = h('div', { id: 'ogx-l-fleetinfo', class: P + 'box' + (this.gz ? ' ' + P + 'gz' : '') + (this.ui.collapsed ? ' ' + P + 'collapsed' : '') },
        h('div', { class: P + 'head' }, btn, h('span', { class: P + 'title' }, 'OgameX Suite: выбранный флот'), c.src),
        h('table', { class: P + 'table' }, c.body));
      anchor.insertAdjacentElement('afterend', this.box);
      if (this.gz) {
        // same width and horizontal place as the game's ship table (table519, 650 px, centred in .mainRS)
        const tb = anchor.getBoundingClientRect();
        if (tb.width > 200) {
          this.box.style.width = Math.round(tb.width) + 'px';
          const dx = Math.round(tb.left - this.box.getBoundingClientRect().left);
          if (dx) this.box.style.marginLeft = (parseFloat(getComputedStyle(this.box).marginLeft) || 0) + dx + 'px';
        }
      }
      this.lastSelSig = null;
      this.update();
      return { ok: true };
    }

    removeTable() {
      for (const old of document.querySelectorAll('div#ogx-l-fleetinfo')) old.remove();
      this.box = null;
      this.cells = {};
    }

    async _toggleCollapsed() {
      this.ui = { v: 1, collapsed: !this.ui.collapsed };
      if (this.box) toggle(this.box, P + 'collapsed', this.ui.collapsed);
      if (this.cells.toggle) setText(this.cells.toggle, this.ui.collapsed ? '▸' : '▾');
      await this.ctx.store.set('ui', this.ui);
      return { collapsed: this.ui.collapsed };
    }

    update() {
      if (!this.box || !this.box.isConnected) {
        if (this.box && this.ctx.settings.get('showTable')) this.renderTable();
        return;
      }
      const r = this.compute();
      const c = this.cells;
      const fmt = OGX.fmt;

      // journal: record the moment the selection or the target changes (not every tick)
      const selSig = shipsSig(r.ships);
      if (selSig !== this.lastSelSig) {
        if (this.lastSelSig !== null) OGX.log.rec('B', NAME, 'selection', { ships: r.ships, src: r.src, cargo: r.cargo, speed: r.maxSpeed });
        this.lastSelSig = selSig;
      }
      const fl = r.flight;
      const tSig = [fl.target, fl.type, fl.mission, fl.speedPct, fl.hold].join('|');
      if (fl.target && tSig !== this.lastTargetSig) {
        OGX.log.rec('B', NAME, 'target', { from: fl.origin, to: fl.target, type: fl.type, mission: fl.mission, speedPct: fl.speedPct, hold: fl.hold, src: fl.src });
      }
      this.lastTargetSig = fl.target ? tSig : null;

      setText(c.src, r.src === 'game' ? 'выбор из игры' : '');
      c.src.title = this.statsSourceText();
      setText(c.count, r.count > 0 ? `${fmt.num(r.count)} (${r.types} ${fmt.plural(r.types, ['тип', 'типа', 'типов'])})` : '—');
      setText(c.cargo, r.count > 0 ? fmt.num(r.cargo) : '—');
      c.cargo.title = r.count > 0 ? Object.keys(r.ships).map((id) => `${OGX.catalog.name(+id)}: ${fmt.num(r.ships[id])} × ${fmt.num((this.stats[id] && this.stats[id].cargo) || 0)}`).join('\n') : '';
      setText(c.speed, r.count > 0 && r.maxSpeed > 0 ? `${fmt.num(r.maxSpeed)} (${OGX.catalog.name(r.slowest) || r.slowest})` : '—');

      const est = r.est;
      const showTarget = !!fl.target;
      for (const k of ['target', 'distance', 'duration', 'fuel', 'arrival', 'back']) c[k + 'Row'].hidden = !showTarget;
      if (showTarget) {
        const mName = fl.mission > 0 ? OGX.catalog.missionName(fl.mission) : 'миссия не выбрана';
        const holdTxt = fl.hold > 0 ? `, удержание ${fl.hold} ч` : '';
        setText(c.target, `${fmt.coords(fl.target, fl.type)}${fl.name ? ' ' + fl.name : ''} · ${mName} · ${fl.speedPct ? Math.round(fl.speedPct * 10) + '%' : 'скорость ?'}${holdTxt}`);
        setText(c.distance, est ? fmt.num(est.distance) : '—');
        setText(c.duration, est && fin(est.duration) ? fmt.duration(est.duration) : '—');
        const deut = this.deuteriumOnBody();
        setText(c.fuel, est && est.fuel !== null ? fmt.num(est.fuel) : '—');
        const short = est && est.fuel !== null && deut !== null && est.fuel > deut;
        toggle(c.fuel, P + 'bad', short);
        c.fuel.title = short ? `Не хватает дейтерия: на планете ~${fmt.num(Math.floor(deut))}` : (deut !== null ? `На планете ~${fmt.num(Math.floor(deut))}` : '');
        setText(c.arrival, est && est.arrival ? when(est.arrival) : '—');
        setText(c.back, est && est.back ? when(est.back) : '—');
      }
      let hint = '';
      if (r.count === 0) hint = 'Выберите корабли: здесь появятся грузоподъёмность и скорость.';
      else if (!showTarget) hint = this.gz ? 'Расстояние, время полёта и расход игра покажет на следующем шаге.' : 'Цель не задана: время полёта и расход появятся на шаге 2.';
      else if (!(r.maxSpeed > 0)) hint = 'Нет данных о скорости выбранных кораблей.';
      setText(c.hint, hint);
      c.hintRow.hidden = !hint;
      return r;
    }

    warnOnce(key, msg) {
      if (this.warned[key]) return;
      this.warned[key] = true;
      this.ctx.log.warn(msg);
    }
  }

  const CSS = `
#ogx-l-fleetinfo.${P}box { clear: both; margin: 6px 10px 4px; padding: 4px 8px 6px; background: rgba(13,16,20,.88); border: 1px solid #2c3a48;
  border-radius: 3px; color: #c8d0d8; font: 11px/1.45 Verdana, Arial, sans-serif; position: relative; z-index: 1; text-align: left; box-sizing: border-box; }
#ogx-l-fleetinfo.${P}gz { margin: 6px 0 6px 8px; max-width: 100%; }
#ogx-l-fleetinfo.${P}box table, #ogx-l-fleetinfo.${P}box tr, #ogx-l-fleetinfo.${P}box th, #ogx-l-fleetinfo.${P}box td {
  background: none; border: 0; height: auto; font: inherit; box-shadow: none; }
#ogx-l-fleetinfo.${P}box tr { border-bottom: 1px solid rgba(44,58,72,.6); }
#ogx-l-fleetinfo.${P}box tr:last-child { border-bottom: 0; }
.${P}head { display: flex; align-items: center; gap: 6px; }
.${P}title { font-weight: bold; color: #9fc6e7; }
.${P}src { margin-left: auto; color: #7d8a96; font-size: 10px; }
.${P}toggle { background: none; border: 0; color: #9fc6e7; cursor: pointer; font-size: 11px; padding: 0 2px; line-height: 1; }
.${P}collapsed .${P}table { display: none; }
.${P}table { width: 100%; border-collapse: collapse; margin-top: 3px; }
#ogx-l-fleetinfo .${P}table th { text-align: left; font-weight: normal; color: #8c99a6; padding: 2px 8px 2px 0; width: 42%; }
#ogx-l-fleetinfo .${P}table td.${P}v { text-align: right; color: #e4e9ee; padding: 2px 0; }
.${P}table tr[hidden] { display: none; }
#ogx-l-fleetinfo .${P}row-hint th { display: none; }
#ogx-l-fleetinfo .${P}row-hint td.${P}v { text-align: left; color: #7d8a96; font-style: italic; }
#ogx-l-fleetinfo .${P}table td.${P}bad { color: #e05a4f; }
.${P}hasbadge { position: relative; }
.${P}speed { position: absolute; left: 1px; top: 1px; z-index: 2; padding: 0 2px; border-radius: 2px; background: rgba(0,0,0,.72);
  color: #ffd76a; font: bold 9px/12px Verdana, Arial, sans-serif; pointer-events: none; white-space: nowrap; }
.${P}speed-anchor { position: relative; display: inline-block; width: 0; height: 0; margin: 0; padding: 0; vertical-align: middle; }
.${P}speed.${P}speed-gz { position: absolute; right: 0; top: 6px; display: inline-block; margin: 0; padding: 0 5px; white-space: nowrap; border: 1px solid #5a4a1c; border-radius: 8px;
  background: rgba(0,0,0,.55); color: #ffd76a; font: bold 10px/14px Verdana, Arial, sans-serif; vertical-align: middle; pointer-events: auto; cursor: help; }
.${P}speed-gz .${P}speed-k { color: #b39a55; font-weight: normal; }
.${P}speed-gz:focus { outline: 1px solid #ffd76a; }
.${P}tip { min-width: 180px; }
.${P}tip-title { font-weight: bold; margin-bottom: 3px; }
.${P}tip table { border-collapse: collapse; width: 100%; }
.${P}tip td.${P}tl { padding-right: 10px; opacity: .8; }
.${P}tip td.${P}tv { text-align: right; }
.${P}tip-src { margin-top: 4px; font-size: 10px; opacity: .7; max-width: 240px; }
`;
})(window.OGX);
