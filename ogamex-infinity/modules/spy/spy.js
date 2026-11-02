/* ogamex-infinity/modules/spy/spy.js — Owner: infinity/spy.
 * Spy-report table and quick raid (DESIGN §4.2.4).
 *   - Collection on /messages: OGX.messages.watch → every `espionage_report` li of the espionage subtab panel (#ui-id-14)
 *     is parsed in its short form (OGX.messages.parse.espionageShort) and stored; when `autoFetchFull` is on the full
 *     report is fetched through the polite background queue (OGX.messages.fetchDetail → GET /ajax/messages/<id>
 *     ?tab=fleets&subtab=espionage, routes/web.php:170, MessagesController::ajaxGetMessage) and parsed with
 *     OGX.messages.parse.espionageFull. Full reports the user opens in the game overlay are captured through the
 *     bridge (same endpoint, page XHR). «Загрузить все отчёты» scans the whole espionage subtab (explicit click + warning:
 *     reading marks messages as read, MessageService.php:208-212 / messages.md §1).
 *   - Derived per report (recomputed on display with the current class, ship stats and body): loot (calc.loot: 50 %, 75 %
 *     for Discoverer, LootService), cargo ships needed with the reserve % (calc.cargoNeeded), fleet/defence value
 *     (calc.unitsValue), debris (existing field + potential debris of the fleet/defence, calc.debris), distance, flight
 *     time and fuel from the current body (calc.distance/flightDuration/fuel, fleet.md §2.7; budget = max(client, server),
 *     DESIGN decision 12), profit = loot MSU − fuel MSU, flags (unknown sections, fleet, defence, moon).
 *   - Tab «Шпионаж» (order 40) of the shared side panel: sortable table with the actions Рейд (OGX.fleet.send, mission 1,
 *     speed 10, explicit click), Подготовить (OGX.fleet.prefill.open), Шпионить (OGX.api.sendMiniFleet mission 6),
 *     Симулятор (simUrl + base64 TrashSim prefill, opened by the user only), Удалить (OGX.messages.delete → POST
 *     /messages messageId=<id>&action=103, MessagesController::post), В цели (bus 'targets:add').
 *   - Message badges: loot, cargo needed and a raid button inside each espionage li (inserted before
 *     `message-footer.msg_actions`, resources/views/ingame/messages/tabs/fleets/subtab.blade.php:53-56).
 * OgameX facts (messages.md §4): the short list form has only player, approximate resources (formatNumberLong, lossy
 * ≥ 1Mn), the exact total incl. energy and the counter-espionage %; fleets/defence/loot in the list are static
 * placeholders (espionage_report.blade.php:40-53). The full report has exact resources in li.resource_list_el[title]
 * (espionage_report_full.blade.php:61-76), a debris list (:91-111), ships/defence/buildings/research lists (:117-253)
 * and the real target type in the attack link `…/fleet?…&type=T&mission=1` (:24).
 * Writes: spy.reports { v:1, items:{ [msgId]: SpyReport & { fetchedAt, full, approx } } } (cap 500, maxAgeHours),
 *         spy.raids { v:1, items:[{ reportId, coords, type, ships, sentAt, ok, message }] } (cap 200); settings spy.*.
 * Local helpers (not in core): TrashSim prefill encoder, flight estimate with cached env (instead of one
 * OGX.fleet.estimate storage round-trip per row).
 *
 * GALAXYZ (ogamex.eu/Aeternum, 2Moons 1.8 fork; REAL pages messages-spy / messages-all):
 *   - The whole report is in the message row (tr.message_head + tr.messages_body .spyRaport): it is parsed from the row with
 *     OGX.messages.parse.espionageFull (exact im[] values of the Simulate link), never fetched; `autoFetchFull` is OgameX only.
 *     Rows arrive through OGX.messages.watch (also rows the game inserts after a category click: Message.getMessages(0|100)).
 *   - Reports carry no player, no debris field and no planet id: the table shows the planet name instead of the player,
 *     «неизвестно» for the current debris field, and probes go through OGX.api.sendMiniFleet by coordinates (unresolved ->
 *     the core's suggestion with a link to the galaxy system, which costs deuterium and is opened only by the user).
 *   - Loot is 50 % with the 2Moons calculateSteal fill order (calc.distributeLoot): the cargo needed for the whole loot is
 *     larger than the loot sum (metal only up to 1/3 + 1/2 of the rest...): core calc.lootCapacity.
 *   - Flight time includes the officer factor (state.factors().FlyTime, General 613) like fleet.estimate.
 *   - Simulator: the game's own page=battleSimulator with the im[] values of the report (TrashSim knows only OGame ships).
 *   - Badges go into the body cell of the message (never into the tr, which would add a table column).
 *   - «Загрузить все отчёты»: GET page=messages&mode=view&messcat=0&site=N&ajax=1 (marks them read; explicit click + confirm).
 *   - Probes: every one-click spy (fleetAjax mission 6) sends min(account spycount, probes on the planet), shipCount is ignored
 *     [UPSTREAM ShowFleetAjaxPage]. Setting spy.probes (default 1100) is passed as shipCount; the account's spycount is read from
 *     page=settings when the user opens it (or on the explicit «Проверить» click: one read-only GET) and the tab warns when it
 *     differs. The game's settings form is never posted (no saved real markup of it to verify a full re-post against).
 */
