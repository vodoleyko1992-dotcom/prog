/* ogamex-live/modules/techcost/techcost.js — Owner: live/techcost.
 * Cost overlay and cost badges (DESIGN §4.1.4, OL rows 12 and 13, OL §4.10, §4.12, §5.5).
 *
 *  1. Badges on every list icon: the next-level cost (buildings/research: calc.cost(id, level + 1); ships/defense:
 *     per piece), computed locally (no AJAX per item). A line is red when the projected stock of the current body
 *     is lower than the cost.
 *  2. Overlay in the technology details: per resource need / have / difference, transports for the missing part
 *     (Battle Transporter 217 = OGX.catalog.transportShip by default, setting `cargoShip`),
 *     total row, "Будет доступно через … (в ЧЧ:ММ:СС)"; ships/defense are multiplied by #build_amount.
 *     Refreshed every tick from the projection of the current body.
 *
 * OgameX markup used (src/OGameX/resources/views/ingame/...):
 *   #technologies li.technology[data-technology]       resources/index.blade.php:32, facilities:38, research/research-item:1,
 *                                                        shipyard/unit-item:1 (research/shipyard wrap the lists in #technologies too)
 *   li span.icon (sprite) > span.level[data-value]      resources/index.blade.php:72 (current level, raw)
 *   li span.icon > span.amount[data-value]              shipyard/unit-item.blade.php:62 (unit amount, raw)
 *   #technologydetails_content                          resources/index.blade.php:23, facilities:29, research/shipyard/defense:17
 *   #technologydetails[data-technology-id]              ajax/object.blade.php:3 — hard-coded "3", never used here
 *   button.upgrade|downgrade[data-technology]           ajax/object.blade.php:221, :244 (the real object id)
 *   .information > span.level|span.amount[data-value]  ajax/object.blade.php:33-40 (current + 1, also for units)
 *   .costs li.resource.<res>[data-value]                ajax/object.blade.php:84-121 (per piece for units)
 *   #build_amount (value, max)                          ajax/object.blade.php:216; game JS reads `val() || 1`
 *                                                        (resources/js/ingame/e7c7…c2.js:41244); the [max] button sets the value
 *                                                        without events (:41430), so the value is re-read every tick.
 *   li.technology.showsDetails                          game JS :41388 (the item whose details are open; id fallback)
 *
 * GALAXYZ 1.8 markup (REAL list pages, specs/galaxyz/buildings.md §3-4):
 *   ul.icons > li.technology[data-technology]            buildings/research/shipyard lists (#technologies is duplicated:
 *                                                        the first one is the empty "... under construction" box)
 *   li div.icon > span.level[data-value]                 buildings level / unit amount (units: span.level, not .amount)
 *   li a.detail_button span.ecke > span.level (text)     research level: NO data-value, read the text
 *   li button.upgrade                                     "can start now" (empty queue: affordable incl. energy vs PRODUCED energy)
 *   #technologydetails_content <- page=<Kind>DetailsAjax  details panel [UNVERIFIED markup, from the fork's base.js]:
 *     .costs[data-tech-id][data-level=current][data-factor] > li.cost-item[data-res=901|902|903|911][data-base=next level]
 *     input#b_input_<id> / input.upgrade-input            target level (buildings) or amount (units); the game JS already
 *                                                        shows the per-resource deficit (.lack-badge), we add ETA/transports
 *   Prices unknown for the fork-only conveyors 71-73 (catalog priceKnown false): badge «цена ?», no overlay numbers.
 *   Energy prices (Terraformer, Graviton) are compared with the PRODUCED energy (2Moons getRestPrice), not the free energy.
 *   The overlay is placed in the flow under the panel's costs (the panel layout is not known), not absolutely.
 *
 * Data: reads state bodies / shipStats / research / player and the core 'flights' cache (read-only).
 * Writes only `techcost.verified` (costs seen in the details that differ from the local formula, so the badge of that
 * level shows the server's number; capped) and `techcost.ui` (overlay collapsed or not).
 */
