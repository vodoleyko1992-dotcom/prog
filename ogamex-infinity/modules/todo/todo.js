/* ogamex-infinity/modules/todo/todo.js — Owner: infinity/todo.
 * Building to-do list (DESIGN §4.2.9):
 *   - Plans per body (buildings, stations, ships, defense) and one player-wide research list. Item = { id, objectId,
 *     targetLevel | amount, addedAt, sentAt?, sentMsg? }. Stored as todo.plans = { v:1, bodies:{[BodyKey]:[Item]}, research:[Item] }
 *     (cap 50 items per list). A storage merger unions lists by item id on import.
 *   - «+» on every list item of /resources, /facilities, /research, /shipyard, /defense: adds the next level (above the
 *     known level, the queue and what is already planned) or, for ships/defense, the amount typed in #build_amount of the
 *     open details panel (1 otherwise). «+ в план» in the technology details panel (core event techdetails:open).
 *   - Tab «План» (order 90): per list: cost, build time (calc.buildTime / unitTime / researchTime with the known levels),
 *     «можно строить» or «через …» (calc.timeUntilAffordable on the projected resources), running totals (Σ), list totals,
 *     reorder ↑/↓, remove ✕, «Построить» (explicit click → own confirm → OGX.api.addBuild(page, id, { amount, cp }), for
 *     another body inside OGX.http.withPlanet so the server's current planet is restored) with the server message in a toast.
 *     A form adds any object (body/research list, object, level/amount).
 *   - Done items (level reached in bodies/research) are removed automatically (setting autoRemoveDone) with a toast;
 *     unit orders are removed when the server accepts them.
 *   - Planet list dot .ogx-i-todo-ready on bodies whose first item is affordable now (setting showReadyDot).
 *
 * OgameX markup / endpoints (src/OGameX/...):
 *   #technologies li.technology[data-technology]       resources/views/ingame/resources/index.blade.php:25,32; facilities/index.blade.php:31,38;
 *                                                      research/research-item.blade.php:3; shipyard/unit-item.blade.php:12
 *   span.level[data-value] / span.amount[data-value]   level or unit amount (raw); buildings.md §3.2
 *   #technologydetails_content > #technologydetails    resources/index.blade.php:23 (AJAX object.blade.php); .content :28; .build-it_wrap :232;
 *                                                      #build_amount :216 (ships/defense only); .information > span.level[data-value] = current + 1
 *   #planetList > .smallplanet[data-planet-id]         layouts/main.blade.php:1737; a.moonlink[href*="cp=<moonId>"] :1793
 *   POST /<page>/add-buildrequest technologyId, amount, mode=1, _token in the body (routes/web.php; ABC:227-279, AUC:135-169,
 *   ResearchController:160-192); the defense page posts to /shipyard/add-buildrequest — all done by core OGX.api.addBuild.
 * Local helpers (not in core): IRN lab level (PlanetService::getResearchNetworkLabLevel:1234, with the per-planet building-requirement filter),
 * own confirm before withPlanet (so the cross-tab "cp" lock is not held while the dialog is open).
 *
 * GALAXYZ (ogamex.eu, 2Moons fork; specs/galaxyz/buildings.md, CORE_API §22):
 *   - list pages: page=buildings (aliases resources + facilities: mines, storage and facilities on one page), research,
 *     shipyard (fleet) and shipyard&mode=defense; items ul.icons > li.technology[data-technology] with span.level[data-value]
 *     (#technologies is duplicated: every list is decorated); levels also from OGX.parse.techList;
 *   - details panel #technologydetails (page=*DetailsAjax, [UNVERIFIED] markup; core bus techdetails:open): unit amount from
 *     its input[name="fmenge[ID]"]; the panel's level is not trusted (list level instead);
 *   - «Построить» = OGX.api.addBuild on a click (GALAXYZ form POST: page=buildings cmd=insert building=ID, page=research
 *     cmd=insert tech=ID, page=shipyard fmenge[ID]=N; no answer text: ok unless the game returns an info page);
 *   - build/research/shipyard times: the universe game speed is not shown on any page (calc.gz.gameSpeed null): times
 *     are «—» with an explanation until the core knows it; costs are exact (catalog = real prices);
 *   - bodies seen only on page=imperium have no production: «не хватает (выработка неизвестна)» instead of a wait time;
 *   - ready dots on the planet list: OGX.dom.planetRows() (one #planetList per planet, ids in a.planetlink cp=).
 */
