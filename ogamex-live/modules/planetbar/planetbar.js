/* ogamex-live/modules/planetbar/planetbar.js — Owner: live/planetbar.
 * Production overlay in the planet list (DESIGN §4.1.2, OL rows 1-6, 9, 10, 11):
 *   M/C/D fill bars with the live projected stock, +X/ч or +X/сут, 90%/100% warnings, time until full,
 *   energy bar + fusion warning, Σ, needed vs owned transporters (217), build timer, stationed-ships bar,
 *   planets/moons switcher, "raider" style and a one-line compact variant.
 *
 * OgameX markup used (src/OGameX/resources/views/ingame/layouts/main.blade.php):
 *   #planetList > div.smallplanet[data-planet-id]          main:1737-1738 (id is planet-<index>, not the planet id)
 *   .smallplanet.smaller / #cutty #myPlanets (>= 6 planets) main:1720-1723
 *   a.planetlink, a.moonlink[href*="cp=<moonId>"]           main:1739, 1793 (the moon id exists only in the moonlink URL)
 *   a.constructionIcon (planets only, empty title)          main:1774-1785
 *   #countColonies                                          main:1724
 * GALAXYZ markup (real saved pages, specs/galaxyz/layout.md):
 *   #rechts #myWorlds > #countColonies "[4 / 6] My planets" (fixed height: the switcher goes AFTER it, not inside)
 *   one #planetList per planet (duplicated id) > .smallplanet > a.planetlink[href*="cp=<planetId>"] (no data-planet-id);
 *   the column is only ~137 px wide and the window edge is close, so the overlay is placed in the flow under each row
 *   (class inflow) instead of beside it. Rows are read through OGX.dom.planetRows() (both engines).
 *   No a.moonlink was ever seen (account without moon): the moon of a row is found through the stored planet's moonKey
 *   (#planetSelector lists moons). span.planet-koords > i.buildingIco = "something is being built" without an end time:
 *   the queue with its end time is known only from the overview/buildings page of that planet.
 *   The stationed-ships bar goes inside the overlay (a bar on a.planetlink would cross the coordinates text).
 * All numbers come from OGX.state (bodies, shipStats) and the stored flights; this module issues no requests.
 */
