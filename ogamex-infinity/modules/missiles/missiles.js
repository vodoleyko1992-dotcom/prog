/* ogamex-infinity/modules/missiles/missiles.js — Owner: infinity/missiles.
 * Interplanetary missiles (503) against defence: how many are needed to destroy a target's defence, and a launch with an
 * explicit confirmation, from the spy report (messages) and from the galaxy row.
 *
 * Mechanics = 2Moons 1.8 [UPSTREAM jkroepke/2Moons, GALAXYZ is a fork; not yet seen on the live server]:
 *   - includes/classes/missions/MissionCaseMIP.class.php: interceptors (502) of the target stop missiles 1:1. When
 *     interceptors >= missiles every missile is stopped (and that many interceptors are spent); otherwise ALL interceptors
 *     are spent and (missiles - interceptors) hit. A moon target is protected by its PLANET's interceptors (id_luna query).
 *     Primary target 0 ("all"), 502 or a type the planet does not have -> 401 first.
 *   - includes/classes/missions/functions/calculateMIPAttack.php:
 *       totalAttack = hits * attack503 * (1 + 0.1 * attackerWeapons109)
 *       per unit    = (metal + crystal) * (1 + 0.1 * defenderShield110) / 10      <- SHIELD tech in 2Moons (OGame: armour)
 *       order       = primary first, then 401..411, 503 (reslist defense + missile, 502 removed, zero counts removed)
 *       per type    = destroyed = min(floor(totalAttack / perUnit), count); totalAttack -= destroyed * perUnit
 *   - Range: systems |Δ| <= impulse117 * 5 - 1, same galaxy only (FleetFunctions::getMissileRange); silo 44 >= 4; impulse > 0.
 *   - Flight: max(round((30 + 60 * |Δsystem|) / (fleet_speed / 2500)), MIN_FLEET_TIME 5) seconds (GetMIPDuration).
 *   - Launch: POST game.php?page=fleetMissile galaxy, system, planet, type, SendMI, Target (0 = all, else 401..411) from the
 *     current planet (cp) (ShowFleetMissilePage). Answer = info page: "<b>N</b> Missles Deployed. Targeted: X" /
 *     "N межпланетных ракет запущено. Главная цель: X", or an error text (ma_*).
 * The defender tech id is a setting (110 by default, 111 = the OGame rule) because the fork's code is not public.
 *
 * Safety: nothing is sent without a click on «Запустить» AND «Да» in the confirmation window (every launch). No background
 * request. The launch runs under OGX.http.withPlanet (cross-tab lock 'cp', current planet restored afterwards).
 *
 * UI: a badge in the body of every espionage report (messages page), a «🚀» button in foreign galaxy rows, a calculator
 *     window, and the tab «Ракеты» of the side panel. Public API: OGX.missiles (math, planFor, openLaunch, reportFor).
 * Writes: missiles.reports { v:1, items:{ 'g:s:p:t': Entry } } (cap 400), missiles.launches { v:1, items:[...] } (cap 200).
 */