(function (OGX) {
  'use strict';

  const NAME = 'todo';
  const P = 'ogx-i-todo-';
  const PANEL_ID = 'infinity';
  const RES = ['metal', 'crystal', 'deuterium'];
  const LIST_PAGES = ['resources', 'facilities', 'research', 'shipyard', 'defense'];
  const CAP = 50;
  const RESEARCH = 'research';

  const rec = (src, what, data) => { try { return OGX.log.rec(src, NAME, what, data); } catch (e) { return null; } };
  const learnValue = (name, v, o) => { try { return OGX.learn ? OGX.learn.value(name, v, o) : true; } catch (e) { return true; } };
  const learnCheck = (name, o) => { try { return OGX.learn ? OGX.learn.check(name, o) : true; } catch (e) { return true; } };
  const h = (...a) => OGX.dom.h(...a);
  const num = (n) => OGX.fmt.num(n);
  const int0 = (v) => { const n = Math.floor(+v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const now = () => OGX.time.serverNow();
  const isGz = () => { try { return !!(OGX.page.isGz && OGX.page.isGz()); } catch (e) { return false; } };
  /** GALAXYZ: the build/research speed of the universe is unknown until the core learns it (CORE_API §10 calc.gz.gameSpeed). */
  const timesUnknown = () => isGz() && !(+(OGX.calc.gz && OGX.calc.gz.gameSpeed) > 0);
  const TIME_UNKNOWN = 'Время неизвестно: скорость строительства этой вселенной не видна ни на одной странице игры (стоимость точная)';

  OGX.module({
    name: NAME,
    title: 'План построек',
    pages: '*',
    settings: {
      autoRemoveDone: { type: 'bool', default: true, label: 'Удалять выполненные пункты автоматически' },
      showReadyDot: { type: 'bool', default: true, label: 'Точка в списке планет, когда первый пункт можно строить' },
      showPlusButtons: { type: 'bool', default: true, label: 'Кнопки «+» на страницах построек' },
    },
    async init(ctx) {
      const t = new Todo(ctx);
      ctx._todo = t;
      await t.start();
    },
    dispose(ctx) { if (ctx._todo) ctx._todo.stop(); },
  });
  // test hook (pure helper, no side effects)
  OGX.todo = Object.assign(OGX.todo || {}, { _test: { labLevel: (bodies, research, rb, objectId) => Todo.prototype.labLevel.call({ bodies, research }, rb, objectId), gzQueue: (doc) => gzQueue(doc) } });

  // ================================================================== pure helpers
  function isUnitObj(o) { return !!o && (o.type === 'ship' || o.type === 'defense'); }
  function normItem(it) {
    if (!it || typeof it !== 'object') return null;
    const o = OGX.catalog.get(+it.objectId);
    if (!o) return null;
    const out = { id: String(it.id || OGX.util.uid()), objectId: o.id, addedAt: +it.addedAt || 0 };
    if (isUnitObj(o)) { out.amount = int0(it.amount); if (!out.amount) return null; } else { out.targetLevel = int0(it.targetLevel); if (!out.targetLevel) return null; }
    if (it.sentAt) { out.sentAt = +it.sentAt; out.sentMsg = String(it.sentMsg || '').slice(0, 200); }
    return out;
  }
  function normList(a) { return (Array.isArray(a) ? a : []).map(normItem).filter(Boolean).slice(0, CAP); }
  function migrate(v) {
    const out = { v: 1, bodies: {}, research: [] };
    if (!v || typeof v !== 'object' || v.v !== 1) return out;
    if (v.bodies && typeof v.bodies === 'object') {
      for (const [k, list] of Object.entries(v.bodies)) if (/^[pm]\d+$/.test(k)) { const l = normList(list); if (l.length) out.bodies[k] = l; }
    }
    out.research = normList(v.research).filter((i) => OGX.catalog.get(i.objectId).type === 'research');
    return out;
  }
  function mergeLists(a, b) {
    const seen = new Set((a || []).map((i) => i.id));
    return (a || []).concat((b || []).filter((i) => i && !seen.has(i.id))).slice(0, CAP);
  }
  function addRes(a, b) { const o = {}; for (const k of RES) o[k] = (+a[k] || 0) + (+b[k] || 0); o.energy = (+a.energy || 0) + (+b.energy || 0); return o; }
  const zeroCost = () => ({ metal: 0, crystal: 0, deuterium: 0, energy: 0 });
  function resText(c) {
    const parts = [];
    if (c.metal) parts.push('М ' + num(c.metal));
    if (c.crystal) parts.push('К ' + num(c.crystal));
    if (c.deuterium) parts.push('Д ' + num(c.deuterium));
    if (c.energy) parts.push('Э ' + num(c.energy));
    return parts.join(' · ') || '0';
  }
  /** Cost as one line per resource (no wrapping inside a number; the side panel is narrow). */
  function resLines(c) {
    const out = [];
    resText(c).split(' · ').forEach((t, i) => {
      if (i) out.push(h('span', { class: P + 'sep' }, ' · '));   // hidden: keeps the text «М … · К …» for copy/tests
      out.push(h('div', { class: P + 'nw' }, t));
    });
    return out;
  }
  function itemLabel(it) {
    const name = OGX.catalog.name(it.objectId);
    return it.amount ? `${name} × ${num(it.amount)}` : `${name}, ур. ${it.targetLevel}`;
  }
  function bodyLabel(b) { return b ? `${b.name || '?'} ${OGX.fmt.coords(b.coords, b.type === 'moon' ? 3 : 1)}` : '?'; }
  function fitsBody(o, b) {
    if (!o || !b) return false;
    if (o.type === 'research') return false;
    const pt = o.planetType || 'both';
    if (pt === 'both') return true;
    return pt === (b.type === 'moon' ? 'moon' : 'planet');
  }

  /**
   * GALAXYZ build/research queue as the game shows it (live markup, specs/galaxyz/buildings.md; live snapshots 2026-10-31):
   *   active:  .build-info-row > .build-image-wrapper > img.build-icon[src=".../gebaeude/<id>.png"] + .build-text .build-level > span (level)
   *   queued:  a.construction-queue-item[style*="gebaeude/<id>.png"] > span (level), data-cancel-message="<level> ?"
   * Shown on page=buildings / page=research (and the overview lists queued items too). Units (ids 200-599) are skipped.
   * -> [{ objectId, targetLevel, active }]
   */
  function gzQueue(doc) {
    const out = [];
    if (!doc || !doc.querySelectorAll) return out;
    const idOf = (s) => { const m = /\/(\d{1,3})\.(?:png|gif|jpe?g|webp)\b/i.exec(String(s || '')); return m ? +m[1] : 0; };
    const ok = (id) => { const o = id ? OGX.catalog.get(id) : null; return !!o && !isUnitObj(o); };
    for (const img of doc.querySelectorAll('img.build-icon')) {
      const id = idOf(img.getAttribute('src'));
      if (!ok(id)) continue;
      const row = img.closest('.build-info-row') || img.parentElement && img.parentElement.parentElement;
      const lvEl = row ? row.querySelector('.build-level span, .build-level') : null;
      let lv = lvEl ? int0(String(lvEl.textContent || '').replace(/\D+/g, '')) : 0;
      if (!lv && row) {
        const tip = row.querySelector('[data-tooltip-content]');
        const m = tip ? /(\d+)\D*\?/.exec(String(tip.getAttribute('data-tooltip-content') || '').replace(/<[^>]*>|&lt;[^&]*&gt;/g, ' ')) : null;
        lv = m ? int0(m[1]) : 0;
      }
      if (lv) out.push({ objectId: id, targetLevel: lv, active: true });
    }
    for (const a of doc.querySelectorAll('a.construction-queue-item')) {
      const id = idOf(a.getAttribute('style'));
      if (!ok(id)) continue;
      const sp = a.querySelector('span');
      const lv = int0(String((sp && sp.textContent) || a.getAttribute('data-cancel-message') || '').replace(/\D+/g, ''));
      if (lv) out.push({ objectId: id, targetLevel: lv, active: false });
    }
    return out;
  }

  // ================================================================== Todo
  function Todo(ctx) {
    this.ctx = ctx;
    this.log = ctx.log;
    this.plans = migrate(null);
    this.bodies = {};
    this.research = { levels: {}, queue: null };
    this.server = { economySpeed: 1, researchSpeed: 1 };
    this.player = null;
    this.offs = [];
    this.tab = null;
    this.panel = null;
    this.busy = new Set();
    this.domQueue = {};          // listKey -> { t, items: [{objectId, targetLevel, active}] } (GALAXYZ queue seen on a page / a build answer)
    this.form = { list: '', objectId: 0, value: '' };
    this.refreshSoon = OGX.util.debounce(OGX.safe(() => this.refresh(), 'todo:refresh'), 120);
    this.decorateSoon = OGX.util.debounce(OGX.safe(() => this.decorateList(), 'todo:decorate'), 150);
    // Every add-on action is a timed B event (CORE_API §21.1).
    this.wAdd = OGX.log.wrap(NAME, (list, spec, source) => this.addItem(list, spec, source), 'plan:add');
    this.wRemove = OGX.log.wrap(NAME, (list, id, why) => this.removeItem(list, id, why), 'plan:remove');
    this.wMove = OGX.log.wrap(NAME, (list, id, dir) => this.moveItem(list, id, dir), 'plan:move');
    this.wBuild = OGX.log.wrap(NAME, (page, id, opts, bodyId) => this.doBuild(page, id, opts, bodyId), 'build');
    this.wSweep = OGX.log.wrap(NAME, () => this.sweepDone(), 'plan:sweep-done');
  }

  Todo.prototype.S = function (k) { try { return this.ctx.settings.get(k); } catch (e) { return undefined; } };

  Todo.prototype.start = async function () {
    const ctx = this.ctx;
    ctx.css(CSS);
    try {
      OGX.storage.registerMerger(NAME + '.plans', (old, imp) => {
        const a = migrate(old), b = migrate(imp);
        const out = { v: 1, bodies: Object.assign({}, a.bodies), research: mergeLists(a.research, b.research) };
        for (const [k, l] of Object.entries(b.bodies)) out.bodies[k] = mergeLists(out.bodies[k], l);
        return out;
      });
    } catch (e) { this.log.warn('registerMerger', e); }
    this.plans = migrate(await ctx.store.get('plans', null));
    learnCheck('todo.plans', this.plans);
    await this.loadState();

    this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
    this.tab = this.panel.addTab({ id: 'todo', label: 'План', order: 90, badge: this.countAll() || null, render: (c) => this.render(c) });

    this.offs.push(ctx.store.subscribe('plans', (v) => { this.plans = migrate(v); this.refreshSoon(); }));
    this.offs.push(OGX.state.onChange(['bodies', 'research', 'player', 'server'], () => { this.loadState().then(() => this.refresh(true)).catch((e) => this.log.error('state', e)); }));
    this.offs.push(ctx.bus.on('techdetails:open', (p) => this.onDetails(p)));
    ctx.every(30000, () => { this.renderDots(); if (this.panel.isOpen() && this.panel.currentTab() === 'todo') this.tab.refresh(); });

    if (this.S('autoRemoveDone') !== false) await this.wSweep();
    this.decorateList();
    if (OGX.page.is(...LIST_PAGES)) {
      // GALAXYZ renders #technologies twice (duplicated id): watch every list
      for (const box of OGX.dom.$$('[id="technologies"]')) this.offs.push(OGX.dom.observe(box, () => this.decorateSoon(), { debounce: 200 }));
      // details may already be open (game AJAX finished before our init)
      const d = document.getElementById('technologydetails');
      if (d) this.onDetails({ el: d, id: detailsId(d) });
    }
    this.renderDots();
  };

  Todo.prototype.stop = function () { for (const off of this.offs) { try { off(); } catch (e) { /* ignore */ } } this.offs = []; };

  Todo.prototype.loadState = async function () {
    const [bodies, research, server, player] = await Promise.all([OGX.state.bodies(), OGX.state.research(), OGX.state.server(), OGX.state.player()]);
    this.bodies = bodies || {};
    this.research = research || { levels: {}, queue: null };
    this.server = server || { economySpeed: 1, researchSpeed: 1 };
    this.player = player;
  };

  Todo.prototype.refresh = async function (sweep) {
    if (sweep && this.S('autoRemoveDone') !== false) await this.wSweep();
    if (this.tab) { this.tab.setBadge(this.countAll() || null); this.tab.refresh(); }
    this.decorateList();
    this.renderDots();
  };

  Todo.prototype.countAll = function () {
    let n = this.plans.research.length;
    for (const l of Object.values(this.plans.bodies)) n += l.length;
    return n;
  };
  Todo.prototype.list = function (key) { return key === RESEARCH ? this.plans.research : (this.plans.bodies[key] || []); };

  Todo.prototype.save = async function () {
    const p = { v: 1, bodies: {}, research: this.plans.research };
    for (const [k, l] of Object.entries(this.plans.bodies)) if (l.length) p.bodies[k] = l;
    this.plans = p;
    await this.ctx.store.set('plans', p);
    if (this.tab) this.tab.setBadge(this.countAll() || null);
  };

  // ---------------------------------------------------------------- levels and queues
  Todo.prototype.knownLevel = function (key, id) {
    if (key === RESEARCH) { const v = this.research.levels && this.research.levels[id]; return v === undefined || v === null ? null : +v; }
    const b = this.bodies[key];
    const v = b && b.levels ? b.levels[id] : undefined;
    return v === undefined || v === null ? null : +v;
  };
  /** Remembers the GALAXYZ queue shown in `doc` for the body it belongs to (research ids -> the research list). */
  Todo.prototype.noteQueue = function (doc, bodyKey) {
    if (!isGz()) return null;
    const items = gzQueue(doc);
    const t = Date.now();
    const byKey = {};
    for (const x of items) { const k = OGX.catalog.get(x.objectId).type === 'research' ? RESEARCH : bodyKey; if (k) (byKey[k] = byKey[k] || []).push(x); }
    for (const [k, list] of Object.entries(byKey)) this.domQueue[k] = { t, items: list };
    return items;
  };
  /** Highest level of `id` in the GALAXYZ queue last seen for that list (an hour at most). */
  Todo.prototype.domQueuedLevel = function (key, id) {
    const q = this.domQueue[key];
    if (!q || Date.now() - q.t > 3600 * 1000) return 0;
    let max = 0;
    for (const x of q.items) if (x.objectId === id) max = Math.max(max, x.targetLevel);
    return max;
  };
  /** Highest level already in the game queue (active + queued) for that list. */
  Todo.prototype.queuedLevel = function (key, id) {
    let max = this.domQueuedLevel(key, id);
    if (key === RESEARCH) {
      const q = this.research.queue;
      if (q && +q.objectId === id && q.endsAt > now()) max = Math.max(max, +q.targetLevel || 0);
      return max;
    }
    const b = this.bodies[key];
    const q = b && b.queues && b.queues.building;
    if (q) {
      if (+q.objectId === id && !q.downgrade && (!q.endsAt || q.endsAt > now())) max = Math.max(max, +q.targetLevel || 0);
      for (const x of q.queued || []) if (+x.objectId === id) max = Math.max(max, +x.targetLevel || 0);
    }
    return max;
  };
  Todo.prototype.nextLevel = function (key, id, hint) {
    // «+» counts the levels already queued in the game (GALAXYZ queue box of this page), not only the built level
    try { const cur = OGX.state.current() || {}; if (cur.key) this.noteQueue(document, cur.key); } catch (e) { /* ignore */ }
    let base = Math.max(this.knownLevel(key, id) || 0, int0(hint), this.queuedLevel(key, id));
    for (const it of this.list(key)) if (it.objectId === id && it.targetLevel) base = Math.max(base, it.targetLevel);
    return base + 1;
  };
  Todo.prototype.listKeyFor = function (o, bodyKey) { return o.type === 'research' ? RESEARCH : bodyKey; };
  /** Planet that pays for and runs research: the current planet (or the planet of the current moon). */
  Todo.prototype.researchBody = function () {
    const cur = OGX.state.current() || {};
    if (cur.key && this.bodies[cur.key] && !cur.isMoon) return this.bodies[cur.key];
    if (cur.planetId && this.bodies['p' + cur.planetId]) return this.bodies['p' + cur.planetId];
    return Object.values(this.bodies).find((b) => b.type === 'planet') || null;
  };
  /**
   * Lab level with the Intergalactic Research Network (PlanetService::getResearchNetworkLabLevel).
   * OgameX only counts another planet's lab when the research object's requirements are met on THAT
   * planet (ObjectService::objectRequirementsMet). Research requirements are player-wide; building
   * requirements (ids < 100, e.g. [31,7] for hyperspace tech) are planet-local. A planet whose levels
   * for a required building are unknown is treated as not qualifying (safe: never shows a too-short time).
   */
  Todo.prototype.labLevel = function (rb, objectId) {
    const own = rb && rb.levels ? +rb.levels[31] || 0 : 0;
    const irn = +(this.research.levels && this.research.levels[123]) || 0;
    if (!irn) return own;
    const o = objectId ? OGX.catalog.get(objectId) : null;
    const localReq = (o && Array.isArray(o.req) ? o.req : []).filter((r) => Array.isArray(r) && +r[0] > 0 && +r[0] < 100);
    const qualifies = (b) => {
      if (!localReq.length) return true;
      if (!b.levels) return false;
      return localReq.every(([id, lv]) => { const v = b.levels[id]; return v !== undefined && v !== null && +v >= +lv; });
    };
    const others = Object.values(this.bodies)
      .filter((b) => b.type === 'planet' && (!rb || b.key !== rb.key) && qualifies(b))
      .map((b) => +(b.levels && b.levels[31]) || 0).sort((a, b) => b - a);
    return own + others.slice(0, irn).reduce((s, x) => s + x, 0);
  };

  // ---------------------------------------------------------------- per item numbers
  Todo.prototype.itemInfo = function (key, it) {
    const o = OGX.catalog.get(it.objectId);
    const S = this.server || {};
    const eco = +S.economySpeed || 1;
    const body = key === RESEARCH ? this.researchBody() : this.bodies[key];
    const lv = (id) => (body && body.levels ? +body.levels[id] || 0 : 0);
    let cost, secs;
    if (isUnitObj(o)) {
      cost = OGX.calc.unitCost(o.id, it.amount);
      secs = OGX.calc.unitTime(o.id, { shipyard: lv(21), nanite: lv(15), economySpeed: eco }) * it.amount;
    } else if (o.type === 'research') {
      cost = OGX.calc.cost(o.id, it.targetLevel);
      secs = OGX.calc.researchTime(o.id, it.targetLevel, { labLevel: this.labLevel(body, o.id), economySpeed: eco, researchSpeed: +S.researchSpeed || 1, playerClass: this.player ? this.player.playerClass : 'none' });
    } else {
      cost = OGX.calc.cost(o.id, it.targetLevel);
      secs = OGX.calc.buildTime(o.id, it.targetLevel, { robotics: lv(14), nanite: lv(15), economySpeed: eco });
    }
    const secsKnown = !timesUnknown();
    if (!learnCheck('todo.cost', cost) || (secsKnown && !learnValue('todo.secs', secs, { min: 1 }))) this.log.warn('implausible cost/time', it, cost, secs);
    const known = this.knownLevel(key, o.id);
    const queued = !isUnitObj(o) && this.queuedLevel(key, o.id) >= it.targetLevel;
    return { o, cost, secs: secsKnown ? secs : null, secsKnown, body, known, queued };
  };
  /** { metal: {amount, storage, perHour, t}, ... } projected to now, or null without resource data. */
  Todo.prototype.resourcesOf = function (body) {
    if (!body || !body.res || !body.res.t) return null;
    const t = now();
    const p = OGX.state.projected(body, t);
    const out = {};
    let rateKnown = true;
    for (const k of RES) {
      const r = p.res[k] || { amount: 0, storage: 0, perHour: 0 };
      const src = body.res[k] || {};
      // GALAXYZ page=imperium stock: storage/production null (unknown, never 0)
      if (src.perHour === null || src.perHour === undefined) rateKnown = false;
      out[k] = { amount: +r.amount || 0, storage: r.storage === null || r.storage === undefined ? Infinity : r.storage, perHour: +r.perHour || 0, t };
    }
    Object.defineProperty(out, 'rateKnown', { value: rateKnown, enumerable: false });
    return out;
  };
  /** seconds until affordable (0 = now, Infinity = never with the current production, null = no data, NaN = short of
   * resources and the production is unknown). */
  Todo.prototype.waitFor = function (cost, res) {
    if (!res) return null;
    if (res.rateKnown === false) return RES.every((k) => (+cost[k] || 0) <= res[k].amount) ? 0 : NaN;
    const s = OGX.calc.timeUntilAffordable(cost, res, now());
    return Number.isFinite(s) ? Math.ceil(s) : Infinity;
  };

  // ---------------------------------------------------------------- mutations
  /** spec: { objectId, targetLevel? | amount? , bodyKey } */
  Todo.prototype.addItem = async function (listKey, spec, source) {
    const o = OGX.catalog.get(+spec.objectId);
    if (!o) return { ok: false, message: 'Неизвестный объект' };
    if (listKey !== RESEARCH) {
      const b = this.bodies[listKey];
      if (b && !fitsBody(o, b)) return { ok: false, message: `${OGX.catalog.name(o.id)} нельзя строить на ${b.type === 'moon' ? 'луне' : 'планете'}` };
      if (!/^[pm]\d+$/.test(listKey)) return { ok: false, message: 'Нет текущей планеты' };
    }
    const list = this.list(listKey).slice();
    if (list.length >= CAP) return { ok: false, message: `В плане уже ${CAP} пунктов` };
    const item = { id: OGX.util.uid(), objectId: o.id, addedAt: now() };
    if (isUnitObj(o)) {
      item.amount = int0(spec.amount) || 1;
      learnValue('todo.amount', item.amount, { min: 1, int: true });
    } else {
      item.targetLevel = int0(spec.targetLevel) || this.nextLevel(listKey, o.id, spec.hint);
      learnValue('todo.targetLevel', item.targetLevel, { min: 1, max: 100, int: true });
      if (list.some((x) => x.objectId === o.id && x.targetLevel === item.targetLevel)) return { ok: false, message: `${itemLabel(item)} уже в плане` };
      const known = this.knownLevel(listKey, o.id);
      if (known !== null && known >= item.targetLevel) return { ok: false, message: `${itemLabel(item)} уже построено` };
    }
    list.push(item);
    if (listKey === RESEARCH) this.plans.research = list; else this.plans.bodies[listKey] = list;
    await this.save();
    this.refresh();
    return { ok: true, item, message: 'В план: ' + itemLabel(item), source };
  };
  Todo.prototype.removeItem = async function (listKey, id, why) {
    const list = this.list(listKey);
    const it = list.find((x) => x.id === id);
    if (!it) return { ok: false };
    const rest = list.filter((x) => x.id !== id);
    if (listKey === RESEARCH) this.plans.research = rest; else this.plans.bodies[listKey] = rest;
    await this.save();
    this.refresh();
    return { ok: true, label: itemLabel(it), why };
  };
  Todo.prototype.moveItem = async function (listKey, id, dir) {
    const list = this.list(listKey).slice();
    const i = list.findIndex((x) => x.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return { ok: false };
    [list[i], list[j]] = [list[j], list[i]];
    if (listKey === RESEARCH) this.plans.research = list; else this.plans.bodies[listKey] = list;
    await this.save();
    this.refresh();
    return { ok: true, from: i, to: j };
  };
  /** Removes items whose level is reached (bodies/research). Returns the removed labels. */
  Todo.prototype.sweepDone = async function () {
    const removed = [];
    const check = (key, list) => list.filter((it) => {
      if (!it.targetLevel) return true;
      const k = this.knownLevel(key, it.objectId);
      if (k !== null && k >= it.targetLevel) { removed.push({ key, label: itemLabel(it) }); return false; }
      return true;
    });
    for (const [k, l] of Object.entries(this.plans.bodies)) this.plans.bodies[k] = check(k, l);
    this.plans.research = check(RESEARCH, this.plans.research);
    if (removed.length) {
      await this.save();
      const txt = removed.length === 1 ? removed[0].label : removed.length + ' ' + OGX.fmt.plural(removed.length, ['пункт', 'пункта', 'пунктов']);
      OGX.dom.toast('План: выполнено — ' + txt + '. Удалено из плана.', { type: 'ok', ms: 5000 });
    }
    return { removed: removed.length, items: removed };
  };

  // ---------------------------------------------------------------- build
  async function confirmFirst(text) {
    let need = true;
    try { need = OGX.settings.get('core.confirmActions') !== false; } catch (e) { need = true; }
    return need ? OGX.dom.confirm(text, { okLabel: 'Построить' }) : true;
  }
  Todo.prototype.doBuild = async function (page, id, opts, bodyId) {
    const cur = OGX.state.current() || {};
    if (bodyId && +bodyId !== +cur.id) {
      return OGX.http.withPlanet(+bodyId, (cp) => OGX.api.addBuild(page, id, Object.assign({}, opts, { cp, confirm: false })));
    }
    // always name the body: a refresh running in this tab (or another tab) may have moved the server's selected planet
    return OGX.api.addBuild(page, id, Object.assign({}, opts, { cp: bodyId || cur.id || undefined, confirm: false }));
  };
  Todo.prototype.build = async function (listKey, itemId, btn) {
    const it = this.list(listKey).find((x) => x.id === itemId);
    if (!it || this.busy.has(itemId)) return;
    const o = OGX.catalog.get(it.objectId);
    const body = listKey === RESEARCH ? this.researchBody() : this.bodies[listKey];
    if (!body) { OGX.dom.toast('Неизвестна планета для постройки', { type: 'error' }); return; }
    const page = o.page === 'defense' ? 'defense' : o.page;
    if (!LIST_PAGES.includes(page)) { OGX.dom.toast('Неизвестная страница для ' + OGX.catalog.name(o.id), { type: 'error' }); return; }
    const where = bodyLabel(body);
    if (!(await confirmFirst(`Построить: ${itemLabel(it)} на ${where}?`))) { rec('U', 'build:cancel', { list: listKey, objectId: it.objectId }); return; }
    this.busy.add(itemId);
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    let r;
    try {
      r = await this.wBuild(page, o.id, { amount: it.amount || 1 }, body.id);
    } catch (e) {
      this.log.error('build', e);
      r = { ok: false, message: String((e && e.message) || e) };
    } finally {
      this.busy.delete(itemId);
    }
    let msg = (r && r.message) || (r && r.ok ? 'Готово' : 'Сервер не принял заказ');
    // GALAXYZ answers a build POST with the page itself (no status): the order counts only when the queue shows it
    const check = r && r.ok && !it.amount ? this.verifyStarted(listKey, it, r, body) : null;
    if (check && !check.started) { r = Object.assign({}, r, { ok: false }); msg = check.message; }
    else if (check && check.message) msg = check.message;
    OGX.dom.toast((r && r.ok ? 'Сервер: ' : 'Ошибка: ') + msg, { type: r && r.ok ? (check && check.partial ? 'warn' : 'ok') : 'error', ms: 6000 });
    if (r && r.ok) {
      if (it.amount) {
        await this.wRemove(listKey, it.id, 'ordered');
      } else if (!(check && check.partial)) {
        const cur = this.list(listKey).find((x) => x.id === itemId);
        if (cur) { cur.sentAt = now(); cur.sentMsg = String(msg).slice(0, 200); await this.save(); }
      }
    } else if (r && /unknown page/.test(msg)) {
      this.log.warn('addBuild page', page, o.id);
    }
    this.refresh();
  };

  /**
   * After a GALAXYZ build order: does the queue in the returned page show the object? -> null (nothing to check: OgameX
   * answers with a status) | { started, partial, level, message }. started + !partial = the planned level is queued.
   */
  Todo.prototype.verifyStarted = function (listKey, it, r, body) {
    if (!isGz() || !r || !r.doc) return null;
    const before = Math.max(this.knownLevel(listKey, it.objectId) || 0, this.queuedLevel(listKey, it.objectId));
    const items = this.noteQueue(r.doc, listKey === RESEARCH ? (body && body.key) || null : listKey) || [];
    const lv = items.filter((x) => x.objectId === it.objectId).reduce((m, x) => Math.max(m, x.targetLevel), 0);
    const name = OGX.catalog.name(it.objectId);
    let out;
    if (!lv) out = { started: false, partial: false, level: 0, message: `${name}: сервер ответил, но в очереди построек этого нет — не построено (ресурсы, занятая очередь или нет требований)` };
    else if (lv >= it.targetLevel) out = { started: true, partial: false, level: lv, message: `${name} ур. ${lv} в очереди` };
    else out = { started: true, partial: true, level: lv, message: `${name}: в очереди ур. ${lv}, до цели ур. ${it.targetLevel} — нажмите «Построить» ещё раз` };
    rec('B', 'build:verify', { objectId: it.objectId, target: it.targetLevel, before, queued: lv, started: out.started, partial: out.partial });
    return out;
  };

  // ---------------------------------------------------------------- list pages: «+» buttons
  function detailsId(el) {
    const btn = el.querySelector('button.upgrade[data-technology], button.downgrade[data-technology]');
    if (btn) return +btn.dataset.technology; // OgameX: #technologydetails[data-technology-id] is hardcoded 3 (object.blade.php:3)
    const costs = el.querySelector('.costs[data-tech-id]');   // GALAXYZ panel [UNVERIFIED]
    if (costs) return +costs.getAttribute('data-tech-id') || null;
    return +el.getAttribute('data-tech') || null;
  }
  /** Level shown in the list item of the page (GALAXYZ: the panel's own level is not trusted). */
  function listLevel(id) {
    const li = OGX.dom.$('[id="technologies"] li.technology[data-technology="' + id + '"]');
    return li ? liLevel(li).value : null;
  }
  Todo.prototype.decorateList = function () {
    if (!OGX.page.is(...LIST_PAGES)) return;
    try { const c = OGX.state.current() || {}; if (c.key) this.noteQueue(document, c.key); } catch (e) { /* ignore */ }
    const on = this.S('showPlusButtons') !== false;
    // OgameX #technologies; GALAXYZ ul.icons > li.technology inside the (duplicated) #technologies
    const lis = OGX.dom.$$('[id="technologies"] li.technology[data-technology]');
    const cur = OGX.state.current() || {};
    for (const li of lis) {
      let btn = li.querySelector(':scope > .' + P + 'plus');
      if (!on) { if (btn) btn.remove(); if (li.classList.contains(P + 'host')) li.classList.remove(P + 'host'); continue; }
      const id = +li.getAttribute('data-technology');
      const o = OGX.catalog.get(id);
      if (!o) { learnValue('todo.li.technology', NaN); continue; }
      const listKey = this.listKeyFor(o, cur.key);
      if (!btn) {
        li.classList.add(P + 'host');
        // GALAXYZ: the game's own build button (button.upgrade) sits in the top-left corner: «+» goes to the top-right
        btn = h('button', { type: 'button', class: [P + 'plus', isGz() ? P + 'plus-r' : null], 'data-ogx-act': 'todo:plus', dataset: { id: String(id) },
          onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); this.onPlus(li, id); } }, '+');
        li.appendChild(btn);
      }
      const planned = this.list(listKey).filter((x) => x.objectId === id);
      const last = planned.length ? planned[planned.length - 1] : null;
      // write only on change: a textContent assignment is a childList mutation under #technologies,
      // which would re-trigger our own observer (and Live techcost's) forever.
      if (btn.classList.contains(P + 'has') !== !!last) btn.classList.toggle(P + 'has', !!last);
      const txt = last ? (last.amount ? '+' + planned.length : '→' + last.targetLevel) : '+';
      if (btn.textContent !== txt) btn.textContent = txt;
      const title = (last ? 'В плане: ' + planned.map(itemLabel).join('; ') + '. ' : '') + (isUnitObj(o) ? 'Добавить в план (количество из поля «Количество»)' : 'Добавить следующий уровень в план');
      if (btn.title !== title) btn.title = title;
    }
  };
  function liLevel(li) {
    const lv = li.querySelector('span.level[data-value], span.amount[data-value]');
    const v = lv ? +lv.getAttribute('data-value') : 0;
    const tgt = li.querySelector('span.targetlevel[data-value]');
    const t = tgt ? +tgt.getAttribute('data-value') : 0;
    return { value: Number.isFinite(v) ? v : 0, target: Number.isFinite(t) ? t : 0 };
  }
  function detailsAmount(id) {
    const d = document.getElementById('technologydetails');
    if (!d || detailsId(d) !== id) return 1;
    // OgameX #build_amount; GALAXYZ the order input of the panel form (fmenge[ID], [UNVERIFIED] panel markup)
    const inp = d.querySelector('#build_amount') || d.querySelector('input[name="fmenge[' + id + ']"]:not([type="hidden"])');
    const n = inp ? int0(String(inp.value || '').replace(/\D/g, '')) : 0;
    return n || 1;
  }
  Todo.prototype.onPlus = async function (li, id) {
    const o = OGX.catalog.get(id);
    const cur = OGX.state.current() || {};
    const listKey = this.listKeyFor(o, cur.key);
    const lv = liLevel(li);
    learnValue('todo.li.level', lv.value, { min: 0, int: true });
    const spec = { objectId: id };
    if (isUnitObj(o)) spec.amount = detailsAmount(id); else spec.hint = Math.max(lv.value, lv.target);
    rec('U', 'plus', { objectId: id, list: listKey, amount: spec.amount, hint: spec.hint });
    const r = await this.wAdd(listKey, spec, 'list');
    OGX.dom.toast(r.message, { type: r.ok ? 'ok' : 'warn' });
  };
  Todo.prototype.onDetails = function (p) {
    const el = p && p.el;
    if (!el || !el.isConnected) return;
    const id = p.id || detailsId(el);
    const o = id ? OGX.catalog.get(id) : null;
    if (!o) return;
    const host = el.querySelector('.content') || el;
    if (host.querySelector('.' + P + 'dplus')) return;
    const btn = h('button', { class: P + 'dplus', 'data-ogx-act': 'todo:details-plus', title: 'Добавить в план построек' }, '+ в план');
    btn.addEventListener('click', OGX.safe(async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const cur = OGX.state.current() || {};
      const listKey = this.listKeyFor(o, cur.key);
      const spec = { objectId: o.id };
      if (isUnitObj(o)) spec.amount = detailsAmount(o.id);
      else {
        const lvEl = el.querySelector('.information > span.level[data-value]'); // data-value = current + 1 (OAT:44)
        if (lvEl) {
          const nextLv = +lvEl.getAttribute('data-value');
          learnValue('todo.details.level', nextLv, { min: 1, int: true });
          spec.hint = nextLv > 0 ? nextLv - 1 : 0;
        } else {
          spec.hint = listLevel(o.id) || 0;   // GALAXYZ: the list item's level
        }
      }
      rec('U', 'details-plus', { objectId: o.id, list: listKey, amount: spec.amount, hint: spec.hint });
      const r = await this.wAdd(listKey, spec, 'details');
      OGX.dom.toast(r.message, { type: r.ok ? 'ok' : 'warn' });
    }, 'todo:details-plus'));
    const wrap = host.querySelector('.build-it_wrap');
    const form = host.querySelector(':scope > form.build_form');   // GALAXYZ panel: the build button sits in its form
    if (wrap && wrap.parentNode === host) host.insertBefore(btn, wrap); else if (form) host.insertBefore(btn, form); else host.appendChild(btn);
  };

  // ---------------------------------------------------------------- planet list dots
  Todo.prototype.readyKeys = function () {
    const out = new Set();
    for (const [key, list] of Object.entries(this.plans.bodies)) {
      if (!list.length) continue;
      const info = this.itemInfo(key, list[0]);
      if (info.queued) continue;
      const w = this.waitFor(info.cost, this.resourcesOf(this.bodies[key]));
      if (w === 0) out.add(key);
    }
    return out;
  };
  Todo.prototype.renderDots = function () {
    for (const d of document.querySelectorAll('.' + P + 'ready')) d.remove();
    if (this.S('showReadyDot') === false) return { shown: 0 };
    const rows = OGX.dom.planetRows();   // OgameX data-planet-id; GALAXYZ one #planetList per planet, id from a.planetlink cp=
    if (!rows.length) return { shown: 0 };
    const ready = this.readyKeys();
    if (!ready.size) return { shown: 0 };
    let shown = 0;
    for (const { row, planetId, moonId } of rows) {
      const pid = +planetId;
      if (!(pid > 0)) continue;
      if (ready.has('p' + pid)) {
        const b = this.bodies['p' + pid];
        row.appendChild(h('span', { class: [P + 'ready', P + 'ready-planet'], dataset: { key: 'p' + pid }, title: 'План: можно строить — ' + itemLabel(this.plans.bodies['p' + pid][0]) + (b ? ' (' + b.name + ')' : '') }));
        shown++;
      }
      {
        const mid = +moonId || 0;
        if (mid && ready.has('m' + mid)) {
          row.appendChild(h('span', { class: [P + 'ready', P + 'ready-moon'], dataset: { key: 'm' + mid }, title: 'План луны: можно строить — ' + itemLabel(this.plans.bodies['m' + mid][0]) }));
          shown++;
        }
      }
    }
    return { shown };
  };

  // ---------------------------------------------------------------- tab
  Todo.prototype.listKeys = function () {
    const cur = OGX.state.current() || {};
    const keys = [];
    const order = (k) => { const b = this.bodies[k]; if (!b) return 1e9; return (b.order || 0) * 2 + (b.type === 'moon' ? 1 : 0); };
    if (cur.key) keys.push(cur.key);
    const rest = Object.keys(this.plans.bodies).filter((k) => k !== cur.key && this.plans.bodies[k].length).sort((a, b) => order(a) - order(b));
    return keys.concat(rest, [RESEARCH]);
  };

  Todo.prototype.render = function (container) {
    const wrap = h('div', { class: P + 'tab' });
    wrap.appendChild(this.renderForm());
    for (const key of this.listKeys()) wrap.appendChild(this.renderList(key));
    container.appendChild(wrap);
  };

  Todo.prototype.renderForm = function () {
    const cur = OGX.state.current() || {};
    const bodyOpts = [];
    for (const { planet, moon } of this.sortedBodies()) {
      bodyOpts.push(planet);
      if (moon) bodyOpts.push(moon);
    }
    if (!this.form.list || (this.form.list !== RESEARCH && !this.bodies[this.form.list])) this.form.list = cur.key && this.bodies[cur.key] ? cur.key : (bodyOpts[0] ? bodyOpts[0].key : RESEARCH);
    const listSel = h('select', { class: P + 'f-list', 'data-ogx-act': 'todo:form-list' },
      bodyOpts.map((b) => h('option', { value: b.key, selected: b.key === this.form.list }, bodyLabel(b))),
      h('option', { value: RESEARCH, selected: this.form.list === RESEARCH }, 'Исследования'));
    const objSel = h('select', { class: P + 'f-obj', 'data-ogx-act': 'todo:form-object' });
    const valInp = h('input', { class: P + 'f-val', type: 'number', min: '1', step: '1', style: 'width:70px', 'data-ogx-act': 'todo:form-value' });
    const hint = h('span', { class: P + 'f-hint' });
    const fillObjects = () => {
      objSel.textContent = '';
      const key = listSel.value;
      const b = this.bodies[key];
      const objs = key === RESEARCH ? OGX.catalog.list('research') : OGX.catalog.list().filter((o) => fitsBody(o, b));
      for (const o of objs) objSel.appendChild(h('option', { value: String(o.id), selected: o.id === this.form.objectId }, OGX.catalog.name(o.id)));
      if (!objs.some((o) => o.id === this.form.objectId) && objs[0]) { this.form.objectId = objs[0].id; objSel.value = String(objs[0].id); }
      fillValue();
    };
    const fillValue = () => {
      const o = OGX.catalog.get(+objSel.value);
      if (!o) return;
      if (isUnitObj(o)) { valInp.value = '1'; hint.textContent = 'шт.'; } else { valInp.value = String(this.nextLevel(listSel.value, o.id)); hint.textContent = 'уровень'; }
    };
    listSel.addEventListener('change', OGX.safe(() => { this.form.list = listSel.value; rec('U', 'form:list', { list: listSel.value }); fillObjects(); }, 'todo:form'));
    objSel.addEventListener('change', OGX.safe(() => { this.form.objectId = +objSel.value; rec('U', 'form:object', { objectId: +objSel.value }); fillValue(); }, 'todo:form'));
    fillObjects();
    const add = h('button', { class: ['ogx-btn', 'ogx-btn-primary', P + 'f-add'], 'data-ogx-act': 'todo:form-add', onClick: async () => {
      const o = OGX.catalog.get(+objSel.value);
      if (!o) return;
      const v = int0(valInp.value);
      const spec = { objectId: o.id };
      if (isUnitObj(o)) spec.amount = v || 1; else spec.targetLevel = v;
      rec('U', 'form:add', { list: listSel.value, objectId: o.id, value: v });
      const r = await this.wAdd(listSel.value, spec, 'form');
      OGX.dom.toast(r.message, { type: r.ok ? 'ok' : 'warn' });
    } }, 'Добавить');
    return h('div', { class: P + 'form' }, listSel, objSel, valInp, hint, add);
  };

  Todo.prototype.sortedBodies = function () {
    const planets = Object.values(this.bodies).filter((b) => b.type === 'planet').sort((a, b) => (a.order || 0) - (b.order || 0));
    return planets.map((p) => ({ planet: p, moon: (p.moonKey && this.bodies[p.moonKey]) || Object.values(this.bodies).find((m) => m.type === 'moon' && m.planetId === p.planetId) || null }));
  };

  Todo.prototype.renderList = function (key) {
    const list = this.list(key);
    const isR = key === RESEARCH;
    const body = isR ? this.researchBody() : this.bodies[key];
    const cur = OGX.state.current() || {};
    const title = isR ? 'Исследования' : bodyLabel(body);
    const res = this.resourcesOf(body);
    const sec = h('div', { class: P + 'list', dataset: { list: key } });
    const head = h('div', { class: P + 'list-head' }, h('b', null, title),
      !isR && key === cur.key ? h('span', { class: P + 'cur' }, ' (текущая)') : null,
      isR && body ? h('span', { class: P + 'muted' }, ' оплата и лаборатория: ' + bodyLabel(body)) : null);
    sec.appendChild(head);
    if (res) {
      sec.appendChild(h('div', { class: P + 'muted' }, 'Сейчас: ' + resText({ metal: Math.floor(res.metal.amount), crystal: Math.floor(res.crystal.amount), deuterium: Math.floor(res.deuterium.amount) })));
    } else if (list.length) {
      sec.appendChild(h('div', { class: P + 'muted' }, 'Ресурсы неизвестны: откройте эту планету в игре.'));
    }
    if (!list.length) {
      sec.appendChild(h('div', { class: 'ogx-empty ' + P + 'empty' }, isR ? 'Исследований в плане нет. Нажмите «+» на странице исследований.' : 'План пуст. Нажмите «+» у постройки или добавьте пункт выше.'));
      return sec;
    }
    const table = h('table', { class: ['ogx-table', P + 'table'] },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Объект'), h('th', null, 'Стоимость'), h('th', null, 'Время'), h('th', null, 'Статус'), h('th', { title: 'Нарастающий итог с предыдущими пунктами' }, 'Σ'), h('th', null, ''))));
    const tb = h('tbody');
    let cum = zeroCost();
    let cumSecs = 0;
    list.forEach((it, i) => {
      const info = this.itemInfo(key, it);
      cum = addRes(cum, info.cost);
      cumSecs = info.secsKnown && cumSecs !== null ? cumSecs + info.secs : null;
      const w = this.waitFor(info.cost, res);
      const cw = this.waitFor(cum, res);
      let status;
      if (info.queued) status = h('span', { class: P + 'st-queued' }, 'в очереди');
      else if (it.sentAt) status = h('span', { class: P + 'st-sent', title: it.sentMsg || '' }, 'заказано ' + OGX.fmt.time(it.sentAt));
      else if (w === null) status = h('span', { class: P + 'muted' }, 'нет данных');
      else if (Number.isNaN(w)) status = h('span', { class: P + 'st-wait', title: 'Ресурсы известны только со страницы «Империя»: выработка этой планеты неизвестна. Откройте её в игре.' }, 'не хватает (выработка неизвестна)');
      else if (w === 0) status = h('span', { class: P + 'st-ok' }, 'можно строить');
      else if (!Number.isFinite(w)) status = h('span', { class: P + 'st-bad', title: 'Нет производства или не хватает хранилища' }, 'не накопить');
      else status = h('span', { class: P + 'st-wait' }, 'через ', OGX.dom.countdown(now() + w * 1000, { short: true, doneText: 'можно' }));
      const cumTxt = cw === null ? '' : cw === 0 ? 'хватает' : Number.isNaN(cw) ? 'не хватает' : Number.isFinite(cw) ? 'через ' + OGX.fmt.durationShort(cw) : 'не накопить';
      const btnBuild = h('button', { class: ['ogx-btn', 'ogx-btn-primary', P + 'build'], 'data-ogx-act': 'todo:build', disabled: this.busy.has(it.id),
        title: 'Отправить заказ на сервер (по клику, с подтверждением)' }, 'Построить');
      btnBuild.addEventListener('click', OGX.safe(() => { rec('U', 'build', { list: key, objectId: it.objectId, level: it.targetLevel, amount: it.amount }); return this.build(key, it.id, btnBuild); }, 'todo:build'));
      const levelNote = it.targetLevel ? (info.known !== null ? `сейчас ${info.known}` : 'уровень неизвестен') : '';
      tb.appendChild(h('tr', { dataset: { id: it.id, obj: String(it.objectId) }, class: w === 0 && !info.queued ? P + 'row-ok' : null },
        h('td', null, String(i + 1)),
        h('td', { class: P + 'name' }, itemLabel(it), levelNote ? h('div', { class: P + 'muted' }, levelNote) : null),
        h('td', { class: P + 'cost', title: resText(info.cost) }, resLines(info.cost)),
        info.secsKnown ? h('td', { class: P + 'time' }, OGX.fmt.durationShort(info.secs)) : h('td', { class: [P + 'time', P + 'muted'], title: TIME_UNKNOWN }, '—'),
        h('td', { class: P + 'status' }, status),
        h('td', { class: P + 'cum', title: 'С предыдущими: ' + resText(cum) + (cumSecs !== null ? ', время ' + OGX.fmt.duration(cumSecs) : '') }, h('div', null, OGX.fmt.short(cum.metal + cum.crystal + cum.deuterium)), h('div', { class: P + 'muted' }, cumTxt)),
        h('td', { class: P + 'acts' }, h('div', { class: P + 'nw' },
          h('button', { class: ['ogx-btn', 'ogx-btn-icon', P + 'up'], 'data-ogx-act': 'todo:up', title: 'Выше', disabled: i === 0,
            onClick: () => { rec('U', 'move', { list: key, id: it.id, dir: -1 }); return this.wMove(key, it.id, -1); } }, '↑'),
          h('button', { class: ['ogx-btn', 'ogx-btn-icon', P + 'down'], 'data-ogx-act': 'todo:down', title: 'Ниже', disabled: i === list.length - 1,
            onClick: () => { rec('U', 'move', { list: key, id: it.id, dir: 1 }); return this.wMove(key, it.id, 1); } }, '↓'),
          h('button', { class: ['ogx-btn', 'ogx-btn-icon', P + 'del'], 'data-ogx-act': 'todo:remove', title: 'Удалить из плана',
            onClick: () => { rec('U', 'remove', { list: key, id: it.id }); return this.wRemove(key, it.id, 'user'); } }, '✕')),
          h('div', null, btnBuild))));
    });
    table.appendChild(tb);
    const tw = this.waitFor(cum, res);
    table.appendChild(h('tfoot', null, h('tr', { class: P + 'total' },
      h('td', null, ''), h('td', null, 'Итого'),
      h('td', { class: P + 'tcost', title: resText(cum) }, resLines(cum)),
      cumSecs !== null ? h('td', { class: P + 'ttime' }, OGX.fmt.durationShort(cumSecs)) : h('td', { class: [P + 'ttime', P + 'muted'], title: TIME_UNKNOWN }, '—'),
      h('td', { colspan: '3', class: P + 'twait' }, tw === null ? '' : tw === 0 ? 'ресурсов хватает на весь план' : Number.isNaN(tw) ? 'ресурсов не хватает (выработка неизвестна)'
        : Number.isFinite(tw) ? 'весь план — через ' + OGX.fmt.durationShort(tw) : 'весь план не накопить при текущем хранилище'))));
    sec.appendChild(table);
    if (timesUnknown()) sec.appendChild(h('div', { class: [P + 'muted', P + 'time-note'] }, 'Время постройки не показано: скорость строительства этой вселенной неизвестна.'));
    return sec;
  };

  const CSS = `
.${P}host { position: relative; }
.${P}plus { position: absolute; top: 1px; left: 1px; z-index: 5; min-width: 16px; height: 16px; padding: 0 3px; border: 1px solid #2b3846; border-radius: 3px;
  background: rgba(13,16,20,.85); color: #8fd18f; font: bold 11px/14px Verdana, Arial, sans-serif; cursor: pointer; }
.${P}plus:hover { background: #1f3a1f; color: #fff; }
.${P}plus.${P}plus-r { left: auto; right: 1px; }
.${P}plus.${P}has { color: #6f9fd8; font-size: 9px; }
.${P}dplus { margin: 4px 0; padding: 2px 8px; border: 1px solid #2b3846; border-radius: 3px; background: #161c24; color: #8fd18f; font: bold 11px Verdana, Arial, sans-serif; cursor: pointer; }
.${P}dplus:hover { background: #1f3a1f; color: #fff; }
#planetList .smallplanet > .${P}ready { position: absolute; z-index: 6; width: 7px; height: 7px; border-radius: 50%; background: #4caf50; box-shadow: 0 0 4px #4caf50; pointer-events: auto; }
#planetList .smallplanet > .${P}ready-planet { left: 2px; top: 2px; }
#planetList .smallplanet > .${P}ready-moon { right: 2px; top: 2px; background: #8fd18f; }
.${P}tab { display: flex; flex-direction: column; gap: 10px; }
.${P}form { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ogx-root .${P}form select { visibility: visible; width: auto; max-width: 170px; height: auto; float: none; } /* game CSS: body.ogame select{visibility:hidden}, select{width:250px} */
.${P}list-head { margin-bottom: 2px; }
.${P}muted { color: var(--ogx-muted, #8a96a3); font-size: 10px; }
.${P}cur { color: var(--ogx-accent, #6f9fd8); }
.${P}table td { vertical-align: top; }
.${P}acts { white-space: nowrap; text-align: right; }
.${P}acts .ogx-btn { margin-left: 2px; }
.${P}acts > div + div { margin-top: 2px; }
.${P}nw { white-space: nowrap; }
.${P}sep { display: none; }
.${P}table { width: 100%; font-size: 11px; }
.${P}table td, .${P}table th { padding: 2px 3px; }
.${P}st-ok { color: var(--ogx-ok, #4caf50); font-weight: bold; }
.${P}st-wait { color: var(--ogx-warn, #ff9800); }
.${P}st-bad { color: var(--ogx-bad, #f44336); }
.${P}st-queued, .${P}st-sent { color: var(--ogx-accent, #6f9fd8); }
.${P}row-ok td.${P}name { color: var(--ogx-ok, #4caf50); }
.${P}total td { font-weight: bold; border-top: 1px solid var(--ogx-border, #2b3846); }
`;
})(window.OGX);