(function (OGX) {
  'use strict';

  const NAME = 'planetbar';
  const P = 'ogx-l-planetbar-';
  const RES = ['metal', 'crystal', 'deuterium'];
  const RES_LABEL = { metal: 'М', crystal: 'К', deuterium: 'Д' };
  const RES_NAME = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий' };
  const MINE = { metal: 1, crystal: 2, deuterium: 3 };   // production percent source (resources/settings select[name="last<id>"])
  const FUSION = 12;
  const TS = OGX.catalog.transportShip || 217;   // every transport count is in Battle Transporters (player decision)

  OGX.module({
    name: NAME,
    title: 'Производство на планетах',
    pages: '*',
    settings: {
      gameStyle: { type: 'enum', default: 'miner', label: 'Стиль отображения', options: [{ value: 'miner', label: 'Шахтёр (всё)' }, { value: 'raider', label: 'Рейдер (только запасы)' }] },
      prodDisplay: { type: 'enum', default: 'hour', label: 'Показывать выработку', options: [{ value: 'hour', label: 'в час' }, { value: 'day', label: 'в сутки' }] },
      showEnergy: { type: 'bool', default: true, label: 'Показывать энергию' },
      showSum: { type: 'bool', default: true, label: 'Показывать сумму ресурсов (Σ)' },
      roundNumbers: { type: 'bool', default: false, label: 'Сокращать числа (тыс., млн)' },
      showNeededTransporters: { type: 'bool', default: true, label: 'Показывать нужные Ул. трансп.' },
      showStationedShips: { type: 'bool', default: true, label: 'Полоса кораблей на планете' },
      autoMoonView: { type: 'bool', default: true, label: 'Показывать луны, когда открыта луна' },
      view: { type: 'enum', default: 'planets', label: 'Вид', hidden: true, options: [{ value: 'planets', label: 'Планеты' }, { value: 'moons', label: 'Луны' }] },
    },

    async init(ctx) {
      const list = OGX.dom.planetListEnd();
      if (!list) { ctx.log.debug('no #planetList, nothing to do'); return; }
      ctx.css(CSS);
      const pb = new PlanetBar(ctx, list);
      ctx._pb = pb;
      await pb.start();
    },

    dispose(ctx) {
      if (ctx._pb) ctx._pb.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const now = () => OGX.time.serverNow();
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  /** A stored number, or null when unknown (null/undefined/'' would be 0 with a plain +v). GALAXYZ page=imperium stores
   * the stock of a body without its storage and production (res.src 'imperium'). */
  const known = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);

  /** Fill class of a stock: 90% warn, 100% bad (same rule as the game's resource bar, layout.md §6.1). */
  function fillClass(amount, storage) {
    if (!(storage > 0)) return amount > 0 ? 'bad' : 'ok';
    if (amount >= storage) return 'bad';
    if (amount >= 0.9 * storage) return 'warn';
    return 'ok';
  }
  function setCls(el, base, cls) {
    if (!el) return;
    const want = base + ' ' + P + cls;
    if (el.className !== want) el.className = want;
  }
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function setTitle(el, t) { if (el && el.getAttribute('title') !== t) el.setAttribute('title', t); }
  function setWidth(el, f) {
    if (!el) return;
    const w = (Math.max(0, Math.min(1, fin(f) ? f : 0)) * 100).toFixed(1);
    if (el.dataset.w !== w) { el.dataset.w = w; el.style.width = w + '%'; }
  }
  function shipsTotal(ships) {
    if (!ships) return 0;
    let n = 0;
    for (const id of OGX.catalog.fleetShipIds) n += +ships[id] || 0;   // 212 (satellites) excluded (OL §4.11)
    return n;
  }

  // ------------------------------------------------------------------ main class
  class PlanetBar {
    constructor(ctx, list) {
      this.ctx = ctx;
      this.list = list;
      this.bodies = {};
      this.flights = null;
      this.stats = {};
      this.parts = [];            // [{ key, isMoon, refs }]
      this.shipBars = [];
      this.viewOverride = null;   // click on the switcher wins over autoMoonView for this page
      this.offs = [];
      this.renderSoon = OGX.util.debounce(() => this.render('update'), 150);
      // B events: every full render and every view switch is journaled (timed, errors with stack).
      this.render = OGX.log.wrap(NAME, this._render.bind(this), 'render');
      this.setView = OGX.log.wrap(NAME, this._setView.bind(this), 'setView');
    }

    S(key) { return this.ctx.settings.get(key); }
    num(n) { return this.S('roundNumbers') || this.inflow ? OGX.fmt.short(n) : OGX.fmt.num(n); }
    /** Every #planetList (GALAXYZ: one per planet); view classes go on all of them. */
    lists() { const all = OGX.dom.planetLists(); return all.length ? all : [this.list]; }

    async start() {
      const ctx = this.ctx;
      this.compact = !!(OGX.dom.$('#cutty') || OGX.dom.$('#planetList > .smallplanet.smaller'));
      // GALAXYZ: no room beside the narrow right column -> overlay in the flow under each planet row
      this.inflow = !!(OGX.page.isGz && OGX.page.isGz());
      // The game CSS gives every div z-index 1, so #planetbarcomponent (position: relative) is a stacking context that the
      // later #bannerSkyscrapercomponent covers. Our own class lifts it above the banner (no global restyle).
      this.host = OGX.dom.$('#planetbarcomponent');
      if (this.host) this.host.classList.add(P + 'host');
      this.buildSwitcher();
      this.applyView();
      await this.render('init');
      this.offs.push(ctx.bus.on('state:updated', (e) => {
        const keys = (e && e.keys) || [];
        if (keys.some((k) => k === 'bodies' || k === 'shipStats' || k === 'research' || k === 'player')) this.renderSoon();
      }));
      this.offs.push(ctx.bus.on('flights:updated', (e) => {
        if (e && Array.isArray(e.flights)) this.flights = e.flights;
        this.renderSoon();
      }));
      this.offs.push(ctx.settings.onChange((key) => {
        if (key === 'view' || key === 'autoMoonView') this.applyView();
        if (key !== 'view') this.renderSoon();
      }));
      // Another tab merged new data (e.g. /fleet of another planet): pick it up.
      this.offs.push(OGX.storage.subscribe('bodies', (v, info) => { if (info && info.remote) this.renderSoon(); }));
      ctx.every(0, (t) => this.tick(t));
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* gone */ } }
      this.offs = [];
      if (this.renderSoon.cancel) this.renderSoon.cancel();
      if (this.host) this.host.classList.remove(P + 'host');
      for (const l of this.lists()) l.classList.remove(P + 'moons');
      if (this.switchEl) this.switchEl.remove();
    }

    async load() {
      this.bodies = (await OGX.state.bodies()) || {};
      const fl = await OGX.flights.cached();   // core: stored list, no request
      if (fl && Array.isArray(fl.flights)) this.flights = fl.flights;
      try { this.stats = (await OGX.state.shipStats()) || {}; } catch (e) { this.stats = {}; this.ctx.log.warn('shipStats failed', e); }
      const c = this.stats[TS] && this.stats[TS].cargo;
      if (c !== undefined) OGX.learn.value('planetbar.cargo' + TS, c, { min: 1 });
    }

    // ---------------------------------------------------------------- view switcher (OL row 11)
    buildSwitcher() {
      const host = OGX.dom.$('#countColonies');
      if (!host) return;
      for (const old of document.querySelectorAll('.' + P + 'switch')) old.remove();
      const mk = (view, label) => h('button', {
        type: 'button', class: P + 'switch-btn', title: label === 'Планеты' ? 'Показать производство планет' : 'Показать запасы лун',
        dataset: { ogxAct: 'planetbar:view-' + view, view }, onClick: () => this.setView(view),
      }, label);
      this.switchEl = h('div', { class: P + 'switch', hidden: true }, mk('planets', 'Планеты'), mk('moons', 'Луны'));
      // after #countColonies, never inside: GALAXYZ gives it a fixed height and the tabs covered the first planet name.
      // Hidden until a moon is known (render), so accounts without moons see no empty «Луны» view.
      host.insertAdjacentElement('afterend', this.switchEl);
    }
    effectiveView() {
      if (this.viewOverride) return this.viewOverride;
      const cur = OGX.state.current();
      if (this.S('autoMoonView') && cur && cur.isMoon) return 'moons';
      return this.S('view') === 'moons' ? 'moons' : 'planets';
    }
    async _setView(view) {
      this.viewOverride = view;
      this.applyView();
      await this.ctx.settings.set('view', view);
      return view;
    }
    applyView() {
      const v = this.effectiveView();
      for (const l of this.lists()) l.classList.toggle(P + 'moons', v === 'moons');
      if (this.switchEl) for (const b of this.switchEl.children) b.classList.toggle(P + 'on', b.dataset.view === v);
    }

    // ---------------------------------------------------------------- full render
    async _render(reason) {
      await this.load();
      const rows = OGX.dom.planetRows();
      if (!rows.length) { this.ctx.log.warn('#planetList has no .smallplanet rows'); return { rows: 0 }; }
      // remove what a previous render injected (exactly one overlay per row; GALAXYZ rows live in several #planetList)
      for (const el of document.querySelectorAll('.' + P + 'prod, .' + P + 'ships')) el.remove();
      this.parts = [];
      this.shipBars = [];
      const raider = this.S('gameStyle') === 'raider';
      const t = now();

      // stationed ships: width relative to the largest known body
      let maxShips = 0;
      for (const b of Object.values(this.bodies)) if (b && b.shipsT) maxShips = Math.max(maxShips, shipsTotal(b.ships));

      let drawn = 0, noId = 0;
      for (const { row, link, planetId: pid, moonLink: moonA, moonId: mid } of rows) {
        if (!(pid > 0)) { noId++; continue; }
        const planet = this.bodies['p' + pid] || null;
        // GALAXYZ: no a.moonlink in the list (not seen live) -> the moon known from #planetSelector via planet.moonKey
        const mkey = mid ? 'm' + mid : (planet && planet.moonKey && this.bodies[planet.moonKey] ? planet.moonKey : null);
        const moon = mkey ? this.bodies[mkey] || null : null;
        if (moonA && !mid) OGX.learn.value('planetbar.moonId', NaN);

        const box = h('div', { class: [P + 'prod', this.compact && P + 'compact', raider && P + 'raider', this.inflow && P + 'inflow'], dataset: { planetId: pid, moonId: mkey ? mkey.slice(1) : null } });
        const planetPart = this.buildPart(planet, false, 'p' + pid, raider, t);
        box.appendChild(planetPart);
        const moonPart = mkey ? this.buildPart(moon, true, mkey, raider, t) : h('div', { class: [P + 'part', P + 'moon', P + 'nomoon'] }, h('span', { class: P + 'muted' }, 'нет луны'));
        box.appendChild(moonPart);
        if (this.inflow) row.insertAdjacentElement('afterend', box); else row.appendChild(box);
        drawn++;

        if (this.S('showStationedShips')) {
          // OgameX: a thin bar at the bottom of the planet/moon link; GALAXYZ (inflow): inside the overlay part
          this.addShipBar(this.inflow ? planetPart : link, planet, maxShips, false);
          if (moonA || (this.inflow && mkey)) this.addShipBar(this.inflow ? moonPart : moonA, moon, maxShips, true);
        }
      }
      if (noId) {
        OGX.learn.value('planetbar.rowPlanetId', NaN);   // markup changed: neither data-planet-id nor a cp= link
        this.ctx.log.warn('planet rows without a planet id (data-planet-id or a.planetlink cp=):', noId);
      }
      if (this.switchEl) {
        const hasMoon = rows.some((r) => r.moonId) || Object.values(this.bodies).some((b) => b && b.type === 'moon');
        this.switchEl.hidden = !hasMoon;
      }
      this.tick(t);
      return { reason, rows: rows.length, drawn, compact: this.compact, raider, inflow: this.inflow };
    }

    addShipBar(link, body, maxShips, isMoon) {
      if (!link || !body || !body.shipsT) return;
      const n = shipsTotal(body.ships);
      OGX.learn.value('planetbar.shipsTotal', n, { min: 0, int: true });
      const f = maxShips > 0 ? n / maxShips : 0;
      const cls = f > 0.75 ? 'bad' : f > 0.5 ? 'warn' : 'ok';
      const fill = h('span', { class: [P + 'ships-fill', P + cls], style: { width: (f * 100).toFixed(1) + '%', minWidth: n > 0 ? '8px' : '0' } });
      const bar = h('span', {
        class: [P + 'ships', this.inflow ? P + 'ships-inflow' : isMoon ? P + 'ships-moon' : P + 'ships-planet'],
        title: 'Кораблей на ' + (isMoon ? 'луне' : 'планете') + ': ' + OGX.fmt.num(n) + ' (без спутников и гусеничников), данные ' + OGX.fmt.ago(body.shipsT),
        dataset: { ships: n },
      }, fill);
      link.appendChild(bar);
      this.shipBars.push(bar);
    }

    /** One body part (planet or moon). Static structure; values are filled by tick(). */
    buildPart(body, isMoon, key, raider, t) {
      const part = h('div', { class: [P + 'part', isMoon ? P + 'moon' : P + 'planet'], dataset: { key } });
      if (!body || !body.res) {
        const where = OGX.suite ? 'OgameX Suite → Live → «Обновить данные всех планет»' : 'меню OgameX Live → «Обновить данные всех планет»';
        const empire = this.inflow ? ', страницу Empire' : '';
        part.appendChild(h('span', { class: P + 'muted', title: 'Данных о ресурсах ещё нет: откройте ' + (isMoon ? 'эту луну' : 'эту планету') + empire + ' или нажмите ' + where },
          isMoon ? 'луна: нет данных' : 'нет данных'));
        if (!raider) this.buildTimer(part, body, isMoon, t);
        return part;
      }
      // sanity checks on stored values (raise L 'implausible' alerts)
      OGX.learn.check('planetbar.res.' + (isMoon ? 'moon' : 'planet'), { metal: body.res.metal, crystal: body.res.crystal, deuterium: body.res.deuterium });
      for (const r of RES) if (body.res[r] && known(body.res[r].storage) !== null) OGX.learn.value('planetbar.storage', +body.res[r].storage, { min: 1 });

      const refs = { res: {}, body };
      const compact = this.compact;
      const miner = !raider;
      if (compact) {
        const line = h('div', { class: [P + 'line', P + 'oneline'] });
        for (const r of RES) {
          const fill = h('span', { class: P + 'fill' });
          const val = h('span', { class: P + 'val' });
          const stock = h('span', { class: [P + 'stock', P + 'r-' + r] }, fill, val);
          line.appendChild(stock);
          refs.res[r] = { stock, fill, val, rate: null };
        }
        if (miner) {
          refs.timerSlot = h('span', { class: P + 'ctimer' });
          line.appendChild(refs.timerSlot);
        }
        part.appendChild(line);
        refs.partTitle = part;
      } else {
        for (const r of RES) {
          const fill = h('span', { class: P + 'fill' });
          const val = h('span', { class: P + 'val' });
          const stock = h('span', { class: [P + 'stock', P + 'r-' + r] }, fill, val);
          const rate = miner && !isMoon ? h('span', { class: P + 'rate' }) : null;
          part.appendChild(h('div', { class: [P + 'line', P + 'res'], dataset: { res: r } },
            h('span', { class: [P + 'lbl', P + 'r-' + r] }, RES_LABEL[r]), stock, rate));
          refs.res[r] = { stock, fill, val, rate };
        }
      }

      if (miner && !compact) {
        // energy (planets; moons only if they somehow produce)
        const e = body.energy;
        if (this.S('showEnergy') && e && (!isMoon || +e.production > 0)) {
          OGX.learn.check('planetbar.energy', { production: e.production, consumption: e.consumption, available: e.available });
          const fill = h('span', { class: P + 'fill' });
          const val = h('span', { class: P + 'val' });
          const stock = h('span', { class: [P + 'stock', P + 'energy'] }, fill, val);
          const line = h('div', { class: [P + 'line', P + 'eline'] }, h('span', { class: [P + 'lbl', P + 'r-energy'] }, 'Э'), stock);
          const prod = known(e.production) || 0;
          const kc = known(e.consumption);
          const ka = known(e.available);
          if (kc === null && ka === null) {
            // GALAXYZ page=imperium: production only, the balance is unknown -> no fake "0"
            stock.className = P + 'stock ' + P + 'energy ' + P + 'unknown';
            setText(val, '—');
            stock.title = 'Энергия: производство ' + OGX.fmt.num(prod) + ', баланс неизвестен (откройте эту планету)';
          } else {
          const cons = kc !== null ? Math.abs(kc) : Math.max(0, prod - ka);
          const avail = ka !== null ? ka : prod - cons;
          const share = prod > 0 ? Math.min(1, cons / prod) : (cons > 0 ? 1 : 0);   // OL §5.2: share of energy consumed
          setWidth(fill, share);
          const ecls = avail < 0 ? 'bad' : (prod > 0 && avail <= 0.05 * prod) ? 'warn' : 'ok';
          stock.className = P + 'stock ' + P + 'energy ' + P + ecls;
          setText(val, OGX.fmt.signed(Math.trunc(avail)).replace(/^\+0$/, '0'));
          stock.title = 'Энергия: производство ' + OGX.fmt.num(prod) + ', потребление ' + OGX.fmt.num(cons) + ', баланс ' + OGX.fmt.signed(Math.trunc(avail)) +
            ' (использовано ' + OGX.fmt.pct(share) + ')';
          }
          // fusion warning (OL §4.11: fusion % < 100 and fusion level > 0)
          const fpct = body.percents && body.percents[FUSION];
          const flvl = body.levels && body.levels[FUSION];
          if (fin(+fpct) && fpct !== null && +fpct < 100 && +flvl > 0) {
            const fc = +fpct < 40 ? 'bad' : +fpct < 70 ? 'warn' : 'note';
            line.appendChild(h('span', { class: [P + 'fusion', P + fc], title: 'Термоядерная электростанция ' + flvl + ' работает на ' + fpct + '%: дейтерий расходуется меньше, энергии меньше' }, 'термояд ' + fpct + '%'));
          }
          part.appendChild(line);
        }
        // Σ + needed transporters (OL §5.3; counted in 217 only)
        const showSum = this.S('showSum');
        const showNeed = this.S('showNeededTransporters');
        if (showSum || showNeed) {
          refs.sum = showSum ? h('span', { class: P + 'sum' }) : null;
          refs.ts = showNeed ? h('span', { class: P + 'need', dataset: { ship: TS } }) : null;
          part.appendChild(h('div', { class: [P + 'line', P + 'sline'] }, refs.sum, refs.ts));
        }
      }
      if (miner) this.buildTimer(part, body, isMoon, t, refs);
      this.parts.push({ key, isMoon, refs, part });
      return part;
    }

    /** Build timer (OL row 9): queue from overview/resources/facilities CountdownTimer (stored by core). */
    buildTimer(part, body, isMoon, t, refs) {
      const q = body && body.queues && body.queues.building;
      const flag = !isMoon && body && body.constructionFlag;
      let node = null;
      if (q && q.endsAt > t && (isMoon || flag)) {
        const name = OGX.catalog.name(q.objectId) || ('#' + q.objectId);
        const cd = OGX.dom.countdown(q.endsAt, { doneText: 'готово', short: this.compact });
        node = h('div', { class: [P + 'line', P + 'build', q.downgrade && P + 'down'], title: (q.downgrade ? 'Снос: ' : 'Строится: ') + name + ' → ур. ' + q.targetLevel + ', завершится ' + OGX.fmt.dateTime(q.endsAt) },
          this.compact ? null : h('span', { class: P + 'bname' }, (q.downgrade ? '↓ ' : '') + name + ' ' + q.targetLevel), cd);
        OGX.learn.value('planetbar.buildLevel', +q.targetLevel, { min: 0, int: true });
      } else if (flag) {
        // wrench in the list but no (current) queue data: OgameX leaves the constructionIcon title empty (main:1774-1785);
        // GALAXYZ i.buildingIco never carries an end time
        const seen = !!(q && q.endsAt) || !this.inflow;   // OgameX: the queue comes with the page, missing = stale
        node = h('div', { class: [P + 'line', P + 'build', P + 'stale'], title: seen
          ? 'На планете идёт строительство, но известная очередь уже завершилась. Откройте обзор этой планеты.'
          : 'На планете идёт строительство (значок в списке планет). Что строится и когда закончится, видно в обзоре или на странице построек этой планеты.' },
        this.compact ? '⚒' : seen ? 'строится (данные устарели)' : 'идёт строительство');
      }
      if (!node) return;
      if (this.compact && refs && refs.timerSlot) { refs.timerSlot.appendChild(node); return; }
      part.appendChild(node);
    }

    // ---------------------------------------------------------------- per tick: texts, widths, classes only
    tick(t) {
      t = t || now();
      const perDay = this.S('prodDisplay') === 'day';
      const showNeed = this.S('showNeededTransporters');
      const cap = this.stats[TS] ? +this.stats[TS].cargo || 0 : 0;
      for (const p of this.parts) {
        const body = p.refs.body;
        let pr;
        try { pr = OGX.state.projected(body, t, { flights: this.flights || undefined }); } catch (e) { pr = OGX.state.projected(body, t); }
        if (!pr || !pr.res) continue;
        let sum = 0;
        const titleLines = [];
        for (const r of RES) {
          const ref = p.refs.res[r];
          const res = pr.res[r] || { amount: 0, storage: null, perHour: null };
          const amount = +res.amount || 0;
          const kStorage = known(res.storage);
          const kPerHour = known((body.res[r] || {}).perHour);
          const storage = kStorage || 0;
          const perHour = kPerHour || 0;
          sum += amount;
          if (kStorage === null) {
            // stock without capacity (GALAXYZ page=imperium): amount only, neutral bar
            setCls(ref.stock, P + 'stock ' + P + 'r-' + r, 'unknown');
            setWidth(ref.fill, 0);
          } else {
            setCls(ref.stock, P + 'stock ' + P + 'r-' + r, fillClass(amount, storage));
            setWidth(ref.fill, storage > 0 ? amount / storage : 0);
          }
          setText(ref.val, this.compact ? OGX.fmt.short(amount) : this.num(amount));
          // tooltip: capacity + time until full (calc.secondsUntilFull, OL §5.2)
          let full;
          const unknownWhy = ' (данные со страницы Empire: откройте эту ' + (p.isMoon ? 'луну' : 'планету') + ')';
          if (kStorage === null || kPerHour === null) full = null;
          else {
            const secs = OGX.calc.secondsUntilFull({ amount, storage, perHour, t }, t);
            if (amount >= storage && storage > 0) full = 'хранилище заполнено' + (amount > storage ? ' (сверх ёмкости на ' + this.num(amount - storage) + ')' : '');
            else if (!fin(secs)) full = 'не заполнится (нет выработки)';
            else full = 'заполнится через ' + OGX.fmt.duration(secs) + ' (' + OGX.fmt.dateTime(t + secs * 1000) + ')';
          }
          const rateTxt = kPerHour === null ? '?' + (perDay ? '/сут' : '/ч') : (perHour >= 0 ? '+' : '') + this.num(perDay ? perHour * 24 : perHour) + (perDay ? '/сут' : '/ч');
          const tip = RES_NAME[r] + ': ' + OGX.fmt.num(amount) + (kStorage === null ? '' : ' (' + OGX.fmt.pct(storage > 0 ? amount / storage : 0) + ')') +
            // one sentence per unknown: never «Ёмкость: неизвестна, ёмкость и выработка неизвестны»
            (full !== null ? '\nЁмкость: ' + OGX.fmt.num(storage) + ', ' + full
              : kStorage === null ? '\n' + (kPerHour === null ? 'Ёмкость и выработка неизвестны' : 'Ёмкость неизвестна') + unknownWhy
                : '\nЁмкость: ' + OGX.fmt.num(storage) + ', выработка неизвестна' + unknownWhy) +
            (p.isMoon || kPerHour === null ? '' : '\nВыработка: ' + (perHour >= 0 ? '+' : '') + OGX.fmt.num(perHour) + '/ч, ' + (perHour >= 0 ? '+' : '') + OGX.fmt.num(perHour * 24) + '/сут');
          setTitle(ref.stock, tip);
          titleLines.push(tip);
          if (ref.rate && kPerHour === null) {
            setText(ref.rate, rateTxt);
            setCls(ref.rate, P + 'rate', 'muted');
            setTitle(ref.rate, 'Выработка неизвестна: откройте эту планету');
          } else if (ref.rate) {
            setText(ref.rate, rateTxt);
            // rate class (OL §5.4): setting % < 70 warn, < 40 or no effective production bad
            const pct = body.percents ? body.percents[MINE[r]] : undefined;
            let rc = 'ok';
            if (perHour <= 0 || (amount >= storage && storage > 0)) rc = 'bad';
            else if (fin(+pct) && pct !== null && +pct < 40) rc = 'bad';
            else if (fin(+pct) && pct !== null && +pct < 70) rc = 'warn';
            setCls(ref.rate, P + 'rate', rc);
            setTitle(ref.rate, 'Выработка ' + (perDay ? 'в сутки' : 'в час') + (fin(+pct) && pct !== null ? ', шахта на ' + pct + '%' : '') + (rc === 'bad' && amount >= storage && storage > 0 ? ' — хранилище полно, добыча стоит' : ''));
          }
        }
        if (p.refs.sum) {
          setText(p.refs.sum, 'Σ ' + this.num(sum));
          setTitle(p.refs.sum, 'Всего ресурсов: ' + OGX.fmt.num(sum));
        }
        if (showNeed && p.refs.ts) {
          const owned = body.shipsT ? body.ships || {} : null;
          const id = TS, el = p.refs.ts;
          const need = cap > 0 ? Math.ceil(sum / cap) : null;
          const have = owned ? +owned[id] || 0 : null;
          const lbl = OGX.catalog.shortName(id);
          setText(el, lbl + ' ' + (have === null ? '?' : OGX.fmt.num(have)) + '/' + (need === null ? '?' : OGX.fmt.num(need)));
          setCls(el, P + 'need', have === null || need === null ? 'muted' : have < need ? 'bad' : 'ok');
          setTitle(el, OGX.catalog.name(id) + ': есть ' + (have === null ? 'неизвестно (откройте «Флот» на этой ' + (p.isMoon ? 'луне' : 'планете') + ')' : OGX.fmt.num(have)) +
            ', нужно ' + (need === null ? 'неизвестно' : OGX.fmt.num(need)) + ' (вместимость ' + OGX.fmt.num(cap) + ')');
        }
        if (p.refs.partTitle) setTitle(p.refs.partTitle, titleLines.join('\n') + '\nΣ ' + OGX.fmt.num(sum));
      }
    }
  }

  const CSS = `
#planetbarcomponent.${P}host { z-index: 3; }
.${P}prod { position: absolute; left: 100%; top: 2px; margin-left: 6px; width: 200px; z-index: 5; box-sizing: border-box;
  padding: 2px 4px; border: 1px solid #2b3846; border-radius: 3px; background: rgba(13,16,20,.88);
  font: 10px/12px Verdana, Arial, sans-serif; color: #cfd8e3; text-align: left; white-space: nowrap; }
.${P}prod * { box-sizing: border-box; }
.${P}prod.${P}compact { top: 50%; transform: translateY(-50%); padding: 1px 3px; }
.${P}prod.${P}inflow { position: relative; left: auto; top: auto; transform: none; width: auto; margin: 0 0 4px 5px; }
.${P}inflow .${P}stock { flex-basis: 54px; }
.${P}inflow .${P}build { height: auto; white-space: normal; }
.${P}inflow .${P}rate { font-size: 9px; }
.${P}inflow .${P}sline { flex-wrap: wrap; height: auto; column-gap: 6px; }
.${P}part { display: block; overflow: hidden; }
.${P}prod:not(.${P}raider) .${P}moon { display: none; }
#planetList.${P}moons .${P}prod:not(.${P}raider) .${P}planet { display: none; }
#planetList.${P}moons .${P}prod:not(.${P}raider) .${P}moon { display: block; }
.${P}raider { width: 196px; display: flex; gap: 4px; }
.${P}raider .${P}part { flex: 1 1 0; min-width: 0; display: block; }
.${P}raider .${P}stock { flex: 1 1 auto; }
.${P}line { display: flex; align-items: center; gap: 3px; height: 12px; margin: 0 0 1px; overflow: hidden; }
.${P}lbl { flex: 0 0 9px; font-weight: bold; }
.${P}r-metal.${P}lbl { color: #a9b5c4; } .${P}r-crystal.${P}lbl { color: #79c2e8; } .${P}r-deuterium.${P}lbl { color: #7fe0b4; } .${P}r-energy.${P}lbl { color: #f2d16b; }
.${P}stock { position: relative; flex: 0 0 82px; height: 11px; border-radius: 2px; background: #26303b; overflow: hidden; }
.${P}fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: rgba(76,175,80,.45); }
.${P}stock.${P}warn .${P}fill { background: rgba(255,152,0,.6); }
.${P}stock.${P}bad .${P}fill { background: rgba(244,67,54,.65); }
.${P}energy .${P}fill { background: rgba(242,209,107,.35); }
.${P}energy.${P}warn .${P}fill { background: rgba(255,152,0,.6); }
.${P}energy.${P}bad .${P}fill { background: rgba(244,67,54,.65); }
.${P}val { position: relative; display: block; padding: 0 2px; text-align: right; color: #fff; text-shadow: 0 0 2px #000; }
.${P}rate { flex: 1 1 auto; text-align: right; color: #8fbf8f; overflow: hidden; }
.${P}rate.${P}warn, .${P}fusion.${P}warn { color: #ff9800; }
.${P}rate.${P}bad, .${P}fusion.${P}bad { color: #f44336; }
.${P}fusion { flex: 1 1 auto; text-align: right; color: #cfd8e3; }
.${P}sline { justify-content: space-between; }
.${P}sum { color: #fff; }
.${P}stock.${P}unknown .${P}fill { background: transparent; }
.${P}rate.${P}muted { color: #8593a3; }
.${P}need.${P}ok { color: #8fbf8f; } .${P}need.${P}bad { color: #f44336; } .${P}need.${P}muted, .${P}muted { color: #8593a3; }
.${P}build { color: #6f9fd8; gap: 4px; }
.${P}build .${P}bname { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
.${P}build.${P}down { color: #ff9800; }
.${P}build.${P}stale { color: #8593a3; font-style: italic; }
.${P}build .ogx-countdown { flex: none; color: #fff; }
.${P}oneline { margin: 0; gap: 2px; }
.${P}oneline .${P}stock { flex: 1 1 0; min-width: 0; }
.${P}ctimer { flex: none; }
.${P}ctimer .${P}line { margin: 0; height: 11px; }
.${P}nomoon { color: #8593a3; }
.${P}ships { position: absolute; display: block; height: 3px; background: rgba(38,48,59,.9); border-radius: 2px; overflow: hidden; pointer-events: auto; }
.${P}ships-planet { left: 10px; right: 10px; bottom: 1px; }
.${P}ships-moon { left: 0; right: 0; bottom: -3px; height: 2px; }
.${P}ships.${P}ships-inflow { position: relative; left: auto; right: auto; bottom: auto; margin: 2px 0 0; height: 3px; }
.${P}ships-fill { display: block; height: 100%; }
.${P}ships-fill.${P}ok { background: #4caf50; } .${P}ships-fill.${P}warn { background: #ff9800; } .${P}ships-fill.${P}bad { background: #f44336; }
.${P}switch[hidden] { display: none; }
.${P}switch { display: flex; justify-content: center; gap: 2px; margin: 2px 0; }
.${P}switch-btn { padding: 0 5px; height: 15px; border: 1px solid #2b3846; border-radius: 3px; background: #161c24; color: #8593a3; font: 10px Verdana, Arial, sans-serif; cursor: pointer; }
.${P}switch-btn:hover { color: #fff; border-color: #6f9fd8; }
.${P}switch-btn.${P}on { color: #fff; background: #24486e; border-color: #6f9fd8; }
`;
})(window.OGX);
