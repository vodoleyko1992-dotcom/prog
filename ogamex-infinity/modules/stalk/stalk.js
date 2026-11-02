/* ogamex-infinity/modules/stalk/stalk.js — Owner: infinity/stalk.
 * Player activity tracking (DESIGN §4.2.6).
 *
 * What OgameX shows (galaxy.md §5, GalaxyController.php:797-821, PlanetService::getMinutesSinceLastUpdate):
 *   activity per body (planet and moon separately): '*' = 0-14 min, 15..60 = idle minutes, null = > 60 min.
 *   A sample taken at server time t gives lastSeen = t for '*', t − idle·60 s for minutes, null for none (galaxy.md §10.5).
 *   Espionage / attack / missile / moon destruction arriving at a body also set its activity (EspionageMission.php:110,
 *   AttackMission.php:110 …), so own missions make the target look active: such samples are flagged `self: true`.
 *
 * Intake (never a request of its own except the scans below):
 *   - every `galaxy:system` bus event (core relays the game's own POST /ajax/galaxy, routes/web.php:147, and emits it for
 *     every core scan) → samples for tracked players' planets and moons;
 *   - `espionage_detected` messages on /messages (OGX.messages.watch; body "A foreign fleet from planet :planet (:attacker_name)
 *     was sighted near your planet", lang/en/t_messages.php:124) → the spy's planet is recorded as active at the message time;
 *   - the galaxy cache when a player starts being tracked.
 * Scans: «Сканировать» (user click) and the optional scheduler (`autoScan`) go through OGX.galaxy.scan (one request at a time,
 *   core.galaxyScanDelayMs + jitter, core hourly cap, cross-tab lock 'galaxyScan'). The scheduler additionally holds the
 *   cross-tab lock 'stalkScheduler', keeps a cross-tab hourly budget in `stalk.sched.runs`, is paused on /galaxy (also when
 *   another tab browsed the galaxy in the last 5 minutes), while the tab is hidden (unless core.backgroundWhenHidden) and
 *   for an hour after a 403 vacation answer.
 * Self-caused activity: own aggressive flights (missions 1, 2, 6, 9, 10) from the core `flights` store / `flights:updated`,
 *   and own sends seen as `fleet:sent` or the game's send-mini-fleet XHR (routes/web.php:126) are kept in `stalk.self`.
 *   A sample is self when such a flight arrived at that body within 15 minutes before the sample (or its lastSeen matches the
 *   arrival within 2 minutes); a send without a known arrival counts for 45 minutes after it was sent.
 * Galaxy page: an eye button in each foreign occupied row (core row slot appended to #galaxyRowN,
 *   galaxy/index.blade.php:319) toggles tracking.
 * Tab «Слежка» (order 60): add by name, auto-scan switch, status; per player: last seen, systems (editable), planets with their
 *   last activity, a 24-hour strip (96 × 15 min), a 7-day × 24-hour heat summary, buttons scan / galaxy / stop tracking.
 *
 * Storage (player scope, via ctx.store):
 *   stalk.players = { v: 1, items: { [playerId]: { name, addedAt, systems: ['g:s'], manual: ['g:s'], lastScanAt,
 *                      scans: { 'g:s': ServerMs }, planets: { 'g:s:p': { name, planetId, moonId, moonName } } } } }   cap 100
 *   stalk.log     = { v: 1, items: { [playerId]: [{ t, coords, body: 'p'|'m', activity: '*'|number|null, lastSeen, self,
 *                      src: 'page'|'scan'|'cache'|'spy', t0?, msg? }] } }   (older than keepDays dropped, 3000 per player)
 *   stalk.sched   = { v: 1, runs: [{ t, n, stoppedBy, manual }], galaxyAt, pausedUntil, pauseReason }   (local helper key)
 *   stalk.self    = { v: 1, items: [{ coords, body, arrival|null, sentAt|null, mission }] }                  (local helper key)
 * Local helpers (no core API): sample collapse/dedupe, self-hit matching, display-zone day/hour split, the scheduler.
 *
 * GALAXYZ (ogamex.eu, 2Moons fork; specs/galaxyz/galaxy.md, CORE_API §17/§22):
 *   - the galaxy is a server-rendered page: the page's system arrives through OGX.galaxy.onSystem / onRender (boot-time event
 *     replayed); activity is the planet-name suffix "(*)" < 15 min, "(N min)" 15..59, none >= 60 [UPSTREAM GalaxyRows.php:107-120]
 *     and covers planet + moon together: no separate moon samples/rows on GALAXYZ.
 *   - EVERY system view costs deuterium: «Сканировать» passes userStarted + confirm (core dialog names the systems and the cost);
 *     the auto-scan stays off until the user enables it in the tab and confirms the cost (stalk.sched.gzConfirmedAt); a value
 *     imported/synced without that confirmation is paused with «просмотр галактики стоит дейтерий». stoppedBy 'deuterium'
 *     (server: not enough deuterium) pauses the auto-scan for an hour.
 *   - player ids come from foreign rows (Dialog.Playercard/PM/Buddy [INFERRED]); a player without a known id is keyed
 *     'n:<name>' and moved under the id when a row shows both. Own rows (`own: true`) never get an eye.
 *   - self-caused activity: bus fleet:sent (via 'fleetAjax' gives `to` + planetId, via 'fleetStep3' the target coords).
 *   - espionage_detected (GALAXYZ kind spy_detected) has no attacker name: matched by the spying planet's coordinates.
 */
