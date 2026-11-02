/* ogamex-infinity/modules/fleethelp/fleethelp.js — Owner: infinity/fleethelp.
 * Keep-N rules, /fleet helper buttons and resource collection «Сбор» v2 (DESIGN §4.2.8, specs/COLLECT_V2.md).
 *   - Keep rules: per body and a default, { ships: Ships, resources: Res } that stay on the body. Edited in the tab «Сбор»
 *     and from the «резерв» link on /fleet. Stored as fleethelp.keep = { v:1, default:{ships,resources}, bodies:{[BodyKey]:{ships,resources}} }.
 *     A body rule replaces the default completely.
 *   - Every transport count is in Battle Transporters (217, «Ул. трансп.») only; no other ship type is ever offered or taken.
 *     Too few 217 is reported («не хватает N» / «нет Ул. трансп.: нужно N»), never filled with other ships.
 *   - Tab «Сбор» (order 80): target = setting collectTarget (single source of truth, persisted when defaulted); one row per other
 *     body from the pure planner planCollect (fuel-aware 217 count, room = 217 x cargo - fuel on GALAXYZ, fill order collectOrder).
 *     «Собрать всё»: refresh (one GET page=imperium, fleetTable per body still missing, slots) -> plan -> ONE confirm dialog
 *     listing every flight -> OGX.fleet.sendBatch (fleetStep1/2/3 POSTs per flight, room check before step 3). Two clicks.
 *     «Подготовить» / «Пошаговый сбор» keep the native prefill path (OGX.fleet.prefill.open, never submits); per-row «Отправить»
 *     (allowDirectSend) = sendBatch of one flight after its own confirm.
 *   - /fleet step 1 (OgameX #fleet1, GALAXYZ fleetTable): «Всё, кроме резерва» and «Транспорт для ресурсов» (217 only, fuel-aware
 *     count toward the form's target or collectTarget). Step 2: «Все ресурсы, кроме резерва» (resources minus keep, deuterium
 *     minus fuel, capped by the fleet's room; GALAXYZ order metal -> crystal -> deuterium like maxResources()).
 * Writes: fleethelp.keep, fleethelp.walk ({ v:2, target, keys, idx, t, excluded }), fleethelp.batch (row statuses of the last
 * batch, 30 min); settings fleethelp.*.
 *
 * GALAXYZ 1.8 (ogamex.eu/Aeternum; specs/galaxyz/fleet.md §1.4, §2): dispatch is three plain form pages. The prefill fills them
 * (fleetTable ships, fleetStep1 speed, fleetStep2 mission + cargo); the user presses «Continue». The direct sends go through
 * OGX.fleet.sendBatch / gz.dispatch(fit) only after a click and a confirm dialog.
 */