(function (OGX) {
  'use strict';

  const NAME = 'techcost';
  const P = 'ogx-l-techcost-';
  const RES = ['metal', 'crystal', 'deuterium'];
  const ALL = ['metal', 'crystal', 'deuterium', 'energy'];
  const LBL = { metal: 'М', crystal: 'К', deuterium: 'Д', energy: 'Э' };
  const NAME_RU = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий', energy: 'Энергия' };
  const NAME_GEN = { metal: 'металла', crystal: 'кристалла', deuterium: 'дейтерия', energy: 'энергии' };
  const TRANSPORT = (OGX.catalog && OGX.catalog.transportShip) || 217;
  const VERIFIED_MAX = 150;
  const UNIT_TYPES = { ship: 1, defense: 1 };

  OGX.module({
    name: NAME,
    title: 'Стоимость построек',
    pages: ['resources', 'facilities', 'research', 'shipyard', 'defense'],
    settings: {
      showBadges: { type: 'bool', default: true, label: 'Стоимость следующего уровня на иконках' },
      showOverlay: { type: 'bool', default: true, label: 'Расчёт стоимости в окне постройки' },
      // new key (was `transportShip` 202/203/both): an old stored choice must not override the Battle Transporter default
      cargoShip: {
        type: 'enum', default: String(TRANSPORT), label: 'Транспорт для недостающих ресурсов',
        options: [{ value: String(TRANSPORT), label: 'Улучшенный транспорт' }, { value: '203', label: 'Большой транспорт' }, { value: '202', label: 'Малый транспорт' }],
      },
    },

    async init(ctx) {
      if (!OGX.dom.$('#technologies') && !OGX.dom.$('ul.icons > li.technology') && !OGX.dom.$('#technologydetails_content')) {
        ctx.log.debug('no #technologies / #technologydetails_content, nothing to do');
        return;
      }
      ctx.css(CSS);
      const tc = new TechCost(ctx);
      ctx._tc = tc;
      await tc.start();
    },

    dispose(ctx) {
      if (ctx._tc) ctx._tc.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const now = () => OGX.time.serverNow();
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function setTitle(el, t) { if (el && el.getAttribute('title') !== t) el.setAttribute('title', t); }
  function toggle(el, cls, on) { if (el && el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); }

  /** Compact number for the small icon badges: 950, 5,4 тыс., 449 тыс., 1,26 млн, 4,5 млрд (ru decimal comma; the
   * same млн/млрд units as OGX.fmt.short everywhere else — a bare «М» would read as metal next to the «М» label). */
  const NB = '\u00a0';
  function compact(n) {
    if (!fin(n)) return '—';
    const a = Math.abs(n);
    const s = n < 0 ? '-' : '';
    const f = (v, d) => v.toFixed(d).replace(/\.?0+$/, '').replace('.', ',');
    if (a < 1000) return s + Math.round(a);
    if (a < 10000) return s + f(a / 1000, 1) + NB + 'тыс.';
    if (a < 1e6) return s + Math.round(a / 1000) + NB + 'тыс.';
    if (a < 1e7) return s + f(a / 1e6, 2) + NB + 'млн';
    if (a < 1e9) return s + f(a / 1e6, 1) + NB + 'млн';
    return s + f(a / 1e9, a < 1e10 ? 2 : 1) + NB + 'млрд';
  }
  const isGz = () => !!(OGX.page.isGz && OGX.page.isGz());
  const LIST_SEL = '#technologies li.technology[data-technology], ul.icons > li.technology[data-technology]';
  const RES_ID = { 901: 'metal', 902: 'crystal', 903: 'deuterium', 911: 'energy' };
  /** Current level (buildings/research) or amount (units) of a list item: data-value, else the text (GALAXYZ research). */
  function itemLevel(li) {
    const el = li.querySelector('span.level[data-value], span.amount[data-value]') || li.querySelector('span.level, span.amount');
    if (!el) return { el: null, level: 0 };
    const raw = el.hasAttribute('data-value') ? el.getAttribute('data-value') : String(el.textContent || '').replace(/[^\d]/g, '');
    return { el, level: raw === '' ? NaN : +raw };
  }
  function priceKnown(id) {
    const o = OGX.catalog.get(id);
    return !(o && o.priceKnown === false);
  }
  function isUnitId(id) {
    const o = OGX.catalog.get(id);
    return !!(o && UNIT_TYPES[o.type]);
  }
  function mul(cost, n) {
    const o = {};
    for (const k of ALL) o[k] = ((cost && cost[k]) || 0) * n;
    return o;
  }
  function sameCost(a, b) {
    return ALL.every((k) => Math.round((a && a[k]) || 0) === Math.round((b && b[k]) || 0));
  }
  function costText(cost) {
    return ALL.filter((k) => cost[k] > 0).map((k) => NAME_RU[k] + ' ' + OGX.fmt.num(cost[k])).join(', ') || 'бесплатно';
  }
  /** Absolute moment: time only when within the next 24 h, otherwise date + time. */
  function when(ms) {
    return ms - now() < 86400000 ? OGX.fmt.time(ms) : OGX.fmt.dateTime(ms);
  }

  // ------------------------------------------------------------------ main
  class TechCost {
    constructor(ctx) {
      this.ctx = ctx;
      this.body = null;
      this.stats = {};
      this.energy = null;
      this.flights = null;
      this.verified = {};
      this.ui = { v: 1, collapsed: false };
      this.items = [];
      this.listSig = '';
      this.ov = null;            // current overlay state
      this.offs = [];
      this.fallbackRes = null;
      this.renderBadges = OGX.log.wrap(NAME, this._renderBadges.bind(this), 'renderBadges');
      this.attach = OGX.log.wrap(NAME, this._attach.bind(this), 'attachOverlay');
      this.toggleCollapsed = OGX.log.wrap(NAME, this._toggleCollapsed.bind(this), 'toggleCollapsed');
    }

    async start() {
      const ctx = this.ctx;
      await this.loadData();
      try {
        const v = await ctx.store.get('verified', null);
        this.verified = v && v.v === 1 && v.items ? v.items : {};
        const ui = await ctx.store.get('ui', null);
        if (ui && ui.v === 1) this.ui = ui;
      } catch (e) { ctx.log.warn('store read failed', e); }

      if (ctx.settings.get('showBadges')) this.renderBadges();

      // technology details: core emits techdetails:open; our own observer is the fallback (both are idempotent)
      this.offs.push(ctx.bus.on('techdetails:open', (p) => { if (p && p.el) this.attach(p.el); }));
      const box = OGX.dom.$('#technologydetails_content');
      if (box) {
        this.offs.push(OGX.dom.observe(box, () => this.checkDetails(), { debounce: 80 }));
      }
      this.checkDetails();

      // list markup changes (the game re-renders items after a build request on some pages)
      // GALAXYZ: #technologies is duplicated (the first is the queue box) -> the container of ul.icons
      const list = this.listRoot();
      if (list) {
        this.offs.push(OGX.dom.observe(list, () => {
          if (ctx.settings.get('showBadges') && this.computeListSig() !== this.listSig) this.renderBadges();
        }, { debounce: 200 }));
        // which item the user opened (fallback id for a details panel without its own id); reading only
        this.offs.push(ctx.on(list, 'click', (ev) => {
          const li = ev.target && ev.target.closest ? ev.target.closest('li.technology[data-technology]') : null;
          if (li) this.lastClicked = { id: +li.dataset.technology, t: Date.now() };
        }));
      }

      this.offs.push(OGX.state.onChange(['bodies', 'shipStats', 'research', 'player'], () => this.reload()));
      this.offs.push(ctx.bus.on('flights:updated', (p) => { this.flights = (p && p.flights) || null; }));
      this.offs.push(ctx.settings.onChange((key) => {
        if (key === 'showBadges') {
          if (ctx.settings.get('showBadges')) this.renderBadges(); else this.removeBadges();
        } else if (key === 'showOverlay') {
          if (ctx.settings.get('showOverlay')) this.checkDetails(true); else this.removeOverlay();
        } else if (key === 'cargoShip') this.update();
      }));
      ctx.every(1000, () => this.update());
      this.update();
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* ignore */ } }
      this.offs = [];
    }

    // -------------------------------------------------------------- data
    async loadData() {
      const ctx = this.ctx;
      try {
        const cur = OGX.state.current();
        this.body = cur && cur.key ? await OGX.state.body(cur.key) : null;
      } catch (e) { this.body = null; ctx.log.warn('body read failed', e); }
      try { this.stats = (await OGX.state.shipStats()) || {}; } catch (e) { this.stats = {}; ctx.log.warn('shipStats failed', e); }
      try {
        const f = await OGX.flights.cached();   // core: stored list, no request
        this.flights = f && Array.isArray(f.flights) ? f.flights : null;
      } catch (e) { this.flights = null; }
      if (!this.body || !this.body.res) {
        // fallback: the boot snapshot of this page (inline reloadResources)
        const snap = OGX.state.snapshot && OGX.state.snapshot();
        const inl = snap && snap.inline;
        if (inl && inl.metal) {
          const t = now();
          this.fallbackRes = {};
          for (const k of RES) {
            const r = inl[k] || {};
            this.fallbackRes[k] = { amount: +r.amount || 0, storage: r.storage, perHour: +r.perHour || (+r.perSecond || 0) * 3600, t };
          }
        }
        if (!this.fallbackRes) ctx.log.debug('no resources for the current body');
      }
      const ship = this.shipId();
      const c = this.stats[ship] && this.stats[ship].cargo;
      if (c !== undefined) OGX.learn.value('techcost.cargo' + ship, c, { min: 1 });
    }

    async reload() {
      await this.loadData();
      this.update();
    }

    /** Projected resources of the current body now: { metal|crystal|deuterium: { amount, storage, perHour, t } }. */
    resNow(t) {
      const b = this.body;
      if (b && b.res) {
        let pr = null;
        try { pr = OGX.state.projected(b, t, { flights: this.flights || undefined }); } catch (e) { pr = null; }
        if (!pr) pr = OGX.state.projected(b, t);
        const out = {};
        for (const k of RES) {
          const r = (pr.res && pr.res[k]) || {};
          out[k] = { amount: +r.amount || 0, storage: r.storage, perHour: +r.perHour || 0, t };
        }
        return out;
      }
      if (this.fallbackRes) {
        const out = {};
        for (const k of RES) {
          const r = this.fallbackRes[k];
          out[k] = { amount: OGX.calc.amountAt(r, t), storage: r.storage, perHour: r.perHour, t };
        }
        return out;
      }
      return null;
    }
    /** Energy an energy price is compared with: OgameX the free energy, GALAXYZ the produced energy (2Moons getRestPrice
     * uses $PLANET['energy']; checked against the real buy buttons, buildings.md §3.6). */
    energyAvailable() {
      const e = this.body && this.body.energy;
      if (isGz()) return e && e.production !== null && e.production !== undefined && fin(+e.production) ? +e.production : null;
      if (e && fin(+e.available)) return +e.available;
      const snap = OGX.state.snapshot && OGX.state.snapshot();
      const inl = snap && snap.inline;
      if (inl && inl.energy && fin(+inl.energy.amount)) return +inl.energy.amount;
      return null;
    }
    /** The one transport the missing resources are counted in (default Battle Transporter 217). */
    shipId() {
      const id = +this.ctx.settings.get('cargoShip');
      return id === 202 || id === 203 || id === TRANSPORT ? id : TRANSPORT;
    }
    /** calc.costOverlay counts one ship kind in the `sc` slot; shipStats cargo includes the Storage officer. */
    caps() {
      const id = this.shipId();
      const def = OGX.catalog.get(id);
      const cap = (this.stats[id] && +this.stats[id].cargo) || (def && def.props && +def.props.cargo) || 0;
      return { capSC: cap, capLC: 0 };
    }
    shipsText(n) {
      return OGX.fmt.num(n) + ' ' + OGX.catalog.shortName(this.shipId());
    }

    /** Next-level cost (or per piece). Prefers a server-verified number for exactly that level. */
    badgeCost(id, level, isUnit) {
      const v = this.verified[id];
      const lvl = isUnit ? 0 : level + 1;
      if (v && v.level === lvl && v.cost) return { cost: v.cost, verified: true };
      return { cost: isUnit ? OGX.calc.cost(id) : OGX.calc.cost(id, lvl), verified: false };
    }

    // -------------------------------------------------------------- badges (OL row 13)
    listItems() {
      return Array.from(new Set(OGX.dom.$$(LIST_SEL)));
    }
    listRoot() {
      const ul = document.querySelector('ul.icons > li.technology[data-technology]');
      if (ul) return ul.closest('#technologies') || ul.parentElement;
      return document.querySelector('#technologies');
    }
    computeListSig() {
      return Array.from(new Set(document.querySelectorAll(LIST_SEL))).map((li) => li.dataset.technology + ':' + itemLevel(li).level).join(',');
    }
    removeBadges() {
      for (const el of document.querySelectorAll('.' + P + 'badge')) el.remove();
      this.items = [];
      this.listSig = '';
    }
    _renderBadges() {
      this.removeBadges();
      const lis = this.listItems();
      let n = 0;
      for (const li of lis) {
        try {
          const id = +li.dataset.technology;
          if (!OGX.catalog.get(id)) { OGX.learn.value('techcost.listId', NaN); continue; }
          const { el: lvEl, level } = itemLevel(li);
          const isUnit = (lvEl && lvEl.classList.contains('amount')) || isUnitId(id);
          if (!OGX.learn.value('techcost.level', level, { min: 0, int: true })) continue;
          // GALAXYZ: div.icon holds the level bar (buildings, units, research inside div.premium)
          const host = li.querySelector('span.icon') || li.querySelector('div.icon') || li;
          if (!priceKnown(id)) {
            const badge = h('span', { class: [P + 'badge', P + 'unknown'], 'data-ogx-act': 'badge', dataset: { id: String(id) },
              title: 'Цена этого здания на сервере неизвестна: игра показывает её только в окне постройки' }, h('span', { class: P + 'bl' }, 'цена ?'));
            host.appendChild(badge);
            n++;
            continue;
          }
          const { cost, verified } = this.badgeCost(id, level, isUnit);
          OGX.learn.check('techcost.badgeCost', cost);
          const lines = {};
          const kids = [];
          for (const k of ALL) {
            if (!(cost[k] > 0)) continue;
            lines[k] = h('span', { class: [P + 'bl', P + 'bl-' + k] }, LBL[k] + ' ' + compact(cost[k]));
            kids.push(lines[k]);
          }
          if (!kids.length) continue;
          const head = isUnit ? 'Цена за 1 шт.' : 'Следующий уровень ' + (level + 1);
          const badge = h('span', { class: P + 'badge', 'data-ogx-act': 'badge', dataset: { id: String(id) } }, kids);
          host.appendChild(badge);
          this.items.push({ li, id, isUnit, level, cost, lines, badge, head: head + (verified ? ' (по данным сервера)' : ''), sig: null });
          n++;
        } catch (e) {
          this.ctx.log.warn('badge failed for', li && li.dataset && li.dataset.technology, e);
        }
      }
      this.listSig = this.computeListSig();
      this.updateBadges(this.resNow(now()));
      return { items: lis.length, badges: n };
    }
    updateBadges(res) {
      const energy = this.energyAvailable();
      for (const it of this.items) {
        if (!it.badge.isConnected) continue;
        const missing = {};
        let bad = false;
        for (const k of ALL) {
          if (!it.lines[k]) continue;
          // energy price: only where the engine requires it to be available (GALAXYZ: produced energy >= price)
          const have = k === 'energy' ? (isGz() && !it.isUnit ? energy : null) : res ? res[k].amount : null;
          const short = have !== null && have < it.cost[k];
          toggle(it.lines[k], P + 'bad', short);
          if (short) { bad = true; missing[k] = it.cost[k] - have; }
        }
        toggle(it.badge, P + 'short', bad);
        const sig = ALL.map((k) => (missing[k] ? 1 : 0)).join('') + (res ? '' : '?');
        if (sig !== it.sig) {
          it.sig = sig;
          let t = it.head + ': ' + costText(it.cost);
          if (!res) t += '\nЗапасы планеты неизвестны';
          else if (bad) t += '\nНе хватает: ' + ALL.filter((k) => missing[k]).map((k) => NAME_GEN[k] + ' ' + OGX.fmt.num(Math.ceil(missing[k]))).join(', ');
          else t += '\nРесурсов достаточно';
          setTitle(it.badge, t);
        }
      }
    }

    // -------------------------------------------------------------- details overlay (OL row 12)
    checkDetails(force) {
      const el = document.getElementById('technologydetails');
      if (!el) { this.ov = null; return; }
      if (!force && this.attachedEl === el && el.querySelector('.' + P + 'ov')) return;
      this.attachedEl = el;
      this.attach(el);
    }
    removeOverlay() {
      for (const x of document.querySelectorAll('.' + P + 'ov, #technologydetails .' + P + 'total')) x.remove();
      this.ov = null;
    }
    detailsId(el) {
      const btn = OGX.dom.$('button.upgrade[data-technology], button.downgrade[data-technology]', el);
      if (btn) return +btn.dataset.technology;
      // GALAXYZ panel [UNVERIFIED]: .costs[data-tech-id] (base.js), then the panel root / the target input id
      const costs = el.querySelector('.costs[data-tech-id]');
      if (costs && +costs.dataset.techId > 0) return +costs.dataset.techId;
      for (const a of ['data-tech', 'data-technology', 'data-technology-id']) if (+el.getAttribute(a) > 0) return +el.getAttribute(a);
      const inp = el.querySelector('[id^="b_input_"]');
      if (inp && +inp.id.slice(8) > 0) return +inp.id.slice(8);
      const li = document.querySelector('#technologies li.technology.showsDetails[data-technology]');
      if (li) return +li.dataset.technology;
      if (this.lastClicked && Date.now() - this.lastClicked.t < 15000) return this.lastClicked.id;
      return null;
    }
    /** GALAXYZ panel: { level (current), factor, cost of the next level / per piece } from .costs + li.cost-item[data-base]. */
    readGzCosts(el) {
      const costs = el.querySelector('.costs[data-tech-id], .costs[data-level]');
      if (!costs) return null;
      const out = { metal: 0, crystal: 0, deuterium: 0, energy: 0 };
      let found = 0;
      for (const li of el.querySelectorAll('li.cost-item[data-res]')) {
        const k = RES_ID[+li.dataset.res];
        const v = parseFloat(li.dataset.base);
        if (k && fin(v)) { out[k] = v; found++; }
      }
      const lv = costs.getAttribute('data-level');
      return { level: lv !== null && lv !== '' && fin(+lv) ? +lv : null, factor: fin(+costs.dataset.factor) && +costs.dataset.factor > 0 ? +costs.dataset.factor : null,
        max: fin(+costs.dataset.max) && +costs.dataset.max > 0 ? +costs.dataset.max : null, cost: found ? out : null };
    }
    readDomCost(el) {
      const out = { metal: 0, crystal: 0, deuterium: 0, energy: 0 };
      let found = 0;
      for (const li of OGX.dom.$$('.costs li.resource[data-value]', el)) {
        for (const k of ALL) {
          if (!li.classList.contains(k)) continue;
          const v = parseFloat(li.dataset.value);
          if (fin(v)) { out[k] = v; found++; }
        }
      }
      return found ? out : null;
    }
    async rememberVerified(id, level, cost) {
      this.verified[id] = { level, cost, t: now() };
      const keys = Object.keys(this.verified);
      if (keys.length > VERIFIED_MAX) {
        keys.sort((a, b) => (this.verified[a].t || 0) - (this.verified[b].t || 0));
        for (const k of keys.slice(0, keys.length - VERIFIED_MAX)) delete this.verified[k];
      }
      try { await this.ctx.store.set('verified', { v: 1, items: this.verified }); } catch (e) { this.ctx.log.warn('store write failed', e); }
    }
    async forgetVerified(id) {
      if (!this.verified[id]) return;
      delete this.verified[id];
      try { await this.ctx.store.set('verified', { v: 1, items: this.verified }); } catch (e) { this.ctx.log.warn('store write failed', e); }
    }

    _attach(el) {
      const ctx = this.ctx;
      if (!el || !el.isConnected) return { skipped: 'detached' };
      if (!ctx.settings.get('showOverlay')) return { skipped: 'off' };
      for (const x of el.querySelectorAll('.' + P + 'ov, .' + P + 'total')) x.remove();
      const id = this.detailsId(el);
      if (!id || !OGX.catalog.get(id)) {
        OGX.learn.value('techcost.detailsId', NaN);   // markup drift: no button.upgrade/downgrade[data-technology]
        this.ov = null;
        return { skipped: 'no id' };
      }
      const gzc = this.readGzCosts(el);
      const lvEl = OGX.dom.$('.information > span.level[data-value], .information > span.amount[data-value]', el);
      const isUnit = (lvEl && lvEl.classList.contains('amount')) || isUnitId(id);
      let nextLevel = lvEl ? +lvEl.dataset.value : null;   // current + 1 (object.blade.php:33-40)
      let curLevel = null;
      // GALAXYZ: the panel markup is UNVERIFIED (base.js reads .costs[data-level] as the CURRENT level). Its numbers are
      // trusted only when that level agrees with the REAL list item; otherwise the list level and the local formula.
      let gzTrusted = !!gzc;
      if (nextLevel === null && !isUnit) {
        const li = this.listItems().find((x) => +x.dataset.technology === id);
        const listLv = li ? itemLevel(li).level : NaN;
        if (gzc && gzc.level !== null && (!fin(listLv) || listLv === gzc.level)) curLevel = gzc.level;
        else {
          if (gzc && gzc.level !== null) {
            gzTrusted = false;
            OGX.learn.value('techcost.gzPanelLevel', NaN);   // panel level != list level: markup meaning differs
            ctx.log.info('details panel level differs from the list', id, gzc.level, listLv);
          }
          if (fin(listLv)) curLevel = listLv;
        }
        if (curLevel !== null) nextLevel = curLevel + 1;
      } else if (nextLevel !== null) curLevel = nextLevel - 1;
      if (nextLevel !== null) OGX.learn.value('techcost.detailsLevel', nextLevel, { min: 0, int: true });

      // cost per piece / of the next level: DOM first, local formula as check and fallback
      let local = null;
      if (priceKnown(id)) {
        try { local = isUnit ? OGX.calc.cost(id) : (nextLevel ? OGX.calc.cost(id, nextLevel) : null); } catch (e) { local = null; }
      }
      const dom = this.readDomCost(el) || (gzTrusted && gzc && gzc.cost) || null;
      let base = dom || local;
      if (!base) {
        this.ov = null;
        if (!priceKnown(id)) {
          // fork-only element without a known price and no price in the panel: say so instead of wrong numbers
          el.appendChild(h('div', { class: [P + 'ov', P + 'flow', 'ogx-root'], dataset: { id: String(id) } },
            h('div', { class: P + 'head' }, h('span', { class: P + 'title' }, 'Стоимость неизвестна')),
            h('div', { class: P + 'muted' }, 'Цена этого здания есть только у сервера; расчёт недоступен.')));
          return { skipped: 'price unknown' };
        }
        return { skipped: 'no cost' };
      }
      OGX.learn.check('techcost.detailsCost', base);
      // remember a server price only from the verified OgameX panel or a GALAXYZ building/research panel whose level matched
      if (dom && local && !(gzc && isUnit)) {
        const lvl = isUnit ? 0 : nextLevel;
        if (!sameCost(dom, local)) {
          OGX.log.rec('B', NAME, 'cost-mismatch', { id, level: lvl, dom, local });
          ctx.log.info('server cost differs from the local formula', id, lvl, dom, local);
          this.rememberVerified(id, lvl, dom).then(() => { if (ctx.settings.get('showBadges')) this.renderBadges(); });
        } else if (this.verified[id]) {
          this.forgetVerified(id);
        }
      }

      const gzPanel = !!(gzc && !el.querySelector('.costs li.resource[data-value]'));
      // OgameX #build_amount (units); GALAXYZ #b_input_<id> / input.upgrade-input = amount (units) or target level (buildings)
      const amountInput = isUnit ? (el.querySelector('#build_amount') || el.querySelector('#b_input_' + id) || el.querySelector('input.upgrade-input')) : null;
      const targetInput = !isUnit && gzPanel ? (el.querySelector('#b_input_' + id) || el.querySelector('input.upgrade-input')) : null;
      const maxAmount = amountInput ? +amountInput.getAttribute('max') || 0 : 0;

      // total li next to the game's cost icons (OL: li.resource.total); GALAXYZ: the Σ row of our table only
      const ul = gzPanel ? null : OGX.dom.$('.costs ul', el);
      let totalLi = null;
      if (ul) {
        totalLi = h('li', { class: [P + 'total'] }, h('span', { class: P + 'total-sym' }, 'Σ'), h('span', { class: P + 'total-val' }, ''));
        ul.appendChild(totalLi);
      }

      const rows = {};
      const tbody = h('tbody');
      for (const k of ALL) {
        if (!(base[k] > 0)) continue;
        const r = {
          tr: h('tr', { class: P + 'row-' + k },
            h('td', { class: P + 'res', title: NAME_RU[k] }, LBL[k]),
            h('td', { class: P + 'diff' }),
            h('td', { class: P + 'ships' })),
        };
        r.diff = r.tr.children[1];
        r.ships = r.tr.children[2];
        rows[k] = r;
        tbody.appendChild(r.tr);
      }
      const totalTr = h('tr', { class: P + 'row-total' }, h('td', { class: P + 'res', title: 'Не хватает всего' }, 'Σ'), h('td', { class: P + 'diff' }), h('td', { class: P + 'ships' }));
      tbody.appendChild(totalTr);
      const head = h('div', { class: P + 'head' },
        h('span', { class: P + 'title' }, isUnit ? 'Стоимость' : 'Стоимость ур. ' + (nextLevel || '?')),
        h('span', { class: P + 'mult' }),
        h('button', {
          type: 'button', class: P + 'toggle', 'data-ogx-act': 'toggle',
          title: 'Свернуть/развернуть расчёт',
          onClick: (ev) => { this.toggleCollapsed(); if (ev) ev.preventDefault(); },
        }, ''));
      const body = h('div', { class: P + 'body' },
        h('table', { class: P + 'tbl' }, tbody),
        h('div', { class: P + 'need' }),
        h('div', { class: P + 'eta' }),
        isUnit ? h('div', { class: P + 'afford' }) : null);
      const box = h('div', { class: [P + 'ov', gzPanel && P + 'flow', 'ogx-root'], dataset: { id: String(id) } }, head, body);
      const after = gzPanel ? (el.querySelector('.costs') || null) : null;
      if (after) after.insertAdjacentElement('afterend', box); else el.appendChild(box);

      this.ov = {
        el, id, isUnit, nextLevel, curLevel, base, amountInput, targetInput, factor: gzTrusted && gzc ? gzc.factor : null, maxLevel: gzc ? gzc.max : null, maxAmount, box, rows, totalLi,
        totalTr: { diff: totalTr.children[1], ships: totalTr.children[2] },
        mult: head.querySelector('.' + P + 'mult'), toggleBtn: head.querySelector('.' + P + 'toggle'),
        need: body.querySelector('.' + P + 'need'), eta: body.querySelector('.' + P + 'eta'), afford: body.querySelector('.' + P + 'afford'),
        amount: null,
      };
      for (const inp of [amountInput, targetInput]) {
        if (inp) for (const type of ['input', 'keyup', 'change']) this.offs.push(ctx.on(inp, type, () => this.update()));
      }
      this.applyCollapsed();
      this.update();
      return { id, isUnit, level: nextLevel, src: dom ? 'dom' : 'calc' };
    }

    /** GALAXYZ target level input (buildings/research): cost of levels cur+1..target like the fork's base.js sumGeometric. */
    readTarget() {
      const o = this.ov;
      if (!o || !o.targetInput || o.curLevel === null) return null;
      let tgt = parseInt(String(o.targetInput.value || ''), 10);
      if (!fin(tgt)) tgt = o.curLevel + 1;
      tgt = Math.max(tgt, o.curLevel + 1);
      if (o.maxLevel) tgt = Math.min(tgt, o.maxLevel);
      return tgt;
    }
    targetCost(tgt) {
      const o = this.ov;
      const steps = tgt - o.curLevel;
      if (steps <= 1) return o.base;
      const f = o.factor || (OGX.catalog.get(o.id) && OGX.catalog.get(o.id).price && OGX.catalog.get(o.id).price.factor) || 1;
      const out = {};
      for (const k of ALL) {
        let sum = 0;
        for (let i = 0; i < steps; i++) sum += Math.floor((o.base[k] || 0) * Math.pow(f, i));
        out[k] = sum;
      }
      return out;
    }

    readAmount() {
      const o = this.ov;
      if (!o || !o.isUnit || !o.amountInput) return 1;
      const raw = String(o.amountInput.value || '').replace(/[^\d]/g, '');
      let n = raw ? parseInt(raw, 10) : 1;     // game: `$('#build_amount').val() || 1`
      if (!fin(n) || n < 1) n = 1;
      if (n > 1e9) n = 1e9;
      return n;
    }

    _toggleCollapsed() {
      this.ui = { v: 1, collapsed: !this.ui.collapsed };
      this.applyCollapsed();
      this.ctx.store.set('ui', this.ui).catch((e) => this.ctx.log.warn('store write failed', e));
      return { collapsed: this.ui.collapsed };
    }
    applyCollapsed() {
      const o = this.ov;
      if (!o) return;
      toggle(o.box, P + 'collapsed', this.ui.collapsed);
      setText(o.toggleBtn, this.ui.collapsed ? '▸' : '▾');
    }

    updateOverlay(res, t) {
      const o = this.ov;
      if (!o) return;
      if (!o.box.isConnected) { this.ov = null; return; }
      const n = this.readAmount();
      if (n !== o.amount) {
        o.amount = n;
        if (n !== 1 || o.isUnit) OGX.learn.value('techcost.amount', n, { min: 1, int: true });
      }
      const tgt = this.readTarget();
      setText(o.mult, o.isUnit ? '×' + OGX.fmt.num(n) : tgt && tgt > o.nextLevel ? 'до ур. ' + tgt : '');
      const cost = tgt && tgt > o.nextLevel ? this.targetCost(tgt) : mul(o.base, n);
      const total = RES.reduce((s, k) => s + cost[k], 0);
      if (o.totalLi) {
        setText(o.totalLi.lastChild, compact(total));
        setTitle(o.totalLi, 'Всего: ' + OGX.fmt.num(total) + (o.isUnit && n > 1 ? ' (за ' + OGX.fmt.num(n) + ' шт.)' : ''));
      }
      if (!res) {
        for (const k of Object.keys(o.rows)) { setText(o.rows[k].diff, OGX.fmt.num(cost[k])); setText(o.rows[k].ships, ''); }
        setText(o.totalTr.diff, OGX.fmt.num(total));
        setText(o.totalTr.ships, '');
        setText(o.need, '');
        setText(o.eta, 'Запасы планеты неизвестны');
        return;
      }
      const caps = this.caps();
      const ov = OGX.calc.costOverlay(cost, res, t, caps);
      for (const k of RES) {
        const r = o.rows[k];
        if (!r) continue;
        const row = ov.rows[k];
        const short = row.diff < 0;
        setText(r.diff, (short ? '−' : '+') + OGX.fmt.num(Math.floor(Math.abs(row.diff))));
        toggle(r.tr, P + 'bad', short);
        toggle(r.tr, P + 'ok', !short);
        setText(r.ships, short ? this.shipsText(row.sc) : '');
        setTitle(r.tr, NAME_RU[k] + ': нужно ' + OGX.fmt.num(row.need) + ', есть ' + OGX.fmt.num(Math.floor(row.have)) +
          (short ? ', не хватает ' + OGX.fmt.num(Math.ceil(-row.diff)) : ', останется ' + OGX.fmt.num(Math.floor(row.diff))));
      }
      if (o.rows.energy) {
        const avail = this.energyAvailable();
        const r = o.rows.energy;
        if (avail === null) { setText(r.diff, OGX.fmt.num(cost.energy)); toggle(r.tr, P + 'bad', false); }
        else {
          const d = avail - cost.energy;
          setText(r.diff, (d < 0 ? '−' : '+') + OGX.fmt.num(Math.abs(d)));
          toggle(r.tr, P + 'bad', d < 0);
          toggle(r.tr, P + 'ok', d >= 0);
          setTitle(r.tr, 'Энергия: нужно ' + OGX.fmt.num(cost.energy) + ', доступно ' + OGX.fmt.num(avail));
        }
      }
      const missing = Math.ceil(ov.missingTotal);
      OGX.learn.value('techcost.missing', missing, { min: 0 });
      setText(o.totalTr.diff, missing > 0 ? '−' + OGX.fmt.num(missing) : OGX.fmt.num(total));
      setTitle(o.totalTr.diff.parentNode, 'Всего: ' + OGX.fmt.num(total) + (missing > 0 ? ', не хватает ' + OGX.fmt.num(missing) : ''));
      toggle(o.totalTr.diff.parentNode, P + 'bad', missing > 0);
      setText(o.totalTr.ships, missing > 0 ? this.shipsText(ov.sc) : '');
      setText(o.need, 'Всего ' + OGX.fmt.num(total));

      // time until affordable
      let eta;
      let etaCls = 'ok';
      if (missing <= 0) eta = 'Ресурсов достаточно';
      else {
        const s = ov.secondsUntilAffordable;
        if (fin(s)) {
          eta = 'Будет доступно через ' + OGX.fmt.duration(Math.ceil(s)) + ' (в ' + when(t + Math.ceil(s) * 1000) + ')';
          etaCls = 'warn';
        } else {
          etaCls = 'bad';
          const why = [];
          for (const k of RES) {
            if (!(ov.rows[k].diff < 0)) continue;
            const r = res[k];
            if (!(r.perHour > 0)) why.push('нет выработки ' + NAME_GEN[k]);
            else if (r.storage !== undefined && r.storage !== null && cost[k] > +r.storage) why.push('мало места в хранилище ' + NAME_GEN[k]);
          }
          eta = 'Не накопится: ' + (why.join(', ') || 'нет выработки');
        }
      }
      setText(o.eta, eta);
      for (const c of ['ok', 'warn', 'bad']) toggle(o.eta, P + c, c === etaCls);
      if (o.afford) {
        let can = Infinity;
        for (const k of RES) if (o.base[k] > 0) can = Math.min(can, Math.floor(res[k].amount / o.base[k]));
        if (fin(can) && can > 1e9) can = 1e9;
        if (!fin(can)) can = 0;
        setText(o.afford, 'Хватает сейчас на ' + OGX.fmt.num(can) + ' шт.' + (o.maxAmount ? ' (макс. ' + OGX.fmt.num(o.maxAmount) + ')' : ''));
      }
    }

    update() {
      const t = now();
      const res = this.resNow(t);
      if (this.items.length) this.updateBadges(res);
      if (this.ov) this.updateOverlay(res, t);
    }
  }

  const CSS = `
.${P}badge { position: absolute; left: 1px; bottom: 16px; z-index: 2; /* above the game's .level bar (bottom:0, 15px) */ display: flex; flex-direction: column; align-items: flex-start;
  padding: 1px 3px; background: rgba(0, 0, 0, .72); border-radius: 2px; font: 9px/10px Verdana, Arial, sans-serif; color: #cfd8e3;
  pointer-events: auto; max-width: calc(100% - 4px); white-space: nowrap; overflow: hidden; text-align: left; }
.${P}bl { display: block; }
.${P}bl-metal { color: #a9b5c4; } .${P}bl-crystal { color: #79c2e8; } .${P}bl-deuterium { color: #7fe0b4; } .${P}bl-energy { color: #f2d04d; }
.${P}bl.${P}bad { color: #f44336; font-weight: bold; }
.${P}badge.${P}short { box-shadow: inset 0 0 0 1px rgba(244, 67, 54, .6); }
.sprite_small .${P}badge, .small .${P}badge { font-size: 8px; line-height: 9px; }
#technologydetails .costs ul li.${P}total { display: inline-block; vertical-align: top; width: 52px; height: 48px; margin: 0 3px; text-align: center; color: #fff; }
.${P}total-sym { display: block; font: bold 20px/32px Verdana, Arial, sans-serif; color: #6f9fd8; margin-bottom: 2px; }
.${P}ov { position: absolute; left: 1px; bottom: 101px; width: 198px; z-index: 3; box-sizing: border-box; padding: 3px 4px;
  background: rgba(13, 16, 20, .88); border-top: 1px solid #2b3846; color: #cfd8e3; font: 10px/12px Verdana, Arial, sans-serif; text-align: left; }
.${P}head { display: flex; align-items: center; gap: 4px; color: #6f9fd8; font-weight: bold; }
.${P}title { flex: 1 1 auto; }
.${P}mult { color: #ff9600; }
.${P}toggle { background: none; border: 0; color: #cfd8e3; cursor: pointer; padding: 0 2px; font-size: 10px; line-height: 12px; }
.${P}collapsed .${P}body { display: none; }
.${P}tbl { width: 100%; border-collapse: collapse; margin-top: 2px; }
.${P}tbl td { padding: 0 2px; white-space: nowrap; }
.${P}res { width: 12px; font-weight: bold; }
.${P}diff { text-align: right; }
.${P}ships { text-align: right; color: #9aa7b5; font-size: 9px; }
.${P}row-metal .${P}res { color: #a9b5c4; } .${P}row-crystal .${P}res { color: #79c2e8; } .${P}row-deuterium .${P}res { color: #7fe0b4; } .${P}row-energy .${P}res { color: #f2d04d; }
.${P}tbl tr.${P}ok .${P}diff { color: #4caf50; } .${P}tbl tr.${P}bad .${P}diff { color: #f44336; }
.${P}row-total td { border-top: 1px solid #2b3846; }
.${P}need { color: #9aa7b5; margin-top: 1px; }
.${P}eta { margin-top: 1px; white-space: normal; }
.${P}eta.${P}ok { color: #4caf50; } .${P}eta.${P}warn { color: #ff9800; } .${P}eta.${P}bad { color: #f44336; }
.${P}afford { color: #9aa7b5; }
.${P}ov.${P}flow { position: static; left: auto; bottom: auto; width: auto; max-width: 320px; margin: 4px 0; border: 1px solid #2b3846; border-radius: 3px; }
.${P}muted { color: #8593a3; }
.${P}badge.${P}unknown { color: #8593a3; font-style: italic; }
`;
})(window.OGX);