(function (OGX) {
  'use strict';

  const NAME = 'stalk';
  const P = 'ogx-i-stalk-';
  const PANEL_ID = 'infinity';
  const MIN = 60000;
  const Q = 15 * MIN;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const CAP_PLAYERS = 100;
  const CAP_SAMPLES = 3000;
  const CAP_HITS = 300;
  const SELF_WINDOW = 15 * MIN;
  const PENDING_WINDOW = 45 * MIN;
  const AGGRESSIVE = new Set([1, 2, 6, 9, 10]);
  const GALAXY_BUSY_MS = 5 * MIN;
  const STOP_TEXT = {
    vacation: 'включён режим отпуска — галактика недоступна',
    auth: 'сессия истекла — войдите в игру снова',
    http: 'ошибка сервера',
    limit: 'достигнут часовой лимит сканирования',
    busy: 'уже идёт другое сканирование (в этой или другой вкладке)',
    abort: 'остановлено',
    cost: 'просмотр галактики стоит дейтерий — сканирование только по вашему подтверждению',
    cancel: 'отменено',
    deuterium: 'не хватает дейтерия для просмотра галактики',
  };
  const STATUS_RU = { A: 'администратор', b: 'заблокирован', v: 'режим отпуска', I: 'неактивен 28+ дней', i: 'неактивен 7+ дней', n: 'новичок', s: 'сильный игрок' };

  OGX.module({
    name: NAME,
    title: 'Слежка за активностью',
    pages: '*',
    settings: {
      autoScan: { type: 'bool', default: false, label: 'Автоматически пересканировать системы отслеживаемых игроков', hint: 'Через вежливый сканер ядра, с часовым лимитом; пауза на странице галактики' },
      intervalMin: { type: 'int', default: 15, min: 5, max: 240, label: 'Интервал автосканирования, мин' },
      notify: { type: 'bool', default: true, label: 'Уведомлять, когда игрок становится активным' },
      keepDays: { type: 'int', default: 14, min: 1, max: 60, label: 'Хранить историю активности, дней' },
    },
    async init(ctx) {
      const s = new Stalk(ctx);
      ctx._stalk = s;
      await s.start();
    },
    dispose(ctx) {
      if (ctx._stalk) ctx._stalk.dispose();
    },
  });

  // ------------------------------------------------------------------ helpers
  const h = (...a) => OGX.dom.h(...a);
  const fin = (n) => typeof n === 'number' && Number.isFinite(n);
  const now = () => OGX.time.serverNow();
  const rec = (src, what, data) => { try { OGX.log.rec(src, NAME, what, data); } catch (e) { /* journal off */ } };
  const learnValue = (name, v, o) => { try { return OGX.learn ? OGX.learn.value(name, v, o) : true; } catch (e) { return true; } };
  const learnCheck = (name, o) => { try { return OGX.learn ? OGX.learn.check(name, o) : true; } catch (e) { return true; } };
  const p2 = (n) => String(n).padStart(2, '0');

  function normCoords(c) {
    if (Array.isArray(c) && c.length >= 3) return c.slice(0, 3).every((x) => +x > 0) ? c.slice(0, 3).map((x) => +x).join(':') : null;
    if (c && typeof c === 'object') {
      if (c.coordsStr) return normCoords(c.coordsStr);
      if (c.coords) return normCoords(c.coords);
      if (c.galaxy) return [c.galaxy, c.system, c.position].join(':');
      return null;
    }
    return typeof c === 'string' ? OGX.util.coords(c) : null;
  }
  /** 'g:s' from "1:45", "[1:45]", "1:45:6". */
  function normSystem(s) {
    const m = /(\d+)\s*:\s*(\d+)/.exec(String(s || ''));
    if (!m) return null;
    const g = +m[1], sy = +m[2];
    return g >= 1 && g <= 99 && sy >= 1 && sy <= 999 ? g + ':' + sy : null;
  }
  const sysOf = (coords) => { const a = OGX.util.coordsArr(coords); return a ? a[0] + ':' + a[1] : null; };
  const sysKey = (s) => s.split(':').map((n) => n.padStart(3, '0')).join(':');
  const coordsSort = (c) => (OGX.util.coordsArr(c) || [0, 0, 0]).map((n) => String(n).padStart(3, '0')).join(':');
  const bodyOfType = (t) => (t === 3 || t === '3' || t === 'moon' || t === 'm' ? 'm' : 'p');
  const lastSeenOf = (t, a) => (a === '*' ? t : fin(a) ? t - a * MIN : null);
  const isActive = (a) => a === '*' || fin(a);
  const isGz = () => { try { return !!(OGX.page.isGz && OGX.page.isGz()); } catch (e) { return false; } };
  /** Player key: numeric id when known, else 'n:<name>' (GALAXYZ rows without an id). */
  function playerKey(id, name) {
    if (fin(+id) && +id > 0) return String(+id);
    const n = name ? String(name).trim().slice(0, 80) : '';
    return n ? 'n:' + n : null;
  }
  const validKey = (k) => (/^\d+$/.test(String(k)) && +k > 0) || /^n:\S/.test(String(k));
  const normKey = (k) => (/^n:/.test(String(k)) ? String(k) : String(+k));
  const GZ_COST = ' (просмотр чужой системы стоит дейтерий)';

  /** Display-zone offset (same rule as OGX.fmt.time: core.timeDisplay 'server' | 'local'). */
  function zoneOffset(ms) {
    let zone = 'server';
    try { zone = OGX.settings.get('core.timeDisplay') || 'server'; } catch (e) { /* default */ }
    if (zone === 'local') return -new Date(ms).getTimezoneOffset() * MIN;
    return (OGX.time && +OGX.time.tzOffsetMs) || 0;
  }
  const wallDay = (ms) => Math.floor((ms + zoneOffset(ms)) / DAY);
  const wallHour = (ms) => Math.floor((((ms + zoneOffset(ms)) % DAY) + DAY) % DAY / HOUR);
  function dayLabel(day) {
    const d = new Date(day * DAY);
    return p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1);
  }
  function hm(ms) {
    const w = new Date(ms + zoneOffset(ms));
    return p2(w.getUTCHours()) + ':' + p2(w.getUTCMinutes());
  }
  function actText(a) {
    if (a === '*') return '*';
    if (fin(a)) return a + ' мин';
    return '—';
  }

  // ------------------------------------------------------------------ data model
  function emptyPlayers() { return { v: 1, items: {} }; }
  function emptyLog() { return { v: 1, items: {} }; }
  function emptySched() { return { v: 1, runs: [], galaxyAt: 0, pausedUntil: 0, pauseReason: null, gzConfirmedAt: 0 }; }
  function emptySelf() { return { v: 1, items: [] }; }

  function cleanPlayer(e) {
    if (!e || typeof e !== 'object') return null;
    const systems = [];
    for (const s of Array.isArray(e.systems) ? e.systems : []) { const k = normSystem(s); if (k && !systems.includes(k)) systems.push(k); }
    const manual = [];
    for (const s of Array.isArray(e.manual) ? e.manual : []) { const k = normSystem(s); if (k && systems.includes(k) && !manual.includes(k)) manual.push(k); }
    const scans = {};
    for (const [k, v] of Object.entries(e.scans || {})) { const s = normSystem(k); if (s && fin(+v)) scans[s] = +v; }
    const planets = {};
    for (const [k, v] of Object.entries(e.planets || {})) {
      const c = normCoords(k);
      if (!c || !v || typeof v !== 'object') continue;
      planets[c] = { name: v.name ? String(v.name).slice(0, 60) : null, planetId: fin(+v.planetId) ? +v.planetId : null,
        moonId: fin(+v.moonId) && +v.moonId > 0 ? +v.moonId : null, moonName: v.moonName ? String(v.moonName).slice(0, 60) : null };
    }
    const o = { name: e.name ? String(e.name).slice(0, 80) : null, addedAt: fin(+e.addedAt) ? +e.addedAt : 0, systems, manual, scans, planets, lastScanAt: 0 };
    o.lastScanAt = computeLastScan(o);
    return o;
  }
  /** lastScanAt = the oldest scan among the player's systems (0 when one was never scanned). */
  function computeLastScan(p) {
    if (!p.systems.length) return 0;
    let m = Infinity;
    for (const s of p.systems) m = Math.min(m, p.scans[s] || 0);
    return fin(m) ? m : 0;
  }
  function normPlayers(raw) {
    const out = emptyPlayers();
    if (!raw || typeof raw !== 'object') return out;
    const items = raw.v ? raw.items : raw;
    for (const [id, e] of Object.entries(items || {})) {
      if (!validKey(id)) continue;
      const c = cleanPlayer(e);
      if (c) out.items[normKey(id)] = c;
    }
    return out;
  }
  function cleanSample(s) {
    if (!s || typeof s !== 'object' || !fin(+s.t)) return null;
    const coords = normCoords(s.coords);
    if (!coords) return null;
    const a = s.activity === '*' ? '*' : fin(+s.activity) && s.activity !== null && s.activity !== '' ? +s.activity : null;
    const o = { t: +s.t, coords, body: bodyOfType(s.body), activity: a, lastSeen: fin(+s.lastSeen) && s.lastSeen !== null ? +s.lastSeen : lastSeenOf(+s.t, a), self: !!s.self };
    if (s.src) o.src = String(s.src).slice(0, 10);
    if (fin(+s.t0) && s.t0 !== null) o.t0 = +s.t0;
    if (fin(+s.msg) && s.msg !== null) o.msg = +s.msg;
    return o;
  }
  function normLog(raw) {
    const out = emptyLog();
    if (!raw || typeof raw !== 'object') return out;
    const items = raw.v ? raw.items : raw;
    for (const [id, list] of Object.entries(items || {})) {
      if (!validKey(id) || !Array.isArray(list)) continue;
      const l = list.map(cleanSample).filter(Boolean).sort((a, b) => a.t - b.t);
      if (l.length) out.items[normKey(id)] = l;
    }
    return out;
  }
  function normSched(raw) {
    const o = emptySched();
    if (!raw || typeof raw !== 'object') return o;
    o.runs = (Array.isArray(raw.runs) ? raw.runs : []).filter((r) => r && fin(+r.t)).map((r) => ({ t: +r.t, n: +r.n || 0, stoppedBy: r.stoppedBy || null, manual: !!r.manual })).slice(-100);
    o.galaxyAt = fin(+raw.galaxyAt) ? +raw.galaxyAt : 0;
    o.pausedUntil = fin(+raw.pausedUntil) ? +raw.pausedUntil : 0;
    o.pauseReason = raw.pauseReason || null;
    o.gzConfirmedAt = fin(+raw.gzConfirmedAt) && +raw.gzConfirmedAt > 0 ? +raw.gzConfirmedAt : 0;
    return o;
  }
  function normSelf(raw) {
    const o = emptySelf();
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return o;
    for (const x of raw.items) {
      const c = x && normCoords(x.coords);
      if (!c) continue;
      const arrival = fin(+x.arrival) && x.arrival !== null ? +x.arrival : null;
      const sentAt = fin(+x.sentAt) && x.sentAt !== null ? +x.sentAt : null;
      if (arrival === null && sentAt === null) continue;
      o.items.push({ coords: c, body: bodyOfType(x.body), arrival, sentAt, mission: +x.mission || 0 });
    }
    return o;
  }
  const NORM = { players: normPlayers, log: normLog, sched: normSched, self: normSelf };

  /** Import mergers: union by player id / sample identity. */
  function mergePlayers(a, b) {
    const A = normPlayers(a), B = normPlayers(b);
    for (const [id, e] of Object.entries(B.items)) {
      const o = A.items[id];
      if (!o) { A.items[id] = e; continue; }
      o.name = e.name || o.name;
      o.addedAt = Math.min(o.addedAt || e.addedAt, e.addedAt || o.addedAt);
      for (const s of e.systems) if (!o.systems.includes(s)) o.systems.push(s);
      for (const s of e.manual) if (!o.manual.includes(s)) o.manual.push(s);
      for (const [s, t] of Object.entries(e.scans)) o.scans[s] = Math.max(o.scans[s] || 0, t);
      Object.assign(o.planets, e.planets);
      o.lastScanAt = computeLastScan(o);
    }
    return A;
  }
  function mergeLog(a, b) {
    const A = normLog(a), B = normLog(b);
    for (const [id, list] of Object.entries(B.items)) {
      const have = A.items[id] || [];
      const keys = new Set(have.map((s) => s.t + '|' + s.coords + '|' + s.body));
      for (const s of list) if (!keys.has(s.t + '|' + s.coords + '|' + s.body)) have.push(s);
      have.sort((x, y) => x.t - y.t);
      A.items[id] = have.slice(-CAP_SAMPLES);
    }
    return A;
  }
  let mergersRegistered = false;

  // ------------------------------------------------------------------ module
  class Stalk {
    constructor(ctx) {
      this.ctx = ctx;
      this.log = ctx.log;
      this.players = emptyPlayers();
      this.logData = emptyLog();
      this.sched = emptySched();
      this.self = emptySelf();
      this.offs = [];
      this.queue = Promise.resolve();
      this.lastPageSys = null;
      this.scanning = null;           // { abort, label, done, total, manual }
      this.lastResult = null;         // { t, text, type }
      this.toastAt = {};
      this.ui = { open: {} };
      this.refreshSoon = OGX.util.debounce(() => this.refreshTab(), 150);

      // Every add-on action is a timed B event (OGX.log.wrap).
      this.track = OGX.log.wrap(NAME, this._track.bind(this), 'track');
      this.untrack = OGX.log.wrap(NAME, this._untrack.bind(this), 'untrack');
      this.scanNow = OGX.log.wrap(NAME, this._scanNow.bind(this), 'scanNow');
      this.autoRun = OGX.log.wrap(NAME, this._autoRun.bind(this), 'autoScan');
      this.recordSystem = OGX.log.wrap(NAME, this._recordSystem.bind(this), 'recordSystem');
      this.recordSpy = OGX.log.wrap(NAME, this._recordSpy.bind(this), 'recordSpy');
      this.addSystem = OGX.log.wrap(NAME, this._addSystem.bind(this), 'addSystem');
      this.removeSystem = OGX.log.wrap(NAME, this._removeSystem.bind(this), 'removeSystem');
      this.renderRows = OGX.log.wrap(NAME, this._renderRows.bind(this), 'galaxyEyes');
      this.findAndTrack = OGX.log.wrap(NAME, this._findAndTrack.bind(this), 'findPlayer');
    }

    async start() {
      const ctx = this.ctx;
      ctx.css(CSS);
      if (!mergersRegistered) {
        OGX.storage.registerMerger(NAME + '.players', mergePlayers);
        OGX.storage.registerMerger(NAME + '.log', mergeLog);
        mergersRegistered = true;
      }
      const [pl, lg, sc, sf] = await Promise.all([ctx.store.get('players', null), ctx.store.get('log', null), ctx.store.get('sched', null), ctx.store.get('self', null)]);
      this.players = normPlayers(pl);
      this.logData = normLog(lg);
      this.sched = normSched(sc);
      this.self = normSelf(sf);

      // other tabs / imports
      for (const key of ['players', 'log', 'sched', 'self']) {
        this.offs.push(ctx.store.subscribe(key, (v, info) => {
          if (!info || !info.remote) return;
          this[key === 'log' ? 'logData' : key] = NORM[key](v);
          this.refreshSoon();
        }));
      }
      this.offs.push(ctx.settings.onChange(() => this.refreshSoon()));

      // intake
      // galaxy.onSystem replays the page's own system (GALAXYZ emits it at boot, before the modules start)
      this.offs.push(OGX.galaxy.onSystem((ev) => {
        if (!ev || !ev.system) return;
        if (ev.source === 'page') { this.lastPageSys = ev.system; this.noteGalaxyBrowsing(); }
        this.enqueue(() => this.recordSystem(ev.system, ev.source === 'page' ? 'page' : 'scan'));
      }));
      this.offs.push(OGX.bus.on('targets:track', (p) => {
        if (!p || !playerKey(p.playerId, p.playerName)) return;
        rec('U', 'targets:track', { playerId: +p.playerId || null });
        this.track(p.playerId, p.playerName || null, { source: 'targets', systems: Array.isArray(p.systems) ? p.systems : [] }).then((r) => this.trackToast(r));
      }));
      // self-caused activity sources
      this.offs.push(OGX.bus.on('flights:updated', (ev) => { if (ev && Array.isArray(ev.flights)) this.enqueue(() => this.ingestFlights(ev.flights)); }));
      this.offs.push(OGX.bus.on('fleet:sent', (ev) => this.onFleetSent(ev)));
      // OgameX: the game's one-click spy is a plain XHR (GALAXYZ: core emits fleet:sent via 'fleetAjax' for it)
      if (!isGz()) this.offs.push(OGX.bridge.onXhr(/^\/ajax\/fleet\/dispatch\/send-mini-fleet$/, (x) => {
        const ok = !!(x.json && x.json.response && x.json.response.success === true);
        this.onFleetSent({ request: x.form, ok, source: 'game-mini' });
      }));
      OGX.flights.cached().then((f) => { if (f && Array.isArray(f.flights)) this.enqueue(() => this.ingestFlights(f.flights)); }).catch(() => {});

      // side panel tab (get-or-create, independent of the panel module's init order)
      this.panel = OGX.dom.sidePanel(PANEL_ID, { title: 'OgameX Infinity', width: 440, maxWidth: 640 });
      this.tab = this.panel.addTab({ id: 'stalk', label: 'Слежка', order: 60, render: (c) => this.renderTab(c) });
      this.updateBadge();

      if (OGX.page.is('galaxy')) this.initGalaxy();
      if (OGX.page.is('messages')) this.offs.push(OGX.messages.watch((item) => this.onMessage(item)));

      // scheduler: on the shared tick, plus one early check
      ctx.every(20000, () => this.schedulerTick());
      this.firstCheck = setTimeout(OGX.safe(() => this.schedulerTick(), 'stalk:firstCheck'), 2500);
      ctx.every(60000, () => this.updateBadge());
    }

    dispose() {
      for (const off of this.offs) { try { off(); } catch (e) { /* ignore */ } }
      this.offs = [];
      clearTimeout(this.firstCheck);
      if (this.scanning && this.scanning.abort) this.scanning.abort.abort();
    }

    enqueue(fn) {
      this.queue = this.queue.then(() => OGX.safe(fn, 'stalk:queue')()).catch(() => {});
      return this.queue;
    }

    async mutate(key, fn) {
      const r = await this.ctx.store.update(key, (old) => { const d = NORM[key](old); fn(d); return d; }, null);
      this[key === 'log' ? 'logData' : key] = r;
      return r;
    }

    myId() {
      try {
        const s = OGX.state.snapshot();
        if (s && s.metas && +s.metas.playerId) return +s.metas.playerId;
        if (s && s.player && +s.player.id) return +s.player.id;
      } catch (e) { /* ignore */ }
      return (OGX.storage.ns && +OGX.storage.ns.playerId) || null;
    }
    myName() {
      try { const s = OGX.state.snapshot(); if (s && s.player && s.player.name) return s.player.name; } catch (e) { /* ignore */ }
      return null;
    }
    /** Own galaxy row: GALAXYZ marks it (`own`), else by id / name. */
    isOwnPos(p) { return OGX.galaxy.isOwnRow(p, { id: this.myId(), name: this.myName() }); }
    /** Key of a tracked player for (id, name): the stored key (id or name), else the preferred new key. */
    keyFor(id, name) {
      if (+id > 0 && this.players.items[String(+id)]) return String(+id);
      if (name && this.players.items['n:' + name]) return 'n:' + name;
      return playerKey(id, name);
    }

    // ---------------------------------------------------------------- intake: galaxy systems
    async _recordSystem(sys, src) {
      if (!sys || !Array.isArray(sys.positions) || !fin(+sys.t)) return { tracked: 0 };
      const sk = normSystem(sys.galaxy + ':' + sys.system);
      if (!sk) return { tracked: 0 };
      if (!Object.keys(this.players.items).length) return { tracked: 0 };
      const foreign = sys.positions.filter((p) => !p.destroyed && !this.isOwnPos(p));
      // a player tracked by name whose id this system shows: move the entries under the id first
      const moves = [];
      for (const p of foreign) {
        if (+p.playerId > 0 && p.playerName && this.players.items['n:' + p.playerName] && !moves.some(([f]) => f === 'n:' + p.playerName)) moves.push(['n:' + p.playerName, String(+p.playerId)]);
      }
      if (moves.length) await this.moveKeys(moves);
      // tracked key of every foreign occupied position
      const posKey = new Map();
      for (const p of foreign) {
        const k = +p.playerId > 0 && this.players.items[String(+p.playerId)] ? String(+p.playerId)
          : p.playerName && this.players.items['n:' + p.playerName] ? 'n:' + p.playerName : null;
        if (k) posKey.set(p, k);
      }
      const inSystem = new Set(posKey.values());
      const relevant = Object.keys(this.players.items).filter((k) => inSystem.has(k) || this.players.items[k].systems.includes(sk));
      if (!relevant.length) return { tracked: 0 };
      const t = +sys.t;
      const samplesById = {};
      for (const [pos, k] of posKey) {
        if (pos.playerId) learnValue('stalk.playerId', +pos.playerId, { min: 1, int: true });
        const list = samplesById[k] = samplesById[k] || [];
        list.push(this.makeSample(t, pos.coords, 'p', pos.activity, src));
        // GALAXYZ shows one activity for planet + moon (on the planet name): no separate moon sample
        if (pos.moon && !pos.moon.destroyed && !isGz()) list.push(this.makeSample(t, pos.coords, 'm', pos.moon.activity, src));
      }
      // players: systems, scans, planets, names
      await this.mutate('players', (d) => {
        for (const id of relevant) {
          const e = d.items[id];
          if (!e) continue;
          const mine = [...posKey.entries()].filter(([, k]) => k === id).map(([p]) => p);
          if (mine.length) {
            if (!e.systems.includes(sk)) e.systems.push(sk);
            if (mine[0].playerName) e.name = mine[0].playerName;
          } else if (e.systems.includes(sk) && !e.manual.includes(sk)) {
            e.systems = e.systems.filter((s) => s !== sk);
          }
          for (const c of Object.keys(e.planets)) if (sysOf(c) === sk && !mine.some((p) => p.coords === c)) delete e.planets[c];
          for (const p of mine) {
            e.planets[p.coords] = { name: p.planetName || null, planetId: p.planetId || null, moonId: p.moon && !p.moon.destroyed ? p.moon.id : null, moonName: p.moon && !p.moon.destroyed ? p.moon.name || null : null };
          }
          if (e.systems.includes(sk)) e.scans[sk] = Math.max(e.scans[sk] || 0, t);
          for (const s of Object.keys(e.scans)) if (!e.systems.includes(s)) delete e.scans[s];
          e.lastScanAt = computeLastScan(e);
        }
      });
      const added = await this.addSamples(samplesById, src !== 'cache');
      this.refreshSoon();
      this.updateBadge();
      return { system: sk, tracked: relevant.length, samples: added };
    }
    /** GALAXYZ: a player tracked by name ('n:<name>') whose id became known: players and log entries move under the id. */
    async moveKeys(moves) {
      await this.mutate('players', (d) => {
        for (const [from, to] of moves) {
          if (!d.items[from]) continue;
          if (!d.items[to]) d.items[to] = d.items[from];
          delete d.items[from];
        }
      });
      await this.mutate('log', (d) => {
        for (const [from, to] of moves) {
          if (!d.items[from]) continue;
          d.items[to] = (d.items[to] || []).concat(d.items[from]).sort((a, b) => a.t - b.t).slice(-CAP_SAMPLES);
          delete d.items[from];
        }
      });
      rec('B', 'player-key-moved', { n: moves.length });
    }

    makeSample(t, coords, body, activity, src) {
      const a = activity === '*' ? '*' : fin(+activity) && activity !== null ? +activity : null;
      if (fin(a)) learnValue('stalk.idleMinutes', a, { min: 15, max: 60, int: true });
      const lastSeen = lastSeenOf(t, a);
      const s = { t, coords, body, activity: a, lastSeen, self: this.isSelf(coords, body, t, lastSeen), src };
      if (lastSeen !== null) learnValue('stalk.lastSeenAgeMin', (now() - lastSeen) / MIN, { min: -10, max: 1e7 });
      learnCheck('stalk.sample', { t, lastSeen: lastSeen === null ? 0 : lastSeen });
      return s;
    }

    /** Appends samples (collapse/dedupe), prunes by keepDays, toasts on inactive -> active. Returns the number stored. */
    async addSamples(samplesById, allowToast) {
      const keepMs = (+this.ctx.settings.get('keepDays') || 14) * DAY;
      const cutoff = now() - keepMs;
      const transitions = [];
      let added = 0;
      await this.mutate('log', (d) => {
        for (const [id, samples] of Object.entries(samplesById)) {
          const list = d.items[id] = d.items[id] || [];
          for (const s of samples) {
            let prev = null;
            for (let i = list.length - 1; i >= 0; i--) if (list[i].coords === s.coords && list[i].body === s.body) { prev = list[i]; break; }
            if (list.some((x) => x.coords === s.coords && x.body === s.body && Math.abs(x.t - s.t) < 1000)) continue;            // same observation twice
            if (s.msg && list.some((x) => x.msg === s.msg)) continue;
            if (prev && prev.t <= s.t) {
              if (prev.activity === null && s.activity === null) { prev.t0 = prev.t0 || prev.t; prev.t = s.t; continue; }      // collapse inactive runs
              if (fin(prev.activity) && fin(s.activity) && prev.lastSeen !== null && Math.abs(prev.lastSeen - s.lastSeen) <= 90000) { prev.t = s.t; continue; } // same idle period
            }
            if (allowToast && prev && prev.t <= s.t && !isActive(prev.activity) && isActive(s.activity) && !s.self) transitions.push({ id, s });
            list.push(s);
            added++;
          }
          list.sort((a, b) => a.t - b.t);
          d.items[id] = list.filter((x) => Math.max(x.t, x.lastSeen || 0) >= cutoff).slice(-CAP_SAMPLES);
          if (!d.items[id].length) delete d.items[id];
        }
        for (const id of Object.keys(d.items)) {
          d.items[id] = d.items[id].filter((x) => Math.max(x.t, x.lastSeen || 0) >= cutoff);
          if (!d.items[id].length) delete d.items[id];
        }
      });
      if (transitions.length && this.ctx.settings.get('notify') !== false) {
        for (const { id, s } of transitions) {
          if (this.toastAt[id] && now() - this.toastAt[id] < 10 * MIN) continue;
          this.toastAt[id] = now();
          const name = (this.players.items[id] && this.players.items[id].name) || (/^n:/.test(id) ? id.slice(2) : '#' + id);
          OGX.dom.toast(`${name} активен: ${OGX.fmt.coords(s.coords, s.body === 'm' ? 3 : 1)} (${actText(s.activity)})`, { type: 'warn', ms: 6000 });
          rec('B', 'toast:active', { playerId: id, coords: s.coords, body: s.body });
        }
      }
      return added;
    }

    // ---------------------------------------------------------------- intake: espionage_detected messages
    onMessage(item) {
      if (!item || !item.li) return;
      let key = item.key || null;   // GALAXYZ items carry the key (kind spy_detected)
      if (!key) { try { key = OGX.messages.classify(item.li, item.subtab); } catch (e) { key = null; } }
      if (key !== 'espionage_detected') return;
      this.enqueue(() => this.recordSpy(item));
    }
    async _recordSpy(item) {
      const r = OGX.messages.parse.espionageDetected(item.li);   // GALAXYZ: no attacker name, matched by coordinates
      if (!r || !r.from) return { matched: false };
      const coords = normCoords(r.from);
      const ts = fin(+r.ts) ? +r.ts : null;
      if (!coords || ts === null) { this.log.warn('espionage_detected without coords/date', item.id); learnCheck('stalk.spyMessage', { coords: coords ? 1 : NaN, ts: ts === null ? NaN : ts }); return { matched: false }; }
      learnValue('stalk.spyMessageAgeMin', (now() - ts) / MIN, { min: -10, max: 1e7 });
      const name = String(r.attackerName || r.spyName || '').trim();
      let id = null;
      for (const [pid, e] of Object.entries(this.players.items)) if (name && e.name && e.name === name) { id = pid; break; }
      if (!id) for (const [pid, e] of Object.entries(this.players.items)) if (e.planets[coords]) { id = pid; break; }
      if (!id) return { matched: false };
      const body = bodyOfType(r.from.planetType || r.from.type);
      const s = { t: ts, coords, body, activity: '*', lastSeen: ts, self: false, src: 'spy', msg: +item.id || +r.id || null };
      const n = await this.addSamples({ [id]: [s] }, false);
      if (n) this.refreshSoon();
      return { matched: true, playerId: id, added: n };
    }

    // ---------------------------------------------------------------- self-caused activity
    onFleetSent(ev) {
      if (!ev || !ev.ok || !ev.request) return;
      const q = ev.request;
      const mission = +(q.mission || ev.mission);
      if (!AGGRESSIVE.has(mission)) return;
      // GALAXYZ: fleetAjax answers name the target in `to` (request has only planetID); fleetStep3 has the coords, type null
      const coords = normCoords([q.galaxy, q.system, q.position]) || (typeof ev.to === 'string' ? normCoords(ev.to) : null);
      if (!coords) return;
      let type = +q.type || +q.planettype || 0;
      if (!type && +ev.planetId > 0) type = this.typeOfPlanetId(+ev.planetId, coords);
      const body = bodyOfType(type || 1);
      this.enqueue(() => this.mutate('self', (d) => {
        d.items.push({ coords, body, arrival: null, sentAt: now(), mission });
        pruneHits(d);
      }));
    }
    /** GALAXYZ: planet (1) or moon (3) for a planetID seen in the last galaxy page / tracked planets; 1 when unknown. */
    typeOfPlanetId(id, coords) {
      const sys = this.lastPageSys;
      const p = sys && sys.positions.find((x) => x.coords === coords);
      if (p && p.moon && +p.moon.id === id) return 3;
      for (const e of Object.values(this.players.items)) { const pl = e.planets[coords]; if (pl && +pl.moonId === id) return 3; }
      return 1;
    }
    async ingestFlights(list) {
      const hits = [];
      for (const f of list) {
        if (!f || !f.own || f.returnFlight || f.synthetic || !AGGRESSIVE.has(+f.missionType) || !fin(+f.arrival)) continue;
        const coords = normCoords(f.to);
        if (!coords || !(f.toType === 1 || f.toType === 3)) continue;
        hits.push({ coords, body: f.toType === 3 ? 'm' : 'p', arrival: +f.arrival, sentAt: null, mission: +f.missionType });
      }
      if (!hits.length) return;
      const before = JSON.stringify(this.self.items);
      await this.mutate('self', (d) => {
        for (const x of hits) {
          if (d.items.some((y) => y.coords === x.coords && y.body === x.body && y.arrival !== null && Math.abs(y.arrival - x.arrival) < 2000)) continue;
          // a known arrival replaces a pending send to the same body
          d.items = d.items.filter((y) => !(y.arrival === null && y.coords === x.coords && y.body === x.body && y.sentAt <= x.arrival + MIN));
          d.items.push(x);
        }
        pruneHits(d);
      });
      if (JSON.stringify(this.self.items) !== before) await this.reflagRecent();
    }
    isSelf(coords, body, t, lastSeen) {
      for (const x of this.self.items) {
        if (x.coords !== coords || x.body !== body) continue;
        if (x.arrival !== null) {
          if (x.arrival > t + MIN) continue;
          if (t - x.arrival <= SELF_WINDOW) return true;
          if (lastSeen !== null && Math.abs(lastSeen - x.arrival) <= 2 * MIN) return true;
        } else if (x.sentAt !== null && x.sentAt <= t && t - x.sentAt <= PENDING_WINDOW && (lastSeen === null || lastSeen >= x.sentAt - MIN)) {
          return true;
        }
      }
      return false;
    }
    async reflagRecent() {
      const from = now() - 3 * HOUR;
      const stale = Object.values(this.logData.items).some((list) => list.some((s) => s.t >= from && isActive(s.activity) && s.src !== 'spy' && this.isSelf(s.coords, s.body, s.t, s.lastSeen) !== s.self));
      if (!stale) return;
      let changed = 0;
      await this.mutate('log', (d) => {
        for (const list of Object.values(d.items)) {
          for (const s of list) {
            if (s.t < from || !isActive(s.activity) || s.src === 'spy') continue;
            const v = this.isSelf(s.coords, s.body, s.t, s.lastSeen);
            if (v !== s.self) { s.self = v; changed++; }
          }
        }
      });
      if (changed) { rec('B', 'reflag-self', { changed }); this.refreshSoon(); }
    }

    // ---------------------------------------------------------------- tracking
    /** playerId: numeric id, a key ('n:<name>') or null with playerName (GALAXYZ players seen without an id). */
    async _track(playerId, playerName, { systems = [], source = 'tab' } = {}) {
      if (/^n:/.test(String(playerId))) { playerName = playerName || String(playerId).slice(2); playerId = null; }
      const id = this.keyFor(playerId, playerName);
      if (!id) return { ok: false, reason: 'id' };
      const numId = /^\d+$/.test(id) ? +id : null;
      if ((numId && numId === this.myId()) || (playerName && playerName === this.myName())) return { ok: false, reason: 'self' };
      if (this.players.items[id]) return { ok: true, already: true, name: this.players.items[id].name };
      if (Object.keys(this.players.items).length >= CAP_PLAYERS) return { ok: false, reason: 'cap' };
      const known = [];
      for (const s of systems) { const k = normSystem(s); if (k) known.push(k); }
      const idx = await OGX.galaxy.player(numId || playerName);
      let name = playerName || (idx && idx.name) || null;
      const planets = {};
      if (idx) {
        for (const pl of idx.planets || []) { const k = sysOf(pl.coords); if (k) known.push(k); planets[pl.coords] = { name: null, planetId: pl.planetId || null, moonId: pl.moonId || null }; }
        if (idx.homeCoords) { const k = sysOf(idx.homeCoords); if (k) known.push(k); }
      }
      if (!known.length && numId) {
        // home coordinates: OgameX highscore around the player (POST /ajax/highscore searchRelId, routes/web.php:214);
        // GALAXYZ page=playerCard (a free page, no deuterium) [UPSTREAM]
        const html = await OGX.api.highscore({ category: 1, type: 0, searchRelId: numId });
        if (typeof html === 'string') {
          const hs = OGX.parse.highscorePlayers(html);
          const row = hs && hs.rows ? hs.rows.find((r) => +r.id === numId) : null;
          if (row) {
            name = name || row.name;
            const k = sysOf(row.homeCoords);
            if (k) known.push(k);
            OGX.galaxy.indexHighscore(hs).catch(() => {});
          }
        }
      }
      const uniq = [...new Set(known)];
      await this.mutate('players', (d) => {
        if (d.items[id]) return;
        d.items[id] = { name, addedAt: now(), systems: uniq, manual: [], scans: {}, planets, lastScanAt: 0 };
      });
      rec('B', 'tracked', { playerId: id, systems: uniq.length, source });
      // seed from the galaxy cache (observations already made, no request)
      for (const s of uniq) {
        const [g, sy] = s.split(':').map(Number);
        const sys = await OGX.galaxy.cached(g, sy);
        if (sys && fin(+sys.t)) await this.recordSystem(sys, 'cache');
      }
      this.refreshSoon();
      this.updateBadge();
      if (OGX.page.is('galaxy')) this.refreshGalaxy();
      return { ok: true, key: id, name: (this.players.items[id] && this.players.items[id].name) || name, systems: (this.players.items[id] || {}).systems || uniq };
    }
    trackToast(r) {
      if (!r) return;
      if (r.ok && r.already) OGX.dom.toast(`${r.name || 'Игрок'} уже отслеживается`, { type: 'info', ms: 2000 });
      else if (r.ok) OGX.dom.toast(`Слежка за ${r.name || 'игроком'} включена` + (r.systems && r.systems.length ? '' : ' — системы пока неизвестны, добавьте их во вкладке «Слежка»'), { type: 'ok', ms: 3000 });
      else if (r.reason === 'cap') OGX.dom.toast(`Можно отслеживать не больше ${CAP_PLAYERS} игроков`, { type: 'error' });
      else if (r.reason === 'self') OGX.dom.toast('Нельзя следить за собой', { type: 'warn' });
    }
    async _untrack(playerId) {
      const id = /^n:/.test(String(playerId)) ? String(playerId) : String(+playerId);
      await this.mutate('players', (d) => { delete d.items[id]; });
      await this.mutate('log', (d) => { delete d.items[id]; });
      this.refreshSoon();
      this.updateBadge();
      if (OGX.page.is('galaxy')) this.refreshGalaxy();
      return { ok: true };
    }
    async _addSystem(playerId, sys) {
      const id = /^n:/.test(String(playerId)) ? String(playerId) : String(+playerId);
      const k = normSystem(sys);
      if (!k || !this.players.items[id]) return { ok: false };
      await this.mutate('players', (d) => {
        const e = d.items[id];
        if (!e) return;
        if (!e.systems.includes(k)) e.systems.push(k);
        if (!e.manual.includes(k)) e.manual.push(k);
        e.lastScanAt = computeLastScan(e);
      });
      this.refreshSoon();
      return { ok: true, system: k };
    }
    async _removeSystem(playerId, sys) {
      const id = /^n:/.test(String(playerId)) ? String(playerId) : String(+playerId);
      await this.mutate('players', (d) => {
        const e = d.items[id];
        if (!e) return;
        e.systems = e.systems.filter((s) => s !== sys);
        e.manual = e.manual.filter((s) => s !== sys);
        delete e.scans[sys];
        e.lastScanAt = computeLastScan(e);
      });
      this.refreshSoon();
      return { ok: true };
    }
    /** Tab input: name -> local player index, else POST /ajax/search category 2 (routes/web.php:240, SearchController:30-75). */
    async _findAndTrack(term) {
      const q = String(term || '').trim();
      if (!q) return { ok: false, reason: 'empty' };
      const local = await OGX.galaxy.players({ nameLike: q });
      let hit = local.find((p) => p.name && p.name.toLowerCase() === q.toLowerCase());
      let candidates = local.slice(0, 10).map((p) => ({ id: p.id, name: p.name }));
      if (!hit) {
        const r = await OGX.api.search(q, 2);
        if (r && Array.isArray(r.results)) {
          const exact = r.results.find((x) => x && x.name && x.name.toLowerCase() === q.toLowerCase());
          if (exact) hit = { id: +exact.id, name: exact.name };
          for (const x of r.results) if (x && +x.id > 0 && !candidates.some((c) => +c.id === +x.id)) candidates.push({ id: +x.id, name: x.name });
        } else if (r && r.error) {
          return { ok: false, reason: 'search', error: r.error };
        }
      }
      if (!hit && candidates.length === 1) hit = candidates[0];
      if (!hit) return { ok: false, reason: candidates.length ? 'ambiguous' : 'notfound', candidates: candidates.slice(0, 10) };
      return Object.assign(await this._track(+hit.id, hit.name, { source: 'tab' }), { id: +hit.id });
    }

    // ---------------------------------------------------------------- scanning
    systemsDue(ids, maxAgeMs) {
      const t = now();
      const due = new Map();
      for (const id of ids) {
        const e = this.players.items[id];
        if (!e) continue;
        for (const s of e.systems) {
          const at = e.scans[s] || 0;
          if (maxAgeMs !== undefined && t - at < maxAgeMs) continue;
          if (!due.has(s) || due.get(s) > at) due.set(s, at);
        }
      }
      return [...due.entries()].sort((a, b) => a[1] - b[1] || sysKey(a[0]).localeCompare(sysKey(b[0]))).map(([s]) => s.split(':').map(Number));
    }
    /** User click: scan the systems of one player (or all). */
    async _scanNow(playerId) {
      if (this.scanning) return { done: 0, stoppedBy: 'busy' };
      const ids = playerId ? [/^n:/.test(String(playerId)) ? String(playerId) : String(+playerId)] : Object.keys(this.players.items);
      const systems = this.systemsDue(ids);
      if (!systems.length) {
        this.setResult('Нет известных систем для сканирования — добавьте систему вручную', 'warn');
        return { done: 0, stoppedBy: null, empty: true };
      }
      return this.runScan(systems, { manual: true });
    }
    async runScan(systems, { manual, maxPerHour } = {}) {
      const abort = new AbortController();
      this.scanning = { abort, done: 0, total: systems.length, manual };
      this.refreshStatus();
      let res;
      try {
        // GALAXYZ: every view costs deuterium. A click asks first (core dialog: number of systems + cost); the auto-scan runs
        // only after the user enabled it with the cost confirmation (pauseReason 'cost' otherwise, never reaching here).
        const gzAuto = !manual && isGz() && this.gzAutoConfirmed();
        res = await OGX.galaxy.scan(systems, {
          signal: abort.signal, maxPerHour,
          userStarted: !!manual || gzAuto, confirm: !!manual,
          onSystem: () => { if (this.scanning) { this.scanning.done++; this.refreshStatus(); } },
        });
      } catch (e) {
        this.log.error('galaxy scan failed', e);
        res = { done: this.scanning ? this.scanning.done : 0, stoppedBy: 'http' };
      } finally {
        this.scanning = null;
      }
      if (!res || typeof res !== 'object') res = { done: 0, stoppedBy: 'http' };
      await this.queue;      // samples of the last system are recorded
      await this.mutate('sched', (d) => {
        d.runs.push({ t: now(), n: res.done, stoppedBy: res.stoppedBy || null, manual: !!manual });
        d.runs = d.runs.filter((r) => now() - r.t < 2 * HOUR).slice(-100);
        if (res.stoppedBy === 'vacation') { d.pausedUntil = now() + HOUR; d.pauseReason = 'vacation'; }
        else if (res.stoppedBy === 'auth') { d.pausedUntil = now() + 15 * MIN; d.pauseReason = 'auth'; }
        else if (res.stoppedBy === 'deuterium') { d.pausedUntil = now() + HOUR; d.pauseReason = 'deuterium'; }
        else if (res.stoppedBy === null && res.done) { d.pausedUntil = 0; d.pauseReason = null; }
      });
      const total = systems.length;
      if (res.stoppedBy === 'cancel') {
        this.setResult('Сканирование отменено — дейтерий не потрачен', 'info', manual);
      } else if (res.stoppedBy && res.stoppedBy !== 'abort') {
        const text = `Сканирование остановлено: ${STOP_TEXT[res.stoppedBy] || res.stoppedBy}` + (res.done ? ` (проверено ${res.done} из ${total})` : '');
        const soft = res.stoppedBy === 'limit' || res.stoppedBy === 'busy' || res.stoppedBy === 'cost';
        this.setResult(text, soft ? 'warn' : 'error', manual);
        if (!soft) this.log.warn('scan stopped', res.stoppedBy, res.done + '/' + total);
      } else if (res.stoppedBy === 'abort') {
        this.setResult(`Сканирование прервано (проверено ${res.done} из ${total})`, 'info', manual);
      } else {
        this.setResult(`Проверено ${res.done} ${OGX.fmt.plural(res.done, ['система', 'системы', 'систем'])}`, 'ok', manual);
      }
      this.refreshSoon();
      return res;
    }
    setResult(text, type, toast = true) {
      this.lastResult = { t: now(), text, type };
      if (toast) OGX.dom.toast(text, { type: type === 'ok' ? 'ok' : type, ms: type === 'error' ? 6000 : 3000 });
      this.refreshStatus();
    }
    hourlyUsed() {
      const t = now();
      return this.sched.runs.filter((r) => t - r.t < HOUR).reduce((a, r) => a + (r.n || 0), 0);
    }
    hourlyCap() { return +OGX.settings.get('core.galaxyScanPerHour') || 300; }
    /** GALAXYZ: the user enabled the auto-scan in this tab's UI with the deuterium confirmation. */
    gzAutoConfirmed() { return !!(this.sched && this.sched.gzConfirmedAt > 0); }
    pauseReason() {
      if (!this.ctx.settings.get('autoScan')) return 'off';
      if (isGz() && !this.gzAutoConfirmed()) return 'cost';
      if (OGX.page.is('galaxy')) return 'galaxy';
      if (now() - (this.sched.galaxyAt || 0) < GALAXY_BUSY_MS) return 'galaxy-other';
      if (document.hidden && !OGX.settings.get('core.backgroundWhenHidden')) return 'hidden';
      if ((this.sched.pausedUntil || 0) > now()) return this.sched.pauseReason || 'paused';
      if (this.hourlyUsed() >= this.hourlyCap()) return 'limit';
      return null;
    }
    noteGalaxyBrowsing() {
      if (!OGX.page.is('galaxy')) return;
      if (now() - (this.sched.galaxyAt || 0) < 60000) return;
      this.sched.galaxyAt = now();
      this.mutate('sched', (d) => { d.galaxyAt = now(); }).catch(() => {});
    }
    schedulerTick() {
      if (this.scanning || this.autoBusy) return;
      if (this.pauseReason()) { this.refreshStatus(); return; }
      const interval = Math.max(5, +this.ctx.settings.get('intervalMin') || 15) * MIN;
      if (!this.systemsDue(Object.keys(this.players.items), interval).length) return;
      this.autoBusy = true;
      this.autoRun().catch(() => {}).finally(() => { this.autoBusy = false; });
    }
    async _autoRun() {
      const interval = Math.max(5, +this.ctx.settings.get('intervalMin') || 15) * MIN;
      let lock = null;
      try {
        lock = await OGX.storage.lock('stalkScheduler', 10 * MIN);
        if (!lock) return { skipped: 'locked' };
        // fresh state: another tab may just have scanned
        const [pl, sc] = await Promise.all([this.ctx.store.get('players', null), this.ctx.store.get('sched', null)]);
        this.players = normPlayers(pl);
        this.sched = normSched(sc);
        const why = this.pauseReason();
        if (why) return { skipped: why };
        const remaining = this.hourlyCap() - this.hourlyUsed();
        const systems = this.systemsDue(Object.keys(this.players.items), interval).slice(0, Math.max(0, remaining));
        if (!systems.length) return { skipped: 'nothing' };
        await lock.refresh(Math.max(2 * MIN, systems.length * 5000));
        const r = await this.runScan(systems, { manual: false, maxPerHour: remaining });
        return { systems: systems.length, done: r.done, stoppedBy: r.stoppedBy };
      } finally {
        if (lock) await lock.release().catch(() => {});
      }
    }

    // ---------------------------------------------------------------- galaxy page
    initGalaxy() {
      // galaxy.onRender replays the boot-time render (GALAXYZ: the page itself is the system)
      this.offs.push(OGX.galaxy.onRender((ev) => this.renderRows(ev)));
      if (!isGz()) {
        const cur = OGX.galaxy.current();
        const rendered = OGX.dom.$('#galaxyContent .galaxyRow .cellPlanet .microplanet');
        if (cur && rendered && !OGX.galaxy.last('render')) this.refreshGalaxy();
      }
    }
    rowsMap() { return OGX.galaxy.rows(); }
    refreshGalaxy() {
      if (!OGX.page.is('galaxy')) return null;
      const cur = OGX.galaxy.current();
      const sys = this.lastPageSys;
      if (sys && (!cur || (cur.galaxy === sys.galaxy && cur.system === sys.system))) return this.renderRows({ galaxy: sys.galaxy, system: sys.system, rows: this.rowsMap() });
      if (cur) return this.renderRows({ galaxy: cur.galaxy, system: cur.system, rows: this.rowsMap() });
      return null;
    }
    async _renderRows(ev) {
      if (!ev || !ev.rows) return 0;
      let sys = this.lastPageSys && this.lastPageSys.galaxy === +ev.galaxy && this.lastPageSys.system === +ev.system ? this.lastPageSys : null;
      if (!sys) sys = await OGX.galaxy.cached(+ev.galaxy, +ev.system);
      let n = 0;
      for (const [pos, row] of ev.rows) {
        const p = sys && sys.positions.find((x) => x.position === pos);
        // GALAXYZ: the core slot lives inside td.action
        const old = row.querySelector('.ogx-gx-slot[data-owner="stalk"]');
        if (!p || p.destroyed || this.isOwnPos(p) || +p.playerId < 0 || !playerKey(p.playerId, p.playerName)) { if (old) old.remove(); continue; }
        const key = this.keyFor(p.playerId, p.playerName);
        const tracked = !!this.players.items[key];
        const slot = OGX.galaxy.rowSlot(row, 'stalk');
        slot.textContent = '';
        slot.classList.add(P + 'slot');
        slot.appendChild(h('button', {
          type: 'button', class: [P + 'eye', tracked ? P + 'eye-on' : null], dataset: { ogxAct: 'stalk:galaxy-eye', pos, playerId: key },
          title: tracked ? `Слежка за ${p.playerName || 'игроком'} включена — нажмите, чтобы прекратить` : `Следить за активностью ${p.playerName || 'игрока'}`,
          'aria-label': tracked ? 'Прекратить слежку' : 'Следить',
          onClick: (e) => {
            e.preventDefault();
            rec('U', 'galaxy-eye', { playerId: key, on: !tracked });
            if (tracked) this.untrack(key).then(() => OGX.dom.toast(`Слежка за ${p.playerName || 'игроком'} выключена`, { type: 'info', ms: 2000 }));
            else this.track(p.playerId || null, p.playerName, { systems: [ev.galaxy + ':' + ev.system], source: 'galaxy' }).then((r) => this.trackToast(r));
          },
        }, OGX.dom.icon('eye')));
        n++;
      }
      return n;
    }

    // ---------------------------------------------------------------- derived data
    playerView(id) {
      const e = this.players.items[id];
      const samples = this.logData.items[id] || [];
      const t = now();
      const bodies = new Map();
      const add = (coords, body) => {
        const k = coords + ':' + body;
        if (!bodies.has(k)) bodies.set(k, { coords, body, name: null, last: null, lastSeen: null, selfSeen: null });
        return bodies.get(k);
      };
      for (const [c, pl] of Object.entries(e.planets || {})) {
        add(c, 'p').name = pl.name;
        if (pl.moonId && !isGz()) add(c, 'm').name = pl.moonName || 'Луна';
      }
      let lastSeen = null;
      for (const s of samples) {
        const b = add(s.coords, s.body);
        if (!b.last || s.t >= b.last.t) b.last = s;
        if (s.lastSeen !== null && !s.self) {
          if (b.lastSeen === null || s.lastSeen > b.lastSeen) b.lastSeen = s.lastSeen;
          if (lastSeen === null || s.lastSeen > lastSeen) lastSeen = s.lastSeen;
        } else if (s.lastSeen !== null && s.self && (b.selfSeen === null || s.lastSeen > b.selfSeen)) b.selfSeen = s.lastSeen;
      }
      const list = [...bodies.values()].sort((a, b) => coordsSort(a.coords).localeCompare(coordsSort(b.coords)) || (a.body === 'p' ? -1 : 1));
      return { e, samples, bodies: list, lastSeen, activeNow: lastSeen !== null && t - lastSeen < Q };
    }
    /** 96 cells of 15 minutes ending now: 'act' | 'self' | 'chk' | '' */
    strip(samples) {
      const end = Math.ceil(now() / Q) * Q;
      const start = end - 96 * Q;
      const cells = new Array(96).fill('');
      const set = (i, v) => {
        if (i < 0 || i >= 96) return;
        const rank = { '': 0, chk: 1, self: 2, act: 3 };
        if (rank[v] > rank[cells[i]]) cells[i] = v;
      };
      const idx = (ms) => Math.floor((ms - start) / Q);
      for (const s of samples) {
        if (s.lastSeen !== null) set(idx(s.lastSeen), s.self ? 'self' : 'act');
        // ranges proven quiet: none -> [t0 - 60 min, t]; minutes -> (lastSeen, t]
        let qFrom = null;
        if (s.activity === null) qFrom = (s.t0 || s.t) - HOUR;
        else if (fin(s.activity)) qFrom = s.lastSeen + Q;
        if (qFrom !== null) for (let i = Math.max(0, idx(qFrom)); i <= Math.min(95, idx(s.t)); i++) set(i, 'chk');
      }
      return { start, cells };
    }
    /** 7 days × 24 hours: number of active (non-self) 15-minute cells per hour. */
    week(samples) {
      const today = wallDay(now());
      const grid = new Map();
      for (let d = today - 6; d <= today; d++) grid.set(d, new Array(24).fill(null).map(() => new Set()));
      const checked = new Map();
      for (let d = today - 6; d <= today; d++) checked.set(d, new Array(24).fill(false));
      for (const s of samples) {
        const dt = wallDay(s.t);
        if (checked.has(dt)) checked.get(dt)[wallHour(s.t)] = true;
        if (s.lastSeen === null || s.self) continue;
        const d = wallDay(s.lastSeen);
        if (!grid.has(d)) continue;
        grid.get(d)[wallHour(s.lastSeen)].add(Math.floor(s.lastSeen / Q));
      }
      let total = 0;
      const rows = [];
      for (let d = today - 6; d <= today; d++) {
        const hours = grid.get(d).map((set) => set.size);
        total += hours.reduce((a, b) => a + b, 0);
        rows.push({ day: d, hours, checked: checked.get(d) });
      }
      return { rows, total };
    }
    updateBadge() {
      if (!this.tab) return;
      let n = 0;
      for (const id of Object.keys(this.players.items)) if (this.playerView(id).activeNow) n++;
      this.tab.setBadge(n ? String(n) : null);
    }

    // ---------------------------------------------------------------- tab
    refreshTab() {
      if (this.tab) this.tab.refresh();
      this.updateBadge();
    }
    statusText() {
      if (this.scanning) return `Сканирование: ${this.scanning.done} из ${this.scanning.total}…`;
      const why = this.pauseReason();
      const interval = Math.max(5, +this.ctx.settings.get('intervalMin') || 15);
      const parts = [];
      if (why === 'off') parts.push('Автосканирование выключено' + (isGz() ? ' (каждый просмотр системы стоит дейтерий)' : ''));
      else if (why === 'galaxy') parts.push('Автосканирование на паузе: вы на странице галактики (ваши просмотры тоже записываются)');
      else if (why === 'galaxy-other') parts.push('Автосканирование на паузе: галактику просматривают в другой вкладке');
      else if (why === 'hidden') parts.push('Автосканирование на паузе: вкладка в фоне');
      else if (why === 'vacation') parts.push('Автосканирование на паузе: режим отпуска');
      else if (why === 'auth') parts.push('Автосканирование на паузе: нужна авторизация');
      else if (why === 'cost') parts.push('Автосканирование выключено: просмотр галактики стоит дейтерий — включите его заново галочкой ниже и подтвердите');
      else if (why === 'deuterium') parts.push('Автосканирование на паузе: не хватает дейтерия для просмотра галактики');
      else if (why === 'limit') parts.push(`Автосканирование на паузе: часовой лимит ${OGX.fmt.num(this.hourlyCap())} систем исчерпан`);
      else if (why) parts.push('Автосканирование на паузе');
      else {
        const t = now();
        let next = Infinity;
        for (const e of Object.values(this.players.items)) for (const s of e.systems) next = Math.min(next, (e.scans[s] || 0) + interval * MIN);
        parts.push(`Автосканирование каждые ${interval} мин` + (fin(next) ? (next <= t ? ', проверка скоро' : `, следующая через ${OGX.fmt.durationShort((next - t) / 1000)}`) : ''));
      }
      parts.push(`за час: ${OGX.fmt.num(this.hourlyUsed())} из ${OGX.fmt.num(this.hourlyCap())}`);
      return parts.join(' · ');
    }
    /** Checkbox «автосканирование». GALAXYZ: switching it on asks for the deuterium cost first; declined -> stays off. */
    async setAutoScan(on, box) {
      if (on && isGz()) {
        const n = this.systemsDue(Object.keys(this.players.items)).length;
        const iv = Math.max(5, +this.ctx.settings.get('intervalMin') || 15);
        let ok = false;
        try {
          ok = await OGX.dom.confirm(`Автосканирование будет просматривать системы отслеживаемых игроков (сейчас ${n} ${OGX.fmt.plural(n, ['система', 'системы', 'систем'])}) каждые ${iv} мин, пока открыта вкладка игры. ` +
            'На этом сервере каждый просмотр чужой системы стоит дейтерий (списывается с текущей планеты). Включить?', { okLabel: 'Включить', title: 'Автосканирование галактики' });
        } catch (e) { ok = false; }
        if (!ok) {
          if (box) box.checked = false;
          await this.ctx.settings.set('autoScan', false);
          this.setResult('Автосканирование не включено — дейтерий не тратится', 'info', false);
          return false;
        }
        await this.mutate('sched', (d) => { d.gzConfirmedAt = now(); });
      } else if (!on && isGz()) {
        await this.mutate('sched', (d) => { d.gzConfirmedAt = 0; });
      }
      await this.ctx.settings.set('autoScan', !!on);
      this.refreshStatus();
      return true;
    }
    refreshStatus() {
      if (this.statusEl && this.statusEl.isConnected) this.statusEl.textContent = this.statusText();
      if (this.resultEl && this.resultEl.isConnected) {
        const r = this.lastResult;
        this.resultEl.textContent = r ? r.text : '';
        this.resultEl.className = P + 'result' + (r ? ' ' + P + 'result-' + r.type : '');
        this.resultEl.hidden = !r;
      }
      if (this.stopBtn && this.stopBtn.isConnected) this.stopBtn.hidden = !this.scanning;
    }

    renderTab(c) {
      const input = h('input', { type: 'search', class: P + 'name', placeholder: 'Имя игрока', dataset: { ogxAct: 'stalk:name-input' } });
      const found = h('div', { class: P + 'found', hidden: true });
      const doFind = async () => {
        rec('U', 'find', { len: input.value.length });
        const r = await this.findAndTrack(input.value);
        found.textContent = '';
        found.hidden = true;
        if (r.ok) { this.trackToast(r); input.value = ''; return; }
        if (r.reason === 'empty') return;
        found.hidden = false;
        if (r.reason === 'notfound') found.appendChild(h('span', { class: P + 'muted' }, 'Игрок не найден'));
        else if (r.reason === 'search') found.appendChild(h('span', { class: P + 'bad' }, 'Поиск не удался: ' + r.error));
        else {
          found.appendChild(h('span', { class: P + 'muted' }, 'Уточните игрока: '));
          for (const x of r.candidates) {
            found.appendChild(h('button', { type: 'button', class: 'ogx-btn ' + P + 'cand', dataset: { ogxAct: 'stalk:pick-candidate', playerId: x.id },
              onClick: () => { rec('U', 'pick-candidate', { playerId: x.id }); this.track(x.id, x.name, { source: 'tab' }).then((rr) => { this.trackToast(rr); found.hidden = true; }); } }, x.name || ('#' + x.id)));
          }
        }
      };
      input.addEventListener('keydown', OGX.safe((ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doFind(); } }, 'stalk:enter'));
      const auto = h('input', { type: 'checkbox', class: P + 'auto', checked: !!this.ctx.settings.get('autoScan') && (!isGz() || this.gzAutoConfirmed()), dataset: { ogxAct: 'stalk:auto-scan' },
        title: isGz() ? 'Каждый просмотр чужой системы стоит дейтерий: включение нужно подтвердить' : '',
        onChange: (ev) => { rec('U', 'auto-scan', { on: ev.target.checked }); this.setAutoScan(ev.target.checked, ev.target); } });
      const interval = h('input', { type: 'number', class: P + 'interval', min: 5, max: 240, step: 5, value: +this.ctx.settings.get('intervalMin') || 15, dataset: { ogxAct: 'stalk:interval' },
        title: 'Интервал автосканирования, мин',
        onChange: (ev) => { rec('U', 'interval', { v: +ev.target.value }); this.ctx.settings.set('intervalMin', +ev.target.value).then(() => this.refreshStatus()); } });
      const notify = h('input', { type: 'checkbox', class: P + 'notify', checked: this.ctx.settings.get('notify') !== false, dataset: { ogxAct: 'stalk:notify' },
        onChange: (ev) => { rec('U', 'notify', { on: ev.target.checked }); this.ctx.settings.set('notify', ev.target.checked); } });
      this.statusEl = h('div', { class: P + 'status' });
      this.resultEl = h('div', { class: P + 'result', hidden: true });
      this.stopBtn = h('button', { type: 'button', class: 'ogx-btn ogx-btn-danger ' + P + 'stop', hidden: true, dataset: { ogxAct: 'stalk:stop' },
        onClick: () => { rec('U', 'stop-scan'); if (this.scanning) this.scanning.abort.abort(); } }, 'Стоп');
      const ids = Object.keys(this.players.items);
      const views = ids.map((id) => ({ id, v: this.playerView(id) }))
        .sort((a, b) => (b.v.lastSeen || 0) - (a.v.lastSeen || 0) || String(a.v.e.name || '').localeCompare(String(b.v.e.name || '')));
      c.appendChild(h('div', { class: P + 'tab' },
        h('div', { class: P + 'bar' }, input,
          h('button', { type: 'button', class: 'ogx-btn ogx-btn-primary ' + P + 'add', dataset: { ogxAct: 'stalk:add' }, onClick: doFind }, 'Следить'),
          h('button', { type: 'button', class: 'ogx-btn ' + P + 'scan-all', dataset: { ogxAct: 'stalk:scan-all' }, disabled: !ids.length,
            title: 'Просмотреть системы всех отслеживаемых игроков' + (isGz() ? GZ_COST + ': спросим подтверждение' : ''),
            onClick: () => { rec('U', 'scan-all'); this.scanNow(null); } }, OGX.dom.icon('refresh'), ' Сканировать всех'),
          this.stopBtn),
        found,
        h('div', { class: P + 'opts' },
          h('label', { class: P + 'opt' }, auto, ' автосканирование каждые '), interval, h('span', null, ' мин'),
          h('label', { class: P + 'opt' }, notify, ' уведомлять')),
        this.statusEl, this.resultEl,
        views.length ? views.map(({ id, v }) => this.playerCard(id, v)) :
          h('div', { class: P + 'empty' }, 'Никого не отслеживаете. Нажмите на глаз в строке галактики, кнопку «Следить» в поиске игроков или введите имя выше.'),
        h('div', { class: P + 'hint' }, isGz()
          ? 'Активность в галактике: «(*)» — меньше 15 минут, «(N min)» — 15–59 минут, без отметки — час и больше; одна отметка на планету и луну вместе. Каждый просмотр чужой системы стоит дейтерий: сканирование только по вашему подтверждению. Ваши шпионаж и атаки тоже делают цель «активной»: такие отметки помечены как свои и не считаются.'
          : 'Активность в OgameX: «*» — меньше 15 минут, число — минуты 15–60, «—» — больше часа. Ваши шпионаж и атаки тоже делают цель «активной»: такие отметки помечены как свои и не считаются.')));
      this.refreshStatus();
    }

    playerCard(id, v) {
      const e = v.e;
      const name = e.name || (/^n:/.test(id) ? id.slice(2) : '#' + id);
      const t = now();
      const seen = v.lastSeen === null ? 'нет данных' : v.activeNow ? 'активен сейчас' : OGX.fmt.ago(v.lastSeen);
      const st = this.statusLetters(id);
      const sysChips = e.systems.slice().sort((a, b) => sysKey(a).localeCompare(sysKey(b))).map((s) => {
        const at = e.scans[s];
        return h('span', { class: [P + 'chip', e.manual.includes(s) ? P + 'chip-manual' : null], title: at ? 'Проверено ' + OGX.fmt.dateTime(at) : 'Ещё не проверялась' },
          h('a', { href: OGX.page.url('/galaxy', { galaxy: s.split(':')[0], system: s.split(':')[1] }), class: P + 'chip-link', title: isGz() ? 'Открыть в галактике' + GZ_COST : null }, '[' + s + ']'),
          h('button', { type: 'button', class: P + 'chip-x', title: 'Убрать систему', dataset: { ogxAct: 'stalk:remove-system', system: s },
            onClick: () => { rec('U', 'remove-system', { playerId: id, system: s }); this.removeSystem(id, s); } }, '×'));
      });
      const sysInput = h('input', { type: 'text', class: P + 'sys-input', placeholder: 'г:с', size: 6, dataset: { ogxAct: 'stalk:system-input' } });
      const addSys = () => {
        const k = normSystem(sysInput.value);
        rec('U', 'add-system', { playerId: id, ok: !!k });
        if (!k) { OGX.dom.toast('Введите систему в виде 1:45', { type: 'warn', ms: 2000 }); return; }
        this.addSystem(id, k);
      };
      sysInput.addEventListener('keydown', OGX.safe((ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addSys(); } }, 'stalk:sys-enter'));
      const first = e.systems[0];
      return h('div', { class: [P + 'card', v.activeNow ? P + 'card-active' : null], dataset: { playerId: id } },
        h('div', { class: P + 'head' },
          h('span', { class: P + 'pname' }, name),
          st ? h('span', { class: P + 'st', title: st.split('').map((x) => STATUS_RU[x] || x).join(', ') }, '(' + st + ')') : null,
          h('span', { class: [P + 'seen', v.activeNow ? P + 'seen-now' : null], title: v.lastSeen !== null ? 'Последняя активность ≈ ' + OGX.fmt.dateTime(v.lastSeen) : '' }, seen),
          h('span', { class: P + 'spacer' }),
          h('button', { type: 'button', class: 'ogx-btn ogx-btn-icon ' + P + 'scan', title: 'Сканировать системы игрока сейчас' + (isGz() ? GZ_COST + ': спросим подтверждение' : ''), dataset: { ogxAct: 'stalk:scan', playerId: id }, disabled: !!this.scanning,
            onClick: () => { rec('U', 'scan', { playerId: id }); this.scanNow(id); } }, OGX.dom.icon('refresh')),
          first ? h('a', { class: 'ogx-btn ogx-btn-icon ' + P + 'gal', title: 'Открыть в галактике' + (isGz() ? GZ_COST : ''), dataset: { ogxAct: 'stalk:galaxy' },
            href: OGX.page.url('/galaxy', { galaxy: first.split(':')[0], system: first.split(':')[1] }) }, OGX.dom.icon('eye')) : null,
          h('button', { type: 'button', class: 'ogx-btn ogx-btn-icon ogx-btn-danger ' + P + 'untrack', title: 'Прекратить слежку', dataset: { ogxAct: 'stalk:untrack', playerId: id },
            onClick: async () => {
              rec('U', 'untrack', { playerId: id });
              const ok = await OGX.dom.confirm(`Прекратить слежку за ${name}? История активности будет удалена.`, { okLabel: 'Прекратить', danger: true });
              if (ok) await this.untrack(id);
            } }, OGX.dom.icon('trash'))),
        h('div', { class: P + 'meta' },
          'Проверено: ', e.lastScanAt ? OGX.fmt.ago(e.lastScanAt) : (Object.keys(e.scans).length ? 'частично' : 'ещё нет'),
          ' · Системы: ', sysChips.length ? sysChips : h('span', { class: P + 'muted' }, 'неизвестны'), ' ', sysInput,
          h('button', { type: 'button', class: 'ogx-btn ogx-btn-icon ' + P + 'sys-add', title: 'Добавить систему', dataset: { ogxAct: 'stalk:add-system' }, onClick: addSys }, OGX.dom.icon('plus'))),
        this.bodiesTable(v, t),
        this.stripEl(v.samples),
        this.weekEl(v.samples));
    }
    statusLetters(id) {
      const sys = this.lastPageSys;
      const p = sys && sys.positions.find((x) => (/^n:/.test(id) ? x.playerName === id.slice(2) : +x.playerId === +id));
      return p ? p.status || '' : '';
    }
    bodiesTable(v, t) {
      if (!v.bodies.length) return h('div', { class: P + 'muted' }, 'Планеты пока неизвестны — просканируйте систему игрока.');
      return h('table', { class: 'ogx-table ' + P + 'bodies' },
        h('thead', null, h('tr', null, h('th', null, 'Коорд.'), h('th', null, 'Название'), h('th', { title: 'Значение в галактике при последней проверке' }, 'Акт.'), h('th', null, 'Был активен'), h('th', null, 'Проверено'))),
        h('tbody', null, v.bodies.map((b) => {
          const last = b.last;
          const selfNote = last && last.self && isActive(last.activity);
          return h('tr', { class: [b.body === 'm' ? P + 'moon' : null, last && isActive(last.activity) && !last.self ? P + 'row-act' : null], dataset: { coords: b.coords, body: b.body } },
            h('td', { class: P + 'coords' }, OGX.fmt.coords(b.coords, b.body === 'm' ? 3 : 1)),
            h('td', null, b.name || (b.body === 'm' ? 'Луна' : '—')),
            h('td', { class: [P + 'act', selfNote ? P + 'act-self' : null], title: selfNote ? 'Активность вызвана вашим флотом (шпионаж/атака)' : '' }, last ? actText(last.activity) + (selfNote ? ' (свой)' : '') : '—'),
            h('td', { class: P + 'ls', title: b.lastSeen !== null ? OGX.fmt.dateTime(b.lastSeen) : '' }, b.lastSeen !== null ? (t - b.lastSeen < Q ? 'сейчас' : OGX.fmt.ago(b.lastSeen)) : '—'),
            h('td', { class: P + 'chk', title: last ? OGX.fmt.dateTime(last.t) : '' }, last ? OGX.fmt.ago(last.t) : '—'));
        })));
    }
    stripEl(samples) {
      const { start, cells } = this.strip(samples);
      const active = cells.filter((x) => x === 'act').length;
      const row = h('div', { class: P + 'strip', title: '' }, cells.map((c, i) => h('span', {
        class: [P + 'cell', c ? P + 'c-' + c : null],
        title: `${hm(start + i * Q)}–${hm(start + (i + 1) * Q)}: ` + (c === 'act' ? 'активен' : c === 'self' ? 'активность от вашего флота' : c === 'chk' ? 'проверено, неактивен' : 'нет данных'),
      })));
      const axis = h('div', { class: P + 'axis' }, [0, 24, 48, 72].map((i) => h('span', null, hm(start + i * Q))), h('span', null, 'сейчас'));
      return h('div', { class: P + 'day' }, h('div', { class: P + 'sub' }, `24 часа: активных интервалов ${active} из 96`), row, axis);
    }
    weekEl(samples) {
      const w = this.week(samples);
      const max = Math.max(1, ...w.rows.map((r) => Math.max(...r.hours)));
      return h('div', { class: P + 'week' },
        h('div', { class: P + 'sub' }, `7 дней: активных 15-минутных интервалов ${OGX.fmt.num(w.total)}`),
        h('table', { class: P + 'heat' },
          h('thead', null, h('tr', null, h('th', null, ''), Array.from({ length: 24 }, (_, i) => h('th', null, i % 3 === 0 ? String(i) : '')))),
          h('tbody', null, w.rows.map((r) => h('tr', { dataset: { day: r.day } },
            h('th', null, dayLabel(r.day)),
            r.hours.map((n, hr) => h('td', {
              class: [P + 'hc', n ? P + 'h' + Math.min(4, Math.ceil((n / max) * 4)) : r.checked[hr] ? P + 'hchk' : null],
              dataset: { n },
              title: `${dayLabel(r.day)} ${p2(hr)}:00–${p2(hr)}:59: ` + (n ? `${n} ${OGX.fmt.plural(n, ['интервал', 'интервала', 'интервалов'])} активности` : r.checked[hr] ? 'проверено, неактивен' : 'нет данных'),
            })))))));
    }
  }

  function pruneHits(d) {
    const t = now();
    d.items = d.items.filter((x) => (x.arrival !== null ? t - x.arrival < DAY : t - x.sentAt < 2 * HOUR)).slice(-CAP_HITS);
  }

  const CSS = `
.${P}slot { display: inline-flex; vertical-align: middle; margin-left: 3px; }
.${P}eye { background: transparent; border: 0; padding: 0 1px; cursor: pointer; color: #6b7a8c; line-height: 0; vertical-align: middle; }
.${P}eye svg { width: 13px; height: 13px; }
.${P}eye.${P}eye-on { color: #ff9800; }
.${P}tab { display: flex; flex-direction: column; gap: 6px; }
.${P}bar { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.${P}name { flex: 1 1 120px; min-width: 100px; }
input.${P}name, input.${P}sys-input { padding: 3px 6px; }   /* colours: core 20-style (text and search inputs) */
.${P}found { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.${P}opts { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.${P}opt { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
.${P}interval { width: 52px; }
.${P}status { color: #8593a3; font-size: 10px; }
.${P}result { padding: 3px 6px; border-radius: 3px; background: #1d2530; }
.${P}result-error { color: #f44336; }
.${P}result-warn { color: #ff9800; }
.${P}result-ok { color: #4caf50; }
.${P}empty, .${P}muted { color: #8593a3; }
.${P}bad { color: #f44336; }
.${P}hint { color: #6b7a8c; font-size: 10px; margin-top: 4px; }
.${P}card { border: 1px solid #2b3846; border-radius: 4px; padding: 6px; background: #121820; display: flex; flex-direction: column; gap: 4px; }
.${P}card-active { border-color: #ff9800; }
.${P}head { display: flex; align-items: center; gap: 6px; }
.${P}pname { font-weight: bold; color: #e6edf5; }
.${P}st { color: #8593a3; }
.${P}seen { color: #cfd8e3; }
.${P}seen-now { color: #ff9800; font-weight: bold; }
.${P}spacer { flex: 1; }
.${P}meta { color: #8593a3; display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
.${P}chip { display: inline-flex; align-items: center; gap: 2px; padding: 0 3px; border: 1px solid #2b3846; border-radius: 3px; color: #cfd8e3; }
.${P}chip-manual { border-style: dashed; }
.${P}chip-link { color: #6f9fd8; text-decoration: none; }
.${P}chip-x { background: transparent; border: 0; color: #8593a3; cursor: pointer; padding: 0 1px; }
.${P}sys-input { width: 52px; }
.${P}bodies td, .${P}bodies th { padding: 1px 4px; }
.${P}bodies tr.${P}moon td:first-child { padding-left: 12px; }
.${P}row-act td.${P}act { color: #ff9800; font-weight: bold; }
.${P}act-self { color: #8593a3; font-style: italic; }
.${P}sub { color: #8593a3; font-size: 10px; margin: 2px 0; }
.${P}strip { display: grid; grid-template-columns: repeat(96, 1fr); gap: 1px; height: 12px; }
.${P}cell { background: #1b232d; }
.${P}cell.${P}c-chk { background: #2e4a3a; }
.${P}cell.${P}c-self { background: #5d6b7a; }
.${P}cell.${P}c-act { background: #ff9800; }
.${P}axis { display: flex; justify-content: space-between; color: #6b7a8c; font-size: 9px; }
.${P}heat { border-collapse: separate; border-spacing: 1px; width: 100%; table-layout: fixed; }
.${P}heat th { font-weight: normal; color: #6b7a8c; font-size: 9px; padding: 0; text-align: center; }
.${P}heat tbody th { text-align: right; padding-right: 3px; width: 34px; }
.${P}hc { height: 9px; background: #1b232d; padding: 0; }
.${P}hc.${P}hchk { background: #24342c; }
.${P}hc.${P}h1 { background: #5a3d12; }
.${P}hc.${P}h2 { background: #8a5a14; }
.${P}hc.${P}h3 { background: #c47a10; }
.${P}hc.${P}h4 { background: #ff9800; }
`;
})(window.OGX);