(function (OGX) {
  'use strict';

  const NAME = 'spy';
  const P = 'ogx-i-spy-';
  const PANEL_ID = 'infinity';
  const RES = ['metal', 'crystal', 'deuterium'];
  const CAP_REPORTS = 500;
  const CAP_RAIDS = 200;
  const HOUR = 3600000;
  const RAID_SHIP = 217;   // «Улучшенный транспорт» (Battle Transporter): the only raid / loot carrier
  const DEFAULT_SIM = 'https://trashsim.oplanet.eu/ru#prefill=';
  const CLASS_NUM = { miner: 1, warrior: 2, explorer: 3, none: 0 }; // TrashSim / OGame API class ids

  const rec = (src, what, data) => { try { return OGX.log.rec(src, NAME, what, data); } catch (e) { return null; } };
  const learnValue = (name, v, o) => { try { return OGX.learn ? OGX.learn.value(name, v, o) : true; } catch (e) { return true; } };
  const learnCheck = (name, o) => { try { return OGX.learn ? OGX.learn.check(name, o) : true; } catch (e) { return true; } };
  const h = (...a) => OGX.dom.h(...a);
  const num = (n) => OGX.fmt.num(n);
  const coordsStr = (c) => (Array.isArray(c) ? c.join(':') : c || null);
  const isGz = () => !!(OGX.page && OGX.page.isGz && OGX.page.isGz());

  /** Cargo capacity that takes the whole loot: GALAXYZ core calc.lootCapacity (2Moons calculateSteal fill order needs more room
   * than the loot sum), OgameX the loot sum. */
  function lootCapacity(loot) {
    const total = (loot.metal || 0) + (loot.crystal || 0) + (loot.deuterium || 0);
    if (!(total > 0)) return 0;
    return isGz() ? OGX.calc.lootCapacity(loot) : total;
  }

  OGX.module({
    name: NAME,
    title: 'Шпионские доклады и рейды',
    pages: '*',
    settings: {
      autoFetchFull: { type: 'bool', default: true, label: 'Загружать полные доклады автоматически', hint: 'Только OgameX: открытие доклада помечает его прочитанным. В GALAXYZ доклад целиком виден в списке сообщений, загрузка не нужна' },
      // Aeternum: raids and loot go ONLY with Battle Transporters (217, John's rule): no raid-ship choice, an old saved
      // 'spy.raidShip' (202/203) is ignored.
      probes: { type: 'int', default: 1100, min: 1, max: 4294967295, label: 'Зондов на шпионаж',
        hint: 'GALAXYZ: один клик шпионажа (кнопка галактики, «Зонды» здесь и в целях) отправляет столько зондов, сколько стоит в настройках игры; дополнение предупреждает, если там другое число' },
      reservePct: { type: 'int', default: 10, min: 0, max: 100, label: 'Запас трюма, %' },
      keepLatestOnly: { type: 'bool', default: true, label: 'Удалять старые доклады по той же цели', hint: 'На каждую планету или луну остаётся только самый свежий доклад (сообщения в игре не трогаются)' },
      maxAgeHours: { type: 'int', default: 168, min: 1, max: 2160, label: 'Хранить доклады, ч' },
      minLootToShow: { type: 'int', default: 0, min: 0, label: 'Показывать доклады с добычей от' },
      simUrl: { type: 'string', default: DEFAULT_SIM, label: 'Адрес симулятора боя', hint: 'Данные добавляются в конец или вместо {prefill}. В GALAXYZ открывается симулятор игры (TrashSim не знает кораблей 2Moons)' },
      showBadges: { type: 'bool', default: true, label: 'Значки с добычей в списке сообщений' },
      confirmRisky: { type: 'bool', default: true, label: 'Спрашивать перед рейдом на цель с флотом/обороной (если подтверждения выключены)' },
      filter: { type: 'string', default: '', hidden: true, label: 'Фильтр таблицы' },
    },
    async init(ctx) {
      const s = new Spy(ctx);
      ctx._spy = s;
      await s.start();
    },
    dispose(ctx) { if (ctx._spy) ctx._spy.stop(); },
  });

  // ================================================================== storage shapes
  function migrateReports(v) {
    if (!v || typeof v !== 'object' || v.v !== 1 || !v.items || typeof v.items !== 'object') return { v: 1, items: {} };
    return v;
  }
  function migrateRaids(v) {
    if (!v || typeof v !== 'object' || v.v !== 1 || !Array.isArray(v.items)) return { v: 1, items: [] };
    return v;
  }
  // Target of a stored report: coords + planet type (a moon is its own target). null when unknown (never deduplicated).
  function reportTargetKey(r) {
    const a = r && r.attackParams;
    if (a && a.galaxy) return `${a.galaxy}:${a.system}:${a.position}:${+a.type || 1}`;
    const c = r && r.target && r.target.coords;
    return Array.isArray(c) && c.length >= 3 ? `${c[0]}:${c[1]}:${c[2]}:${(r.target && r.target.planetType) || 1}` : null;
  }
  // Keeps only the newest report per target (by report time, then id). Returns the number removed.
  function dedupeReports(o) {
    const best = {};
    let removed = 0;
    for (const [id, r] of Object.entries(o.items)) {
      const k = reportTargetKey(r);
      if (!k) continue;
      const cur = best[k];
      if (!cur) { best[k] = id; continue; }
      const newer = ((r.ts || 0) - (o.items[cur].ts || 0)) || (+id - +cur);
      delete o.items[newer > 0 ? cur : id];
      if (newer > 0) best[k] = id;
      removed++;
    }
    return removed;
  }
  function pruneReports(o, maxAgeHours, now, latestOnly) {
    const minTs = now - maxAgeHours * HOUR;
    for (const [id, r] of Object.entries(o.items)) if (!r || (r.ts && r.ts < minTs)) delete o.items[id];
    if (latestOnly) dedupeReports(o);
    const ids = Object.keys(o.items);
    if (ids.length > CAP_REPORTS) {
      ids.sort((a, b) => (o.items[b].ts || 0) - (o.items[a].ts || 0));
      for (const id of ids.slice(CAP_REPORTS)) delete o.items[id];
    }
    return o;
  }

  // ================================================================== Spy
  function Spy(ctx) {
    this.ctx = ctx;
    this.log = ctx.log;
    this.reports = { v: 1, items: {} };
    this.raids = { v: 1, items: [] };
    this.env = null;
    this.queue = [];
    this.queued = new Set();
    this.busy = false;
    this.badges = new Map(); // msgId -> { li, el }
    this.offs = [];
    this.table = null;
    this.moreOpen = new Set(); // report ids whose «⋯» action row is open
    this.tab = null;
    this.refreshSoon = OGX.util.debounce(OGX.safe(() => this.refresh(), 'spy:refresh'), 150);
    // Every add-on action is a timed B event (CORE_API §21.1).
    this.wSend = OGX.log.wrap(NAME, (req) => OGX.fleet.send(req), 'raid:send');
    this.wPrefill = OGX.log.wrap(NAME, (spec) => OGX.fleet.prefill.open(spec), 'raid:prefill');
    this.wSpy = OGX.log.wrap(NAME, (q) => OGX.api.sendMiniFleet(q), 'spy:mini');
    this.wDelete = OGX.log.wrap(NAME, (id) => OGX.messages.delete(id), 'message:delete');
    this.wFetch = OGX.log.wrap(NAME, (id) => OGX.messages.fetchDetail(id, 'fleets', 'espionage', { background: true }), 'report:fetch');
    this.wList = OGX.log.wrap(NAME, (page) => OGX.messages.fetchList('fleets', 'espionage', page, { background: true }), 'report:list');
  }

  Spy.prototype.set = function (k) { return this.ctx.settings.get(k); };

  Spy.prototype.start = async function () {
    const ctx = this.ctx;
    ctx.css(CSS);
    this.reports = migrateReports(await ctx.store.get('reports', null));
    // reports stored before keepLatestOnly existed (or while it was off): drop the older duplicates once at start
    if (this.set('keepLatestOnly') !== false && dedupeReports(JSON.parse(JSON.stringify(this.reports)))) {
      this.reports = await ctx.store.update('reports', (old) => { const o = migrateReports(old); dedupeReports(o); return o; }, null);
    }
    this.raids = migrateRaids(await ctx.store.get('raids', null));
    await this.loadEnv();
    try { this.spycount = isGz() ? await OGX.api.gzSpyCount() : null; } catch (e) { this.spycount = null; }
    if (isGz() && OGX.page.is('options')) await this.readGameSettings(document, 'settings');

    this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
    this.tab = this.panel.addTab({ id: 'spy', label: 'Шпионаж', order: 40, render: (c) => this.render(c) });
    this.updateBadge();

    this.offs.push(ctx.store.subscribe('reports', (v) => { this.reports = migrateReports(v); this.refreshSoon(); }));
    if (isGz()) this.offs.push(OGX.storage.subscribe('gz.spycount', (v) => { this.spycount = v && +v.value > 0 ? v : null; this.refreshSoon(); }, { scope: 'server' }));
    this.offs.push(ctx.store.subscribe('raids', (v) => { this.raids = migrateRaids(v); this.refreshSoon(); }));
    this.offs.push(OGX.state.onChange(['bodies', 'shipStats', 'research', 'player', 'server'], async () => { await this.loadEnv(); this.refreshSoon(); }));
    this.offs.push(ctx.settings.onChange((key) => { if (!/filter$/.test(String(key))) this.refreshSoon(); }));

    // Reports opened in the game's own detail overlay (page XHR GET /ajax/messages/<id>).
    // GALAXYZ has no per-message endpoint (the report is in the list row; rows the game inserts are seen by messages.watch).
    if (!isGz() && OGX.bridge && OGX.bridge.onXhr) {
      this.offs.push(OGX.bridge.onXhr(/^\/ajax\/messages\/\d+$/, (ev) => this.onDetailXhr(ev)));
    }
    if (OGX.page.is('messages')) {
      this.offs.push(OGX.messages.watch((item) => this.onItem(item)));
    }
    rec('B', 'init', { reports: Object.keys(this.reports.items).length, page: OGX.page.info().name });
  };

  Spy.prototype.stop = function () {
    for (const off of this.offs) { try { off && off(); } catch (e) { /* ignore */ } }
    this.offs = [];
  };

  Spy.prototype.loadEnv = async function () {
    const [stats, server, player, bodies, research] = await Promise.all([
      OGX.state.shipStats(), OGX.state.server(), OGX.state.player(), OGX.state.bodies(), OGX.state.research()]);
    const cur = OGX.state.current() || null;
    const body = cur && bodies ? bodies[cur.key] || null : null;
    let flyFactor = 1;
    if (isGz() && OGX.state.factors) {
      // 2Moons fleetspeedfactor = max(0, 1 + FlyTime) (General 613, boost 707), as in fleet.estimate
      try { const f = await OGX.state.factors(); const ft = f && +f.FlyTime; if (Number.isFinite(ft)) flyFactor = Math.max(0, 1 + ft); } catch (e) { flyFactor = 1; }
    }
    this.env = { stats: stats || {}, server: server || {}, player: player || {}, playerClass: OGX.calc.normClass(player && player.playerClass), bodies: bodies || {}, research: research || { levels: {} }, cur, body, flyFactor, gz: isGz() };
    return this.env;
  };

  // ================================================================== collection
  Spy.prototype.onItem = function (item) {
    if (!item || item.subtab !== 'espionage' || !item.li) return;
    if (item.engine === 'galaxyz' || isGz()) return this.onGzItem(item);
    const li = item.li;
    let key;
    try { key = OGX.messages.classify(li, 'espionage'); } catch (e) { key = null; }
    if (key !== 'espionage_report') return;
    const id = +item.id;
    const have = this.reports.items[id];
    if (!have) {
      const short = this.parseShort(li);
      if (short) OGX.safe(() => this.saveReport(short), 'spy:save')();
    }
    if (this.set('showBadges')) this.badge(id, li);
    const r = this.reports.items[id] || have;
    if (this.set('autoFetchFull') && (!r || !r.full)) this.enqueue(id);
  };

  /** GALAXYZ row: the full report is in the row (no request). Spy-detected rows of the same category are skipped. */
  Spy.prototype.onGzItem = function (item) {
    if (item.key !== 'espionage_report') return;
    const id = +item.id;
    if (!id) return;
    const have = this.reports.items[id];
    if (!have || !have.full) {
      const r = this.fromGzRow(item.li);
      if (r) OGX.safe(() => this.saveReport(r), 'spy:save')();
      else this.log.warn('report row not parsed', id);
    }
    if (this.set('showBadges')) this.badge(id, item.li, item.body);
  };

  /** GALAXYZ tr.message_head (page or a fetched list) -> stored report (full, exact) + the game's simulator link. */
  Spy.prototype.fromGzRow = function (tr) {
    let f = null;
    try { f = OGX.messages.parse.espionageFull(tr); } catch (e) { f = null; }
    if (!f || !f.id || !f.target || !f.target.coords) return null;
    const r = this.fromParsed(f);
    r.simHref = f.simHref || null;   // core: the report's own page=battleSimulator link
    delete r.gz;
    return r;
  };

  Spy.prototype.parseShort = function (li) {
    let s;
    try { s = OGX.messages.parse.espionageShort(li); } catch (e) {
      this.log.warn('short report not parsed', li && li.dataset && li.dataset.msgId, e && e.message);
      return null;
    }
    if (!s || !s.target || !s.target.coords) return null;
    const dateEl = OGX.dom.$('.msg_head .msg_date', li);
    const ts = dateEl ? OGX.time.parseServerWall(dateEl.textContent.replace(/\s+/g, ' ').trim()) : null;
    const res = s.resources || {};
    const r = {
      id: +s.id, ts: ts || null, target: s.target, player: s.player || null, counterEspionage: s.counterEspionage,
      attackParams: null,
      resources: { metal: res.metal || 0, crystal: res.crystal || 0, deuterium: res.deuterium || 0, energy: null },
      totalInclEnergy: s.total, debris: { metal: 0, crystal: 0, deuterium: 0 },
      ships: {}, defense: {}, buildings: {}, research: {},
      known: { ships: false, defense: false, buildings: false, research: false },
      full: false, approx: true, fetchedAt: null, seenAt: OGX.time.serverNow(),
    };
    learnCheck('spy.short', r.resources);
    return r;
  };

  Spy.prototype.fromFull = function (doc, html) {
    let f;
    try { f = OGX.messages.parse.espionageFull(doc || html); } catch (e) { return null; }
    if (!f || !f.id || !f.target || !f.target.coords) return null;
    return this.fromParsed(f);
  };

  /** parse.espionageFull result -> stored report (sanity checks as learning alerts). */
  Spy.prototype.fromParsed = function (f) {
    const r = Object.assign({}, f, { full: true, approx: false, fetchedAt: OGX.time.serverNow() });
    delete r.gz;
    // sanity checks → learning alerts (L 'implausible') on NaN/negatives
    if (f.resources) learnCheck('spy.full.resources', { metal: f.resources.metal, crystal: f.resources.crystal, deuterium: f.resources.deuterium });
    else r.resources = { metal: 0, crystal: 0, deuterium: 0, energy: null };
    learnCheck('spy.full.units', { ships: f.ships, defense: f.defense });
    for (const [id, n] of Object.entries(Object.assign({}, f.ships, f.defense))) {
      if (!OGX.catalog.get(+id)) this.log.warn('unknown unit id in report', f.id, id);
      learnValue('spy.full.unitCount', n, { min: 0, int: true });
    }
    return r;
  };

  Spy.prototype.saveReport = async function (r) {
    if (!r || !r.id) return;
    const maxAge = this.set('maxAgeHours') || 168;
    const prev = this.reports.items[r.id];
    if (prev && prev.full && !r.full) return;
    if (prev && r.full && prev.totalInclEnergy && r.resources) {
      // cross-check the list total (exact, incl. energy) with the full report
      const sum = RES.reduce((s, k) => s + (r.resources[k] || 0), 0) + (r.resources.energy || 0);
      if (prev.totalInclEnergy > 0 && Math.abs(sum - prev.totalInclEnergy) / prev.totalInclEnergy > 0.02) {
        this.log.warn('report total mismatch', r.id, sum, prev.totalInclEnergy);
        rec('B', 'parse-mismatch', { id: r.id, full: sum, short: prev.totalInclEnergy });
      }
    }
    const merged = Object.assign({}, prev || {}, r, { seenAt: (prev && prev.seenAt) || r.seenAt || OGX.time.serverNow() });
    if (!merged.ts && prev && prev.ts) merged.ts = prev.ts;
    if (prev && prev.totalInclEnergy && !merged.totalInclEnergy) merged.totalInclEnergy = prev.totalInclEnergy;
    this.reports.items[r.id] = merged;
    const now = OGX.time.serverNow();
    this.reports = await this.ctx.store.update('reports', (old) => {
      const o = migrateReports(old);
      o.items[r.id] = Object.assign({}, o.items[r.id] || {}, merged);
      return pruneReports(o, maxAge, now, this.set('keepLatestOnly') !== false);
    }, null);
    rec('B', r.full ? 'report:full' : 'report:short', { id: r.id, coords: coordsStr(r.target.coords) });
    this.updateBadge();
    this.refreshSoon();
  };

  Spy.prototype.enqueue = function (id) {
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    this.pump();
  };

  Spy.prototype.pump = async function () {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift();
        const cur = this.reports.items[id];
        if (cur && cur.full) continue;
        let res;
        try { res = await this.wFetch(id); } catch (e) { res = { error: String(e && e.message || e) }; }
        if (!res || res.error) {
          this.log.warn('full report fetch failed', id, res && res.error);
          this.queued.delete(id);
          continue;
        }
        const r = this.fromFull(res.doc, res.html);
        if (!r) { this.log.warn('full report not parsed', id); continue; }
        if (r.id !== id) this.log.warn('report id differs', id, r.id);
        await this.saveReport(r);
        this.refreshBadge(r.id);
      }
    } finally {
      this.busy = false;
      if (this.queue.length) this.pump();
    }
  };

  Spy.prototype.onDetailXhr = function (ev) {
    if (!ev || ev.status !== 200 || !ev.responseText || ev.responseText.indexOf('data-type="resources"') < 0) return;
    const doc = new DOMParser().parseFromString(ev.responseText, 'text/html');
    if (!doc.querySelector('.detail_msg a.icon_nf_link[href*="mission=1"]')) return; // espionage_report_full.blade.php:24
    const r = this.fromFull(doc);
    if (!r) return;
    rec('B', 'report:captured', { id: r.id });
    this.saveReport(r).then(() => this.refreshBadge(r.id));
  };

  /** Explicit «Загрузить все отчёты»: every page of the espionage subtab, then the full reports. */
  Spy.prototype.scanAll = async function () {
    const gz = isGz();
    const ok = await OGX.dom.confirm(gz
      ? 'Будут загружены все страницы категории «Шпионаж» (Spy messages). Сервер игры пометит эти сообщения прочитанными. Продолжить?'
      : 'Будут загружены все страницы раздела «Шпионаж» и полные доклады. Сервер OgameX пометит их прочитанными. Продолжить?', { okLabel: 'Загрузить' });
    rec('U', 'scan:confirm', { ok });
    if (!ok) return;
    if (gz) return this.scanAllGz();
    let page = 1, pages = 1, found = 0;
    do {
      this.panel.setStatus(`Шпионаж: страница ${page}…`);
      const r = await this.wList(page);
      if (!r || r.error) { OGX.dom.toast('Не удалось загрузить список: ' + (r && r.error || 'ошибка'), { type: 'error' }); break; }
      pages = r.pages || 1;
      for (const it of r.items || []) {
        let key = null;
        try { key = OGX.messages.classify(it.li, 'espionage'); } catch (e) { key = null; }
        if (key !== 'espionage_report') continue;
        found++;
        if (!this.reports.items[it.id]) { const s = this.parseShort(it.li); if (s) await this.saveReport(s); }
        const cur = this.reports.items[it.id];
        if (!cur || !cur.full) this.enqueue(+it.id);
      }
      page++;
    } while (page <= pages && page <= 50);
    this.panel.setStatus(null);
    OGX.dom.toast(`Найдено докладов: ${num(found)}`, { type: 'ok' });
  };

  /** GALAXYZ: every page of messcat 0; the reports are complete in the rows (no detail request). */
  Spy.prototype.scanAllGz = async function () {
    let page = 1, pages = 1, found = 0, added = 0;
    do {
      this.panel.setStatus(`Шпионаж: страница ${page}…`);
      const r = await this.wList(page);
      if (!r || r.error) { OGX.dom.toast('Не удалось загрузить список: ' + (r && r.error || 'ошибка'), { type: 'error' }); break; }
      pages = r.pages || 1;
      for (const it of r.items || []) {
        if (!it || !it.item || it.item.key !== 'espionage_report') continue;
        found++;
        const cur = this.reports.items[it.id];
        if (cur && cur.full) continue;
        const rep = this.fromGzRow(it.li);
        if (rep) { await this.saveReport(rep); added++; }
      }
      page++;
    } while (page <= pages && page <= 50);
    this.panel.setStatus(null);
    OGX.dom.toast(`Найдено докладов: ${num(found)}, новых: ${num(added)}`, { type: 'ok' });
  };

  // ================================================================== derived values
  /** Raids are sized and sent in Battle Transporters only (217); no other carrier, whatever an old setting says. */
  Spy.prototype.cargoShip = function () { return RAID_SHIP; };

  Spy.prototype.derive = function (r) {
    const env = this.env || { stats: {}, server: {}, playerClass: 'none', bodies: {} };
    const cs = this.cargoShip();
    const reserve = +this.set('reservePct') || 0;
    const res = r.resources || {};
    const loot = OGX.calc.loot(res, { attackerClass: env.playerClass });
    const lootPct = OGX.calc.lootPct(env.playerClass);
    const cap = env.stats[cs] ? env.stats[cs].cargo : 0;
    // GALAXYZ: calculateSteal needs more room than the loot sum (lootCapacity); OgameX: the sum
    const needCap = lootCapacity(loot);
    const n = OGX.calc.cargoNeeded(needCap, cs, env.stats, { reservePct: reserve });
    learnValue('spy.loot', loot.total, { min: 0, int: true });
    learnValue('spy.cargoNeeded', n, { min: 0, int: true });
    const fleetVal = OGX.calc.unitsValue(r.ships || {});
    const defVal = OGX.calc.unitsValue(r.defense || {});
    const potential = OGX.calc.debris(Object.assign({}, r.ships || {}, r.defense || {}), env.server || {});
    const fieldKnown = !!r.debris;   // GALAXYZ reports have no debris field
    const field = r.debris || { metal: 0, crystal: 0, deuterium: 0 };
    const debris = { metal: (field.metal || 0) + potential.metal, crystal: (field.crystal || 0) + potential.crystal, deuterium: (field.deuterium || 0) + potential.deuterium };
    debris.total = debris.metal + debris.crystal + debris.deuterium;
    const target = this.target(r);
    const tc = target ? `${target.galaxy}:${target.system}:${target.position}` : null;
    // flight from the current body (fleet.md §2.7; OGX.fleet.estimate logic with the cached env)
    let distance = null, duration = null, fuel = null;
    // research levels unknown -> shipStats() falls back to base speeds (t:null): the time is only a guess
    const durApprox = !(env.stats[cs] && env.stats[cs].t);
    const from = env.cur && env.cur.coords;
    if (from && tc && cap > 0) {
      const ships = { [cs]: Math.max(1, n) };
      const server = env.server || {};
      distance = OGX.calc.distance(from, tc, { galaxies: server.galaxies || 9, systems: server.systems || 499 });
      const maxSpeed = OGX.calc.fleetMaxSpeed(ships, env.stats);
      const speedFactor = OGX.calc.missionSpeedFactor(1, server);
      duration = OGX.calc.flightDuration({ distance, maxSpeed, speedPct: 10, speedFactor, flyFactor: env.flyFactor || 1 });
      if (Number.isFinite(duration)) {
        const fc = OGX.calc.fuel({ ships, stats: env.stats, distance, duration, speedFactor, playerClass: env.playerClass, variant: 'client' });
        const fs = OGX.calc.fuel({ ships, stats: env.stats, distance, duration, speedFactor, playerClass: env.playerClass, variant: 'server', fleetSpeed: server.fleetSpeed || 1, speedPct: 10 });
        fuel = Math.max(fc || 0, fs || 0);
      } else duration = null;
    }
    const rates = OGX.calc.msuRates();   // the account's rate (Stats setting stats.msuRates, else the server's trader rate)
    const profit = OGX.calc.msu(loot, rates) - OGX.calc.msu({ deuterium: fuel || 0 }, rates);
    const known = r.known || {};
    const flags = {
      unknownFleet: !known.ships, unknownDefense: !known.defense,
      hasFleet: OGX.util.shipsTotal(r.ships || {}) > 0, hasDefense: Object.entries(r.defense || {}).some(([id, c]) => +c > 0 && +id < 500),
      moon: target ? +target.type === 3 : false, approx: !!r.approx,
    };
    flags.risky = flags.hasFleet || flags.hasDefense || flags.unknownFleet || flags.unknownDefense;
    // raid availability on the current body
    let canRaid = true, reason = '';
    const body = env.body;
    const have = body && body.shipsT ? (body.ships && body.ships[cs]) || 0 : null;
    if (!target) { canRaid = false; reason = 'Неизвестны координаты цели'; }
    else if (!(cap > 0)) { canRaid = false; reason = 'Неизвестна вместимость транспорта'; }
    else if (n <= 0) { canRaid = false; reason = 'Нечего забирать'; }
    else if (have !== null && have < n) { canRaid = false; reason = `На планете ${num(have)} ${OGX.catalog.shortName(cs)}, нужно ${num(n)}`; }
    else if (env.cur && target && env.cur.coords === tc && !!env.cur.isMoon === (+target.type === 3)) { canRaid = false; reason = 'Это текущая планета'; }
    return { cs, cap, n, needCap, loot, lootPct, fleetVal, defVal, debris, field, fieldKnown, potential, distance, duration, durApprox, fuel, profit, rates, flags, canRaid, reason, have, target, tc };
  };

  const APPROX_NOTE = 'Уровни двигателей неизвестны (не открывались «Исследования» или «Империя») — время по базовой скорости кораблей, реальное меньше';
  function flightText(d) {
    if (d.duration === null) return '—';
    return (d.durApprox ? '≈' : '') + OGX.fmt.duration(d.duration);
  }
  function flightTitle(d) {
    if (d.distance === null) return 'Нет данных о текущей планете';
    const base = `Расстояние ${num(d.distance)}, дейтерий ~${num(d.fuel || 0)}`;
    return d.durApprox ? base + '. ' + APPROX_NOTE : base;
  }

  Spy.prototype.target = function (r) {
    if (r.attackParams && r.attackParams.galaxy) return Object.assign({}, r.attackParams, { type: +r.attackParams.type || 1 });
    const c = r.target && r.target.coords;
    if (!Array.isArray(c) || c.length < 3) return null;
    return { galaxy: c[0], system: c[1], position: c[2], type: (r.target && r.target.planetType) || 1 };
  };

  Spy.prototype.lastRaid = function (id) {
    for (let i = this.raids.items.length - 1; i >= 0; i--) if (this.raids.items[i].reportId === id) return this.raids.items[i];
    return null;
  };

  // ================================================================== actions (explicit clicks only)
  Spy.prototype.raid = async function (id, btn) {
    const r = this.reports.items[id];
    if (!r) { OGX.dom.toast('Доклад не найден', { type: 'warn' }); return; }
    await this.loadEnv();
    const d = this.derive(r);
    rec('U', 'raid', { id, coords: d.tc, type: d.target && d.target.type, n: d.n, ship: d.cs });
    if (!d.canRaid) { OGX.dom.toast(d.reason || 'Рейд невозможен', { type: 'warn' }); return; }
    let confirmOn = true;
    try { confirmOn = OGX.settings.get('core.confirmActions') !== false; } catch (e) { confirmOn = true; }
    if (d.flags.risky) {
      const what = [d.flags.hasFleet && 'флот', d.flags.hasDefense && 'оборона', (d.flags.unknownFleet || d.flags.unknownDefense) && 'неизвестные данные'].filter(Boolean).join(', ');
      if (!confirmOn && this.set('confirmRisky')) {
        const ok = await OGX.dom.confirm(`У цели ${OGX.fmt.coords(d.tc, d.target.type)}: ${what}. Транспорты могут быть уничтожены. Отправить рейд?`, { okLabel: 'Отправить', danger: true, title: 'Рейд' });
        rec('U', 'raid:risk-confirm', { id, ok });
        if (!ok) return;
      } else OGX.dom.toast(`Внимание: у цели ${what}`, { type: 'warn', ms: 6000 });
    }
    if (btn) btn.disabled = true;
    const req = {
      galaxy: d.target.galaxy, system: d.target.system, position: d.target.position, type: d.target.type,
      mission: 1, ships: { [d.cs]: d.n }, speed: 10, cargo: { metal: 0, crystal: 0, deuterium: 0 },
      originId: this.env.cur ? this.env.cur.id : undefined, source: 'infinity/spy',
    };
    let res;
    try { res = await this.wSend(req); } catch (e) { res = { success: false, message: String(e && e.message || e) }; }
    if (btn) btn.disabled = false;
    if (res && res.cancelled) { rec('U', 'raid:cancelled', { id }); return; }
    const entry = { reportId: id, coords: d.tc, type: d.target.type, ships: req.ships, sentAt: OGX.time.serverNow(), ok: !!(res && res.success), message: (res && res.message) || '' };
    this.raids = await this.ctx.store.update('raids', (old) => {
      const o = migrateRaids(old);
      o.items.push(entry);
      if (o.items.length > CAP_RAIDS) o.items = o.items.slice(-CAP_RAIDS);
      return o;
    }, null);
    if (entry.ok) OGX.dom.toast(`Флот отправлен: ${OGX.fmt.coords(d.tc, d.target.type)}, ${OGX.catalog.shortName(d.cs)} × ${num(d.n)}`, { type: 'ok' });
    else OGX.dom.toast('Ошибка отправки: ' + (entry.message || 'неизвестная ошибка'), { type: 'error', ms: 7000 });
    this.refreshSoon();
    this.refreshBadge(id);
  };

  Spy.prototype.prepare = async function (id) {
    const r = this.reports.items[id];
    if (!r) return;
    await this.loadEnv();
    const d = this.derive(r);
    rec('U', 'prepare', { id, coords: d.tc });
    if (!d.target) { OGX.dom.toast('Неизвестны координаты цели', { type: 'warn' }); return; }
    const ships = d.n > 0 ? { [d.cs]: d.have !== null ? Math.min(d.n, d.have) || d.n : d.n } : {};
    await this.wPrefill({
      originId: this.env.cur ? this.env.cur.id : undefined, target: { galaxy: d.target.galaxy, system: d.target.system, position: d.target.position, type: d.target.type },
      mission: 1, ships, speed: 10, source: 'infinity/spy', note: `рейд ${OGX.fmt.coords(d.tc, d.target.type)}, добыча ${num(d.loot.total)}`,
    });
  };

  Spy.prototype.spy = async function (id) {
    const r = this.reports.items[id];
    if (!r) return;
    const t = this.target(r);
    rec('U', 'spy', { id, coords: t && `${t.galaxy}:${t.system}:${t.position}` });
    if (!t) return;
    let res;
    try { res = await this.wSpy({ mission: 6, galaxy: t.galaxy, system: t.system, position: t.position, type: t.type, shipCount: this.probes() }); } catch (e) { res = { success: false, message: String(e && e.message || e) }; }
    if (res && res.unresolved) { this.showUnresolved(res, t); return; }
    if (res && res.success) {
      const cnt = Number.isFinite(res.shipsSent) && res.shipsSent > 0 ? ` (${num(res.shipsSent)})` : '';
      OGX.dom.toast(`Зонды отправлены${cnt}${spyFrom(res)}`, { type: 'ok' });
      if (res.mismatch) OGX.dom.toast(`Внимание: сервер отправил зонды на ${res.targetCoords || 'другие координаты'} — устаревший id цели. Откройте систему в галактике, чтобы обновить данные.`, { type: 'warn', ms: 9000 });
    } else OGX.dom.toast('Шпионаж не отправлен: ' + ((res && res.message) || 'ошибка'), { type: 'error' });
  };

  /** « с <планета> [g:s:p]» when the probes left another body than the current one (api.pickSpyOrigin), else ''. */
  function spyFrom(res) {
    const o = res && res.origin;
    return o && !o.current && o.coords ? ` с ${o.name ? o.name + ' ' : ''}[${o.coords}]` : '';
  }

  /** Probes per spy (setting spy.probes). */
  Spy.prototype.probes = function () { return OGX.api.spyProbes ? OGX.api.spyProbes() : (+this.set('probes') || 1100); };

  /**
   * GALAXYZ: the account's probe setting (spycount, page=settings) -> stored through api.saveGzSpyCount (journal + warning when it
   * differs from spy.probes). Read-only: the settings form is never posted by the add-on.
   */
  Spy.prototype.readGameSettings = async function (doc, source) {
    let r = null;
    try { r = OGX.parse.gz.settingsPage(doc); } catch (e) { r = null; }
    if (!r || !r.spycount) { rec('S', 'spycount:not-found', { source }); return null; }
    this.spycount = await OGX.api.saveGzSpyCount(r.spycount, source);
    return this.spycount;
  };

  /** Explicit click «Проверить настройки игры»: one read-only GET page=settings through the core queue. */
  Spy.prototype.checkGameSettings = async function (btn) {
    rec('U', 'spycount:check', null);
    if (btn) btn.disabled = true;
    try {
      const g = await OGX.http.get('settings', { expect: 'doc' });
      const v = g && g.doc ? await this.readGameSettings(g.doc, 'settings-get') : null;
      if (!v) OGX.dom.toast('Число зондов в настройках игры не найдено', { type: 'warn' });
      else OGX.dom.toast(`В настройках игры: ${num(v.value)} зондов на шпионаж`, { type: v.value === this.probes() ? 'ok' : 'warn' });
    } catch (e) {
      OGX.dom.toast('Не удалось открыть настройки игры: ' + (e && e.message || e), { type: 'error' });
    } finally { if (btn) btn.disabled = false; this.refreshSoon(); }
  };

  /** GALAXYZ spy tab: game probe setting vs spy.probes (warning when they differ, a hint when unknown). */
  Spy.prototype.probesBox = function () {
    const want = this.probes();
    const sc = this.spycount;
    const settingsUrl = OGX.page.url('/options');
    const link = h('a', { href: settingsUrl, class: P + 'settings-link', 'data-ogx-act': 'spy:open-settings' }, 'Открыть настройки игры');
    const check = h('button', { type: 'button', class: 'ogx-btn ' + P + 'check-settings', 'data-ogx-act': 'spy:check-settings',
      title: 'Прочитать число зондов со страницы настроек игры (только чтение, ничего не меняет)', onClick: (ev) => this.checkGameSettings(ev.currentTarget) }, 'Проверить');
    if (!sc) {
      return h('div', { class: [P + 'probes', P + 'probes-unknown'] },
        `Зондов на шпионаж: ${num(want)}. Сколько стоит в настройках игры, пока неизвестно — откройте настройки игры. `, link, ' ', check);
    }
    if (sc.value === want) return h('div', { class: [P + 'probes', P + 'probes-ok'], title: 'Совпадает с настройкой игры' }, `Зондов на шпионаж: ${num(want)} (как в настройках игры)`);
    return h('div', { class: [P + 'probes', P + 'probes-warn'], role: 'alert' },
      OGX.api.spyCountWarning(sc.value, want) + '. Измените «количество шпионских зондов» в настройках игры. ', link, ' ', check);
  };

  /** GALAXYZ: the target's planet id is unknown (no ids in reports): explain and offer the system (costs deuterium, user click). */
  Spy.prototype.showUnresolved = function (res, t) {
    rec('B', 'spy:unresolved', { coords: `${t.galaxy}:${t.system}:${t.position}` });
    const body = h('div', { class: P + 'unresolved' },
      h('p', null, res.message || 'Неизвестен id цели'),
      res.suggestion ? h('p', null, res.suggestion) : null,
      res.galaxyUrl ? h('p', null, h('a', { href: res.galaxyUrl, class: P + 'galaxy-link', 'data-ogx-act': 'spy:open-galaxy' }, `Открыть систему ${t.galaxy}:${t.system} (стоит дейтерий)`)) : null);
    OGX.dom.modal({ title: 'Шпионаж не отправлен', body, buttons: [{ label: 'Закрыть', primary: true, onClick: (close) => close() }] });
  };

  /** GALAXYZ: the game's own simulator (page=battleSimulator&im[ID]=value), the report's link or one built from the stored values. */
  Spy.prototype.gzSimUrl = function (r) {
    if (r.simHref && /page=battleSimulator/.test(r.simHref)) {
      try { return new URL(r.simHref, location.href).href; } catch (e) { /* build below */ }
    }
    const q = {};
    const res = r.resources || {};
    if (res.metal != null) q['im[901]'] = res.metal;
    if (res.crystal != null) q['im[902]'] = res.crystal;
    if (res.deuterium != null) q['im[903]'] = res.deuterium;
    for (const [id, n] of Object.entries(Object.assign({}, r.ships || {}, r.defense || {}))) if (+n > 0) q['im[' + id + ']'] = +n;
    return OGX.page.url('battleSimulator', q);
  };

  Spy.prototype.simPrefill = function (r, d) {
    const env = this.env || {};
    const lv = (map) => { const o = {}; for (const [id, l] of Object.entries(map || {})) if (+l > 0) o[id] = { level: +l }; return o; };
    const cnt = (map) => { const o = {}; for (const [id, n] of Object.entries(map || {})) if (+n > 0) o[id] = { count: +n }; return o; };
    const own = env.cur && env.cur.coords ? OGX.util.coordsObj(env.cur.coords) : null;
    const data = {
      0: [{ class: CLASS_NUM[env.playerClass] || 0, research: lv(env.research && env.research.levels), ships: cnt(d.n > 0 ? { [d.cs]: d.n } : {}), planet: own ? { galaxy: own.galaxy, system: own.system, position: own.position } : undefined }],
      1: [{ class: 0, research: lv(r.research), ships: cnt(Object.assign({}, r.ships || {}, r.defense || {})),
        planet: d.target ? { galaxy: d.target.galaxy, system: d.target.system, position: d.target.position, type: d.target.type } : undefined,
        resources: { metal: r.resources.metal || 0, crystal: r.resources.crystal || 0, deuterium: r.resources.deuterium || 0 } }],
    };
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  };

  Spy.prototype.simUrl = function (id) {
    const r = this.reports.items[id];
    if (!r) return null;
    if (isGz()) return this.gzSimUrl(r);
    const d = this.derive(r);
    const b64 = this.simPrefill(r, d);
    const tpl = String(this.set('simUrl') || DEFAULT_SIM);
    return tpl.includes('{prefill}') ? tpl.replace('{prefill}', encodeURIComponent(b64)) : tpl + b64;
  };

  Spy.prototype.openSim = function (id) {
    const url = this.simUrl(id);
    rec('U', 'sim', { id });
    if (!url || !/^https?:\/\//i.test(url)) { OGX.dom.toast('Укажите адрес симулятора в настройках', { type: 'warn' }); return; }
    window.open(url, '_blank', 'noopener');
  };

  Spy.prototype.remove = async function (id) {
    rec('U', 'delete', { id });
    const ok = await this.wDelete(id);
    if (!ok) { OGX.dom.toast('Сообщение не удалено', { type: 'warn' }); return; }
    delete this.reports.items[id];
    this.reports = await this.ctx.store.update('reports', (old) => { const o = migrateReports(old); delete o.items[id]; return o; }, null);
    const b = this.badges.get(id);
    if (b && b.li && b.li.isConnected) {
      // GALAXYZ: the message is two rows (tr.message_head + tr.messages_body)
      const next = b.li.nextElementSibling;
      if (next && next.matches && next.matches('tr.messages_body')) next.remove();
      b.li.remove(); // the game removes the li the same way after its own delete
    }
    this.badges.delete(id);
    OGX.dom.toast('Доклад удалён', { type: 'ok' });
    this.updateBadge();
    this.refreshSoon();
  };

  Spy.prototype.toTargets = function (id) {
    const r = this.reports.items[id];
    if (!r) return;
    const t = this.target(r);
    rec('U', 'targets:add', { id });
    if (!t) return;
    const payload = { coords: `${t.galaxy}:${t.system}:${t.position}`, type: t.type, playerId: null, playerName: r.player || null };
    OGX.bus.emit('targets:add', payload);
    rec('B', 'targets:add', payload);
    const handled = OGX.bus.count ? OGX.bus.count('targets:add') > 0 : true;
    OGX.dom.toast(handled ? 'Добавлено в цели' : 'Модуль «Цели» выключен', { type: handled ? 'ok' : 'warn' });
  };

  // ================================================================== tab
  Spy.prototype.updateBadge = function () {
    if (!this.tab) return;
    const n = Object.keys(this.reports.items).length;
    this.tab.setBadge(n ? String(n) : null);
  };

  Spy.prototype.refresh = function () {
    if (this.tab) this.tab.refresh();
    for (const id of this.badges.keys()) this.refreshBadge(id);
  };

  Spy.prototype.rows = function () {
    const minLoot = +this.set('minLootToShow') || 0;
    const maxAge = (+this.set('maxAgeHours') || 168) * HOUR;
    const now = OGX.time.serverNow();
    const f = String(this.set('filter') || '').trim().toLowerCase();
    const out = [];
    for (const r of Object.values(this.reports.items)) {
      if (!r || !r.target) continue;
      if (r.ts && now - r.ts > maxAge) continue;
      const d = this.derive(r);
      if (d.loot.total < minLoot) continue;
      if (f && !(`${d.tc || ''} ${r.player || ''} ${(r.target && r.target.name) || ''}`.toLowerCase().includes(f))) continue;
      out.push({ id: +r.id, r, d });
    }
    return out;
  };

  Spy.prototype.render = function (container) {
    const self = this;
    const rows = this.rows();
    const cur = this.env && this.env.cur;
    const cs = this.cargoShip();
    const gz = isGz();
    const head = h('div', { class: P + 'head' },
      h('div', { class: P + 'info' },
        `Докладов: ${num(rows.length)}`,
        cur ? ` · отправка с ${cur.name || ''} ${OGX.fmt.coords(cur.coords, cur.isMoon ? 3 : 1)}` : '',
        ` · ${OGX.catalog.shortName(cs)}, запас ${num(+this.set('reservePct') || 0)}%`,
        ` · добыча ${OGX.fmt.pct(OGX.calc.lootPct(this.env ? this.env.playerClass : 'none'))}`),
      gz ? h('div', { class: P + 'note' }, 'GALAXYZ: в докладах нет игрока и поля обломков; трюмы с учётом порядка загрузки добычи (металл ≤ 1/3 трюма…).') : null,
      gz ? this.probesBox() : null,
      h('div', { class: P + 'tools' },
        h('input', { type: 'search', class: 'ogx-input ' + P + 'filter', placeholder: gz ? 'Фильтр: планета, координаты' : 'Фильтр: игрок, координаты', value: this.set('filter') || '', 'data-key': 'spy.filter',
          onInput: OGX.util.debounce(OGX.safe((ev) => { self.ctx.settings.set('filter', ev.target.value); if (self.table) { self.table.setRows(self.rows()); self.decorate(); } }, 'spy:filter'), 300) }),
        h('button', { type: 'button', class: 'ogx-btn ' + P + 'scan', 'data-ogx-act': 'spy:scan', title: gz ? 'Загрузить все страницы категории «Шпионаж» (пометит их прочитанными)' : 'Загрузить все доклады раздела «Шпионаж»', onClick: () => self.scanAll() }, 'Загрузить все отчёты'),
        h('button', { type: 'button', class: 'ogx-btn ' + P + 'clear', 'data-ogx-act': 'spy:clear', title: 'Удалить сохранённые доклады из дополнения (сообщения в игре остаются)', onClick: () => self.clearAll() }, 'Очистить')));

    // compact: secondary actions are icon buttons (label in title / aria-label) so a row stays one line in the 440 px panel
    const act = (label, cls, fn, opts = {}) => {
      const attrs = Object.assign({}, opts.attrs || {});
      if (opts.icon) { attrs['aria-label'] = label; attrs.title = attrs.title ? `${label}: ${attrs.title}` : label; }
      return h('button', Object.assign({ type: 'button', class: ['ogx-btn', P + 'btn', P + cls, opts.icon && P + 'ibtn', opts.primary && 'ogx-btn-primary', opts.danger && 'ogx-btn-danger'], 'data-ogx-act': 'spy:' + cls,
        onClick: (ev) => { ev.stopPropagation(); fn(ev.currentTarget); } }, attrs), opts.icon ? OGX.dom.icon(opts.icon) : label);
    };

    const unitsCell = (val, unknown, map, what) => {
      if (unknown && !val.total) return h('span', { class: P + 'unknown', title: `${what}: раздел не раскрыт` }, '?');
      const list = Object.entries(map || {}).filter(([, n]) => +n > 0).map(([id, n]) => `${OGX.catalog.name(+id)}: ${num(+n)}`).join('\n');
      return h('span', { class: val.total > 0 ? P + 'warn' : null, title: `${what}: ${list || 'нет'}` }, val.total > 0 ? OGX.fmt.short(val.total) : '0');
    };

    const columns = [
      { key: 'age', label: 'Возраст', align: 'right', defaultDir: 'asc', value: (x) => (x.r.ts ? OGX.time.serverNow() - x.r.ts : null),
        render: (x) => h('span', { title: x.r.ts ? OGX.fmt.dateTime(x.r.ts) : '' }, x.r.ts ? OGX.fmt.ago(x.r.ts).replace(' назад', '') : '—') },
      // the target name (GALAXYZ: planet; OgameX: player) sits under the coordinates: no own column in the narrow panel
      { key: 'coords', label: 'Коорд.', title: gz ? 'Координаты и название цели из доклада (в докладах GALAXYZ нет имени игрока)' : 'Координаты и игрок',
        value: (x) => x.d.target ? x.d.target.galaxy * 1e6 + x.d.target.system * 100 + x.d.target.position : null, defaultDir: 'asc',
        render: (x) => {
          const who = gz ? (x.r.target && x.r.target.name) || '' : x.r.player || '';
          return h('span', { class: P + 'where' },
            h('a', { class: P + 'coords', href: x.d.target ? OGX.page.url('/galaxy', { galaxy: x.d.target.galaxy, system: x.d.target.system }) : '#',
              title: ((x.r.target && x.r.target.name) || '') + (gz ? '\nОткрыть систему (просмотр галактики стоит дейтерий)' : '') },
            x.d.tc ? OGX.fmt.coords(x.d.tc, x.d.flags.moon ? 3 : 1) : '?'),
            h('span', { class: P + 'pname', title: who }, who || '—'));
        } },
      { key: 'loot', label: 'Добыча', align: 'right', value: (x) => x.d.loot.total,
        render: (x) => h('span', { class: P + 'loot', title: `${OGX.fmt.res(x.d.loot)}\nДобыча ${OGX.fmt.pct(x.d.lootPct)}${x.d.flags.approx ? '\nПриблизительно (краткий доклад)' : ''}`,
          dataset: { metal: String(x.d.loot.metal), crystal: String(x.d.loot.crystal), deuterium: String(x.d.loot.deuterium), total: String(x.d.loot.total) } },
        (x.d.flags.approx ? '≈' : '') + OGX.fmt.short(x.d.loot.total)) },
      { key: 'profit', label: 'Прибыль', align: 'right', value: (x) => x.d.profit,
        render: (x) => h('span', { class: x.d.profit > 0 ? P + 'pos' : P + 'neg', title: `Добыча ${num(Math.round(OGX.calc.msu(x.d.loot, x.d.rates)))} − топливо ${num(Math.round((x.d.fuel || 0) * x.d.rates[2]))} (в единицах металла ${x.d.rates.map((v) => String(v).replace('.', ',')).join(':')})` }, OGX.fmt.short(Math.round(x.d.profit))) },
      { key: 'cargo', label: 'Трюмы', align: 'right', value: (x) => x.d.n,
        render: (x) => h('span', { class: P + 'cargo', title: `${OGX.catalog.name(x.d.cs)}: ${num(x.d.n)} (вместимость ${num(x.d.cap)}, запас ${num(+self.set('reservePct') || 0)}%)`
          + (x.d.needCap > x.d.loot.total ? `\nНужен трюм ${num(x.d.needCap)} для добычи ${num(x.d.loot.total)} (порядок загрузки)` : '') + (x.d.have !== null ? `\nНа планете: ${num(x.d.have)}` : '') }, num(x.d.n)) },
      { key: 'flight', label: 'Полёт', align: 'right', defaultDir: 'asc', value: (x) => x.d.duration,
        render: (x) => h('span', { title: flightTitle(x.d) }, flightText(x.d)) },
      { key: 'actions', label: '', sortable: false,
        render: (x) => {
          const raidBtn = act('Рейд', 'raid', (b) => self.raid(x.id, b), { primary: true, attrs: { disabled: !x.d.canRaid, title: x.d.canRaid ? `Атака: ${OGX.catalog.shortName(x.d.cs)} × ${num(x.d.n)}, скорость 100%` : x.d.reason } });
          const open = self.moreOpen.has(x.id);
          const more = act('Ещё действия', 'more', (b) => self.toggleMore(x.id, b), { icon: open ? 'up' : 'down',
            attrs: { title: 'Подготовить, зонды, симулятор, в цели, удалить', 'aria-expanded': open ? 'true' : 'false' } });
          return h('span', { class: P + 'actions' }, raidBtn, more);
        } },
      // Флот · Оборона · ПО in one column (value = fleet + defence, unknown sections sort as null)
      { key: 'units', label: 'Ф·О·ПО', align: 'right', title: 'Флот · Оборона (стоимость в ресурсах) · Поле обломков (сейчас + после боя)',
        value: (x) => ((x.d.flags.unknownFleet && !x.d.fleetVal.total) || (x.d.flags.unknownDefense && !x.d.defVal.total) ? null : x.d.fleetVal.total + x.d.defVal.total),
        render: (x) => h('span', { class: P + 'units' },
          h('span', { class: P + 'u-fleet' }, unitsCell(x.d.fleetVal, x.d.flags.unknownFleet, x.r.ships, 'Флот')), h('span', { class: P + 'sep' }, '·'),
          h('span', { class: P + 'u-def' }, unitsCell(x.d.defVal, x.d.flags.unknownDefense, x.r.defense, 'Оборона')), h('span', { class: P + 'sep' }, '·'),
          h('span', { class: P + 'u-debris', title: `Поле обломков сейчас: ${x.d.fieldKnown ? OGX.fmt.res(x.d.field) : 'неизвестно (нет в докладе)'}\nПосле уничтожения флота/обороны: +${OGX.fmt.res(x.d.potential)}` },
            x.d.debris.total ? OGX.fmt.short(x.d.debris.total) : (x.d.fieldKnown ? '0' : '—'))) },
    ];
    const prev = this.table ? this.table.sort : null;
    this.table = OGX.dom.table({ columns, rows, rowKey: 'id', sortKey: prev ? prev.key : 'profit', sortDir: prev ? prev.dir : 'desc', emptyText: gz ? 'Нет шпионских докладов. Откройте «Сообщения → Spy messages».' : 'Нет шпионских докладов. Откройте «Сообщения → Флоты → Шпионаж».', className: P + 'table' });
    // a header click rebuilds tbody: decorate again (risky / approx marks, open «⋯» rows)
    const tbl = this.table, sortBy = tbl.sortBy;
    tbl.sortBy = (k, d) => { sortBy(k, d); if (self.table === tbl) self.decorate(); };
    this.decorate(rows);
    const wrap = h('div', { class: P + 'wrap' }, this.table.el);
    // overlay scrollbars show nothing: a visible «→» edge while columns are hidden to the right
    const hint = h('div', { class: P + 'scrollhint', title: 'Таблица шире панели — прокрутите вправо или расширьте панель за левый край', hidden: true, 'aria-hidden': 'true' }, '→');
    const updHint = () => { hint.hidden = !(wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 2); };
    wrap.addEventListener('scroll', OGX.safe(updHint, 'spy:scrollhint'), { passive: true });
    hint.addEventListener('click', OGX.safe(() => wrap.scrollBy({ left: wrap.clientWidth * 0.8, behavior: 'smooth' }), 'spy:scrollhint'));
    if (typeof ResizeObserver === 'function') { try { new ResizeObserver(OGX.safe(updHint, 'spy:scrollhint')).observe(wrap); } catch (e) { /* no observer */ } }
    requestAnimationFrame(OGX.safe(updHint, 'spy:scrollhint'));
    container.appendChild(h('div', { class: P + 'root' }, head, h('div', { class: P + 'scroller' }, wrap, hint)));
  };

  Spy.prototype.decorate = function (rows) {
    if (!this.table) return;
    rows = rows || this.table.rows;
    for (const tr of this.table.el.querySelectorAll('tbody tr[data-key]')) {
      const x = rows.find((y) => String(y.id) === tr.dataset.key);
      if (x && x.d.flags.risky) tr.classList.add(P + 'risky');
      if (x && x.d.flags.approx) tr.classList.add(P + 'approx');
      if (x && this.moreOpen.has(x.id)) tr.after(this.moreRow(x, tr.cells.length));
    }
  };

  /** «⋯» of a row: the secondary actions in a row of their own under it (the 440 px panel has no room for 6 buttons). */
  Spy.prototype.toggleMore = function (id, btn) {
    const open = !this.moreOpen.has(id);
    if (open) this.moreOpen.add(id); else this.moreOpen.delete(id);
    rec('U', 'more', { id, open });
    const tr = btn && btn.closest('tr');
    if (!tr) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains(P + 'morerow')) next.remove();
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = '';
    btn.appendChild(OGX.dom.icon(open ? 'up' : 'down'));
    const x = open && (this.table ? this.table.rows : []).find((y) => y.id === id);
    if (x) tr.after(this.moreRow(x, tr.cells.length));
  };

  Spy.prototype.moreRow = function (x, cols) {
    const self = this;
    const gz = isGz();
    const last = this.lastRaid(x.id);
    const act = (label, cls, icon, fn, attrs = {}) => h('button', Object.assign({ type: 'button', class: ['ogx-btn', P + 'btn', P + cls, cls === 'delete' && 'ogx-btn-danger'], 'data-ogx-act': 'spy:' + cls,
      onClick: (ev) => { ev.stopPropagation(); fn(ev.currentTarget); } }, attrs), OGX.dom.icon(icon), ' ' + label);
    return h('tr', { class: P + 'morerow', dataset: { for: String(x.id) } }, h('td', { colspan: String(cols || 1) },
      h('div', { class: P + 'morebox' },
        act('Подготовить', 'prepare', 'send', () => self.prepare(x.id), { title: 'Открыть отправку флота с заполненными данными' }),
        act('Зонды', 'spy', 'spy', () => self.spy(x.id), { title: gz ? 'Отправить зонды (число зондов задаётся в настройках игры)' : 'Отправить зонды' }),
        act('Симулятор', 'sim', 'eye', () => self.openSim(x.id), { title: gz ? 'Открыть симулятор игры с данными доклада в новой вкладке' : 'Открыть симулятор боя в новой вкладке' }),
        act('В цели', 'target', 'star', () => self.toTargets(x.id), { title: 'Добавить в «Цели»' }),
        act('Удалить', 'delete', 'trash', () => self.remove(x.id), { title: 'Удалить сообщение в игре' }),
        last ? h('span', { class: [P + 'raided', last.ok ? 'ogx-ok' : 'ogx-bad'], title: last.message || '' }, (last.ok ? 'Рейд ' : 'Ошибка ') + OGX.fmt.time(last.sentAt)) : null)));
  };

  Spy.prototype.clearAll = async function () {
    const ok = await OGX.dom.confirm('Удалить все сохранённые доклады и историю рейдов из дополнения? Сообщения в игре не изменятся.', { danger: true, okLabel: 'Очистить' });
    rec('U', 'clear', { ok });
    if (!ok) return;
    this.reports = { v: 1, items: {} };
    this.raids = { v: 1, items: [] };
    await this.ctx.store.set('reports', this.reports);
    await this.ctx.store.set('raids', this.raids);
    rec('B', 'cleared', {});
    this.updateBadge();
    this.refresh();
  };

  // ================================================================== message badges
  Spy.prototype.badge = function (id, li, bodyCell) {
    const old = this.badges.get(id);
    if (old && old.li === li && old.el.isConnected) { this.fillBadge(id); return; }
    const el = h('div', { class: P + 'badge ogx-root', dataset: { msgId: String(id) } });
    if (li.matches && li.matches('tr.message_head')) {
      // GALAXYZ: at the top of the body cell (td of tr.messages_body); a div in the tr would become a table cell
      const next = li.nextElementSibling;
      const td = bodyCell || (next && next.matches('tr.messages_body') ? next.querySelector('td') : null);
      if (!td) return;
      td.insertBefore(el, td.firstChild);
    } else {
      // inside li.msg, before message-footer.msg_actions (fleets/subtab.blade.php:53-56); fallback: end of li
      const footer = OGX.dom.$('message-footer', li);
      if (footer && footer.parentNode === li) li.insertBefore(el, footer);
      else li.appendChild(el);
    }
    this.badges.set(id, { li, el });
    this.fillBadge(id);
  };

  Spy.prototype.refreshBadge = function (id) { if (this.badges.has(id)) this.fillBadge(id); };

  Spy.prototype.fillBadge = function (id) {
    const b = this.badges.get(id);
    if (!b) return;
    if (!b.el.isConnected) { this.badges.delete(id); return; }
    const r = this.reports.items[id];
    b.el.textContent = '';
    if (!r) { b.el.appendChild(h('span', { class: P + 'muted' }, 'Доклад не разобран')); return; }
    const d = this.derive(r);
    const last = this.lastRaid(id);
    b.el.append(...[
      h('span', { class: P + 'b-loot', title: OGX.fmt.res(d.loot) }, `Добыча ${OGX.fmt.pct(d.lootPct)}: ${d.flags.approx ? '≈' : ''}${num(d.loot.total)}`),
      h('span', { class: P + 'b-cargo', title: `${OGX.catalog.name(d.cs)}: ${num(d.n)}` + (d.needCap > d.loot.total ? ` (трюм ${num(d.needCap)} с учётом порядка загрузки)` : '') }, `${OGX.catalog.shortName(d.cs)}: ${num(d.n)}`),
      r.full ? h('span', { class: P + 'b-units' }, `Флот ${d.flags.unknownFleet ? 'не раскрыт' : OGX.fmt.short(d.fleetVal.total)} · Оборона ${d.flags.unknownDefense ? 'не раскрыта' : OGX.fmt.short(d.defVal.total)}`)
        : h('span', { class: P + 'muted' }, this.set('autoFetchFull') && !isGz() ? 'загрузка доклада…' : 'краткий доклад'),
      d.duration !== null ? h('span', { class: P + 'b-flight', title: flightTitle(d) }, flightText(d)) : null,
      h('button', { type: 'button', class: ['ogx-btn', 'ogx-btn-primary', P + 'b-raid'], 'data-ogx-act': 'spy:badge-raid', disabled: !d.canRaid,
        title: d.canRaid ? `Атака: ${OGX.catalog.shortName(d.cs)} × ${num(d.n)}` : d.reason, onClick: (ev) => { ev.stopPropagation(); this.raid(id, ev.currentTarget); } }, 'Рейд'),
      last ? h('span', { class: [P + 'raided', last.ok ? 'ogx-ok' : 'ogx-bad'] }, (last.ok ? 'отправлен ' : 'ошибка ') + OGX.fmt.time(last.sentAt)) : null,
    ].filter(Boolean)); // Element.append(null) would print "null"
  };

  const CSS = `
.${P}root { display: flex; flex-direction: column; gap: 6px; }
.${P}head { display: flex; flex-direction: column; gap: 4px; }
.${P}info { color: var(--ogx-muted, #8a99ab); }
.${P}tools { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.${P}filter { flex: 1 1 140px; min-width: 100px; }
.${P}scroller { position: relative; }
.${P}wrap { overflow-x: auto; }
.${P}scrollhint { position: absolute; top: 0; right: 0; bottom: 0; width: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer;
  color: var(--ogx-accent, #6f9fd8); font-weight: bold; background: linear-gradient(to right, transparent, var(--ogx-panel, #161c24) 70%); }
.${P}scrollhint[hidden] { display: none; }
.${P}where { display: inline-flex; flex-direction: column; line-height: 1.2; }
.${P}pname { color: var(--ogx-muted, #8a99ab); font-size: 10px; max-width: 90px; overflow: hidden; text-overflow: ellipsis; }
.${P}units .${P}sep { color: var(--ogx-muted, #8a99ab); margin: 0 2px; }
.${P}table td, .${P}table th { white-space: nowrap; }
.${P}table tr.${P}risky td:first-child { box-shadow: inset 3px 0 0 var(--ogx-warn, #ff9800); }
.${P}table tr.${P}approx .${P}loot { font-style: italic; }
.${P}actions { display: inline-flex; gap: 2px; flex-wrap: nowrap; align-items: center; }
.${P}table tr.${P}morerow td { white-space: normal; background: rgba(255,255,255,.03); }
.${P}morebox { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; position: sticky; left: 4px; max-width: 400px; }
.${P}morebox .ogx-icon { vertical-align: -2px; }
.${P}ibtn { padding: 1px 3px; line-height: 0; }
.${P}btn { padding: 1px 4px; font-size: 10px; }
.${P}warn { color: var(--ogx-warn, #ff9800); }
.${P}unknown { color: var(--ogx-muted, #8a99ab); }
.${P}pos { color: var(--ogx-ok, #4caf50); }
.${P}neg { color: var(--ogx-bad, #f44336); }
.${P}raided { font-size: 10px; margin-left: 4px; }
.${P}table a.${P}coords, .${P}table a.${P}coords:visited { color: var(--ogx-accent, #6f9fd8); text-decoration: none; }
.${P}note { color: var(--ogx-muted, #8a99ab); font-size: 10px; }
.${P}probes { font-size: 11px; margin: 4px 0; padding: 3px 6px; border-radius: 3px; color: var(--ogx-muted, #8a99ab); }
.${P}probes-warn { color: var(--ogx-text, #cfd8e3); border: 1px solid var(--ogx-warn, #ff9800); box-shadow: inset 3px 0 0 var(--ogx-warn, #ff9800); }
.${P}probes a.${P}settings-link, .${P}probes a.${P}settings-link:visited { color: var(--ogx-accent, #6f9fd8); text-decoration: underline; }
.${P}probes .ogx-btn { padding: 0 6px; font-size: 10px; }
.${P}unresolved p { margin: 0 0 6px; }
.${P}unresolved a.${P}galaxy-link, .${P}unresolved a.${P}galaxy-link:visited { color: var(--ogx-accent, #6f9fd8); text-decoration: underline; }
.${P}badge { box-sizing: border-box; max-width: 100%; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0; padding: 3px 6px; border: 1px solid var(--ogx-border, #2b3846);
  background: var(--ogx-panel, #161c24); color: var(--ogx-text, #cfd8e3); font-size: 11px; border-radius: 3px; }
.${P}b-loot { color: var(--ogx-ok, #4caf50); font-weight: bold; }
.${P}muted { color: var(--ogx-muted, #8a99ab); }
`;
})(window.OGX);