(function (OGX) {
  'use strict';

  const NAME = 'fleethelp';
  const P = 'ogx-i-fleethelp-';
  const PANEL_ID = 'infinity';
  const RES = ['metal', 'crystal', 'deuterium'];
  const FILL_ORDER = ['deuterium', 'crystal', 'metal']; // FleetDispatcher.selectMaxAll order
  const FILL_ORDER_GZ = ['metal', 'crystal', 'deuterium']; // 2Moons maxResources() order (scripts/game/flotten.js)
  const TRANSPORT = OGX.catalog.transportShip || 217;   // Battle Transporter: every transport count of the suite
  const T217 = 'Ул. трансп.';
  const isGz = () => !!(OGX.page.isGz && OGX.page.isGz());
  const fillOrder = () => (isGz() ? FILL_ORDER_GZ : FILL_ORDER);
  const RES_RU = { metal: 'Металл', crystal: 'Кристалл', deuterium: 'Дейтерий' };
  const WALK_MAX_AGE = 30 * 60 * 1000;
  const BATCH_MAX_AGE = 30 * 60 * 1000;
  const MISSION_TRANSPORT = 3;
  const CP_NOTICE_GZ = [
    'Данные о кораблях части планет игра показывает только на странице этой планеты. ',
    'Чтобы их прочитать, дополнение по очереди откроет «Флот» каждой такой планеты с параметром &cp=… — сервер на это время считает выбранной ту планету.',
    '\n\nПосле обновления дополнение вернёт выбранную сейчас планету. Пока идёт обновление, не отправляйте флоты и не стройте в других вкладках: ',
    'действие может уйти с другой планеты. Каждый запрос — обычная страница игры (без затрат дейтерия); запросы идут по одному с паузой и только по вашему нажатию.',
  ].join('');
  const ORDER_OPTIONS = [
    { value: 'dcm', label: 'Дейтерий → Кристалл → Металл' },
    { value: 'cmd', label: 'Кристалл → Металл → Дейтерий' },
    { value: 'mcd', label: 'Металл → Кристалл → Дейтерий' },
    { value: 'prop', label: 'Пропорционально запасам' },
  ];
  const SPEED_OPTIONS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((v) => ({ value: v, label: v * 10 + ' %' }));

  const rec = (src, what, data) => { try { return OGX.log.rec(src, NAME, what, data); } catch (e) { return null; } };
  const learnValue = (name, v, o) => { try { return OGX.learn ? OGX.learn.value(name, v, o) : true; } catch (e) { return true; } };
  const learnCheck = (name, o) => { try { return OGX.learn ? OGX.learn.check(name, o) : true; } catch (e) { return true; } };
  const h = (...a) => OGX.dom.h(...a);
  const num = (n) => OGX.fmt.num(n);
  const short = (n) => OGX.fmt.short(n);
  const int0 = (v) => { const n = Math.floor(+v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const emptyRes = () => ({ metal: 0, crystal: 0, deuterium: 0 });
  const emptyRule = () => ({ ships: {}, resources: emptyRes() });

  OGX.module({
    name: NAME,
    title: 'Резерв, сбор ресурсов и помощь при отправке флота',
    pages: '*',
    settings: {
      collectOrder: { type: 'enum', default: 'dcm', label: 'Порядок загрузки при сборе', options: ORDER_OPTIONS },
      keepDeuteriumForFuel: { type: 'bool', default: true, label: 'Оставлять дейтерий на топливо',
        hint: 'Топливо полёта всегда списывается с дейтерия планеты; включено — на планете-источнике остаётся ещё столько же дейтерия, чтобы туда можно было отправить такой же флот ещё раз' },
      collectMaxAgeMin: { type: 'int', default: 3, min: 1, max: 60, step: 1, label: 'Данные для сбора старше, мин — обновить' },
      collectSpeed: { type: 'enum', default: 10, label: 'Скорость полётов сбора', options: SPEED_OPTIONS },
      collectMinLoadPct: { type: 'int', default: 10, min: 0, max: 100, step: 5, label: 'Минимальный груз полёта сбора, % от одного Ул. трансп.',
        hint: 'Источник с меньшим грузом не отправляется («мало ресурсов»): полёт занял бы слот и сжёг топливо почти впустую' },
      allowDirectSend: { type: 'bool', default: false, label: 'Кнопка «Отправить» у каждого источника во вкладке «Сбор»', hint: 'Отправка одного источника с подтверждением' },
      showFleetButtons: { type: 'bool', default: true, label: 'Кнопки резерва на странице флота' },
      collectTarget: { type: 'string', default: '', hidden: true, label: 'Цель сбора' },
    },
    async init(ctx) {
      const f = new FleetHelp(ctx);
      ctx._fh = f;
      await f.start();
    },
    dispose(ctx) { if (ctx._fh) ctx._fh.stop(); },
  });

  // ================================================================== pure helpers
  function normRes(r) {
    const o = emptyRes();
    if (r && typeof r === 'object') for (const k of RES) o[k] = int0(r[k]);
    return o;
  }
  function normShips(s) {
    const o = {};
    if (s && typeof s === 'object') for (const [id, n] of Object.entries(s)) if (/^\d+$/.test(id) && int0(n) > 0) o[id] = int0(n);
    return o;
  }
  function normRule(r) { return { ships: normShips(r && r.ships), resources: normRes(r && r.resources) }; }
  function migrateKeep(v) {
    const out = { v: 1, default: emptyRule(), bodies: {} };
    if (!v || typeof v !== 'object' || v.v !== 1) return out;
    out.default = normRule(v.default);
    if (v.bodies && typeof v.bodies === 'object') for (const [k, r] of Object.entries(v.bodies)) if (/^[pm]\d+$/.test(k)) out.bodies[k] = normRule(r);
    return out;
  }
  function ruleIsEmpty(r) { return !r || (!Object.keys(r.ships || {}).length && RES.every((k) => !(r.resources && r.resources[k]))); }
  function minusShips(have, keep) {
    const o = {};
    for (const [id, n] of Object.entries(have || {})) {
      const left = int0(n) - int0(keep && keep[id]);
      if (left > 0) o[id] = left;
    }
    return o;
  }
  /** Fills `cap` with `avail` in the game's order (OgameX D → C → M, GALAXYZ M → C → D). */
  function fillCargo(avail, cap, order) {
    const out = emptyRes();
    let free = Math.max(0, Math.floor(cap));
    for (const k of order || fillOrder()) {
      const n = Math.min(int0(avail[k]), free);
      out[k] = n;
      free -= n;
    }
    return out;
  }
  /** Sequential fill in the collect order ('dcm' | 'cmd' | 'mcd' | 'prop'), the same helper the core uses before step 3. */
  const fillByOrder = (avail, room, order) => OGX.fleet.fillByOrder(avail, room, order || 'dcm');
  const resSum = (r) => RES.reduce((s, k) => s + (+r[k] || 0), 0);
  const shipsTxt = (ships) => Object.entries(ships || {}).filter(([, n]) => n > 0).map(([id, n]) => `${OGX.catalog.shortName(+id)} ${num(n)}`).join(', ') || '—';
  function bodyLabel(b) { return b ? `${b.name || '?'} ${OGX.fmt.coords(b.coords, b.type === 'moon' ? 3 : 1)}` : '?'; }
  function targetOf(b) {
    const c = OGX.util.coordsObj(b.coords);
    return c ? { galaxy: c.galaxy, system: c.system, position: c.position, type: b.type === 'moon' ? 3 : 1 } : null;
  }
  /** Planet-list order, each planet followed by its moon; anything else at the end. */
  function orderBodies(bodies) {
    const all = Object.values(bodies || {});
    const planets = all.filter((b) => b.type !== 'moon').sort((a, b) => (a.order || 0) - (b.order || 0));
    const out = [];
    for (const p of planets) {
      out.push(p);
      const m = (p.moonKey && bodies[p.moonKey]) || all.find((x) => x.type === 'moon' && x.planetId === p.planetId && x.planetId);
      if (m && !out.includes(m)) out.push(m);
    }
    for (const b of all) if (!out.includes(b)) out.push(b);
    return out;
  }

  /** Loadable deuterium for a flight that burns `fuel`: GALAXYZ always takes the fuel from the planet stock; keepDeutForFuel keeps
   * one more flight's fuel on the source. OgameX: fuel is subtracted only with keepDeutForFuel (old meaning). */
  function deutLoadable(d, fuel, keepDeutForFuel, gz) {
    if (gz) return Math.max(0, d - fuel - (keepDeutForFuel ? fuel : 0));
    return keepDeutForFuel ? Math.max(0, d - fuel) : d;
  }

  /** Fuel-aware Battle Transporter count (at most 4 passes): n = ceil((load + fuel on GALAXYZ) / cap).
   * -> { n, fuel (of n), total (loadable), deut (loadable deuterium) } */
  async function count217({ avail, cap, fuelFn, keepDeutForFuel = true, gz = true }) {
    const m = int0(avail.metal), c = int0(avail.crystal), d = int0(avail.deuterium);
    if (!(cap > 0)) return { n: 0, fuel: 0, total: m + c + d, deut: d };
    let n = Math.max(1, Math.ceil((m + c + d) / cap));
    let fuel = 0, dd = d, done = false;
    for (let pass = 0; pass < 4; pass++) {
      fuel = int0(await fuelFn(n));
      dd = deutLoadable(d, fuel, keepDeutForFuel, gz);
      const n2 = Math.max(1, Math.ceil((m + c + dd + (gz ? fuel : 0)) / cap));
      if (n2 === n) { done = true; break; }
      n = n2;
    }
    if (!done) { fuel = int0(await fuelFn(n)); dd = deutLoadable(d, fuel, keepDeutForFuel, gz); }
    return { n, fuel, total: m + c + dd, deut: dd };
  }

  /**
   * Pure collect planner (specs/COLLECT_V2.md §2.4). Injected: estimate (OGX.fleet.estimate), project (state.projected), keep(key).
   * -> { dst, rows, flights (ok rows, largest load first, cut to freeSlots), excluded [{ key, code, reason }], totals }
   * row = { key, body, ok, code, reason, warn, avail, total, have217, need217, use217, short217, cap217, fuel, room, cargo, load,
   *         left, duration, arrival, age, stale, rule }
   * codes: ok, nores, noships, nocoords, nocap, empty, no217, noroom, small (load < minLoadPct % of one 217), noslot.
   */
  async function planCollect({ bodies, targetKey, stats, keep, order = 'dcm', keepDeutForFuel = true, speed = 10, now = Date.now(),
    freeSlots = null, estimate, project, maxAgeMs = 180000, gz = true, minLoadPct = 0 }) {
    const dst = (bodies && bodies[targetKey]) || null;
    const out = { dst, rows: [], flights: [], excluded: [], totals: { metal: 0, crystal: 0, deuterium: 0, load: 0, fuel: 0, flights: 0 } };
    if (!dst) return out;
    const ruleOf = typeof keep === 'function' ? keep : () => keep || emptyRule();
    const projectOf = project || ((b) => b);
    const cap = (stats && stats[TRANSPORT] && +stats[TRANSPORT].cargo) || 0;
    for (const S of orderBodies(bodies)) {
      if (S.key === targetKey) continue;
      const rule = normRule(ruleOf(S.key));
      const row = { key: S.key, body: S, ok: false, code: '', reason: '', warn: '', avail: emptyRes(), total: 0, have217: 0, need217: 0, use217: 0,
        short217: 0, cap217: cap, fuel: 0, room: 0, cargo: emptyRes(), load: 0, left: 0, duration: null, arrival: null, age: null, stale: true, rule };
      const resT = S.res && +S.res.t > 0 ? +S.res.t : null;
      const shipsT = +S.shipsT > 0 ? +S.shipsT : null;
      row.age = resT && shipsT ? Math.min(resT, shipsT) : resT || shipsT || null;
      row.stale = !(resT && shipsT) || now - row.age > maxAgeMs;
      out.rows.push(row);
      const fail = (code, reason) => { row.code = code; row.reason = reason; };
      if (!S.res) { fail('nores', 'Нет данных о ресурсах'); continue; }
      const proj = projectOf(S) || S;
      let raw = 0;
      for (const k of RES) {
        const r = proj.res && proj.res[k];
        const amount = Math.max(0, Math.floor((r && +r.amount) || 0));
        raw += amount;
        row.avail[k] = Math.max(0, amount - rule.resources[k]);
      }
      row.total = resSum(row.avail);
      if (!shipsT) { fail('noships', 'нет данных о кораблях — откройте планету'); continue; }
      row.have217 = Math.max(0, int0(S.ships && S.ships[TRANSPORT]) - int0(rule.ships[TRANSPORT]));
      if (!S.coords || !dst.coords) { fail('nocoords', 'Неизвестные координаты'); continue; }
      if (!row.total) { fail('empty', raw > 0 ? 'Нечего забирать (всё в резерве)' : 'Нечего забирать (ресурсов нет)'); continue; }
      if (!(cap > 0)) { fail('nocap', 'Вместимость ' + T217 + ' неизвестна'); continue; }
      const ests = new Map();
      const estOf = async (n) => {
        if (!ests.has(n)) ests.set(n, await estimate({ from: S.coords, to: dst.coords, ships: { [TRANSPORT]: n }, mission: MISSION_TRANSPORT, speedPct: speed }));
        return ests.get(n);
      };
      const fuelFn = async (n) => (n > 0 ? Math.ceil(+(await estOf(n)).fuelBudget || 0) : 0);
      const c = await count217({ avail: row.avail, cap, fuelFn, keepDeutForFuel, gz });
      row.need217 = c.n;
      row.total = c.total;
      row.use217 = Math.min(row.need217, row.have217);
      row.short217 = row.need217 - row.use217;
      if (!c.total) { fail('empty', 'Нечего забирать (дейтерий уходит на топливо)'); continue; }
      if (row.use217 === 0) { fail('no217', `нет ${T217}: нужно ${num(row.need217)}`); continue; }
      const est = await estOf(row.use217);
      const fuel = Math.ceil(+est.fuelBudget || 0);
      const load = { metal: row.avail.metal, crystal: row.avail.crystal, deuterium: deutLoadable(row.avail.deuterium, fuel, keepDeutForFuel, gz) };
      row.total = resSum(load);
      row.fuel = fuel;
      row.duration = Number.isFinite(est.duration) ? est.duration : null;
      row.arrival = Number.isFinite(est.arrival) ? est.arrival : null;
      row.room = Math.max(0, row.use217 * cap - (gz ? fuel : 0));
      row.cargo = fillByOrder(load, row.room, order);
      row.load = resSum(row.cargo);
      row.left = Math.max(0, row.total - row.load);
      if (row.load <= 0) { fail('noroom', 'Груз не помещается (топливо больше вместимости)'); continue; }
      const minLoad = Math.max(0, +minLoadPct || 0) / 100 * cap;
      if (minLoad > 0 && row.load < minLoad) { fail('small', `мало ресурсов (${short(row.load)}, меньше ${short(minLoad)})`); continue; }
      row.ok = true;
      row.code = 'ok';
      if (row.short217 > 0) row.warn = `не хватает ${num(row.short217)} ${T217} (останется ${short(row.left)})`;
    }
    const ready = out.rows.filter((r) => r.ok).sort((a, b) => b.load - a.load);
    const fs = Number.isFinite(freeSlots) ? Math.max(0, freeSlots) : Infinity;
    ready.forEach((r, i) => {
      if (i < fs) out.flights.push(r);
      else { r.ok = false; r.code = 'noslot'; r.reason = 'нет свободного слота'; }
    });
    out.excluded = out.rows.filter((r) => !r.ok).map((r) => ({ key: r.key, code: r.code, reason: r.reason }));
    for (const r of out.flights) {
      for (const k of RES) out.totals[k] += r.cargo[k];
      out.totals.load += r.load;
      out.totals.fuel += r.fuel;
    }
    out.totals.flights = out.flights.length;
    return out;
  }

  // ================================================================== FleetHelp
  function FleetHelp(ctx) {
    this.ctx = ctx;
    this.log = ctx.log;
    this.keep = migrateKeep(null);
    this.walk = null;
    this.batch = { target: null, t: 0, status: {} };
    this.offs = [];
    this.tab = null;
    this.ui = null;
    this.plan = null;
    this.renderSeq = 0;
    this.sending = false;
    this.busy = false;
    this.fresh = null;           // last ensureFresh summary { t, imperium, perBody, errors, noCp }
    this.refreshSoon = OGX.util.debounce(OGX.safe(() => this.refreshTab(), 'fleethelp:refresh'), 150);
    // Every add-on action is a timed B event (CORE_API §21.1).
    this.wSelect = OGX.log.wrap(NAME, (ships) => this.applyShips(ships), 'fleet:selectShips');
    this.wCargo = OGX.log.wrap(NAME, (cargo) => this.applyCargo(cargo), 'fleet:setCargo');
    this.wPrefill = OGX.log.wrap(NAME, (spec) => OGX.fleet.prefill.open(spec), 'collect:prefill');
    this.wSaveKeep = OGX.log.wrap(NAME, (key, rule) => this.saveRule(key, rule), 'keep:save');
  }

  FleetHelp.prototype.set = function (k) { return this.ctx.settings.get(k); };
  FleetHelp.prototype.order = function () { const v = String(this.set('collectOrder') || 'dcm'); return ORDER_OPTIONS.some((o) => o.value === v) ? v : 'dcm'; };
  FleetHelp.prototype.speed = function () { const v = Math.round(+this.set('collectSpeed') || 10); return Math.max(1, Math.min(10, v)); };
  FleetHelp.prototype.minLoadPct = function () { const v = this.set('collectMinLoadPct'); return v === undefined || v === null || v === '' ? 10 : Math.max(0, Math.min(100, +v || 0)); };
  FleetHelp.prototype.maxAgeMs = function () { return Math.max(1, Math.min(60, +this.set('collectMaxAgeMin') || 3)) * 60000; };

  FleetHelp.prototype.start = async function () {
    const ctx = this.ctx;
    ctx.css(CSS);
    this.keep = migrateKeep(await ctx.store.get('keep', null));
    this.walk = await this.loadWalk();
    this.batch = await this.loadBatch();
    learnCheck('fleethelp.keep', this.keep);
    this.offs.push(ctx.store.subscribe('keep', (v) => { this.keep = migrateKeep(v); this.refreshSoon(); this.updateFleetBars(); }));
    this.offs.push(ctx.store.subscribe('walk', (v) => { this.walk = this.validWalk(v); this.refreshSoon(); this.renderWalkBar(); }));
    this.offs.push(OGX.state.onChange(['bodies', 'shipStats', 'research', 'player', 'server', 'slots'], () => this.refreshSoon()));
    this.offs.push(ctx.settings.onChange((key) => {
      if (/collectTarget$/.test(String(key))) return;
      this.refreshSoon();
      this.updateFleetBars();
    }));

    this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
    this.tab = this.panel.addTab({ id: 'collect', label: 'Сбор', order: 80, render: (c) => this.render(c) });

    if (OGX.page.is('fleet')) await (isGz() ? this.initFleetPageGz() : this.initFleetPage());
    rec('B', 'init', { page: OGX.page.info().name, rules: Object.keys(this.keep.bodies).length, walk: !!this.walk });
  };

  FleetHelp.prototype.stop = function () {
    for (const off of this.offs.splice(0)) { try { off(); } catch (e) { /* ignore */ } }
    if (this.abort) { try { this.abort.abort(); } catch (e) { /* ignore */ } }
  };

  // ------------------------------------------------------------------ keep rules
  FleetHelp.prototype.ruleFor = function (key) {
    const b = key && this.keep.bodies[key];
    if (b) return Object.assign(normRule(b), { src: 'body' });
    return Object.assign(normRule(this.keep.default), { src: 'default' });
  };

  FleetHelp.prototype.saveRule = async function (key, rule) {
    const next = await this.ctx.store.update('keep', (old) => {
      const k = migrateKeep(old);
      if (key === 'default') k.default = rule ? normRule(rule) : emptyRule();
      else if (!rule) delete k.bodies[key];
      else k.bodies[key] = normRule(rule);
      return k;
    }, null);
    this.keep = migrateKeep(next);
    this.refreshSoon();
    this.updateFleetBars();
    return { ok: true, key, removed: !rule };
  };

  FleetHelp.prototype.editRule = async function (key) {
    const bodies = await OGX.state.bodies();
    const isDefault = key === 'default';
    const body = isDefault ? null : bodies[key];
    const cur = isDefault ? normRule(this.keep.default) : normRule(this.keep.bodies[key] || this.keep.default);
    const inputs = { res: {}, ships: {} };
    const field = (label, value, dataKey) => {
      const inp = h('input', { type: 'number', min: '0', step: '1', class: P + 'inp', value: String(value || 0), dataset: { k: dataKey } });
      return [inp, h('label', { class: P + 'field' }, h('span', null, label), inp)];
    };
    const resBox = h('div', { class: P + 'grid' });
    for (const k of RES) { const [inp, el] = field(RES_RU[k], cur.resources[k], k); inputs.res[k] = inp; resBox.appendChild(el); }
    const shipBox = h('div', { class: P + 'grid' });
    for (const id of OGX.catalog.fleetShipIds) {
      const have = body && body.shipsT ? (body.ships[id] || 0) : null;
      const [inp, el] = field(OGX.catalog.shortName(id) + (have !== null ? ` (${num(have)})` : ''), cur.ships[id], String(id));
      inputs.ships[id] = inp;
      shipBox.appendChild(el);
    }
    const note = isDefault ? 'Правило по умолчанию действует для всех планет и лун без своего правила.'
      : (this.keep.bodies[key] ? 'Своё правило этой планеты (заменяет правило по умолчанию).' : 'Своего правила нет: сейчас действует правило по умолчанию. Сохранение создаст своё правило.');
    const content = h('div', { class: P + 'editor' },
      h('div', { class: P + 'muted' }, note),
      h('h4', null, 'Ресурсы, которые оставить'), resBox,
      h('h4', null, 'Корабли, которые оставить'), shipBox);
    const read = () => {
      const r = emptyRule();
      for (const k of RES) r.resources[k] = int0(inputs.res[k].value);
      for (const [id, inp] of Object.entries(inputs.ships)) { const n = int0(inp.value); if (n > 0) r.ships[id] = n; }
      return r;
    };
    const buttons = [{ label: 'Отмена', onClick: (close) => { rec('U', 'keep:cancel', { key }); close(); } }];
    if (!isDefault && this.keep.bodies[key]) {
      buttons.unshift({ label: 'Удалить правило', danger: true, onClick: async (close) => {
        rec('U', 'keep:remove', { key });
        await this.wSaveKeep(key, null);
        OGX.dom.toast('Правило удалено', { type: 'ok' });
        close();
      } });
    }
    buttons.push({ label: 'Сохранить', primary: true, onClick: async (close) => {
      const r = read();
      learnCheck('fleethelp.keepRule', r);
      rec('U', 'keep:save', { key, ships: r.ships, resources: r.resources });
      await this.wSaveKeep(key, r);
      OGX.dom.toast('Резерв сохранён', { type: 'ok' });
      close();
    } });
    const m = OGX.dom.modal({ title: 'Резерв: ' + (isDefault ? 'по умолчанию' : bodyLabel(body) || key), body: content, buttons, width: 560 });
    if (m && m.el) m.el.classList.add(P + 'modal');
    return m;
  };

  // ------------------------------------------------------------------ walk / batch state
  FleetHelp.prototype.validWalk = function (w) {
    if (!w || w.v !== 2 || !Array.isArray(w.keys) || typeof w.target !== 'string') return null;
    if (!(OGX.time.serverNow() - (+w.t || 0) < WALK_MAX_AGE)) return null;
    return w;
  };
  FleetHelp.prototype.loadWalk = async function () {
    return this.validWalk(await this.ctx.store.get('walk', null));
  };
  FleetHelp.prototype.saveWalk = async function (w) {
    this.walk = w;
    if (w) await this.ctx.store.set('walk', w);
    else await this.ctx.store.remove('walk');
  };
  FleetHelp.prototype.loadBatch = async function () {
    const b = await this.ctx.store.get('batch', null);
    if (!b || !b.status || typeof b.status !== 'object' || !(OGX.time.serverNow() - (+b.t || 0) < BATCH_MAX_AGE)) return { target: null, t: 0, status: {} };
    return b;
  };
  FleetHelp.prototype.clearBatch = async function () {
    this.batch = { target: null, t: 0, status: {} };
    try { await this.ctx.store.remove('batch'); } catch (e) { /* ignore */ }
  };
  FleetHelp.prototype.batchStatus = function (key) {
    const b = this.batch;
    return b && b.target && b.target === this.lastTarget && b.status ? b.status[key] || null : null;
  };

  // ------------------------------------------------------------------ target (single source of truth: setting collectTarget)
  FleetHelp.prototype.resolveTarget = function (bodies) {
    if (this.resolving) return this.resolving;
    this.resolving = this.resolveTargetNow(bodies || {}).finally(() => { this.resolving = null; });
    return this.resolving;
  };
  FleetHelp.prototype.resolveTargetNow = async function (bodies) {
    const saved = this.set('collectTarget');
    if (saved && bodies[saved]) return saved;
    const list = orderBodies(bodies);
    if (!list.length) return null;
    // default = the main planet (first planet of the list): the hub with the most 217 is where the sources need their transporters
    const planets = list.filter((b) => b.type !== 'moon');
    const first = planets[0] || list[0];
    const key = first.key;
    await this.ctx.settings.set('collectTarget', key);
    rec('B', 'collect:target-default', { key, why: 'main', lost: saved || null });
    if (saved) {
      rec('B', 'collect:target-lost', { old: saved, now: key });
      if (this.walk) await this.saveWalk(null);
      await OGX.fleet.prefill.clear('target-lost');
      await this.clearBatch();
      const oldB = this.lastBodies && this.lastBodies[saved];
      OGX.dom.toast(`Цель сбора ${oldB ? bodyLabel(oldB) : saved} удалена — новая цель: ${bodyLabel(first)} (можно сменить)`, { type: 'warn', ms: 8000 });
    } else {
      OGX.dom.toast(`Цель сбора: ${bodyLabel(first)} (можно сменить)`, { type: 'info', ms: 6000 });
    }
    return key;
  };

  FleetHelp.prototype.setTarget = async function (key) {
    const from = this.set('collectTarget') || null;
    if (!key || key === from) return;
    rec('U', 'collect:target', { from, to: key });
    await this.ctx.settings.set('collectTarget', key);
    await this.saveWalk(null);
    await OGX.fleet.prefill.clear('target');
    await this.clearBatch();
    this.renderWalkBar();
    this.refreshTab();
  };

  // ------------------------------------------------------------------ data
  FleetHelp.prototype.slotsFree = async function () {
    const s = await OGX.state.slots();
    const f = s && s.fleet;
    if (!f || !(+f.max > 0)) return { free: null, used: null, max: null, t: null };
    return { used: +f.used || 0, max: +f.max, free: Math.max(0, +f.max - (+f.used || 0)), t: s.fleetT || s.t || null };
  };

  FleetHelp.prototype.computePlan = async function (tKey, { freeSlots = null } = {}) {
    const [bodies, stats] = await Promise.all([OGX.state.bodies(), OGX.state.shipStats()]);
    const plan = await planCollect({ bodies: bodies || {}, targetKey: tKey, stats: stats || {}, keep: (k) => this.ruleFor(k), order: this.order(),
      keepDeutForFuel: !!this.set('keepDeuteriumForFuel'), speed: this.speed(), now: OGX.time.serverNow(), freeSlots,
      estimate: (q) => OGX.fleet.estimate(q), project: (b) => OGX.state.projected(b), maxAgeMs: this.maxAgeMs(), gz: isGz(), minLoadPct: this.minLoadPct() });
    plan.stats = stats || {};
    plan.bodies = bodies || {};
    for (const r of plan.rows) {
      if (r.ok) {
        learnValue('fleethelp.available', r.total, { min: 0, int: true });
        learnValue('fleethelp.cargoNeeded', r.need217, { min: 0, int: true });
        learnValue('fleethelp.fuel', r.fuel, { min: 0 });
      }
    }
    return plan;
  };

  /** Keeps the data of every body fresh enough for a plan (§4.3): one GET page=imperium (no cp switch), then fleetTable per body
   * that is still missing data (needs core.cpConfirmed), then the slots. Read-only GETs through the polite background queue. */
  FleetHelp.prototype.ensureFresh = function (opts = {}) {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.ensureFreshNow(opts).finally(() => { this.refreshing = null; });
    return this.refreshing;
  };
  FleetHelp.prototype.ensureFreshNow = async function ({ reason = 'open', force = false, slots: withSlots = false, onProgress } = {}) {
    const t0 = Date.now();
    const maxAge = this.maxAgeMs();
    const now = OGX.time.serverNow();
    const ageOf = (b) => (b.res && +b.res.t > 0 && +b.shipsT > 0 ? Math.min(+b.res.t, +b.shipsT) : 0);
    const missingOf = (bodies) => Object.values(bodies).filter((b) => !b.res || !(+b.shipsT > 0)).map((b) => b.key);
    let bodies = (await OGX.state.bodies()) || {};
    const oldest = Object.values(bodies).reduce((m, b) => Math.min(m, ageOf(b)), Infinity);
    const out = { reason, imperium: null, perBody: [], slots: null, errors: [], noCp: false };
    if (this.ui) this.setStatus('Обновляю данные…');
    if (isGz() && (force || !Object.keys(bodies).length || now - (Number.isFinite(oldest) ? oldest : 0) > maxAge || missingOf(bodies).length)) {
      const ti = Date.now();
      if (onProgress) onProgress('империя');
      const r = await OGX.state.refreshBodies({ include: ['empire'] });
      out.imperium = { ok: !!(r && r.ok), ms: Date.now() - ti };
      for (const e of (r && r.errors) || []) out.errors.push({ key: e.key, error: e.error, text: e.text });
      bodies = (await OGX.state.bodies()) || {};
    }
    const missing = missingOf(bodies);
    if (isGz() && missing.length) {
      if (OGX.settings.get('core.cpConfirmed')) {
        if (onProgress) onProgress('планеты ' + missing.length);
        const r = await OGX.state.refreshBodies({ keys: missing, include: ['fleet'] });
        out.perBody = missing;
        for (const e of (r && r.errors) || []) out.errors.push({ key: e.key, error: e.error, text: e.text });
      } else out.noCp = true;
    }
    if (withSlots && isGz()) {
      const s = await OGX.state.slots();
      const st = s && s.fleet ? +(s.fleetT || s.t) || 0 : 0;
      if (!st || OGX.time.serverNow() - st > maxAge) {
        if (onProgress) onProgress('слоты');
        const r = await OGX.fleet.status({ background: true, merge: true });
        if (r && r.slots) out.slots = r.slots;
        else if (r && r.error) out.errors.push({ key: null, error: r.error, text: OGX.state.refreshErrorText(r.error) });
      }
    }
    out.ms = Date.now() - t0;
    out.t = OGX.time.serverNow();
    this.fresh = out;
    // new data, new plan: a past batch's failures and stops no longer describe the rows (sent marks stay as a note)
    if (!this.sending && this.batch && this.batch.status) {
      for (const [k, v] of Object.entries(this.batch.status)) if (!v || v.status !== 'sent') delete this.batch.status[k];
    }
    rec('B', 'collect:refresh', { reason, imperium: out.imperium, perBody: out.perBody, slots: out.slots, errors: out.errors.map((e) => ({ key: e.key, error: e.error })), noCp: out.noCp, ms: out.ms });
    this.refreshTab();
    return out;
  };

  // ------------------------------------------------------------------ tab «Сбор»: static skeleton once per open, rows on refresh
  FleetHelp.prototype.refreshTab = function () {
    if (this.ui && this.ui.root && this.ui.root.isConnected) return this.renderRows();
    if (this.tab) this.tab.refresh();
    return null;
  };

  FleetHelp.prototype.render = function (container) {
    container.textContent = '';
    const ui = this.ui = {};
    this.selSig = null;
    this.selPending = false;
    ui.sel = h('select', { class: P + 'target', 'data-ogx-act': 'fleethelp:target' });
    ui.sel.addEventListener('change', OGX.safe(() => this.setTarget(ui.sel.value), 'fleethelp:target'));
    const opened = () => { const t = Date.now(); if (t - (this.openLogT || 0) > 800) { this.openLogT = t; rec('U', 'collect:target-open', {}); } };
    ui.sel.addEventListener('focus', opened);
    ui.sel.addEventListener('mousedown', opened);
    ui.sel.addEventListener('blur', OGX.safe(() => { if (this.selPending) this.syncSelect(this.lastBodies || {}, this.lastTarget); }, 'fleethelp:target-blur'));
    ui.refresh = h('button', { class: ['ogx-btn', P + 'refresh'], 'data-ogx-act': 'fleethelp:refresh', title: 'Обновить данные всех планет (империя)', onClick: () => this.manualRefresh() }, '⟳ Обновить');
    ui.status = h('div', { class: P + 'statusline' }, 'Загрузка…');
    ui.cpBtn = h('button', { class: ['ogx-btn', P + 'cpallow'], 'data-ogx-act': 'fleethelp:cp-allow', hidden: true, onClick: () => this.allowCp() }, 'Разрешить обновление планет');
    ui.main = h('button', { class: ['ogx-btn', 'ogx-btn-primary', P + 'all'], 'data-ogx-act': 'fleethelp:collect-all', dataset: { flights: '0' }, onClick: () => this.collectAll() }, 'Собрать всё');
    ui.tbody = h('tbody');
    ui.table = h('table', { class: ['ogx-table', P + 'table'] },
      h('thead', null, h('tr', null,
        h('th', null, 'Источник'), h('th', { title: 'Груз этого полёта (металл / кристалл / дейтерий)' }, 'Груз М/К/Д'),
        h('th', { title: 'Улучшенные транспорты: берём из нужных' }, T217), h('th', null, 'Полёт / топл.'), h('th', null, 'Статус'), h('th', null, ''))),
      ui.tbody);
    ui.totals = h('div', { class: P + 'foot' });
    ui.orderSel = h('select', { class: P + 'order', 'data-ogx-act': 'fleethelp:order' }, ORDER_OPTIONS.map((o) => h('option', { value: o.value, selected: o.value === this.order() }, o.label)));
    ui.orderSel.addEventListener('change', OGX.safe(async () => {
      rec('U', 'collect:order', { order: ui.orderSel.value });
      await this.ctx.settings.set('collectOrder', ui.orderSel.value);
    }, 'fleethelp:order'));
    ui.cargoInfo = h('div', { class: P + 'muted ' + P + 'cargoinfo' });
    ui.walkBody = h('div', { class: P + 'walkin' });
    ui.walk = h('details', { class: P + 'walkbox' }, h('summary', null, 'Пошаговый сбор (подготовить формы, отправляете вы)'), ui.walkBody);
    ui.rulesBody = h('div', { class: P + 'rules' });
    ui.rules = h('details', { class: P + 'rulesbox' }, h('summary', null, 'Резерв (что оставлять на планете)'), ui.rulesBody);
    ui.root = h('div', { class: P + 'tab' },
      h('div', { class: P + 'head' }, h('span', null, 'Собрать на:'), ui.sel, ui.refresh),
      ui.status, ui.cpBtn, ui.main, ui.table, ui.totals,
      h('div', { class: P + 'orderrow' }, h('span', null, 'Порядок загрузки:'), ui.orderSel),
      ui.cargoInfo, ui.walk, ui.rules,
      h('div', { class: P + 'muted' }, `Перевозка только на ${T217} (Улучшенный транспорт). «Собрать всё» обновляет данные, показывает все полёты и отправляет их только после вашего подтверждения.`));
    container.appendChild(ui.root);
    this.renderRows();
    // refresh on open, at most once per collectMaxAgeMin (read-only GETs, polite queue)
    if (isGz() && Date.now() - (this.openFreshT || 0) > this.maxAgeMs()) {
      this.openFreshT = Date.now();
      this.ensureFresh({ reason: 'open' }).catch((e) => this.log.warn('refresh on open failed', e));
    }
  };

  FleetHelp.prototype.manualRefresh = async function () {
    rec('U', 'collect:refresh', {});
    if (this.ui) this.ui.refresh.disabled = true;
    try { await this.ensureFresh({ reason: 'manual', force: true, slots: true }); } finally { if (this.ui) this.ui.refresh.disabled = false; }
  };

  /** The same one-time notice as «Империя» «Обновить всё» (empire.js): sets core.cpConfirmed, then reads the missing planets. */
  FleetHelp.prototype.allowCp = async function () {
    rec('U', 'collect:cp-allow', {});
    const ok = await OGX.dom.confirm(h('div', { class: P + 'notice' }, CP_NOTICE_GZ), { okLabel: 'Понятно, обновить', cancelLabel: 'Отмена', title: 'Обновление данных всех планет' });
    rec('U', 'cp-notice', { ok, from: NAME });
    if (!ok) return;
    await OGX.settings.set('core.cpConfirmed', true);
    if (this.ui && this.ui.cpBtn) this.ui.cpBtn.hidden = true;
    await this.ensureFresh({ reason: 'cp-allow', force: true, slots: true });
  };

  FleetHelp.prototype.setStatus = function (text, cls) {
    if (!this.ui) return;
    this.ui.status.textContent = text;
    this.ui.status.classList.toggle(P + 'stale', cls === 'stale');
  };
  FleetHelp.prototype.setMain = function (text, disabled) {
    this.mainOverride = text;
    if (!this.ui) return;
    if (text) { this.ui.main.textContent = text; this.ui.main.disabled = !!disabled; }
  };

  FleetHelp.prototype.renderRows = async function () {
    const ui = this.ui;
    if (!ui) return;
    const seq = ++this.renderSeq;
    try {
      const bodies = (await OGX.state.bodies()) || {};
      if (seq !== this.renderSeq) return;
      if (!Object.keys(bodies).length) {
        this.setStatus('Нет данных о планетах. Откройте «Обзор» или «Империю».');
        ui.tbody.textContent = '';
        return;
      }
      const tKey = await this.resolveTarget(bodies);
      const slots = await this.slotsFree();
      const plan = await this.computePlan(tKey, { freeSlots: slots.free });
      const player = await OGX.state.player();
      if (seq !== this.renderSeq || this.ui !== ui) return;
      this.plan = plan;
      this.lastBodies = bodies;
      this.lastTarget = tKey;
      this.syncSelect(bodies, tKey);
      this.drawStatus(plan, slots);
      this.drawRows(plan);
      this.drawFoot(plan, player);
      this.drawWalk(plan);
      this.drawRules(bodies);
    } catch (e) {
      this.log.error('render failed', e);
      this.setStatus('Ошибка отображения: ' + (e && e.message || e));
    }
  };

  /** Target <select>: rebuilt only when the option set changed and the user is not using it (B3). */
  FleetHelp.prototype.syncSelect = function (bodies, tKey) {
    const sel = this.ui && this.ui.sel;
    if (!sel) return;
    const list = orderBodies(bodies);
    const opts = list.map((b) => [b.key, (b.type === 'moon' ? '↳ Луна ' + OGX.fmt.coords(b.coords, 3) + (b.name ? ' ' + b.name : '') : bodyLabel(b))]);
    const sig = JSON.stringify(opts);
    const focused = document.activeElement === sel;
    if (sig !== this.selSig) {
      if (focused && this.selSig) { this.selPending = true; return; }
      this.selPending = false;
      this.selSig = sig;
      sel.textContent = '';
      for (const [k, label] of opts) sel.appendChild(h('option', { value: k }, label));
    }
    if (!focused && tKey && sel.value !== tKey) sel.value = tKey;
  };

  FleetHelp.prototype.drawStatus = function (plan, slots) {
    const now = OGX.time.serverNow();
    const f = this.fresh;
    const ages = plan.rows.map((r) => r.age || 0).concat(plan.dst && plan.dst.res ? [+plan.dst.res.t || 0] : []);
    const oldest = ages.length ? Math.min(...ages) : 0;
    const stale = !oldest || now - oldest > this.maxAgeMs();
    const parts = [];
    if (f && f.t) {
      const what = [f.imperium ? (f.imperium.ok ? 'империя' : 'империя: ошибка') : null, f.perBody.length ? f.perBody.length + ' ' + OGX.fmt.plural(f.perBody.length, ['планета', 'планеты', 'планет']) : null].filter(Boolean).join(' + ');
      parts.push('Данные: обновлено ' + OGX.fmt.time(f.t) + (what ? ' (' + what + ')' : ''));
    } else parts.push('Данные: ' + (oldest ? 'самые старые — ' + OGX.fmt.ago(oldest) : 'нет'));
    if (slots && slots.max) parts.push(`слоты ${slots.used}/${slots.max}`);
    const noData = plan.rows.filter((r) => r.code === 'noships' || r.code === 'nores').map((r) => bodyLabel(r.body));
    if (f && f.noCp) parts.push('нет данных: ' + (noData.length ? noData.join(', ') : 'части планет') + ' — откройте их или нажмите «Разрешить обновление планет»');
    if (f && f.errors && f.errors.length) parts.push('ошибка: ' + f.errors.map((e) => e.text || e.error).join('; '));
    this.setStatus(parts.join(' · '), stale ? 'stale' : null);
    if (this.ui && this.ui.cpBtn) this.ui.cpBtn.hidden = !(f && f.noCp && !OGX.settings.get('core.cpConfirmed'));
  };

  FleetHelp.prototype.drawRows = function (plan) {
    const ui = this.ui;
    if (!ui) return;
    const allow = !!this.set('allowDirectSend');
    ui.tbody.textContent = '';
    for (const r of plan.rows) {
      ui.tbody.appendChild(this.rowEl(r, allow));
      const warn = r.ok ? r.warn : r.code === 'no217' ? '✗ ' + r.reason : '';
      if (warn) ui.tbody.appendChild(h('tr', { class: P + 'warn', dataset: { key: r.key } }, h('td', { colspan: '6' }, (r.ok ? '⚠ ' : '') + warn)));
    }
    const n = plan.flights.length;
    ui.main.dataset.flights = String(n);
    if (this.sending) { ui.main.textContent = this.stopping ? 'Останавливаю…' : 'Стоп'; ui.main.disabled = !!this.stopping; return; }
    if (this.busy && this.mainOverride) return;
    ui.main.disabled = false;
    ui.main.textContent = n ? `Собрать всё на ${bodyLabel(plan.dst)} (${n} ${OGX.fmt.plural(n, ['полёт', 'полёта', 'полётов'])})` : 'Собрать всё' + (plan.dst ? ' на ' + bodyLabel(plan.dst) : '');
  };

  FleetHelp.prototype.rowEl = function (r, allow) {
    const b = r.body;
    const st = this.batchStatus(r.key);
    const tdSrc = h('td', { class: P + 'src' }, h('div', null, bodyLabel(b)),
      h('div', { class: [P + 'muted', r.stale && P + 'stale'] }, r.age ? 'данные: ' + OGX.fmt.ago(r.age) : 'данных нет'));
    const c = r.ok ? r.cargo : r.avail;
    const tdCargo = h('td', { class: [P + 'cargo', !r.ok && P + 'muted'], dataset: { metal: c.metal, crystal: c.crystal, deuterium: c.deuterium, total: r.ok ? r.load : r.total },
      title: (r.ok ? 'Груз: ' : 'Есть на планете (не отправляется): ') + OGX.fmt.res(c) + (r.rule && r.rule.src === 'body' ? ' (своё правило резерва)' : '') },
    (r.ok ? '' : 'есть: ') + `${short(c.metal)}/${short(c.crystal)}/${short(c.deuterium)}`);
    const known = !['nores', 'noships', 'nocoords'].includes(r.code);
    const mark = r.ok ? (r.short217 > 0 ? ' ⚠' : '') : r.code === 'no217' ? ' ✗' : '';
    const td217 = h('td', { class: P + 't217', dataset: { have: r.have217, need: r.need217, use: r.use217, short: r.short217 } },
      known && r.need217 ? `${num(r.use217)} из ${num(r.need217)}${mark}` : known ? num(r.have217) : '—');
    const tdFlight = h('td', { class: P + 'flight', dataset: { duration: r.duration === null ? '' : r.duration, fuel: r.fuel } },
      r.ok && r.duration !== null ? [h('div', null, OGX.fmt.duration(r.duration)), h('div', { class: P + 'muted' }, 'Д ' + num(r.fuel))] : '—');
    // the plan's own state is the status; the last batch result is a second line (it never hides what the plan says now)
    let stText, stCode, bText = null;
    if (r.ok) { stText = r.stale ? 'готов (данные устарели)' : 'готов'; stCode = 'ready'; }
    else if (r.code === 'no217') { stText = 'пропуск'; stCode = 'skip'; }   // the reason is the warn line below
    else { stText = 'пропуск: ' + r.reason; stCode = 'skip'; }
    if (st && st.status === 'sending') { bText = '⏳ отправляется'; stCode = 'sending'; }
    else if (st && st.status === 'sent') { bText = '✓ ' + OGX.fmt.time(st.t) + (st.arrival ? ' → прилёт ' + OGX.fmt.time(st.arrival).slice(0, 5) : ''); stCode = 'sent'; }
    else if (st && st.status === 'unknown') { bText = '? ' + (st.text || 'неизвестно, проверьте флот'); stCode = 'unknown'; }
    else if (st && st.status === 'failed') { bText = '✗ ' + (st.text || 'ошибка'); stCode = 'failed'; }
    else if (st && st.status === 'skipped') { bText = 'не отправлен: ' + (st.text || ''); stCode = 'skipped'; }
    const tdSt = h('td', { class: P + 'status' }, h('div', { class: P + 'pst' }, stText), bText ? h('div', { class: [P + 'bst', P + 'muted'] }, bText) : null);
    const prep = h('button', { class: ['ogx-btn', 'ogx-btn-primary'], 'data-ogx-act': 'fleethelp:prepare', disabled: !r.ok && r.code !== 'noslot', title: r.ok ? 'Груз: ' + OGX.fmt.res(r.cargo) : r.reason,
      onClick: () => this.prepare(r.key) }, 'Подготовить');
    const send = allow ? h('button', { class: ['ogx-btn', 'ogx-btn-danger'], 'data-ogx-act': 'fleethelp:send', disabled: !r.ok || this.sending, onClick: () => this.sendOne(r.key) }, 'Отправить') : null;
    return h('tr', { dataset: { key: r.key, code: r.code, status: stCode }, class: [r.ok ? null : P + 'off', r.stale && P + 'stalerow'] },
      tdSrc, tdCargo, td217, tdFlight, tdSt, h('td', { class: P + 'acts' }, h('div', { class: P + 'actsbox' }, prep, send)));
  };

  FleetHelp.prototype.drawFoot = function (plan, player) {
    const ui = this.ui;
    const t = plan.totals;
    ui.totals.textContent = '';
    ui.totals.appendChild(h('span', { class: P + 'total', dataset: { total: t.load, flights: t.flights } },
      `Итого: ${OGX.fmt.res(t, { short: true })} · ${t.flights} ${OGX.fmt.plural(t.flights, ['полёт', 'полёта', 'полётов'])} · топливо ${short(t.fuel)}`));
    ui.totals.appendChild(h('span', { class: P + 'muted' }, `Источников готово: ${t.flights} из ${plan.rows.length}`));
    if (document.activeElement !== ui.orderSel && ui.orderSel.value !== this.order()) ui.orderSel.value = this.order();
    const s = plan.stats && plan.stats[TRANSPORT];
    const lv = player && player.officers ? +player.officers[607] || 0 : 0;
    ui.cargoInfo.textContent = s ? `${T217}: ${num(s.cargo)} ` + (s.src === 'fleetroom' ? `(измерено ${OGX.fmt.time(s.t)})` : `(расчёт: офицер «Кладовщик» ур. ${lv})`) : '';
    ui.cargoInfo.dataset.cargo = s ? String(s.cargo) : '';
    ui.cargoInfo.dataset.src = s ? String(s.src || '') : '';
  };

  FleetHelp.prototype.drawWalk = function (plan) {
    const ui = this.ui;
    ui.walkBody.textContent = '';
    const w = this.walk && this.walk.target === this.lastTarget ? this.walk : null;
    const ready = plan.rows.filter((r) => r.ok || r.code === 'noslot');
    const nextIdx = w ? w.idx : 0;
    const total = w ? w.keys.length : ready.length;
    const walkBtn = h('button', { class: ['ogx-btn', P + 'next'], 'data-ogx-act': 'fleethelp:next', disabled: !ready.length && !(w && nextIdx < total),
      onClick: () => this.prepareNext() }, w && nextIdx < total ? `Подготовить следующий (${nextIdx + 1}/${total})` : ready.length ? `Подготовить следующий (1/${ready.length})` : 'Подготовить следующий');
    const walkReset = w ? h('button', { class: ['ogx-btn', P + 'walkreset'], 'data-ogx-act': 'fleethelp:walk-reset', onClick: async () => {
      rec('U', 'walk:reset', {});
      await this.saveWalk(null);
      await OGX.fleet.prefill.clear('walk-reset');
      this.refreshTab();
      this.renderWalkBar();
    } }, 'Начать заново') : null;
    ui.walkBody.appendChild(h('div', { class: P + 'walkrow' }, walkBtn, walkReset));
    ui.walkBody.appendChild(h('div', { class: P + 'muted' }, '«Подготовить» открывает отправку флота с заполненными кораблями и грузом; отправляете вы сами.'
      + (isGz() ? ' В этой игре отправка идёт по шагам: корабли → «Continue» → скорость → «Continue» → миссия и груз → «Continue».' : '')));
  };

  FleetHelp.prototype.drawRules = function (bodies) {
    const box = this.ui.rulesBody;
    box.textContent = '';
    const ruleTxt = (r) => {
      const parts = [];
      const rs = RES.filter((k) => r.resources[k]).map((k) => `${RES_RU[k][0]} ${num(r.resources[k])}`);
      if (rs.length) parts.push(rs.join(' · '));
      if (Object.keys(r.ships).length) parts.push(shipsTxt(r.ships));
      return parts.join('; ') || 'ничего';
    };
    const line = (key, label, r, own) => h('div', { class: P + 'rule', dataset: { key } },
      h('span', { class: P + 'rlabel' }, label), h('span', { class: own ? null : P + 'muted' }, own ? ruleTxt(r) : 'по умолчанию'),
      h('button', { class: ['ogx-btn', 'ogx-btn-icon'], 'data-ogx-act': 'fleethelp:keep-edit', title: 'Изменить', onClick: () => { rec('U', 'keep:edit', { key }); this.editRule(key); } }, OGX.dom.icon('note')));
    box.appendChild(line('default', 'По умолчанию', normRule(this.keep.default), true));
    for (const b of orderBodies(bodies)) {
      const own = this.keep.bodies[b.key];
      box.appendChild(line(b.key, bodyLabel(b), own ? normRule(own) : null, !!own));
    }
  };

  // ------------------------------------------------------------------ «Собрать всё»
  FleetHelp.prototype.collectAll = async function () {
    if (this.sending) {
      if (this.stopping) return;
      rec('U', 'collect:stop', {});
      this.stopping = true;
      if (this.abort) this.abort.abort();
      this.setMain('Останавливаю…', true);
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      const bodies0 = (await OGX.state.bodies()) || {};
      const tKey0 = await this.resolveTarget(bodies0);
      rec('U', 'collect:all', { target: tKey0 });
      this.setMain('Обновляю данные…', true);
      const newest = Object.values(bodies0).reduce((m, b) => Math.max(m, b.res && +b.res.t > 0 && +b.shipsT > 0 ? Math.min(+b.res.t, +b.shipsT) : 0), 0);
      await this.ensureFresh({ reason: 'collect', force: OGX.time.serverNow() - newest > 60000, slots: true,
        onProgress: (what) => this.setMain('Обновляю данные… ' + what, true) });
      const bodies = (await OGX.state.bodies()) || {};
      const tKey = await this.resolveTarget(bodies);
      if (!tKey) { OGX.dom.toast('Нет данных о планетах', { type: 'warn' }); return; }
      const slots = await this.slotsFree();
      const plan = await this.computePlan(tKey, { freeSlots: slots.free });
      this.plan = plan;
      this.lastTarget = tKey;
      rec('B', 'collect:rows', { target: tKey, rows: plan.rows.map((r) => ({ key: r.key, code: r.code, ok: r.ok, have217: r.have217, need217: r.need217, use217: r.use217,
        short217: r.short217, load: r.load, fuel: r.fuel, duration: r.duration, stale: r.stale })) });
      this.mainOverride = null;
      if (this.ui) this.drawRows(plan);
      if (!plan.flights.length) {
        const why = plan.excluded.map((x) => `${bodyLabel(plan.bodies[x.key])}: ${x.reason}`).join('; ');
        OGX.dom.toast('Нечего отправлять' + (why ? ' — ' + why : ''), { type: 'warn', ms: 8000 });
        rec('U', 'collect:confirm', { ok: false, flights: 0, excluded: plan.excluded.length, none: true });
        return;
      }
      const ok = await this.confirmFlights(plan, plan.flights, slots, { bulk: true });
      rec('U', 'collect:confirm', { ok, flights: plan.flights.length, excluded: plan.excluded.length });
      if (!ok) return;
      await this.runBatch(plan.flights, plan.dst);
    } finally {
      this.busy = false;
      this.mainOverride = null;
      this.refreshTab();
    }
  };

  /** The one confirm dialog of a send (forced, whatever core.confirmActions says). Resolves true only on «Отправить N». */
  FleetHelp.prototype.confirmFlights = function (plan, flights, slots, { bulk = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      const dst = plan.dst;
      const now = OGX.time.serverNow();
      const lines = flights.map((r) => {
        const warns = [];
        if (r.short217 > 0) warns.push(`не хватает ${num(r.short217)} ${T217}, останется ${short(r.left)}`);
        if (r.stale && r.age) warns.push('данные ' + OGX.fmt.ago(r.age));
        const known = r.duration !== null && r.duration !== undefined && Number.isFinite(+r.duration);
        if (!known) warns.push('время полёта неизвестно');
        const text = `${bodyLabel(r.body)} → ${bodyLabel(dst)} · ${T217} ${num(r.use217)} · М ${num(r.cargo.metal)} · К ${num(r.cargo.crystal)} · Д ${num(r.cargo.deuterium)}`
          + ` · топливо ${num(r.fuel)} · ` + (known ? `${OGX.fmt.duration(r.duration)} (прилёт ${OGX.fmt.time(now + r.duration * 1000)})` : 'время неизвестно');
        return h('tr', { class: P + 'dlg-flight', dataset: { key: r.key, ships: JSON.stringify({ [TRANSPORT]: r.use217 }) } },
          h('td', null, text, warns.length ? h('div', { class: 'ogx-warn' }, '⚠ ' + warns.join('; ')) : null));
      });
      // «Собрать всё» always lists every source it leaves out (§1.3); a per-row send lists none
      const skipped = bulk ? plan.rows.filter((r) => !flights.includes(r)) : [];
      const totals = emptyRes();
      let fuel = 0;
      for (const r of flights) { for (const k of RES) totals[k] += r.cargo[k]; fuel += r.fuel; }
      const body = h('div', { class: P + 'dlg' },
        h('table', { class: ['ogx-table', P + 'dlg-table'] }, h('tbody', null, lines)),
        skipped.length ? h('div', { class: P + 'dlg-skips' }, h('h4', null, 'Не отправляются:'),
          skipped.map((r) => h('div', { class: P + 'dlg-skip', dataset: { key: r.key, code: r.code } }, `${bodyLabel(r.body)} — ${r.reason}`))) : null,
        h('div', { class: P + 'dlg-total' }, `Итого: ${OGX.fmt.res(totals)} · топливо ${num(fuel)} · полётов ${flights.length}`
          + (slots && slots.max ? ` · Свободных слотов: ${slots.free}` : '')));
      const m = OGX.dom.modal({
        title: `Сбор на ${bodyLabel(dst)}`, body, width: 640,
        buttons: [
          { label: 'Отмена', role: 'cancel', onClick: () => fin(false) },
          { label: `Отправить ${flights.length} ${OGX.fmt.plural(flights.length, ['полёт', 'полёта', 'полётов'])}`, role: 'ok', danger: true, onClick: () => fin(true) },
        ],
        onClose: () => fin(false),
      });
      if (m && m.el) m.el.classList.add(P + 'modal', P + 'confirm');
    });
  };

  /** Sends the planned rows through OGX.fleet.sendBatch (confirmed by the caller's dialog). */
  FleetHelp.prototype.runBatch = async function (rows, dst) {
    const t = targetOf(dst);
    if (!t) { OGX.dom.toast('Неизвестные координаты цели', { type: 'error' }); return null; }
    const keepDeut = !!this.set('keepDeuteriumForFuel');
    const flights = rows.map((r) => ({ originId: r.body.id, galaxy: t.galaxy, system: t.system, position: t.position, type: t.type, mission: MISSION_TRANSPORT,
      ships: { [TRANSPORT]: r.use217 }, speed: this.speed(), cargo: Object.assign({}, r.cargo), order: this.order(),
      keepDeut: isGz() && keepDeut ? r.fuel : 0, keepRes: r.rule ? r.rule.resources : null, holdingtime: 0, union: 0, key: r.key, source: NAME }));
    await OGX.fleet.prefill.clear('batch');
    const ac = new AbortController();
    this.abort = ac;
    this.sending = true;
    this.stopping = false;
    const guard = (e) => { e.preventDefault(); e.returnValue = 'Флоты ещё отправляются'; return e.returnValue; };
    window.addEventListener('beforeunload', guard);
    this.batch = { target: dst.key, t: OGX.time.serverNow(), status: {} };
    for (const f of flights) this.batch.status[f.key] = { status: 'sending' };
    if (this.plan && this.ui) this.drawRows(this.plan);
    const t0 = Date.now();
    let res = null;
    try {
      res = await OGX.fleet.sendBatch(flights, { confirmed: true, signal: ac.signal, onEach: (i, r, f) => {
        const ok = !!r.success;
        const r3 = r.result || {};
        this.batch.status[f.key] = ok ? { status: 'sent', t: OGX.time.serverNow(), arrival: r3.arrival || null, cargo: r.cargo || f.cargo }
          : { status: r.unknown ? 'unknown' : 'failed', text: r.message || 'ошибка', step: r.step || null };
        rec('B', 'collect:send', { i, key: f.key, ok, step: r.step || null, message: r.message || '', cargoAsked: f.cargo, cargoSent: r.cargo || null,
          clamped: r.fit ? r.fit.clamped : [], room: r.fit ? r.fit.free : null, arrival: r3.arrival || null, fleetId: r3.fleetId != null ? r3.fleetId : null });
        if (this.plan && this.ui) this.drawRows(this.plan);
      } });
    } finally {
      window.removeEventListener('beforeunload', guard);
      this.sending = false;
      this.abort = null;
    }
    const stopped = !!this.stopping;
    this.stopping = false;
    const abortText = res && res.aborted && !stopped ? 'остановлено после ошибки' : 'остановлено';
    let skipped = 0;
    for (const f of flights) if (this.batch.status[f.key] && this.batch.status[f.key].status === 'sending') { this.batch.status[f.key] = { status: 'skipped', text: abortText }; skipped++; }
    const cargo = emptyRes();
    let fuel = 0;
    flights.forEach((f, i) => {
      const r = res && res.results[i];
      if (!r || !r.success) return;
      const c = r.cargo || f.cargo;
      for (const k of RES) cargo[k] += +c[k] || 0;
      fuel += (r.fit && +r.fit.consumption) || 0;
    });
    const sent = res ? res.sent : 0, failed = res ? res.failed : 0, unknown = res ? res.unknown || 0 : 0;
    rec('B', 'collect:done', { sent, failed, skipped, unknown, stopped, aborted: !!(res && res.aborted), abortReason: res && res.abortReason || null, cargo, fuel, ms: Date.now() - t0 });
    const tail = (skipped ? `, ${abortText} ${skipped}` : '') + (unknown ? ` · неизвестно ${unknown} — проверьте флот` : '');
    OGX.dom.toast(`Сбор: отправлено ${sent} из ${flights.length} · груз ${short(resSum(cargo))} · ошибок ${failed}${tail}`, { type: failed || skipped ? 'warn' : 'ok', ms: 8000 });
    if (unknown) {
      // the server may have accepted those fleets: re-read the origins before anything is planned again
      const keys = flights.filter((f) => this.batch.status[f.key] && this.batch.status[f.key].status === 'unknown').map((f) => f.key);
      OGX.safe(() => OGX.state.refreshBodies({ keys, include: ['fleet'] }), 'fleethelp:unknown-refresh')();
    }
    // only the sent marks survive a reload; failures belong to this batch
    const keep = { target: this.batch.target, t: this.batch.t, status: {} };
    for (const [k, v] of Object.entries(this.batch.status)) if (v && v.status === 'sent') keep.status[k] = v;
    try { await this.ctx.store.set('batch', keep); } catch (e) { /* ignore */ }
    this.refreshTab();
    return res;
  };

  /** Per-row «Отправить» (allowDirectSend): the same batch path with a one-flight confirm. */
  FleetHelp.prototype.sendOne = async function (key) {
    rec('U', 'collect:send-one', { key });
    if (!this.set('allowDirectSend')) { OGX.dom.toast('Прямая отправка выключена в настройках', { type: 'warn' }); return; }
    if (this.sending || this.busy) return;
    this.busy = true;
    try {
      const tKey = await this.resolveTarget(await OGX.state.bodies());
      const plan = await this.computePlan(tKey);
      const row = plan.rows.find((r) => r.key === key);
      if (!plan.dst || !row || !row.ok) { OGX.dom.toast(row ? row.reason : 'Источник не найден', { type: 'warn' }); return; }
      const ok = await this.confirmFlights(plan, [row], await this.slotsFree());
      rec('U', 'collect:confirm', { ok, flights: 1, key });
      if (!ok) return;
      await this.runBatch([row], plan.dst);
    } finally { this.busy = false; this.refreshTab(); }
  };

  // ------------------------------------------------------------------ manual fallback: prefill + walk
  FleetHelp.prototype.findRow = async function (key, targetKey) {
    const tKey = targetKey || await this.resolveTarget(await OGX.state.bodies());
    const plan = await this.computePlan(tKey);
    return { dst: plan.dst, row: plan.rows.find((r) => r.key === key) || null, plan, tKey };
  };

  FleetHelp.prototype.prepare = async function (key, { targetKey, walk } = {}) {
    rec('U', walk ? 'collect:next' : 'collect:prepare', { key, target: targetKey || this.set('collectTarget') || null });
    const { dst, row } = await this.findRow(key, targetKey);
    if (!dst || !row || !(row.ok || row.code === 'noslot')) { OGX.dom.toast(row ? row.reason : 'Источник не найден', { type: 'warn' }); return false; }
    const target = targetOf(dst);
    if (!target) { OGX.dom.toast('Неизвестные координаты цели', { type: 'error' }); return false; }
    const spec = { originId: row.body.id, target, mission: MISSION_TRANSPORT, ships: { [TRANSPORT]: row.use217 }, cargo: row.cargo, speed: this.speed(), source: NAME,
      note: `сбор с ${bodyLabel(row.body)} на ${bodyLabel(dst)}` };
    await this.wPrefill(spec);
    return true;
  };

  /** Next source of the walk toward collectTarget; continues the stored walk whatever page or planet is open (B1/B2). */
  FleetHelp.prototype.prepareNext = async function () {
    const bodies = await OGX.state.bodies();
    const tKey = await this.resolveTarget(bodies);
    let w = this.walk && this.validWalk(this.walk);
    if (w && w.target !== tKey) { rec('B', 'walk:drop', { target: w.target, now: tKey }); w = null; }
    if (!w || w.idx >= w.keys.length) {
      const plan = await this.computePlan(tKey);
      const ready = plan.rows.filter((r) => r.ok);
      const keys = ready.map((r) => r.key);
      const excluded = plan.rows.filter((r) => !r.ok).map((r) => ({ key: r.key, reason: r.reason }));
      if (!keys.length) { OGX.dom.toast('Нет источников для сбора', { type: 'warn' }); rec('U', 'collect:next', { none: true, excluded }); return; }
      w = { v: 2, target: tKey, keys, idx: 0, t: OGX.time.serverNow(), excluded };
      rec('B', 'walk:start', { target: tKey, keys, excluded });
    }
    while (w.idx < w.keys.length) {
      const key = w.keys[w.idx];
      w = Object.assign({}, w, { idx: w.idx + 1, t: OGX.time.serverNow() });
      if (!bodies[key]) { rec('B', 'walk:skip', { key, reason: 'removed' }); continue; }
      const { row } = await this.findRow(key, tKey);
      if (row && (row.ok || row.code === 'noslot')) {
        await this.saveWalk(w);
        await this.prepare(key, { targetKey: tKey, walk: true });
        return;
      }
      rec('B', 'walk:skip', { key, reason: row ? row.reason : 'missing' });
    }
    await this.saveWalk(null);
    OGX.dom.toast('Сбор завершён: все источники пройдены', { type: 'ok' });
    this.refreshTab();
    this.renderWalkBar();
  };

  // ------------------------------------------------------------------ /fleet page
  FleetHelp.prototype.initFleetPage = async function () {
    if (!this.set('showFleetButtons')) { this.renderWalkBar(); return; }
    const f1 = await OGX.dom.waitFor('#fleet1', { timeout: 5000 });
    if (!f1) return;
    this.renderBar1();
    this.renderBar2();
    this.renderWalkBar();
  };

  FleetHelp.prototype.currentKey = function () { const c = OGX.state.current(); return c ? c.key : null; };

  /** Ships on the current body: boot snapshot (inline shipsOnPlanet, fleet.md §2.3), else the DOM (index.blade.php:891-933). */
  FleetHelp.prototype.shipsOnPage = function () {
    if (isGz()) {
      // fleetTable lists only ships with count > 0; the solar satellite (212) has no input (cannot fly)
      const st = OGX.fleet.gz.state();
      const out = {};
      const form = gzShipForm();
      for (const [id, n] of Object.entries((st && st.available) || {})) {
        if (int0(n) > 0 && (!form || form.querySelector('input[name="ship' + id + '"]'))) out[id] = int0(n);
      }
      return out;
    }
    const snap = OGX.state.snapshot && OGX.state.snapshot();
    const fp = snap && snap.fleetPage;
    if (fp && fp.shipsOnPlanet && Object.keys(fp.shipsOnPlanet).length) return normShips(fp.shipsOnPlanet);
    const out = {};
    for (const li of OGX.dom.$$('#fleet1 #technologies li[data-technology]')) {
      const a = li.querySelector('span.amount[data-value]');
      const n = a ? parseInt(a.dataset.value, 10) : 0;
      if (n > 0) out[li.dataset.technology] = n;
    }
    return out;
  };

  /** Resources on the current body now: game resourcesBar via the bridge, else the projected body, else the inline vars. */
  FleetHelp.prototype.resourcesNow = async function () {
    if (isGz()) {
      // the header stock the game's maxResource() uses (#current_<res> data-real, floored)
      const s = OGX.fleet.gz.stock();
      if (s && RES.every((k) => Number.isFinite(s[k]))) return normRes(s);
    }
    try {
      const live = await OGX.bridge.call('resources.live');
      if (live && live.ok && live.metal) {
        const r = emptyRes();
        for (const k of RES) r[k] = Math.floor(+(live[k] && live[k].amount) || 0);
        if (learnCheck('fleethelp.resourcesLive', r)) return r;
      }
    } catch (e) { /* bridge unavailable */ }
    const key = this.currentKey();
    const b = key ? await OGX.state.body(key) : null;
    if (b && b.res) {
      const p = OGX.state.projected(b);
      const r = emptyRes();
      for (const k of RES) r[k] = Math.floor((p.res[k] && p.res[k].amount) || 0);
      return r;
    }
    const snap = OGX.state.snapshot && OGX.state.snapshot();
    const fr = snap && snap.fleetPage && snap.fleetPage.resources;
    return fr ? normRes(fr) : emptyRes();
  };

  FleetHelp.prototype.renderBar1 = function () {
    const old = document.getElementById(P + 'bar1');
    if (old) old.remove();
    // before the ship list (#buttonz, index.blade.php:881) or the no-ships warning (:862): inside the page flow, not under
    // the fixed-height #allornone/.footer box
    const anchor = OGX.dom.$('#fleet1 #buttonz') || OGX.dom.$('#fleet1 #warning');
    const host = anchor ? anchor.parentNode : OGX.dom.$('#fleet1');
    if (!host) return;
    const noShips = !!OGX.dom.$('#fleet1 #warning') || !Object.keys(this.shipsOnPage()).length;
    const key = this.currentKey();
    const rule = this.ruleFor(key);
    const bar = h('div', { id: P + 'bar1', class: ['ogx-root', P + 'bar'] },
      h('span', { class: P + 'label' }, 'Infinity:'),
      h('button', { class: 'ogx-btn', id: P + 'allbut', 'data-ogx-act': 'fleethelp:all-but-keep', disabled: noShips, title: 'Выбрать все корабли, кроме резерва', onClick: () => this.selectAllButKeep() }, 'Всё, кроме резерва'),
      h('button', { class: 'ogx-btn', id: P + 'transport', 'data-ogx-act': 'fleethelp:transport', disabled: noShips, title: 'Выбрать транспорты для ресурсов планеты (минус резерв)', onClick: () => this.selectTransport() }, 'Транспорт для ресурсов'),
      h('a', { href: '#', class: P + 'keeplink', 'data-ogx-act': 'fleethelp:keep-link', title: 'Изменить резерв этой планеты',
        onClick: (e) => { e.preventDefault(); rec('U', 'keep:edit', { key, from: 'fleet' }); this.editRule(key || 'default'); } },
      'резерв: ' + (ruleIsEmpty(rule) ? 'нет' : (rule.src === 'body' ? 'свой' : 'по умолчанию'))),
      h('span', { class: P + 'status', id: P + 'status1' }));
    if (anchor) host.insertBefore(bar, anchor);
    else host.appendChild(bar);
  };

  FleetHelp.prototype.renderBar2 = function () {
    const old = document.getElementById(P + 'bar2');
    if (old) old.remove();
    // below the cargo box: #resources (index.blade.php:1326) sits in a div.border5px; the bar goes after that box
    const res = OGX.dom.$('#fleet2 #resources');
    const anchor = res ? res.parentNode : null;
    const host = anchor ? anchor.parentNode : OGX.dom.$('#fleet2');
    if (!host) return;
    const bar = h('div', { id: P + 'bar2', class: ['ogx-root', P + 'bar', P + 'bar2'] },
      h('button', { class: 'ogx-btn', id: P + 'allres', 'data-ogx-act': 'fleethelp:all-res-but-keep', title: 'Загрузить все ресурсы, кроме резерва и топлива', onClick: () => this.loadAllButKeep() }, 'Все ресурсы, кроме резерва'),
      h('span', { class: P + 'status', id: P + 'status2' }));
    if (anchor && anchor.nextSibling) host.insertBefore(bar, anchor.nextSibling);
    else host.appendChild(bar);
  };

  FleetHelp.prototype.updateFleetBars = function () {
    if (!OGX.page.is('fleet') || !this.set('showFleetButtons')) return;
    if (document.getElementById(P + 'bar1')) { if (isGz()) this.renderBar1Gz(); else this.renderBar1(); }
  };

  FleetHelp.prototype.status = function (n, text) {
    const el = document.getElementById(P + 'status' + n);
    if (el) el.textContent = text || '';
  };

  FleetHelp.prototype.selectAllButKeep = async function () {
    const key = this.currentKey();
    const rule = this.ruleFor(key);
    const have = this.shipsOnPage();
    const ships = minusShips(have, rule.ships);
    rec('U', 'fleet:all-but-keep', { key, have, keep: rule.ships, ships });
    learnCheck('fleethelp.selectAll', ships);
    if (!Object.keys(ships).length) { OGX.dom.toast('Все корабли в резерве', { type: 'warn' }); this.status(1, 'всё в резерве'); return; }
    const r = await this.wSelect(ships);
    this.status(1, r && r.ok ? 'выбрано: ' + shipsTxt(ships) : 'не удалось выбрать корабли');
  };

  /** «Транспорт для ресурсов»: Battle Transporters only, fuel-aware count for the body's resources minus keep (§5). */
  FleetHelp.prototype.selectTransport = async function () {
    const key = this.currentKey();
    const rule = this.ruleFor(key);
    const stats = await OGX.state.shipStats();
    const cap = (stats && stats[TRANSPORT] && +stats[TRANSPORT].cargo) || 0;
    const res = await this.resourcesNow();
    const avail = emptyRes();
    for (const k of RES) avail[k] = Math.max(0, res[k] - rule.resources[k]);
    const total0 = resSum(avail);
    const onPage = this.shipsOnPage();
    const have217 = Math.max(0, int0(onPage[TRANSPORT]) - int0(rule.ships[TRANSPORT]));
    // fuel toward the form's target (prefill / GET), else collectTarget when it is another body, else none
    const cur = OGX.state.current() || {};
    const from = cur.coords || null;
    let to = null;
    try {
      const st = isGz() ? OGX.fleet.gz.state() : null;
      const tg = st && st.target;
      if (tg && +tg.galaxy > 0 && +tg.system > 0 && +tg.position > 0) to = `${+tg.galaxy}:${+tg.system}:${+tg.position}`;
    } catch (e) { to = null; }
    if (to && to === from) to = null;
    if (!to) {
      const tk = this.set('collectTarget');
      const bodies = await OGX.state.bodies();
      if (tk && tk !== key && bodies[tk] && bodies[tk].coords) to = bodies[tk].coords;
    }
    const fuelFn = to && from
      ? async (n) => Math.ceil(+(await OGX.fleet.estimate({ from, to, ships: { [TRANSPORT]: n }, mission: MISSION_TRANSPORT, speedPct: this.speed() })).fuelBudget || 0)
      : async () => 0;
    const c = total0 > 0 && cap > 0 ? await count217({ avail, cap, fuelFn, keepDeutForFuel: !!this.set('keepDeuteriumForFuel'), gz: isGz() }) : { n: 0, fuel: 0, total: total0 };
    const need = c.n, use = Math.min(need, have217), shortN = need - use;
    const ships = use > 0 ? { [TRANSPORT]: use } : {};
    rec('U', 'fleet:transport', { key, total: c.total, have217, need217: need, use217: use, short217: shortN, cap, fuel: c.fuel, to, ships });
    learnValue('fleethelp.transportTotal', c.total, { min: 0, int: true });
    if (!total0) { OGX.dom.toast('Нет ресурсов сверх резерва', { type: 'warn' }); this.status(1, 'ресурсы в резерве'); return; }
    if (!(cap > 0)) { this.status(1, `${T217}: вместимость неизвестна`); return; }
    if (!have217) {
      const txt = `${T217}: нет на планете, нужно ${num(need)}`;
      OGX.dom.toast(txt, { type: 'warn' });
      this.status(1, txt);
      return;
    }
    const r = await this.wSelect(ships);
    const noFuel = to ? '' : ', без учёта топлива';
    const room = use * cap - (isGz() ? c.fuel : 0);
    const txt = shortN > 0
      ? `${T217}: есть ${num(have217)}, нужно ${num(need)}, не хватает ${num(shortN)} — выбрано ${num(use)} (вместимость ${short(room)} для ${short(c.total)}${noFuel})`
      : `${T217}: выбрано ${num(use)} из ${num(have217)} (хватает${noFuel})`;
    this.status(1, r && r.ok ? txt : 'не удалось выбрать корабли');
    if (shortN > 0) OGX.dom.toast(`Не хватает ${num(shortN)} ${T217}`, { type: 'warn' });
  };

  /** Fuel shown by the game (#consumption, index.blade.php:1289), 0 without game JS. */
  function consumptionShown() {
    const el = OGX.dom.$('#fleet2 #consumption');
    if (!el) return 0;
    const m = /([\d.,\s]+)/.exec(el.textContent || '');
    const n = m ? OGX.util.parseGameNumber(m[1].trim()) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  FleetHelp.prototype.loadAllButKeep = async function () {
    if (isGz()) return this.loadAllButKeepGz();
    const key = this.currentKey();
    const rule = this.ruleFor(key);
    let st = null;
    try { st = await OGX.bridge.call('fleet.state'); } catch (e) { st = null; }
    const stats = Object.assign({}, await OGX.state.shipStats());
    let ships = {};
    if (st && st.ok && Array.isArray(st.shipsToSend)) {
      for (const s of st.shipsToSend) if (s && int0(s.number) > 0) ships[s.id] = int0(s.number);
      // the game's own effective values after check-target (fleet.md §3.2)
      if (st.shipsData) for (const [id, d] of Object.entries(st.shipsData)) if (d && +d.baseCargoCapacity > 0 && +d.speed > 0) stats[id] = Object.assign({}, stats[id] || {}, { cargo: +d.baseCargoCapacity });
    } else {
      // no dispatcher: read the step-1 inputs
      for (const li of OGX.dom.$$('#fleet1 #technologies li[data-technology]')) {
        const inp = li.querySelector('input');
        const n = inp ? int0(OGX.util.parseGameNumber(inp.value)) : 0;
        if (n > 0) ships[li.dataset.technology] = n;
      }
    }
    if (!Object.keys(ships).length) {
      rec('U', 'fleet:all-res-but-keep', { key, ships: {} });
      OGX.dom.toast('Сначала выберите корабли', { type: 'warn' });
      this.status(2, 'нет выбранных кораблей');
      return;
    }
    const capacity = OGX.calc.fleetCargo(ships, stats);
    const res = await this.resourcesNow();
    let fuel = consumptionShown();
    const tp = st && st.targetPlanet;
    const cur = OGX.state.current();
    if (tp && +tp.galaxy && cur && cur.coords) {
      try {
        const est = await OGX.fleet.estimate({ from: cur.coords, to: `${tp.galaxy}:${tp.system}:${tp.position}`, ships, mission: +st.mission || MISSION_TRANSPORT,
          speedPct: +st.speedPercent || 10, holdingHours: [5, 15].includes(+st.mission) ? (+st.mission === 15 ? +st.expeditionTime : +st.holdingTime) || 0 : 0 });
        if (Number.isFinite(est.fuelBudget)) fuel = Math.max(fuel, Math.ceil(est.fuelBudget));
      } catch (e) { this.log.warn('estimate failed', e); }
    }
    learnValue('fleethelp.fuelStep2', fuel, { min: 0 });
    const avail = emptyRes();
    for (const k of RES) avail[k] = Math.max(0, res[k] - rule.resources[k]);
    avail.deuterium = Math.max(0, avail.deuterium - fuel);
    const cargo = fillCargo(avail, capacity);
    rec('U', 'fleet:all-res-but-keep', { key, ships, capacity, fuel, cargo });
    learnCheck('fleethelp.cargo', cargo);
    const r = await this.wCargo(cargo);
    this.status(2, r && r.ok ? `груз ${num(resSum(cargo))} из ${num(capacity)}, топливо ~${num(fuel)}` : 'не удалось заполнить груз');
  };

  /** Ships through the bridge (game dispatcher); DOM inputs as a fallback. */
  FleetHelp.prototype.applyShips = async function (ships) {
    let r = null;
    try { r = await OGX.bridge.call('fleet.selectShips', ships); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (r && r.ok) return { ok: true, via: 'bridge' };
    let n = 0;
    for (const li of OGX.dom.$$('#fleet1 #technologies li[data-technology]')) {
      const inp = li.querySelector('input');
      if (!inp) continue;
      const want = int0(ships[li.dataset.technology]);
      inp.value = want ? String(want) : '';
      for (const t of ['keyup', 'focusout', 'change']) inp.dispatchEvent(new Event(t, { bubbles: true }));
      if (want) n++;
    }
    return { ok: n > 0, via: 'dom', n };
  };

  /** Cargo through the bridge; DOM inputs (#metal/#crystal/#deuterium) as a fallback. */
  FleetHelp.prototype.applyCargo = async function (cargo) {
    if (isGz()) {
      // reset: the three fields count as empty before clamping (each value is clamped to the room the others leave)
      const r = OGX.fleet.gz.fillCargo(cargo, { reset: true });
      if (!r.ok) return { ok: false, via: 'gz', error: r.error, message: r.message };
      return { ok: !!r.ok, via: 'gz', cargo: r.cargo, free: r.free, clamped: r.clamped || [] };
    }
    let r = null;
    try { r = await OGX.bridge.call('fleet.setCargo', cargo); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (r && r.ok) return { ok: true, via: 'bridge' };
    let n = 0;
    for (const k of RES) {
      const inp = OGX.dom.$('#fleet2 input#' + k);
      if (!inp) continue;
      inp.value = String(cargo[k] || 0);
      for (const t of ['keyup', 'change']) inp.dispatchEvent(new Event(t, { bubbles: true }));
      n++;
    }
    return { ok: n > 0, via: 'dom' };
  };

  // ------------------------------------------------------------------ GALAXYZ dispatch pages
  /** fleetTable ship form (posts to fleetStep1; holds input[name=ship<ID>], fleet.md §1.4). */
  function gzShipForm() {
    return OGX.dom.$$('form[action*="page=fleetStep1"]').find((f) => f.querySelector('input[name^="ship"], td[id^="ship"][id$="_value"]')) || null;
  }

  FleetHelp.prototype.initFleetPageGz = async function () {
    const step = OGX.fleet.gz.step();
    if (this.set('showFleetButtons')) {
      if (step === 0) this.renderBar1Gz();
      if (step === 2) this.renderBar2Gz();
    }
    this.renderWalkBar();
  };

  /** fleetTable: one table row under the Continue row of the ship table (else after «No ship / All ships», tr.alt). Not
   *  above Continue: a taller table pushes the game's button under the fixed #siteFooter on a 900 px screen (verify-r1). */
  FleetHelp.prototype.renderBar1Gz = function () {
    const old = document.getElementById(P + 'bar1row');
    if (old) old.remove();
    const form = gzShipForm();
    const table = form && form.querySelector('table');
    if (!table) return;
    const tbody = table.tBodies[0] || table;
    const rows = Array.from(tbody.rows);
    const alt = rows.find((r) => r.classList.contains('alt'));
    const submitRow = rows.find((r) => r.querySelector('input[type=submit]'));
    const ref = submitRow ? submitRow.nextSibling : alt ? alt.nextSibling : (rows.length ? rows[rows.length - 1] : null);
    const noShips = !Object.keys(this.shipsOnPage()).length;
    const key = this.currentKey();
    const rule = this.ruleFor(key);
    const why = noShips ? 'На этой планете нет кораблей, которые могут летать' : null;
    const bar = h('div', { id: P + 'bar1', class: ['ogx-root', P + 'bar', P + 'bargz'] },
      h('span', { class: P + 'label' }, 'Infinity:'),
      h('button', { type: 'button', class: 'ogx-btn', id: P + 'allbut', 'data-ogx-act': 'fleethelp:all-but-keep', disabled: noShips, title: why || 'Выбрать все корабли, кроме резерва', onClick: () => this.selectAllButKeep() }, 'Всё, кроме резерва'),
      h('button', { type: 'button', class: 'ogx-btn', id: P + 'transport', 'data-ogx-act': 'fleethelp:transport', disabled: noShips, title: why || 'Выбрать транспорты для ресурсов планеты (минус резерв)', onClick: () => this.selectTransport() }, 'Транспорт для ресурсов'),
      h('a', { href: '#', class: P + 'keeplink', 'data-ogx-act': 'fleethelp:keep-link', title: 'Изменить резерв этой планеты',
        onClick: (e) => { e.preventDefault(); rec('U', 'keep:edit', { key, from: 'fleet' }); this.editRule(key || 'default'); } },
      'резерв: ' + (ruleIsEmpty(rule) ? 'нет' : (rule.src === 'body' ? 'свой' : 'по умолчанию'))),
      h('span', { class: P + 'status', id: P + 'status1' }));
    const tr = h('tr', { id: P + 'bar1row', class: P + 'row' }, h('td', { colspan: '4' }, bar));
    if (ref) tbody.insertBefore(tr, ref); else tbody.appendChild(tr);
  };

  /** fleetStep2: one row under the Continue row of the outer form table (like fleetTable), so the game's
   *  #consumption, #fleetPoints and Continue keep their places (verify-r2: a row under «All resources» moved them
   *  44 px down); without a Continue row, under «All resources» (a[href*=maxResources]); else before the form. */
  FleetHelp.prototype.renderBar2Gz = function () {
    for (const id of [P + 'bar2row', P + 'bar2']) { const old = document.getElementById(id); if (old) old.remove(); }
    const form = OGX.dom.$('form[action*="page=fleetStep3"]');
    if (!form) return;
    const all = form.querySelector('a[href*="maxResources()"]');
    const allRow = all ? all.closest('tr') : null;
    const bar = h('div', { id: P + 'bar2', class: ['ogx-root', P + 'bar', P + 'bar2', P + 'bargz'] },
      h('button', { type: 'button', class: 'ogx-btn', id: P + 'allres', 'data-ogx-act': 'fleethelp:all-res-but-keep', title: 'Загрузить все ресурсы, кроме резерва и топлива (металл → кристалл → дейтерий, как «All resources»)', onClick: () => this.loadAllButKeep() }, 'Все ресурсы, кроме резерва'),
      h('span', { class: P + 'status', id: P + 'status2' }));
    const submit = form.querySelector('input[type=submit]');
    const submitRow = submit ? submit.closest('tr') : null;
    const anchorRow = submitRow || allRow;
    if (anchorRow && anchorRow.parentNode) {
      const cols = Math.max(1, Array.from(anchorRow.cells).reduce((a, c) => a + (c.colSpan || 1), 0));
      const tr = h('tr', { id: P + 'bar2row', class: P + 'row' }, h('td', { class: 'transparent', colspan: String(cols) }, bar));
      anchorRow.parentNode.insertBefore(tr, anchorRow.nextSibling);
    } else form.parentNode.insertBefore(bar, form);
  };

  /** fleetStep2: stock (header) minus keep, deuterium minus the flight's consumption, into data.fleetroom - consumption. */
  FleetHelp.prototype.loadAllButKeepGz = async function () {
    const key = this.currentKey();
    const rule = this.ruleFor(key);
    const st = OGX.fleet.gz.state();
    if (!st || !st.ok || st.step !== 2) { this.status(2, 'это не шаг выбора миссии и груза'); return; }
    if (!(+st.capacity > 0)) {
      rec('U', 'fleet:all-res-but-keep', { key, capacity: st.capacity });
      OGX.dom.toast('Грузоподъёмность флота неизвестна (нет data.fleetroom на странице)', { type: 'warn' });
      this.status(2, 'грузоподъёмность неизвестна');
      return;
    }
    const fuel = int0(st.consumption);
    const room = Math.max(0, int0(st.capacity) - fuel);
    const res = await this.resourcesNow();
    learnValue('fleethelp.fuelStep2', fuel, { min: 0 });
    const avail = emptyRes();
    for (const k of RES) avail[k] = Math.max(0, res[k] - rule.resources[k]);
    avail.deuterium = Math.max(0, avail.deuterium - fuel);
    const cargo = fillCargo(avail, room, FILL_ORDER_GZ);
    rec('U', 'fleet:all-res-but-keep', { key, capacity: st.capacity, fuel, room, cargo });
    learnCheck('fleethelp.cargo', cargo);
    const r = await this.wCargo(cargo);
    const loaded = r && r.cargo ? resSum(r.cargo) : resSum(cargo);
    this.status(2, r && r.ok ? `груз ${num(loaded)} из ${num(room)}, топливо ${num(fuel)}` : 'не удалось заполнить груз');
  };

  /** Bar on /fleet while a collect walk is active: names the target, next source / finish. */
  FleetHelp.prototype.renderWalkBar = function () {
    if (!OGX.page.is('fleet')) return;
    const seq = this.walkBarSeq = (this.walkBarSeq || 0) + 1;
    OGX.safe(async () => {
      const bodies = (await OGX.state.bodies()) || {};
      if (seq !== this.walkBarSeq) return;
      const old = document.getElementById(P + 'walkbar');
      if (old) old.remove();
      const w = this.walk;
      if (!w || !w.keys.length) return;
      const host = isGz() ? OGX.dom.$('#inhalt') : (OGX.dom.$('#fleetdispatchcomponent') || OGX.dom.$('#inhalt'));
      if (!host) return;
      const left = w.keys.length - w.idx;
      const dst = bodies[w.target];
      const bar = h('div', { id: P + 'walkbar', class: ['ogx-root', 'ogx-banner', P + 'walkbar'], dataset: { target: w.target } },
        h('span', null, `Сбор на ${dst ? bodyLabel(dst) : w.target}: источник ${Math.min(w.idx, w.keys.length)} из ${w.keys.length}.`),
        left > 0 ? h('button', { class: ['ogx-btn', 'ogx-btn-primary'], 'data-ogx-act': 'fleethelp:walk-next', onClick: () => this.prepareNext() }, `Подготовить следующий (${w.idx + 1}/${w.keys.length})`) : h('span', null, 'Это последний источник.'),
        h('button', { class: 'ogx-btn', 'data-ogx-act': 'fleethelp:walk-stop', onClick: async () => {
          rec('U', 'walk:stop', {});
          await this.saveWalk(null);
          await OGX.fleet.prefill.clear('walk-stop');
          this.renderWalkBar();
          this.refreshTab();
        } }, 'Завершить сбор'));
      const banner = document.getElementById('ogx-fleet-prefill');
      // GALAXYZ: under the page's picture header (div#planet / #fleet1 / #fleet2, 250 px), right before the content (.headerRS)
      const headerRS = isGz() ? OGX.dom.$$('.headerRS', host).find((e) => e.parentNode === host) : null;
      if (headerRS) host.insertBefore(bar, headerRS);
      else if (banner && banner.parentNode === host) host.insertBefore(bar, banner.nextSibling);
      else host.insertBefore(bar, host.firstChild);
    }, 'fleethelp:walkbar')();
  };

  const CSS = `
.${P}bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 8px; padding: 4px 6px; border: 1px solid var(--ogx-border); border-radius: 3px; background: var(--ogx-panel); color: var(--ogx-text); font-size: 11px; clear: both; }
.${P}bar2 { margin: 6px 0; }
.${P}bargz { margin: 2px 0; justify-content: center; text-align: left; border: none; background: transparent; }
tr.${P}row > td { padding: 2px 4px; }
.${P}label { color: var(--ogx-accent); font-weight: bold; }
.${P}keeplink { color: var(--ogx-muted) !important; text-decoration: underline dotted; }
.${P}status { color: var(--ogx-muted); }
.${P}walkbar { margin: 4px 8px; }
.${P}tab { display: flex; flex-direction: column; gap: 8px; }
.${P}head { display: flex; align-items: center; gap: 6px; }
.${P}head select { flex: 1; }
.${P}table td { vertical-align: top; }
.${P}table { width: 100%; table-layout: auto; }
.${P}table td, .${P}table th { padding: 2px 3px; word-break: break-word; }
.${P}acts .ogx-btn { padding: 1px 5px; font-size: 10px; }
.${P}table tr.${P}off td { opacity: .65; }
.${P}acts { white-space: nowrap; }
.${P}table td.${P}avail { white-space: nowrap; word-break: normal; }
.${P}table td.${P}need { word-break: normal; }
.${P}actsbox { display: flex; flex-direction: column; gap: 3px; }
.${P}muted { color: var(--ogx-muted); font-size: 10px; }
.${P}foot { display: flex; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.${P}walk { display: flex; gap: 6px; }
.${P}rules h4, .${P}editor h4 { margin: 6px 0 3px; font-size: 11px; color: var(--ogx-accent); }
.${P}rule { display: flex; align-items: center; gap: 6px; padding: 2px 0; border-bottom: 1px solid var(--ogx-border); }
.${P}rlabel { min-width: 140px; }
.${P}rule > span:nth-child(2) { flex: 1; }
.${P}grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 8px; }
.${P}field { display: flex; flex-direction: column; gap: 1px; font-size: 10px; }
.${P}inp { width: 100%; box-sizing: border-box; }
.${P}statusline { font-size: 10px; color: var(--ogx-muted); }
.${P}notice { white-space: pre-line; }
.${P}cpallow { margin: 4px 0; }
.${P}cpallow[hidden] { display: none; }
.${P}bst { font-size: 10px; }
.${P}statusline.${P}stale, .${P}muted.${P}stale { color: var(--ogx-bad, #e06c6c); }
.${P}all { width: 100%; }
.${P}table tr.${P}warn td { color: var(--ogx-warn, #e0b04c); font-size: 10px; padding-top: 0; }
.${P}table tr.${P}stalerow td.${P}src { box-shadow: inset 2px 0 0 var(--ogx-bad, #e06c6c); }
.${P}table td.${P}cargo, .${P}table td.${P}t217 { white-space: nowrap; word-break: normal; }
.${P}table tr[data-status="sent"] td.${P}status { color: var(--ogx-good, #6cc070); }
.${P}table tr[data-status="failed"] td.${P}status { color: var(--ogx-bad, #e06c6c); }
.${P}orderrow { display: flex; align-items: center; gap: 6px; }
.${P}walkbox summary, .${P}rulesbox summary { cursor: pointer; color: var(--ogx-accent); font-size: 11px; }
.${P}walkrow { display: flex; gap: 6px; margin: 4px 0; }
.${P}dlg-table td { font-size: 11px; padding: 3px 4px; }
.${P}dlg-skips h4 { margin: 8px 0 3px; font-size: 11px; color: var(--ogx-accent); }
.${P}dlg-skip { font-size: 11px; color: var(--ogx-muted); }
.${P}dlg-total { margin-top: 8px; font-size: 11px; }
`;

  OGX.fleethelp = OGX.fleethelp || {};
  OGX.fleethelp._test = { fillCargo, fillByOrder, minusShips, migrateKeep, normRule, planCollect, count217, orderBodies };
})(window.OGX);