(function (OGX) {
  'use strict';

  const NAME = 'missiles';
  const P = 'ogx-i-mip-';
  const PANEL_ID = 'infinity';
  const IPM = 503;
  const ABM = 502;
  // reslist['defense'] (vars class 400, by id) + reslist['missile'] without 502
  const ORDER = [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 503];
  const DEFENSE_TARGETS = [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411];
  const MIN_FLEET_TIME = 5;
  const CAP_REPORTS = 400;
  const CAP_LAUNCHES = 200;
  const HOUR = 3600000;

  // ================================================================== pure math (no DOM, no storage)
  const price = (id) => {
    const o = OGX.catalog && OGX.catalog.get(id);
    return o && o.price ? { metal: +o.price.metal || 0, crystal: +o.price.crystal || 0 } : null;
  };
  const ipmAttack = () => {
    const o = OGX.catalog && OGX.catalog.get(IPM);
    return (o && o.props && +o.props.attack) || 12000;
  };
  /** Structure points one missile hit has to remove for one unit (PHP evaluation order kept). */
  function unitPoints(id, defTech) {
    const p = price(id);
    if (!p) return null;
    return (p.metal + p.crystal) * (1 + 0.1 * (+defTech || 0)) / 10;
  }
  /** Damage of `hits` missiles that got through. */
  function totalAttack(hits, weapons) { return hits * ipmAttack() * (1 + 0.1 * (+weapons || 0)); }
  /** Effective primary target like MissionCaseMIP (0, 502 or not a defence/missile -> 401). */
  function primaryOf(t) { t = +t || 0; return ORDER.includes(t) ? t : 401; }

  /**
   * One missile strike, exactly like MissionCaseMIP + calculateMIPAttack.
   * in: { missiles, abm, defense: {id: n} (502 ignored), primary, weapons, defTech }
   * out: { intercepted, hits, abmLeft, destroyed: {id: n}, remaining: {id: n}, attackLeft, all: bool }
   */
  function impact({ missiles, abm = 0, defense = {}, primary = 0, weapons = 0, defTech = 0 }) {
    missiles = Math.max(0, Math.floor(+missiles || 0));
    abm = Math.max(0, Math.floor(+abm || 0));
    const remaining = {};
    for (const id of ORDER) if (+defense[id] > 0) remaining[id] = Math.floor(+defense[id]);
    const out = { intercepted: 0, hits: 0, abmLeft: abm, destroyed: {}, remaining, attackLeft: 0, all: false };
    const done = () => { out.all = Object.values(out.remaining).every((n) => !(n > 0)); return out; };
    if (abm >= missiles) { out.intercepted = missiles; out.abmLeft = abm - missiles; return done(); }
    out.intercepted = abm;
    out.abmLeft = 0;
    out.hits = missiles - abm;
    let attack = totalAttack(out.hits, weapons);
    const first = primaryOf(primary);
    const order = remaining[first] > 0 ? [first, ...ORDER.filter((x) => x !== first)] : ORDER.slice();
    for (const id of order) {
      const count = remaining[id];
      if (!(count > 0)) continue;
      const sp = unitPoints(id, defTech);
      if (!(sp > 0)) continue;
      const d = Math.min(Math.floor(attack / sp), count);
      attack -= d * sp;
      if (d > 0) { out.destroyed[id] = d; remaining[id] = count - d; }
      if (attack <= 0) break;
    }
    out.attackLeft = Math.max(0, attack);
    return done();
  }

  /** Smallest n with pred(impact(n)) true; closed-form start, then verified with impact() (float floors). */
  function smallest(start, pred, base) {
    let n = Math.max(0, Math.floor(start));
    for (let i = 0; i < 6 && n > 0 && pred(impact(Object.assign({}, base, { missiles: n - 1 }))); i++) n--;
    for (let i = 0; i < 64 && !pred(impact(Object.assign({}, base, { missiles: n }))); i++) n++;
    return n;
  }

  /**
   * How many missiles are needed.
   * in: { defense, abm, weapons, defTech, primary, reservePct }
   * out: { total (structure points), perMissile, needAll, needPrimary, primary, units, empty, reserve } — needAll includes
   *      the interceptors (each stops one missile); +reservePct is added on top (rounded up) as needAllSafe.
   */
  function plan({ defense = {}, abm = 0, weapons = 0, defTech = 0, primary = 0, reservePct = 0 } = {}) {
    abm = Math.max(0, Math.floor(+abm || 0));
    const per = ipmAttack() * (1 + 0.1 * (+weapons || 0));
    const units = [];
    let total = 0;
    for (const id of ORDER) {
      const n = Math.floor(+defense[id] || 0);
      if (!(n > 0)) continue;
      const sp = unitPoints(id, defTech);
      units.push({ id, count: n, points: sp, sum: n * sp });
      total += n * sp;
    }
    const base = { abm, defense, primary, weapons, defTech };
    const out = { total, perMissile: per, abm, units, empty: !units.length, primary: primaryOf(primary), needAll: 0, needPrimary: 0, needAllSafe: 0 };
    if (out.empty) return out;
    out.needAll = smallest(abm + Math.ceil(total / per), (r) => r.all, base);
    const pu = units.find((u) => u.id === out.primary);
    if (pu) out.needPrimary = smallest(abm + Math.ceil(pu.sum / per), (r) => !(r.remaining[out.primary] > 0), Object.assign({}, base, { primary: out.primary }));
    const extra = Math.ceil((out.needAll - abm) * Math.max(0, +reservePct || 0) / 100);
    out.needAllSafe = out.needAll + extra;
    return out;
  }

  const missileRange = (impulse) => Math.max((+impulse || 0) * 5 - 1, 0);
  /** fleetSpeed = universe multiplier (fleet_speed / 2500, Aeternum 7). */
  function flightSecs(fromSystem, toSystem, fleetSpeed) {
    const d = Math.abs((+fromSystem || 0) - (+toSystem || 0));
    return Math.max(Math.round((30 + 60 * d) / (+fleetSpeed > 0 ? +fleetSpeed : 1)), MIN_FLEET_TIME);
  }
  function inRange(from, to, impulse) {
    const a = parseC(from), b = parseC(to);
    if (!a || !b || a[0] !== b[0]) return false;
    return Math.abs(a[1] - b[1]) <= missileRange(impulse);
  }
  function parseC(c) {
    const s = OGX.util && OGX.util.coords ? OGX.util.coords(c) : (Array.isArray(c) ? c.join(':') : c);
    if (!s) return null;
    const a = String(s).split(':').map(Number);
    return a.length >= 3 && a.every(Number.isFinite) ? a : null;
  }
  /** Launch answer text -> { ok: true, count } | { ok: false, message } | { ok: null } (unknown). */
  function launchResult(text) {
    const t = String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return { ok: null, message: '' };
    const m = /(\d[\d.\s]*)\s*(?:Missles Deployed|missiles? (?:were )?(?:deployed|sent|launched)|межпланетн\S* ракет\S* (?:запущен|отправлен))/i.exec(t);
    if (m) return { ok: true, count: +m[1].replace(/\D/g, ''), message: t };
    return { ok: false, message: t };
  }

  const math = { ORDER, DEFENSE_TARGETS, unitPoints, totalAttack, primaryOf, impact, plan, missileRange, flightSecs, inRange, launchResult };
  OGX.missiles = Object.assign(OGX.missiles || {}, { math });

  // ================================================================== module
  const rec = (src, what, data) => { try { return OGX.log.rec(src, NAME, what, data); } catch (e) { return null; } };
  const h = (...a) => OGX.dom.h(...a);
  const num = (n) => OGX.fmt.num(n);
  const isGz = () => !!(OGX.page && OGX.page.isGz && OGX.page.isGz());
  const keyOf = (coords, type) => `${OGX.util.coords(coords)}:${+type === 3 ? 3 : 1}`;
  const typeName = (t) => (+t === 3 ? 'луна' : 'планета');
  /** Element.append without the null/false entries (append(null) would print "null"). */
  const add = (el, ...xs) => el.append(...xs.filter((x) => x !== null && x !== undefined && x !== false));

  OGX.module({
    name: NAME,
    title: 'Межпланетные ракеты: снос обороны',
    pages: '*',
    settings: {
      showBadges: { type: 'bool', default: true, label: 'Расчёт ракет в шпионских докладах' },
      showGalaxy: { type: 'bool', default: true, label: 'Кнопка «🚀» в строках галактики' },
      defTech: { type: 'enum', default: 110, label: 'Какая технология цели усиливает оборону против ракет',
        hint: '2Moons (движок сервера): щитовая технология. В OGame — броня. Поменяйте, если боевой доклад ракет покажет другое',
        options: [{ value: 110, label: 'Щитовая технология (2Moons)' }, { value: 111, label: 'Броня (как в OGame)' }] },
      unknownTech: { type: 'enum', default: 'own', label: 'Если технология цели не видна в докладе',
        options: [{ value: 'own', label: 'Считать как мою' }, { value: 'zero', label: 'Считать 0 (меньше ракет, риск недобора)' }] },
      reservePct: { type: 'int', default: 0, min: 0, max: 200, label: 'Запас ракет сверх расчёта, %', hint: 'На случай новых перехватчиков или обороны после доклада' },
      maxAgeHours: { type: 'int', default: 168, min: 1, max: 2160, label: 'Хранить данные докладов, ч' },
    },
    async init(ctx) {
      const m = new Missiles(ctx);
      ctx._mip = m;
      await m.start();
    },
    dispose(ctx) { if (ctx._mip) ctx._mip.stop(); },
  });

  function migrate(v, arr) {
    if (arr) return v && v.v === 1 && Array.isArray(v.items) ? v : { v: 1, items: [] };
    return v && v.v === 1 && v.items && typeof v.items === 'object' ? v : { v: 1, items: {} };
  }

  function Missiles(ctx) {
    this.ctx = ctx;
    this.log = ctx.log;
    this.reports = { v: 1, items: {} };
    this.launches = { v: 1, items: [] };
    this.env = null;
    this.offs = [];
    this.badges = new Map();
    this.busy = false;
    this.refreshSoon = OGX.util.debounce(OGX.safe(() => this.refresh(), 'missiles:refresh'), 150);
    this.wLaunch = OGX.log.wrap(NAME, (q) => this.post(q), 'launch');
  }
  Missiles.prototype.set = function (k) { return this.ctx.settings.get(k); };

  Missiles.prototype.start = async function () {
    const ctx = this.ctx;
    ctx.css(CSS);
    this.reports = migrate(await ctx.store.get('reports', null));
    this.launches = migrate(await ctx.store.get('launches', null), true);
    await this.loadEnv();
    Object.assign(OGX.missiles, {
      // plan(report) / planFor(report): report = parse.espionageFull result or a stored entry -> { need, needAll, abm, units, ... }
      plan: (r, o) => this.planFor(r, o),
      planFor: (r, o) => this.planFor(r, o),
      reportFor: (coords, type) => this.reportFor(coords, type),
      // openLaunch({ coords: [g,s,p] | 'g:s:p', planetType | type, report? }): calculator window; launch only after confirmation
      openLaunch: (t) => this.openFrom(t),
      openCalc: (t) => this.openFrom(t),
    });
    this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
    this.tab = this.panel.addTab({ id: 'missiles', label: 'Ракеты', order: 45, render: (c) => this.render(c) });
    this.offs.push(ctx.store.subscribe('reports', (v) => { this.reports = migrate(v); this.refreshSoon(); }));
    this.offs.push(ctx.store.subscribe('launches', (v) => { this.launches = migrate(v, true); this.refreshSoon(); }));
    this.offs.push(OGX.state.onChange(['bodies', 'research'], async () => { await this.loadEnv(); this.refreshSoon(); }));
    this.offs.push(ctx.settings.onChange(() => this.refreshSoon()));
    if (OGX.page.is('messages') && this.set('showBadges') !== false) this.offs.push(OGX.messages.watch((item) => this.onItem(item)));
    if (OGX.page.is('galaxy') && this.set('showGalaxy') !== false && OGX.galaxy && OGX.galaxy.onRender) {
      this.offs.push(OGX.galaxy.onRender((ev) => OGX.safe(() => this.renderRows(ev), 'missiles:galaxy')()));
    }
    rec('B', 'init', { reports: Object.keys(this.reports.items).length, page: OGX.page.info().name });
  };
  Missiles.prototype.stop = function () {
    for (const off of this.offs) { try { off && off(); } catch (e) { /* ignore */ } }
    this.offs = [];
  };

  Missiles.prototype.loadEnv = async function () {
    const [bodies, research, server] = await Promise.all([OGX.state.bodies(), OGX.state.research(), OGX.state.server()]);
    let fleetSpeed = 7;
    try { fleetSpeed = OGX.calc.config(server).fleetSpeed || 7; } catch (e) { fleetSpeed = 7; }
    const lv = (research && research.levels) || {};
    const cur = OGX.state.current() || null;
    this.env = { bodies: bodies || {}, levels: lv, researchKnown: !!(research && research.t), fleetSpeed, cur };
    return this.env;
  };

  // ------------------------------------------------------------------ reports
  /** parse.espionageFull result -> stored entry (null when it has no coordinates). */
  function entryOf(f) {
    if (!f || !f.target || !f.target.coords) return null;
    const def = {};
    for (const [id, n] of Object.entries(f.defense || {})) if (+n > 0) def[id] = +n;
    const rs = f.research || {};
    return {
      key: keyOf(f.target.coords, f.target.planetType), coords: OGX.util.coords(f.target.coords), type: f.target.planetType === 3 ? 3 : 1,
      name: f.target.name || null, msgId: f.id || null, ts: f.ts || OGX.time.serverNow(),
      known: { defense: !!(f.known && f.known.defense), research: !!(f.known && f.known.research) },
      defense: def, abm: +(f.defense || {})[ABM] || 0, ipm: +(f.defense || {})[IPM] || 0,
      research: f.known && f.known.research ? { 109: rs[109] ?? null, 110: rs[110] ?? null, 111: rs[111] ?? null } : null,
      predicted: null,
    };
  }
  Missiles.prototype.saveEntry = async function (e) {
    if (!e) return;
    const maxAge = (this.set('maxAgeHours') || 168) * HOUR;
    const now = OGX.time.serverNow();
    const prev = this.reports.items[e.key];
    if (prev && (prev.ts || 0) > (e.ts || 0)) return;            // keep the newest report per target
    if (prev && prev.msgId === e.msgId && prev.predicted) e.predicted = prev.predicted;
    this.reports.items[e.key] = e;
    this.reports = await this.ctx.store.update('reports', (old) => {
      const o = migrate(old);
      const p = o.items[e.key];
      if (!p || (p.ts || 0) <= (e.ts || 0)) o.items[e.key] = Object.assign({}, e, { predicted: p && p.msgId === e.msgId ? p.predicted : e.predicted });
      for (const [k, v] of Object.entries(o.items)) if (!v || (v.ts && now - v.ts > maxAge)) delete o.items[k];
      const keys = Object.keys(o.items);
      if (keys.length > CAP_REPORTS) keys.sort((a, b) => (o.items[b].ts || 0) - (o.items[a].ts || 0)).slice(CAP_REPORTS).forEach((k) => delete o.items[k]);
      return o;
    }, null);
  };
  Missiles.prototype.reportFor = function (coords, type) { return this.reports.items[keyOf(coords, type)] || null; };

  /** Interceptors that protect a target: a moon is protected by its planet's (MissionCaseMIP id_luna). */
  Missiles.prototype.abmFor = function (e) {
    if (!e) return { abm: 0, known: false, src: null };
    if (e.type !== 3) return { abm: e.abm || 0, known: !!e.known.defense, src: 'report' };
    const pl = this.reports.items[keyOf(e.coords, 1)];
    if (pl && pl.known.defense) return { abm: pl.abm || 0, known: true, src: 'planet' };
    return { abm: 0, known: false, src: 'planet-unknown' };
  };
  /** Tech level of the defender used in the formula: report value, else the setting rule. */
  Missiles.prototype.techFor = function (e) {
    const id = +this.set('defTech') === 111 ? 111 : 110;
    const v = e && e.research ? e.research[id] : null;
    if (v !== null && v !== undefined) return { id, level: +v, known: true };
    const own = this.set('unknownTech') === 'zero' ? 0 : +(this.env.levels[id] || 0);
    return { id, level: own, known: false };
  };
  /** Plan for a stored entry (or a parse.espionageFull result) with the current settings. */
  Missiles.prototype.planFor = function (r, o = {}) {
    const e = r && r.key ? r : entryOf(r);
    if (!e) return null;
    const usePred = o.usePredicted !== false && e.predicted && e.predicted.at > (e.ts || 0);
    const src = usePred ? e.predicted : e;
    const a = usePred ? { abm: e.predicted.abm, known: true, src: 'predicted' } : this.abmFor(e);
    const t = o.defTech !== undefined ? { id: +this.set('defTech') === 111 ? 111 : 110, level: +o.defTech, known: true } : this.techFor(e);
    const weapons = o.weapons !== undefined ? +o.weapons : +(this.env.levels[109] || 0);
    const abm = o.abm !== undefined ? +o.abm : a.abm;
    const p = plan({ defense: src.defense, abm, weapons, defTech: t.level, primary: o.primary || 0, reservePct: this.set('reservePct') || 0 });
    return Object.assign(p, { entry: e, predicted: !!usePred, abmKnown: a.known, abmSrc: a.src, tech: t, weapons, defenseKnown: !!e.known.defense,
      need: p.empty ? 0 : p.needAllSafe });
  };

  // ------------------------------------------------------------------ own missiles
  /** Own planets that can fire at `coords`: [{ key, id, name, coords, missiles (null = unknown), silo, inRange, flight }] */
  Missiles.prototype.sources = function (coords) {
    const env = this.env;
    const impulse = +(env.levels[117] || 0);
    const out = [];
    let headerMissiles = null;
    if (OGX.page.is('galaxy')) { try { headerMissiles = OGX.galaxy.gz.header(document).missiles; } catch (e) { headerMissiles = null; } }
    for (const b of Object.values(env.bodies)) {
      if (!b || b.type !== 'planet' || !b.coords) continue;
      let n = b.defense && b.defense[IPM] !== undefined ? +b.defense[IPM] : null;
      if (n !== null) {
        const since = b.defenseT || 0;
        for (const l of this.launches.items) if (l.ok && l.fromKey === b.key && l.t > since) n -= l.count;
        n = Math.max(0, n);
      }
      if (env.cur && env.cur.key === b.key && headerMissiles !== null && headerMissiles !== undefined) n = +headerMissiles;
      const silo = b.levels && b.levels[44] !== undefined ? +b.levels[44] : null;
      const a = parseC(b.coords), t = parseC(coords);
      out.push({ key: b.key, id: b.id, name: b.name, coords: b.coords, missiles: n, silo,
        inRange: !!(a && t && impulse > 0 && inRange(b.coords, coords, impulse)),
        flight: a && t && a[0] === t[0] ? flightSecs(a[1], t[1], env.fleetSpeed) : null, current: !!(env.cur && env.cur.key === b.key) });
    }
    out.sort((x, y) => (y.inRange - x.inRange) || ((y.missiles || 0) - (x.missiles || 0)) || ((x.flight || 1e9) - (y.flight || 1e9)));
    return { list: out, impulse, range: missileRange(impulse) };
  };

  // ------------------------------------------------------------------ messages
  Missiles.prototype.onItem = function (item) {
    if (!item || item.key !== 'espionage_report' || !item.li) return;
    let f = null;
    try { f = OGX.messages.parse.espionageFull(item.li); } catch (e) { f = null; }
    const e = entryOf(f);
    if (!e) { this.log.warn('report not parsed', item.id); return; }
    OGX.safe(() => this.saveEntry(e), 'missiles:save')();
    const td = item.body || (item.li.nextElementSibling && item.li.nextElementSibling.querySelector('td'));
    if (!td) return;
    let el = td.querySelector(`:scope > .${P}badge`);
    if (!el) {
      el = h('div', { class: P + 'badge ogx-root', dataset: { msgId: String(item.id || '') } });
      const spyBadge = td.querySelector(':scope > .ogx-i-spy-badge');
      if (spyBadge) spyBadge.after(el); else td.insertBefore(el, td.firstChild);
    }
    this.badges.set(item.id, { el, key: e.key });
    this.fillBadge(el, e.key);
  };
  Missiles.prototype.fillBadge = function (el, key) {
    const e = this.reports.items[key];
    el.textContent = '';
    if (!e) return;
    const p = this.planFor(e);
    const parts = [h('span', { class: P + 'icon' }, '🚀')];
    if (!e.known.defense) parts.push(h('span', { class: P + 'muted' }, 'Ракеты: оборона не раскрыта (нужно больше зондов)'));
    else if (p.empty) parts.push(h('span', { class: P + 'muted' }, `Обороны нет${p.abm ? `, перехватчиков ${num(p.abm)}` : ''}`));
    else {
      parts.push(h('span', { class: P + 'need', title: this.planTitle(p) }, `Снос обороны: ${num(p.need)} МПР`));
      parts.push(h('span', { class: P + 'muted' }, `перехв. ${p.abmKnown ? num(p.abm) : '?'} · ${p.tech.id === 111 ? 'броня' : 'щит'} ${p.tech.known ? p.tech.level : '≈' + p.tech.level}`));
    }
    parts.push(h('button', { type: 'button', class: ['ogx-btn', 'ogx-btn-primary', P + 'b-open'], 'data-ogx-act': 'missiles:badge-open',
      onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); this.openCalc({ coords: e.coords, type: e.type, name: e.name }); } }, 'Ракеты…'));
    el.append(...parts);
  };
  Missiles.prototype.planTitle = function (p) {
    return [`Прочность обороны: ${num(Math.ceil(p.total))}`, `Урон одной ракеты: ${num(p.perMissile)} (оружейная ${p.weapons})`,
      `Перехватчики: ${p.abmKnown ? num(p.abm) : 'неизвестно'}${p.abmSrc === 'planet' ? ' (с планеты)' : ''}`,
      `${p.tech.id === 111 ? 'Броня' : 'Щитовая'} цели: ${p.tech.level}${p.tech.known ? '' : ' (не видна, допущение)'}`,
      p.predicted ? 'По прогнозу после прошлого залпа' : ''].filter(Boolean).join('\n');
  };

  // ------------------------------------------------------------------ galaxy
  Missiles.prototype.renderRows = async function (ev) {
    if (!ev || !ev.rows) return;
    let sys = null;
    try { sys = OGX.galaxy.last('system'); sys = sys && sys.system; } catch (e) { sys = null; }
    if (!sys || sys.galaxy !== +ev.galaxy || sys.system !== +ev.system) sys = await OGX.galaxy.pageSystem;
    for (const [pos, row] of ev.rows) {
      const p = sys && sys.positions ? sys.positions.find((x) => x.position === pos) : null;
      const old = row.querySelector('.ogx-gx-slot[data-owner="missiles"]');
      if (!p || p.destroyed || p.own || OGX.galaxy.isOwnRow(p)) { if (old) old.remove(); continue; }
      const coords = `${ev.galaxy}:${ev.system}:${pos}`;
      const slot = OGX.galaxy.rowSlot(row, 'missiles');
      slot.textContent = '';
      slot.classList.add(P + 'slot');
      const targets = [{ type: 1, label: '🚀' }];
      if (p.moon) targets.push({ type: 3, label: '🚀Л' });
      for (const t of targets) {
        const e = this.reportFor(coords, t.type);
        const pl = e && e.known.defense ? this.planFor(e) : null;
        const title = !e ? `Ракеты на ${typeName(t.type)} [${coords}]: доклада нет, расчёт вручную`
          : !pl ? `Ракеты на ${typeName(t.type)} [${coords}]: оборона в докладе не раскрыта`
            : pl.empty ? `Ракеты на ${typeName(t.type)} [${coords}]: обороны нет` : `Снос обороны [${coords}] ${typeName(t.type)}: ${num(pl.need)} МПР`;
        slot.appendChild(h('button', { type: 'button', class: [P + 'gx', pl && !pl.empty ? P + 'gx-has' : null], title, 'aria-label': title,
          dataset: { ogxAct: 'missiles:galaxy', pos: String(pos), type: String(t.type) },
          onClick: (x) => { x.preventDefault(); x.stopPropagation(); this.openCalc({ coords, type: t.type, name: p.planetName || null, player: p.playerName || null }); } },
        pl && !pl.empty ? `${t.label} ${OGX.fmt.short(pl.need)}` : t.label));
      }
    }
  };

  // ------------------------------------------------------------------ calculator window
  /** Public entry: stores a passed report first (another module's row), then opens the calculator. */
  Missiles.prototype.openFrom = async function (t = {}) {
    const type = +(t.type || t.planetType) === 3 ? 3 : 1;
    if (t.report) { const e = entryOf(t.report); if (e) await this.saveEntry(e); }
    return this.openCalc({ coords: t.coords, type, name: t.name || (t.report && t.report.target && t.report.target.name) || null });
  };
  Missiles.prototype.openCalc = async function (target) {
    await this.loadEnv();
    const coords = OGX.util.coords(target && target.coords);
    if (!coords) { OGX.dom.toast('Ракеты: нет координат цели', { type: 'error' }); return null; }
    const type = +target.type === 3 ? 3 : 1;
    const e = this.reportFor(coords, type) || { key: keyOf(coords, type), coords, type, name: target.name || null, ts: null,
      known: { defense: false, research: false }, defense: {}, abm: 0, ipm: 0, research: null, predicted: null, manual: true };
    const tech = this.techFor(e);
    const a = this.abmFor(e);
    const usePredDefault = !!(e.predicted && e.predicted.at > (e.ts || 0));
    const st = { primary: 0, count: null, weapons: +(this.env.levels[109] || 0), defTech: tech.level, abm: a.abm, usePred: usePredDefault,
      defense: Object.assign({}, e.defense), from: null };
    const src = this.sources(coords);
    const firstOk = src.list.find((s) => s.inRange && (s.missiles === null || s.missiles > 0));
    st.from = firstOk ? firstOk.key : (src.list[0] ? src.list[0].key : null);
    rec('U', 'calc-open', { coords, type, report: !!e.ts });

    const body = h('div', { class: P + 'calc ogx-root' });
    const inp = (val, onInput, attrs = {}) => h('input', Object.assign({ type: 'number', min: '0', step: '1', value: String(val ?? ''), class: P + 'in',
      onInput: (ev) => { onInput(ev.target.value); draw(); } }, attrs));
    let modal = null;
    const resultBox = h('div', { class: P + 'result' });
    const head = h('div', { class: P + 'head' });
    const form = h('div', { class: P + 'form' });
    const defBox = h('div', { class: P + 'def' });
    body.append(head, form, defBox, resultBox);

    const cur = () => {
      const def = st.usePred && e.predicted ? e.predicted.defense : st.defense;
      const abm = st.usePred && e.predicted ? e.predicted.abm : st.abm;
      return { def, abm };
    };
    const ageText = e.ts ? `доклад ${OGX.fmt.ago ? OGX.fmt.ago(e.ts) : OGX.fmt.dateTime(e.ts)}` : 'доклада нет — введите оборону вручную';
    add(head, h('div', { class: P + 'title' }, `${typeName(type) === 'луна' ? 'Луна' : 'Планета'} ${e.name || ''} [${coords}]`),
      h('div', { class: P + 'muted' }, ageText + (e.ts && !e.known.defense ? ' · оборона в докладе не раскрыта' : '')),
      type === 3 ? h('div', { class: P + 'note' }, a.known ? `Луну защищают перехватчики её планеты: ${num(a.abm)} (из доклада планеты).`
        : 'Луну защищают перехватчики её планеты; доклада планеты нет — проверьте число перехватчиков.') : null);

    // form: primary target, missiles, techs, interceptors, source planet
    const primarySel = h('select', { class: P + 'sel', onChange: (ev) => { st.primary = +ev.target.value; st.count = null; draw(); } },
      [0, ...DEFENSE_TARGETS].map((id) => h('option', { value: String(id) }, id === 0 ? 'Вся оборона (ракетные установки первыми)' : OGX.catalog.name(id))));
    const fromSel = h('select', { class: P + 'sel', onChange: (ev) => { st.from = ev.target.value; draw(); } },
      src.list.map((s) => h('option', { value: s.key, disabled: !s.inRange },
        `${s.name || ''} [${s.coords}] — ${s.missiles === null ? '? МПР' : num(s.missiles) + ' МПР'}${s.inRange ? (s.flight ? ', ' + OGX.fmt.durationShort(s.flight) : '') : ' — вне досягаемости'}`)));
    if (st.from) fromSel.value = st.from;
    const countIn = inp('', (v) => { st.count = v === '' ? null : Math.max(0, Math.floor(+v || 0)); });
    const abmIn = inp(st.abm, (v) => { st.abm = Math.max(0, Math.floor(+v || 0)); st.usePred = false; if (predChk) predChk.checked = false; st.count = null; });
    const wIn = inp(st.weapons, (v) => { st.weapons = Math.max(0, Math.floor(+v || 0)); st.count = null; });
    const tIn = inp(st.defTech, (v) => { st.defTech = Math.max(0, Math.floor(+v || 0)); st.count = null; });
    let predChk = null;
    const techLabel = tech.id === 111 ? 'Броня цели' : 'Щитовая техн. цели';
    add(form,
      row('Главная цель', primarySel),
      row('Перехватчики цели', abmIn, a.known ? null : h('span', { class: P + 'warn' }, ' не видно в докладе')),
      row('Моя оружейная техн.', wIn, this.env.researchKnown ? null : h('span', { class: P + 'warn' }, ' откройте «Исследования»')),
      row(techLabel, tIn, tech.known ? null : h('span', { class: P + 'warn', title: 'Технология цели не раскрыта: нужно больше зондов. Значение — допущение из настроек' }, ' ≈ допущение')),
      row('Откуда', src.list.length ? fromSel : h('span', { class: P + 'warn' }, 'нет данных о планетах — откройте «Империю»')),
      row('Ракет к запуску', countIn, h('span', { class: P + 'muted' }, ' пусто = по расчёту')),
    );
    if (e.predicted && e.predicted.at > (e.ts || 0)) {
      predChk = h('input', { type: 'checkbox', checked: st.usePred, onChange: (ev) => { st.usePred = ev.target.checked; st.count = null; draw(); } });
      form.append(h('label', { class: P + 'pred' }, predChk, ` Считать от прогноза после залпа ${OGX.fmt.time(e.predicted.at)} (${num(e.predicted.sent)} МПР)`));
    }
    function row(label, ...el) { return h('div', { class: P + 'row' }, h('span', { class: P + 'lbl' }, label), ...el.filter(Boolean)); }

    // defence table (editable counts when there is no report)
    const drawDef = () => {
      defBox.textContent = '';
      const { def } = cur();
      const ids = ORDER.filter((id) => +def[id] > 0 || (e.manual && id !== IPM));
      if (!ids.length && e.known.defense) { defBox.append(h('div', { class: P + 'muted' }, 'Обороны нет.')); return; }
      if (!ids.length) { defBox.append(h('div', { class: P + 'muted' }, 'Оборона не раскрыта. Отправьте больше зондов или введите вручную:')); }
      const list = ids.length ? ids : DEFENSE_TARGETS;
      const tb = h('table', { class: P + 'table' }, h('tr', {}, h('th', {}, 'Оборона'), h('th', {}, 'Было'), h('th', {}, 'Снесёт'), h('th', {}, 'Останется')));
      const res = this.lastImpact;
      for (const id of list) {
        const editable = e.manual || !e.known.defense;
        const n = +def[id] || 0;
        const d = res ? res.destroyed[id] || 0 : 0;
        tb.append(h('tr', { class: n > 0 && res && !(res.remaining[id] > 0) ? P + 'gone' : null },
          h('td', {}, OGX.catalog.name(id)),
          h('td', {}, editable ? h('input', { type: 'number', min: '0', step: '1', value: n ? String(n) : '', class: P + 'in ' + P + 'in-s',
            onChange: (ev) => { st.defense[id] = Math.max(0, Math.floor(+ev.target.value || 0)); st.count = null; draw(); } }) : num(n)),
          h('td', { class: d ? P + 'pos' : P + 'muted' }, d ? num(d) : '—'),
          h('td', { class: res && res.remaining[id] > 0 ? P + 'neg' : P + 'muted' }, res ? num(res.remaining[id] || 0) : '—')));
      }
      defBox.append(tb);
    };

    const draw = () => {
      const { def, abm } = cur();
      const p = plan({ defense: def, abm, weapons: st.weapons, defTech: st.defTech, primary: st.primary, reservePct: this.set('reservePct') || 0 });
      const s = src.list.find((x) => x.key === st.from) || null;
      const auto = p.empty ? 0 : (st.primary ? Math.max(p.needPrimary, 0) : p.needAllSafe);
      const n = st.count !== null ? st.count : auto;
      if (st.count === null) countIn.placeholder = String(auto);
      const r = impact({ missiles: n, abm, defense: def, primary: st.primary, weapons: st.weapons, defTech: st.defTech });
      this.lastImpact = r;
      drawDef();
      resultBox.textContent = '';
      if (p.empty) resultBox.append(h('div', { class: P + 'muted' }, 'Сносить нечего.'));
      else {
        add(resultBox,
          h('div', { class: P + 'big' }, `Снести всю оборону: ${num(p.needAllSafe)} МПР`,
            p.needAllSafe !== p.needAll ? h('span', { class: P + 'muted' }, ` (${num(p.needAll)} + запас ${this.set('reservePct')}%)`) : null),
          st.primary && p.needPrimary ? h('div', {}, `Снести «${OGX.catalog.name(p.primary)}» полностью: ${num(p.needPrimary)} МПР`) : null,
          h('div', { class: P + 'muted' }, `Из них на перехватчики: ${num(abm)}. Урон одной ракеты ${num(p.perMissile)}, прочность обороны ${num(Math.ceil(p.total))}.`));
      }
      resultBox.append(h('div', {}, n > 0 ? `${num(n)} МПР: сбито ${num(r.intercepted)}, долетит ${num(r.hits)}, ${r.all ? 'оборона снесена полностью' : 'оборона останется частично'}.` : 'Число ракет 0.'));
      if (s) {
        const lack = s.missiles !== null && n > s.missiles ? n - s.missiles : 0;
        resultBox.append(h('div', { class: lack || !s.inRange ? P + 'warn' : P + 'muted' },
          !s.inRange ? `Цель вне досягаемости с ${s.name || s.coords}: дальность ${src.range} систем (импульсный ${src.impulse}).`
            : `С ${s.name || ''} [${s.coords}]: ${s.missiles === null ? 'число ракет неизвестно' : num(s.missiles) + ' МПР'}${lack ? `, не хватает ${num(lack)}` : ''}; полёт ${OGX.fmt.duration(s.flight)}.` +
              (s.silo !== null && s.silo < 4 ? ' Ракетная шахта ниже 4 уровня: игра не даст запустить.' : '')));
      }
      if (n > 0 && s && s.missiles !== null && n > s.missiles && src.list.filter((x) => x.inRange && x.missiles > 0).length > 1) {
        resultBox.append(h('div', { class: P + 'note' }, 'Ракеты с разных планет прилетают отдельными залпами: перехватчики сбивают первый залп. После запуска расчёт учитывает прогноз.'));
      }
      launchBtn.disabled = this.busy || !(n > 0) || !s || !s.inRange || (s.missiles !== null && s.missiles < 1);
      launchBtn.textContent = `Запустить ${n > 0 && s && s.missiles !== null ? num(Math.min(n, s.missiles)) : num(n)} МПР`;
      st._n = n; st._s = s; st._p = p; st._r = r;
    };

    const launchBtn = h('button', { type: 'button', class: ['ogx-btn', 'ogx-btn-danger', P + 'launch'], 'data-ogx-act': 'missiles:launch',
      onClick: () => this.confirmLaunch({ e, coords, type, st, modal, redraw: draw }) }, 'Запустить');
    const gameForm = h('a', { class: P + 'link', target: '_self', title: 'Форма запуска самой игры (открывает галактику этой системы)',
      href: OGX.page.url('galaxy', { action: 'sendMissle', galaxy: coords.split(':')[0], system: coords.split(':')[1], planet: coords.split(':')[2], type }) }, 'Форма игры');
    body.append(h('div', { class: P + 'actions' }, launchBtn, gameForm));
    draw();
    modal = OGX.dom.modal({ title: '🚀 Межпланетные ракеты', body, width: 560, buttons: [{ label: 'Закрыть' }] });
    return modal;
  };

  Missiles.prototype.confirmLaunch = async function ({ e, coords, type, st, redraw }) {
    if (this.busy) return;
    const s = st._s, n0 = st._n;
    if (!s || !(n0 > 0)) return;
    const n = s.missiles !== null ? Math.min(n0, s.missiles) : n0;
    const r = impact({ missiles: n, abm: st.usePred && e.predicted ? e.predicted.abm : st.abm, defense: st.usePred && e.predicted ? e.predicted.defense : st.defense,
      primary: st.primary, weapons: st.weapons, defTech: st.defTech });
    const lost = Object.entries(r.destroyed).map(([id, d]) => `${OGX.catalog.shortName(+id)} ${num(d)}`).join(', ') || 'ничего';
    const text = h('div', {},
      h('p', {}, `Запустить ${num(n)} межпланетных ракет с «${s.name || ''}» [${s.coords}] на ${typeName(type)} [${coords}]?`),
      h('p', {}, `Главная цель: ${st.primary ? OGX.catalog.name(st.primary) : 'вся оборона'}. Полёт ${OGX.fmt.duration(s.flight)}.`),
      h('p', {}, `Ожидаемо: сбито ${num(r.intercepted)}, уничтожит: ${lost}.`),
      h('p', { class: P + 'warn' }, 'Ракеты не возвращаются, отменить запуск нельзя.'));
    rec('U', 'launch-ask', { from: s.coords, to: coords, type, n, primary: st.primary });
    const ok = await OGX.dom.confirm(text, { title: 'Запуск ракет', okLabel: 'Запустить', danger: true });
    if (!ok) { rec('U', 'launch-cancel', { to: coords }); return; }
    this.busy = true;
    redraw();
    let res;
    try {
      res = await this.wLaunch({ fromId: s.id, fromKey: s.key, current: s.current, coords, type, count: n, primary: st.primary });
    } catch (err) {
      res = { ok: false, message: String(err && err.message || err) };
    } finally { this.busy = false; }
    const item = { t: OGX.time.serverNow(), fromKey: s.key, fromCoords: s.coords, target: coords, type, count: n, primary: st.primary, ok: res.ok, message: res.message || '' };
    this.launches = await this.ctx.store.update('launches', (old) => { const o = migrate(old, true); o.items.push(item); o.items = o.items.slice(-CAP_LAUNCHES); return o; }, null);
    if (res.ok) {
      const rem = Object.assign({}, r.remaining);
      const pred = { at: item.t, sent: n, abm: r.abmLeft, defense: rem };
      if (!e.manual) {
        e.predicted = pred;
        this.reports = await this.ctx.store.update('reports', (old) => { const o = migrate(old); if (o.items[e.key]) o.items[e.key].predicted = pred; return o; }, null);
      }
      OGX.dom.toast(`Запущено ${num(res.count || n)} МПР на [${coords}]`, { type: 'ok', ms: 5000 });
    } else if (res.ok === null) {
      OGX.dom.toast('Исход запуска неизвестен: проверьте «Флот» и боевые сообщения', { type: 'warn', ms: 8000 });
    } else {
      OGX.dom.toast('Ракеты не запущены: ' + (res.message || 'ошибка'), { type: 'error', ms: 8000 });
    }
    rec('B', 'launch-result', item);
    await this.loadEnv();
    redraw();
  };

  /** POST page=fleetMissile from the source planet. -> { ok: true|false|null, count?, message } */
  Missiles.prototype.post = async function ({ fromId, current, coords, type, count, primary }) {
    const [g, s, p] = coords.split(':').map(Number);
    const form = { galaxy: g, system: s, planet: p, type: +type === 3 ? 3 : 1, SendMI: Math.floor(count), Target: DEFENSE_TARGETS.includes(+primary) ? +primary : 0 };
    const send = (cp) => OGX.http.post('fleetMissile', form, { cp, expect: 'doc' });
    const r = current || !OGX.http.withPlanet ? await send(fromId) : await OGX.http.withPlanet(fromId, (cp) => send(cp));
    if (!r || !r.ok || !r.doc) return { ok: null, message: (r && (r.error || ('http ' + r.status))) || 'нет ответа' };
    let text = null;
    try { text = OGX.parse.gz.infoMessage(r.doc); } catch (e) { text = null; }
    if (!text) { try { const b = r.doc.querySelector('#content') || r.doc.body; text = b ? b.textContent : ''; } catch (e) { text = ''; } }
    const out = launchResult(text);
    if (out.ok === null) out.message = 'ответ сервера не распознан';
    if (out.ok === false && /Missles Deployed|ракет\S* запущен/i.test(text || '')) out.ok = true;
    return out;
  };

  // ------------------------------------------------------------------ side panel tab
  Missiles.prototype.refresh = function () {
    for (const [id, b] of this.badges) { if (!b.el.isConnected) this.badges.delete(id); else this.fillBadge(b.el, b.key); }
    if (this.tab) this.tab.refresh();
    if (OGX.page.is('galaxy') && this.set('showGalaxy') !== false) {
      const ev = OGX.galaxy.last('render');
      if (ev) this.renderRows(Object.assign({}, ev, { rows: OGX.galaxy.rows() })).catch(() => {});
    }
  };
  Missiles.prototype.render = function (c) {
    c.textContent = '';
    const env = this.env || { levels: {} };
    const impulse = +(env.levels[117] || 0);
    const own = Object.values(env.bodies || {}).filter((b) => b && b.type === 'planet');
    const totalIpm = own.reduce((s, b) => s + (+((b.defense || {})[IPM]) || 0), 0);
    c.append(h('div', { class: P + 'info' },
      `Мои МПР: ${num(totalIpm)} · дальность ${missileRange(impulse)} систем (импульсный ${impulse}) · оружейная ${env.levels[109] ?? '?'}`));
    const rows = Object.values(this.reports.items).filter((e) => e && e.known && e.known.defense)
      .map((e) => ({ e, p: this.planFor(e) })).filter((x) => !x.p.empty)
      .sort((a, b) => (b.e.ts || 0) - (a.e.ts || 0)).slice(0, 100);
    if (!rows.length) {
      c.append(h('div', { class: P + 'muted' }, 'Нет докладов с обороной. Откройте шпионские доклады в «Сообщениях» — расчёт появится здесь и в каждом докладе.'));
      return;
    }
    const tb = h('table', { class: P + 'table ' + P + 'list' }, h('tr', {}, h('th', {}, 'Цель'), h('th', {}, 'Оборона'), h('th', {}, 'Перехв.'), h('th', {}, 'МПР'), h('th', {}, '')));
    for (const { e, p } of rows) {
      const can = impulse > 0 && own.some((b) => b.coords && inRange(b.coords, e.coords, impulse));
      tb.append(h('tr', {},
        h('td', { title: e.name || '' }, `[${e.coords}]${e.type === 3 ? ' Л' : ''}`),
        h('td', { title: p.units.map((u) => `${OGX.catalog.shortName(u.id)} ${num(u.count)}`).join(', ') }, OGX.fmt.short(p.units.reduce((s, u) => s + u.count, 0)) + ' ед.'),
        h('td', {}, p.abmKnown ? num(p.abm) : '?'),
        h('td', { class: can ? P + 'need' : P + 'muted', title: can ? 'В досягаемости' : 'Вне досягаемости ракет' }, num(p.need) + (p.predicted ? '*' : '')),
        h('td', {}, h('button', { type: 'button', class: 'ogx-btn ' + P + 'btn', 'data-ogx-act': 'missiles:tab-open', onClick: () => this.openCalc({ coords: e.coords, type: e.type, name: e.name }) }, 'Расчёт'))));
    }
    c.append(tb, h('div', { class: P + 'note' }, '* — по прогнозу после прошлого залпа. Формула 2Moons: щитовая технология цели, перехватчик сбивает одну ракету.'));
  };

  const CSS = `
.${P}badge { box-sizing: border-box; max-width: 100%; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0; padding: 3px 6px;
  border: 1px solid var(--ogx-border, #2b3846); background: var(--ogx-panel, #161c24); color: var(--ogx-text, #cfd8e3); font-size: 11px; border-radius: 3px; }
.${P}need { color: var(--ogx-warn, #ff9800); font-weight: bold; }
.${P}muted { color: var(--ogx-muted, #8a99ab); }
.${P}warn { color: var(--ogx-warn, #ff9800); }
.${P}pos { color: var(--ogx-ok, #4caf50); }
.${P}neg { color: var(--ogx-bad, #f44336); }
.${P}note { color: var(--ogx-muted, #8a99ab); font-size: 10px; margin-top: 4px; }
.${P}b-open, .${P}btn { padding: 1px 6px; font-size: 10px; }
.${P}gx { margin-left: 3px; padding: 0 3px; font-size: 10px; line-height: 14px; cursor: pointer; border: 1px solid var(--ogx-border, #2b3846);
  background: var(--ogx-panel, #161c24); color: var(--ogx-text, #cfd8e3); border-radius: 2px; }
.${P}gx-has { color: var(--ogx-warn, #ff9800); }
.${P}calc { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.${P}title { font-weight: bold; font-size: 13px; }
.${P}form { display: flex; flex-direction: column; gap: 4px; }
.${P}row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.${P}lbl { width: 150px; color: var(--ogx-muted, #8a99ab); }
.${P}in { width: 110px; }
.${P}in-s { width: 80px; }
.${P}sel { max-width: 340px; }
.${P}table { border-collapse: collapse; width: 100%; }
.${P}table th, .${P}table td { padding: 2px 4px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--ogx-border, #2b3846); }
.${P}table th:first-child, .${P}table td:first-child { text-align: left; }
.${P}table tr.${P}gone td:first-child { text-decoration: line-through; color: var(--ogx-muted, #8a99ab); }
.${P}big { font-size: 13px; font-weight: bold; color: var(--ogx-warn, #ff9800); }
.${P}result { display: flex; flex-direction: column; gap: 3px; }
.${P}actions { display: flex; gap: 10px; align-items: center; }
.${P}link, .${P}link:visited { color: var(--ogx-accent, #6f9fd8); }
.${P}info { margin-bottom: 6px; color: var(--ogx-muted, #8a99ab); }
.${P}pred { color: var(--ogx-muted, #8a99ab); }
`;
})(window.OGX);
