/* ogamex-bot/modules/botcore/botcore.js — «Бот: ядро», the bot runtime of OgameX Suite. Owner: runtime agent.
 * Contract: specs/bot/BOT_CONTRACT.md C2/C3/C5/C6 (binding); design: specs/bot/BOT_DESIGN.md §1–§3.
 *
 * Defines window.OGX.bot at load time (API usable before init: calls that need storage wait for OGX.bot.ready) and starts
 * work only in init(ctx):
 *   - leader election across game tabs (OGX.storage.lock('bot.leader', 15000), refreshed every 5 s from the worker clock,
 *     released on pagehide; a visible tab is preferred via botcore.leaderWant);
 *   - workers (OGX.bot.register) scheduled on a Blob-URL dedicated Worker clock (setTimeout fallback = degraded);
 *   - ONE persisted action queue (botcore.queue) with ONE executor in the leader tab: gates (stopped/paused, leader, dry-run,
 *     limits, user-first, sleep, threat lock, slots, ships/fuel/cargo), exact GALAXYZ requests (BOT_DESIGN §2) through
 *     OGX.http with an explicit cp, stop checks on every answer (logout, captcha, vacation, unknown page), per-type
 *     verification (C3.3), backoff ladder and pause after botcore.maxErrors, cp restore when the queue drains;
 *   - shared read cache (identical reads within botcore.readCacheSec answered from memory, writes drop their planet's pages),
 *     reads wait botcore.readGapMs, writes minGapMs..maxGapMs and run before queued reads; OGX.bot.efficiency() for the panel;
 *   - threat detection from every page's event box / flights:updated, body lock (C2.6);
 *   - registries (battles, needs, reservations, intel), precise persisted timers, notify, sleep window, limits.
 * Safety: master switch OFF and dry-run ON by default; nothing is sent before the user turns master on AND dry-run off.
 * The bot runs only while a game tab is open (no background page automation; permissions stay ["storage"]).
 * Every action and decision goes to the journal (OGX.log.rec src 'B', kinds 'botcore:<event>'). */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const NAME = 'botcore';
  const VERSION = '1.0.0';
  const MODULES = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'];
  const bot = (OGX.bot = OGX.bot || {});

  // ------------------------------------------------------------------ settings (contract C5)
  const SEC = 'Бот: общие';
  const SETTINGS = {
    master: { type: 'bool', default: true, label: 'Бот включён (главный выключатель)', section: SEC },
    dryRun: { type: 'bool', default: false, label: 'Пробный режим: планировать и писать в журнал, ничего не отправлять', section: SEC },
    maxActionsPerHour: { type: 'int', default: 5000, min: 1, max: 20000, label: 'Действий в час, не больше', section: SEC },
    maxFleetSendsPerHour: { type: 'int', default: 30, min: 0, max: 500, label: 'Отправок флота в час, не больше', section: SEC },
    maxBuildsPerHour: { type: 'int', default: 1000, min: 0, max: 5000, label: 'Заказов построек в час, не больше', section: SEC },
    galaxyViewsPerHour: { type: 'int', default: 300, min: 0, max: 300, label: 'Просмотров галактики в час (стоят дейтерий; 0 = никогда)', section: SEC },
    slotsReserve: { type: 'int', default: 1, min: 0, max: 10, label: 'Свободных слотов флота держать в резерве', section: SEC },
    minGapMs: { type: 'int', default: 300, min: 300, max: 60000, label: 'Пауза между запросами, мин. (мс)', section: SEC },
    maxGapMs: { type: 'int', default: 600, min: 300, max: 120000, label: 'Пауза между запросами, макс. (мс)', section: SEC },
    readGapMs: { type: 'int', default: 150, min: 100, max: 60000, label: 'Пауза перед чтением страницы (мс; постройки и отправки ждут паузу выше)', section: SEC },
    readCacheSec: { type: 'int', default: 20, min: 0, max: 600, label: 'Одинаковое чтение не чаще (с; галактика не чаще 60 с, 0 = без кэша)', section: SEC },
    userIdleSec: { type: 'int', default: 20, min: 0, max: 600, label: 'Ждать после действий пользователя в игре (с)', section: SEC },
    maxErrors: { type: 'int', default: 5, min: 1, max: 50, label: 'Ошибок подряд до паузы', section: SEC },
    onlineBonus: { type: 'bool', default: true, label: 'Забирать бонус за онлайн (звёздочка «Online bonus» в игре)', section: SEC },
    autoLogin: { type: 'bool', default: true, label: 'Автовход: после вылета нажимать «Вход» (логин и пароль подставляет браузер)', section: SEC },
    threatLockSec: { type: 'int', default: 3600, min: 0, max: 86400, label: 'Блокировать отправки с атакуемого тела за (с) до удара', section: SEC },
    readMessages: { type: 'bool', default: true, label: 'Бот может открывать сообщения (они станут прочитанными)', section: SEC },
    rateC: { type: 'float', default: 1.5, min: 0.1, max: 10, step: 0.1, label: 'Курс кристалла к металлу', section: SEC },
    rateD: { type: 'float', default: 3, min: 0.1, max: 20, step: 0.1, label: 'Курс дейтерия к металлу', section: SEC },
    sleepOn: { type: 'bool', default: false, label: 'Режим сна', section: SEC },
    sleepFrom: { type: 'string', default: '01:30', label: 'Засыпать в (серверное время)', section: SEC },
    sleepTo: { type: 'string', default: '07:30', label: 'Просыпаться в', section: SEC },
    sleepPreventIfFleets: { type: 'bool', default: true, label: 'Откладывать сон, пока флоты в полёте', section: SEC },
    runHidden: { type: 'bool', default: true, label: 'Работать в фоновой вкладке', section: SEC },
    notifySound: { type: 'bool', default: true, label: 'Звук при тревоге', section: SEC },
    deutReserve: { type: 'int', default: 0, min: 0, label: 'Дейтерий, который бот не тратит ни на одном теле', section: SEC },
  };

  // ------------------------------------------------------------------ constants
  const ACTION_TYPES = ['read.page', 'read.fleetTable', 'read.messages', 'read.galaxy', 'read.statistics', 'probe.target',
    'fleet.send', 'fleet.recall', 'fleet.ajax', 'build.building', 'build.research', 'build.units', 'messages.delete', 'bonus.claim'];
  // free in dry-run (change nothing in the game); everything else is refused with 'dryRun' (galaxy views cost deuterium,
  // message listing marks read)
  const DRY_FREE = new Set(['read.page', 'read.fleetTable', 'read.statistics', 'probe.target']);
  const PRIO = { defense: 0, deadline: 1, fleet: 2, build: 3, read: 4 };
  const DEFAULT_JITTER = { defense: [5000, 15000], build: [5000, 15000], deadline: [20000, 50000], fleet: [20000, 50000] };
  const BACKOFF = [[5000, 15000], [40000, 140000], [240000, 360000], [1500000, 2100000]];
  const HOUR = 3600000;
  const MIN = 60000;
  const TICK_MS = 5000;
  const LEADER_TTL = 15000;
  const QUEUE_MAX = 200;
  const CAPTCHA_RE = /captcha|recaptcha|hcaptcha/i;
  const LIMIT_KEYS = { actions: 'maxActionsPerHour', fleetSends: 'maxFleetSendsPerHour', builds: 'maxBuildsPerHour', galaxyViews: 'galaxyViewsPerHour' };
  const RES = ['metal', 'crystal', 'deuterium'];
  // «Автовход»: one record in the GLOBAL scope ('*|*|botcore.autologin'), because the login page has no account namespace.
  // { pending: { t, host, url } | null, attempts: [ms], gaveUp: ms|null, userLogout: ms|null, last: { t, text } } — never credentials.
  const AUTOLOGIN_KEY = 'botcore.autologin';
  const AUTOLOGIN_USER_LOGOUT_MS = 30 * 60000;   // the user pressed «Выход» himself: no auto-login for 30 min

  // ------------------------------------------------------------------ small helpers
  const now = () => { try { return OGX.time.serverNow(); } catch (e) { return Date.now(); } };
  const sget = (k) => { try { return OGX.settings.get(k); } catch (e) { return undefined; } };
  const core = (k) => sget('botcore.' + k);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const S = (k) => 'botcore.' + k;
  const store = {
    get: (k, d = null) => OGX.storage.get(S(k), d),
    set: (k, v) => OGX.storage.set(S(k), v),
    update: (k, fn, d = null) => OGX.storage.update(S(k), fn, d),
    subscribe: (k, fn) => OGX.storage.subscribe(S(k), fn),
  };
  const res0 = () => ({ metal: 0, crystal: 0, deuterium: 0 });
  const fmtTime = (ms) => { try { return OGX.fmt.time(ms); } catch (e) { return String(ms); } };
  function rec(event, what, data) {
    try { OGX.log.rec('B', NAME + ':' + event, String(what || event).slice(0, 300), data); } catch (e) { /* journal off */ }
  }
  function errText(e) { return e && e.message ? e.message : String(e); }

  // ------------------------------------------------------------------ utilities (C2.8)
  bot.version = VERSION;
  bot.rand = function (min, max) {
    min = +min; max = +max;
    if (!(max >= min)) [min, max] = [max, min];
    if (Number.isInteger(min) && Number.isInteger(max)) return min + Math.floor(Math.random() * (max - min + 1));
    return min + Math.random() * (max - min);
  };
  bot.randMs = (range) => (Array.isArray(range) ? Math.round(bot.rand(Math.round(+range[0] || 0), Math.round(+range[1] || 0))) : Math.round(+range || 0));
  bot.INTERVALS = { tiny: [500, 1000], short: [1000, 5000], s15: [5000, 15000], s50: [20000, 50000], s140: [40000, 140000],
    m6: [240000, 360000], m12: [540000, 720000], m16: [840000, 960000], m35: [1500000, 2100000], hour: [3000000, 4200000] };
  bot.msu = function (res, { rateC, rateD } = {}) {
    const c = Number.isFinite(+rateC) ? +rateC : (+core('rateC') || 1.5);
    const d = Number.isFinite(+rateD) ? +rateD : (+core('rateD') || 3);
    const r = res || {};
    return (+r.metal || 0) + (+r.crystal || 0) * c + (+r.deuterium || 0) * d;
  };
  bot.coordsKey = function (t) {
    if (!t) return null;
    if (typeof t === 'string') { const a = OGX.util.coordsArr(t); return a ? a.join(':') + ':1' : null; }
    return [+t.galaxy, +t.system, +(t.position !== undefined ? t.position : t.planet), +(t.type || 1)].join(':');
  };
  let shipStatsCache = null;
  let serverCache = null;
  let factorsCache = null;
  async function refreshCalcCaches() {
    try { shipStatsCache = await OGX.state.shipStats(); } catch (e) { /* keep */ }
    try { serverCache = await OGX.state.server(); } catch (e) { /* keep */ }
    try { factorsCache = OGX.state.factors ? await OGX.state.factors() : null; } catch (e) { /* keep */ }
  }
  bot.flightTime = function ({ from, to, ships, speed = 10, data } = {}) {
    const fg = OGX.fleet && OGX.fleet.gz;
    const f = typeof from === 'string' ? from : from ? [from.galaxy, from.system, from.position !== undefined ? from.position : from.planet].join(':') : null;
    const t = typeof to === 'string' ? to : to ? [to.galaxy, to.system, to.position !== undefined ? to.position : to.planet].join(':') : null;
    const distance = fg.distance(f, t);
    if (distance === null) return { duration: Infinity, fuel: 0, distance: null };
    const d = data || fg.dataFor(ships, shipStatsCache || {}, serverCache || { fleetSpeed: 7 }, factorsCache);
    const duration = fg.duration(d, distance, speed);
    const fuel = Number.isFinite(duration) ? fg.consumption(d, distance, duration) : 0;
    return { duration, fuel, distance };
  };

  // ------------------------------------------------------------------ runtime state (one per tab)
  const R = {
    inited: false, ctx: null, tab: null,
    leader: false, lock: null, leaderTab: null,
    state: 'off', pauseReason: null, stopReason: null,
    sleepUntil: null, backoffUntil: null, consecutiveErrors: 0, startPauseUntil: 0,
    queue: [], pending: new Map(), running: null,
    limits: { actions: [], fleetSends: [], builds: [], galaxyViews: [] }, limitJournaled: {}, limitHit: {},
    workers: new Map(), workerRunning: null,
    timers: new Map(), timerFns: new Map(), timerHandlers: new Map(),
    threats: {}, locked: {},
    battles: {}, needs: {}, reservations: [], intel: {},
    slots: null, rtt: [], lastReqEnd: 0, lastCp: null, drainTimer: null,
    userBusy: null, stopped: null, paused: null, storedStatus: null, autoLogin: null, actReq: null,
    statusFns: new Set(), sections: new Map(),
    recent: [], lines: [], lastWantSeen: null,
    sleepPlan: {}, asleep: false, returns: new Map(),
    flights: [], flightsT: 0,              // sync mirror of OGX.flights.cached() (core cache is async) for wctx.flights()
    claims: {},                            // '<mission>:<g:s:p:type>' -> { module, action, until } (C8 integration: one sender per target)
    bodyKeys: null,                        // last known body key set (bot:bodies-changed)
    holds: [],                             // slot holds [{ id, module, until, label }]
    readCache: new Map(),                  // read cache key -> { t, r (clean result), bodyId, type } (identical reads within readCacheSec)
    joins: new Map(),                      // action id -> [resolve] of identical reads that wait for that queued/running read
    eff: { reads: [], hits: [], builds: [], sends: [] },   // last-hour timestamps for the panel efficiency line
  };
  let resolveReady;
  const readyPromise = new Promise((r) => { resolveReady = r; });
  Object.defineProperty(bot, 'ready', {
    configurable: true,
    get() {
      // botcore switched off (account or popup): the other bot modules must not wait forever in init
      if (!R.inited && typeof OGX._moduleOn === 'function' && !OGX._moduleOn(NAME)) return Promise.resolve();
      return readyPromise;
    },
  });

  // ------------------------------------------------------------------ clock: dedicated Worker (Blob URL) + fallback
  const WORKER_SRC = 'var t={};onmessage=function(e){var d=e.data;if(d==="ping"){postMessage("pong");return;}' +
    'if(d.op==="set"){clearTimeout(t[d.id]);t[d.id]=setTimeout(function(){delete t[d.id];postMessage(d.id);},Math.max(0,d.ms));}' +
    'else if(d.op==="clear"){clearTimeout(t[d.id]);delete t[d.id];}};';
  const clock = {
    mode: 'timeout', degraded: false, w: null, seq: 0, cbs: new Map(), pong: false,
    init() {
      try {
        const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
        const w = new Worker(url);
        w.onmessage = (ev) => {
          if (ev.data === 'pong') { clock.pong = true; return; }
          const cb = clock.cbs.get(ev.data);
          if (cb) { clock.cbs.delete(ev.data); OGX.safe(cb.fn, 'botcore:clock')(); }
        };
        w.onerror = () => clock.fallback('worker error');
        clock.w = w; clock.mode = 'worker'; clock.degraded = false;
        w.postMessage('ping');
        setTimeout(() => { if (!clock.pong) clock.fallback('worker did not answer'); }, 4000);
      } catch (e) { clock.fallback(errText(e)); }
    },
    fallback(why) {
      if (clock.mode === 'timeout' && clock.degraded) return;
      try { if (clock.w) clock.w.terminate(); } catch (e) { /* ignore */ }
      clock.w = null; clock.mode = 'timeout'; clock.degraded = true;
      for (const [id, cb] of clock.cbs) { cb.h = setTimeout(() => { if (clock.cbs.delete(id)) OGX.safe(cb.fn, 'botcore:clock')(); }, Math.max(0, cb.due - Date.now())); }
      rec('timer-degraded', 'Таймер в фоне неточен: Worker недоступен (' + why + ')', { why });
      publishStatus();
    },
    after(ms, fn) {
      const id = ++clock.seq;
      const cb = { fn, due: Date.now() + Math.max(0, ms) };
      clock.cbs.set(id, cb);
      if (clock.w) clock.w.postMessage({ op: 'set', id, ms: Math.max(0, ms) });
      else cb.h = setTimeout(() => { if (clock.cbs.delete(id)) OGX.safe(fn, 'botcore:clock')(); }, Math.max(0, ms));
      return id;
    },
    cancel(id) {
      const cb = clock.cbs.get(id);
      if (!cb) return;
      clock.cbs.delete(id);
      if (clock.w) clock.w.postMessage({ op: 'clear', id });
      if (cb.h) clearTimeout(cb.h);
    },
    /** fn at local epoch ms `target` with spin-wait accuracy: coarse timer to target-1500, then MessageChannel spin. */
    precise(target, fn) {
      let cancelled = false; let coarse = null;
      const spin = () => {
        if (cancelled) return;
        if (Date.now() >= target) { fn(); return; }
        const ch = new MessageChannel();
        ch.port1.onmessage = () => { ch.port1.close(); spin(); };
        if (target - Date.now() > 30) setTimeout(spin, Math.min(20, target - Date.now() - 10)); else ch.port2.postMessage(0);
      };
      const lead = target - Date.now();
      if (lead > 1500) coarse = clock.after(lead - 1500, spin); else spin();
      return { cancel() { cancelled = true; if (coarse) clock.cancel(coarse); } };
    },
  };
  const toLocal = (serverMs) => Date.now() + (serverMs - now());

  // ------------------------------------------------------------------ sub-second server clock (precise sends, C3.4)
  // OGX.time knows the server clock only to the whole second (serverTime of the page, floored by PHP time()) and late by the
  // transfer: a step 3 aimed at a second boundary may then be processed up to ~1 s late. Every page the executor fetches
  // bounds the offset: its server second S was rendered between our send and our receipt, so
  //   S*1000 - tRecv <= offset < S*1000 + 1000 - tSend.
  // The intersection of recent samples gives the offset to a few tens of ms; precise steps fire on it.
  const CLK = { samples: [] };
  function serverSecondOf(doc) {
    try {
      const st = OGX.parse.gz.serverTime(doc);
      if (st && +st.renderUnix > 1e9) return +st.renderUnix * 1000;
      if (!st || !st.wall) return null;   // tzOffsetMs may be the 15-min guess: a wrong guess is dropped by the 5 s check below
      const m = /^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)$/.exec(st.wall);
      if (!m) return null;
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - (+OGX.time.tzOffsetMs || 0);
    } catch (e) { return null; }
  }
  function clockSample(doc, tSend, tRecv) {
    const S = serverSecondOf(doc);
    if (S === null || !(tRecv >= tSend)) return;
    const coarse = now() - Date.now();
    const lo = S - tRecv; const hi = S + 1000 - tSend;
    if (Math.abs(lo - coarse) > 5000) return;   // a cached/foreign page: ignore
    CLK.samples.push({ lo, hi, t: tRecv });
    const cut = Date.now() - 20 * 60000;
    CLK.samples = CLK.samples.filter((x) => x.t >= cut).slice(-30);
  }
  /** { off, width } of the refined offset (serverMs - Date.now()) or null when unknown / the samples disagree. */
  function preciseClock() {
    let lo = -Infinity; let hi = Infinity;
    for (const x of CLK.samples) { lo = Math.max(lo, x.lo); hi = Math.min(hi, x.hi); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (lo > hi) {   // clock jump or drift: keep the newest samples only
      CLK.samples = CLK.samples.slice(-3);
      return null;
    }
    return { off: (lo + hi) / 2, width: hi - lo, n: CLK.samples.length };
  }
  const pNow = () => { const c = preciseClock(); return c ? Date.now() + c.off : now(); };
  const pToLocal = (serverMs) => { const c = preciseClock(); return c ? serverMs - c.off : toLocal(serverMs); };

  // ------------------------------------------------------------------ settings accessors (C2.2)
  bot.cfg = function (key) {
    const k = String(key || '');
    return sget(k.includes('.') ? k : 'botcore.' + k);
  };
  bot.isDryRun = () => core('dryRun') !== false;
  function moduleEnabled(m) { try { return OGX._moduleOn ? OGX._moduleOn(m) !== false : sget(m + '.enabled') !== false; } catch (e) { return true; } }
  bot.isActive = function (module) {
    if (!module) return false;
    if (core('master') !== true) return false;
    if (R.stopped) return false;
    if (module === NAME) return true;
    return sget(module + '.on') === true && sget(module + '.enabled') !== false && moduleEnabled(module);
  };
  /** true when the entry's own module was switched off (master + module on is required for every action of a module). */
  function moduleOff(e) { return !!(e && e.module && e.module !== NAME && !bot.isActive(e.module)); }
  const MODULE_OFF = (e) => ({ ok: false, dry: false, refused: 'stopped', message: 'модуль ' + e.module + ' выключен — не отправлено', verified: false, ms: 0, at: now(), noBackoff: true });

  // ------------------------------------------------------------------ status (C2.1)
  function limitsSnapshot() {
    const t = now();
    const out = {};
    for (const [k, sk] of Object.entries(LIMIT_KEYS)) out[k] = { used: (R.limits[k] || []).filter((x) => x > t - HOUR).length, max: +core(sk) || 0 };
    return out;
  }
  function computeState() {
    if (R.stopped) return 'stopped';
    if (core('master') !== true) return 'off';
    if (R.paused) return 'paused';
    if (R.asleep) return 'sleeping';
    if (R.running || R.workerRunning) return 'running';
    return 'idle';
  }
  function localStatus() {
    const st = computeState();
    return {
      master: core('master') === true, dryRun: bot.isDryRun(),
      leader: R.leader, leaderTab: R.leader ? R.tab : (R.storedStatus && R.storedStatus.leaderTab) || null,
      state: st, pauseReason: R.paused ? R.paused.reason : (st === 'idle' || st === 'running') && limitsHit().length ? 'limit' : null,
      limitsHit: limitsHit(),
      stopReason: R.stopped ? R.stopped.reason : (R.lastStop || null),
      sleepUntil: R.asleep ? R.sleepUntil : null, backoffUntil: R.backoffUntil && R.backoffUntil > now() ? R.backoffUntil : null,
      consecutiveErrors: R.consecutiveErrors,
      queue: R.queue.map((e) => ({ id: e.id, type: e.type, module: e.module, prio: e.prio, at: e.precise ? e.precise.at : (e.at || null), state: e.state })),
      limits: limitsSnapshot(),
      efficiency: effSnapshot(),
      workers: [...R.workers.values()].map((w) => ({ id: w.def.id, on: bot.isActive(w.def.module), nextAt: w.nextAt || null, lastRun: w.lastRun || null, lastResult: w.lastResult || null })),
      timer: { mode: clock.mode, degraded: clock.degraded },
      t: now(),
    };
  }
  bot.status = function () {
    if (R.leader || !R.inited) return localStatus();
    const s = R.storedStatus;
    const fresh = s && s.leader && s.t && now() - s.t < 30000 && core('master') === true;
    if (!fresh) {
      const l = localStatus();
      l.leaderTab = null;
      return l;
    }
    const out = clone(s);
    out.master = core('master') === true;
    out.dryRun = bot.isDryRun();
    out.leader = false;
    if (R.stopped) { out.state = 'stopped'; out.stopReason = R.stopped.reason; }
    else if (!out.master) out.state = 'off';
    else if (R.paused) { out.state = 'paused'; out.pauseReason = R.paused.reason; }
    out.timer = out.timer || { mode: clock.mode, degraded: clock.degraded };
    return out;
  };
  bot.onStatus = function (fn) {
    if (typeof fn !== 'function') return () => {};
    const f = OGX.safe(fn, 'bot:onStatus');
    R.statusFns.add(f);
    return () => R.statusFns.delete(f);
  };
  let statusTimer = null;
  let lastStateLogged = null;
  function publishStatus() {
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      const st = bot.status();
      if (st.state !== lastStateLogged) {
        // idle <-> running flips on every worker run: not journaled (noise); every other change is
        const busyFlip = (lastStateLogged === 'idle' && st.state === 'running') || (lastStateLogged === 'running' && st.state === 'idle');
        if (lastStateLogged !== null && !busyFlip && (R.leader || !R.inited || st.state === 'off' || st.state === 'stopped')) {
          rec('state', 'Состояние бота: ' + stateRu(st.state), { from: lastStateLogged, to: st.state, pauseReason: st.pauseReason, stopReason: st.stopReason });
        }
        lastStateLogged = st.state;
      }
      if (R.leader && R.inited) store.set('status', st);
      for (const f of R.statusFns) f(st);
      try { OGX.bus.emit('bot:status', st); } catch (e) { /* ignore */ }
    }, 150);
  }
  function stateRu(s) {
    return { off: 'выключен', idle: 'ожидает', running: 'работает', sleeping: 'спит', paused: 'пауза', stopped: 'остановлен' }[s] || s;
  }
  bot._stateRu = stateRu;

  // ------------------------------------------------------------------ start / stop / pause / resume (C2.1)
  bot.start = async function () {
    await readyPromise;
    R.lastStop = null;
    if (R.stopped) { R.stopped = null; await store.set('stopped', null); }
    if (R.paused) { R.paused = null; await store.set('paused', null); }
    R.consecutiveErrors = 0; R.backoffUntil = null;
    await OGX.settings.set('botcore.master', true);
    rec('start', 'Бот запущен' + (bot.isDryRun() ? ' (пробный режим)' : ''), { dryRun: bot.isDryRun() });
    onMasterChange();
    publishStatus();
  };
  bot.stop = async function (reason = 'manual') {
    await readyPromise;
    R.lastStop = reason;
    await OGX.settings.set('botcore.master', false);
    cancelQueued('stopped', 'Бот остановлен');
    rec('stop', 'Бот остановлен (' + reason + ')', { reason });
    onMasterChange();
    publishStatus();
  };
  bot.pause = async function (reason = 'user') {
    await readyPromise;
    R.paused = { reason, t: now() };
    await store.set('paused', R.paused);
    rec('pause', 'Пауза: ' + pauseRu(reason), { reason });
    gatePrecise('pause');
    publishStatus();
  };
  bot.resume = async function () {
    await readyPromise;
    const was = R.paused;
    R.paused = null;
    R.consecutiveErrors = 0; R.backoffUntil = null;
    await store.set('paused', null);
    rec('resume', 'Бот продолжает работу', { was: was && was.reason });
    restartWorkers('resume');
    kick(0);
    publishStatus();
  };
  function pauseRu(r) { return { user: 'по команде', errors: 'много ошибок подряд', limit: 'лимит', threat: 'угроза', userActive: 'пользователь в игре', logout: 'вылет из игры, ждёт автовход', scan: 'скан страниц' }[r] || r; }

  // ------------------------------------------------------------------ «Автовход» (botcore.autoLogin)
  const alGet = async () => { try { return (await OGX.storage.get(AUTOLOGIN_KEY, null, { scope: 'global' })) || {}; } catch (e) { return {}; } };
  const alUpdate = (fn) => { try { return OGX.storage.update(AUTOLOGIN_KEY, (v) => Object.assign({}, v || {}, fn(v || {})), null, { scope: 'global' }); } catch (e) { return Promise.resolve(null); } };
  bot.autoLoginInfo = () => (R.autoLogin ? clone(R.autoLogin) : null);
  /** The login page of this universe: the logout redirect when it is ours (index.php?code=3), else <universe>/index.php. */
  function loginUrlFrom(url) {
    try {
      const u = new URL(String(url || ''), location.href);
      if (u.origin === location.origin && /\/index\.php$/i.test(u.pathname)) return u.href;
    } catch (e) { /* fall through */ }
    return location.origin + location.pathname.replace(/[^/]*$/, 'index.php');
  }
  /** Logout seen with botcore.autoLogin on: pause (master stays on), remember the login page, open it in the leader tab.
   *  The content part at the end of this file presses «Вход» there; init() on the next logged-in game page resumes. */
  async function logoutPause(data) {
    if (R.paused && R.paused.reason === 'logout') return;
    const rec0 = await alGet();
    if (rec0.userLogout && Date.now() - rec0.userLogout < AUTOLOGIN_USER_LOGOUT_MS) {
      rec('autologin', 'Автовход: вы вышли из игры сами — бот не входит обратно', { reason: 'userLogout' });
      return hardStop('logout', 'выход из игры (сессия завершена)', data);
    }
    const text = 'вылет из игры: пауза, автовход';
    R.paused = { reason: 'logout', t: now(), resumeAfterLogin: true };
    rec('logout', 'Выход из игры (сессия завершена): включён автовход — пауза до повторного входа', Object.assign({ reason: 'logout', autoLogin: true }, data || {}));
    cancelQueued('stopped', text);
    try { await store.set('paused', R.paused); } catch (e) { /* ignore */ }
    gatePrecise('pause');
    rec('pause', 'Пауза: ' + pauseRu('logout'), { reason: 'logout', resumeAfterLogin: true });
    const url = loginUrlFrom(data && data.url);
    await alUpdate(() => ({ pending: { t: Date.now(), host: location.host, url }, gaveUp: null, last: { t: Date.now(), text: 'Вылет из игры — открываю страницу входа' } }));
    try { await OGX.storage.flush(); } catch (e) { /* ignore */ }
    bot.notify('Вылет из игры: бот на паузе, автовход нажмёт «Вход»', { level: 'warn' });
    publishStatus();
    if (R.leader) setTimeout(() => { try { location.assign(url); } catch (e) { /* ignore */ } }, 1500);
  }
  /** init() on a logged-in game page: the pause 'logout' ends here (master was never switched off). */
  async function resumeAfterLogin() {
    const al = await alGet();
    const hour = (al.attempts || []).filter((t) => Date.now() - t < HOUR).length;
    // the record first: the bot is not shown as running again while the pending login is still stored
    await alUpdate(() => ({ pending: null, gaveUp: null, last: { t: Date.now(), text: 'Вход выполнен, бот продолжает работу' } }));
    try { await OGX.storage.flush(); } catch (e) { /* ignore */ }
    R.paused = null;
    R.consecutiveErrors = 0; R.backoffUntil = null;
    try { await store.set('paused', null); } catch (e) { /* ignore */ }
    rec('autologin', 'Автовход: вход выполнен — бот продолжает работу', { attemptsLastHour: hour });
    rec('resume', 'Бот продолжает работу после повторного входа', { was: 'logout' });
  }

  /** Automatic stop (C3.6): state stopped, queue cancelled, master off, alarm. The user presses «Старт» again. */
  async function hardStop(reason, text, data) {
    if (R.stopped && R.stopped.reason === reason) return;
    R.stopped = { reason, t: now(), text };
    rec(reason === 'unknownPage' ? 'unknown-page' : reason, text, Object.assign({ reason }, data || {}));
    cancelQueued('stopped', text);
    try { await store.set('stopped', R.stopped); } catch (e) { /* ignore */ }
    try { await OGX.settings.set('botcore.master', false); } catch (e) { /* ignore */ }
    rec('stop', 'Бот остановлен: ' + text, { reason });
    bot.notify('Бот остановлен: ' + text, { level: 'alarm', sound: true });
    onMasterChange();
    publishStatus();
  }

  // ------------------------------------------------------------------ notify (toast in every game tab + title flash + beep)
  let flashTimer = null;
  const shownNotices = [];
  function showNotice(n) {
    if (!n || !n.text) return;
    if (n.id) { if (shownNotices.includes(n.id)) return; shownNotices.push(n.id); if (shownNotices.length > 30) shownNotices.shift(); }
    try { OGX.dom.toast(n.text, { type: n.level === 'alarm' ? 'error' : n.level === 'warn' ? 'warn' : 'info', ms: n.level === 'alarm' ? 15000 : 6000 }); } catch (e) { /* ignore */ }
    if (n.level === 'alarm' || n.level === 'warn') {
      const orig = document.title.replace(/^⚠ (Бот|Bot): /, '');
      let i = 0;
      if (flashTimer) clearInterval(flashTimer);
      flashTimer = setInterval(() => {
        i++;
        document.title = i % 2 ? '⚠ Бот: ' + n.text.slice(0, 60) : orig;
        if (i >= 12) { clearInterval(flashTimer); flashTimer = null; document.title = orig; }
      }, 1000);
    }
    if (n.sound && core('notifySound') !== false && n.level === 'alarm') beep();
  }
  function beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      const o = ac.createOscillator(); const g = ac.createGain();
      o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.05;
      o.connect(g); g.connect(ac.destination);
      o.start(); setTimeout(() => { try { o.stop(); ac.close(); } catch (e) { /* ignore */ } }, 400);
    } catch (e) { /* autoplay policy */ }
  }
  bot.notify = function (textRu, { level = 'info', sound = false } = {}) {
    const n = { id: (OGX.util && OGX.util.uid) ? OGX.util.uid() : String(Math.random()), text: String(textRu || ''), level, sound: !!sound, t: now(), tab: R.tab };
    showNotice(n);
    if (R.inited) store.set('notify', n);
  };

  // ------------------------------------------------------------------ panel hooks (C2.8)
  bot.panelSection = function (module, render) {
    if (!module || typeof render !== 'function') return;
    R.sections.set(module, render);
    try { OGX.bus.emit('bot:panel-section', { module }); } catch (e) { /* ignore */ }
  };
  bot._panelSection = (module) => R.sections.get(module) || null;
  bot._panelSections = () => [...R.sections.keys()];
  if (typeof bot.renderOverview !== 'function') {
    // replaced by botpanel at load time; kept as a fallback when botpanel is switched off
    bot.renderOverview = function (container) {
      const st = bot.status();
      const p = document.createElement('div');
      p.className = 'ogx-bot-fallback';
      p.textContent = 'Бот: ' + stateRu(st.state) + (st.dryRun ? ' (пробный режим)' : '') + '. Модуль «Бот: панель» выключен.';
      container.appendChild(p);
    };
  }
  /** Last executed actions (persisted by the leader, readable in every tab) and module log lines. */
  bot.recentActions = (n = 10) => R.recent.slice(-n).reverse();
  bot.recentLines = (n = 50) => R.lines.slice(-n).reverse();

  // ------------------------------------------------------------------ registries (C2.7)
  function persist(key, val) { if (R.inited) store.set(key, val); }
  bot.battles = {
    put(b) {
      if (!b || !b.id) return;
      const v = Object.assign({}, clone(b), { updated: now() });
      R.battles[v.id] = v;
      persist('battles', R.battles);
      try { OGX.bus.emit('bot:battle-planned', clone(v)); } catch (e) { /* ignore */ }
    },
    remove(id, reason = 'removed') {
      if (!R.battles[id]) return;
      delete R.battles[id];
      persist('battles', R.battles);
      try { OGX.bus.emit('bot:battle-cancelled', { id, reason }); } catch (e) { /* ignore */ }
    },
    list: () => Object.values(R.battles).map(clone).sort((a, b) => a.arrival - b.arrival),
    get: (id) => clone(R.battles[id]) || null,
  };
  bot.needs = {
    set(owner, list) {
      R.needs[owner] = clone(Array.isArray(list) ? list : []).map((n) => Object.assign({ owner }, n));
      persist('needs', R.needs);
      try { OGX.bus.emit('bot:needs', { owner, needs: clone(R.needs[owner]) }); } catch (e) { /* ignore */ }
    },
    list: () => Object.values(R.needs).flat().map(clone),
  };
  function liveReservations() { const t = now(); return R.reservations.filter((r) => r.until > t); }
  bot.reservations = { list: () => clone(liveReservations()) };

  // target claims (integration): one module per (mission, target) while a fleet is queued for or flying to it, so two modules
  // never attack/recycle/colonize the same coordinates. Checked by the executor right before step 0 (sends are serialized, so the
  // check cannot race); prio 'defense' sends are never refused but still claim (a save that harvests a field keeps botdebris off it).
  const CLAIM_MISSIONS = new Set([1, 2, 7, 8, 9]);
  function claimKey(e) {
    const p = e.params || {};
    const m = +p.mission;
    if (e.type !== 'fleet.send' || !CLAIM_MISSIONS.has(m)) return null;
    const t = target(p);
    if (!(t.galaxy > 0 && t.system > 0 && t.position > 0)) return null;
    return m + ':' + bot.coordsKey(t);
  }
  function liveClaims() {
    const t = now();
    for (const [k, c] of Object.entries(R.claims)) if (!(c.until > t)) delete R.claims[k];
    return R.claims;
  }
  function claimCheck(e) {
    const k = claimKey(e);
    if (!k) return null;
    const c = liveClaims()[k];
    // an 'uncertain' claim (lost step-3 answer, maybe sent) blocks the same module too: no blind second fleet to that target
    if (c && (c.module !== e.module || c.state === 'uncertain') && c.action !== e.id && e.prio !== 'defense') {
      return { refused: 'duplicate', message: 'цель ' + k.slice(k.indexOf(':') + 1) + ' уже занята: ' + c.module + (c.state === 'uncertain' ? ' (результат прошлой отправки неизвестен)' : c.fleetId ? ' (флот ' + c.fleetId + ')' : ' (в очереди)'), data: { claim: clone(c) } };
    }
    // a live claim (own module's earlier fleet, or another module's when a defense send passes) is kept as it is
    if (!c) {
      R.claims[k] = { key: k, module: e.module, action: e.id, fleetId: null, until: now() + 2 * HOUR, state: 'pending' };
      persist('claims', R.claims);
    }
    return null;
  }
  function claimFinish(e, r) {
    const k = claimKey(e);
    if (!k) return;
    const c = R.claims[k];
    if (!c || c.action !== e.id) return;
    if (r && r.ok && !r.dry) {
      const arr = r.data && +r.data.arrival > 0 ? +r.data.arrival : now() + HOUR;
      Object.assign(c, { fleetId: r.data && r.data.fleetId != null ? r.data.fleetId : null, until: arr + 120000, state: 'flying' });
    } else if (r && r.error === 'uncertain') {
      // the send may have left (lost step-3 answer): keep the target claimed so no module sends a second fleet there
      Object.assign(c, { until: now() + HOUR, state: 'uncertain' });
    } else delete R.claims[k];
    persist('claims', R.claims);
  }
  function claimRecalled(fleetId) {
    let any = false;
    for (const [k, c] of Object.entries(R.claims)) if (c.fleetId != null && +c.fleetId === +fleetId) { delete R.claims[k]; any = true; }
    if (any) persist('claims', R.claims);
  }
  /** Live target claims: [{ key: '<mission>:<g:s:p:type>', module, action, fleetId, until, state }] (additive API). */
  bot.claims = () => Object.values(clone(liveClaims()));
  bot.intel = {
    put(coordsKey, intel) {
      if (!coordsKey || !intel) return;
      R.intel[coordsKey] = Object.assign({}, clone(intel), { coordsKey, _seen: now() });
      const keys = Object.keys(R.intel);
      if (keys.length > 2000) {
        keys.sort((a, b) => (R.intel[a]._seen || 0) - (R.intel[b]._seen || 0));
        for (const k of keys.slice(0, keys.length - 2000)) delete R.intel[k];
      }
      persist('intel', R.intel);
    },
    get: (k) => { const v = R.intel[k]; if (!v) return null; const o = clone(v); delete o._seen; return o; },
    list: () => Object.values(R.intel).map((v) => { const o = clone(v); delete o._seen; return o; }),
  };

  // ------------------------------------------------------------------ bodies helpers
  let bodiesCache = {};
  async function refreshBodies() { try { bodiesCache = (await OGX.state.bodies()) || {}; } catch (e) { /* keep */ } return bodiesCache; }
  function bodyById(id) {
    for (const b of Object.values(bodiesCache)) if (+b.id === +id) return b;
    return null;
  }
  function bodyKeyOf(id) { const b = bodyById(id); return b ? b.key : (id ? 'p' + id : null); }
  function bodyAt(coords, type = 1) {
    for (const b of Object.values(bodiesCache)) {
      if (b.coords !== coords) continue;
      const isMoon = b.type === 'moon' || /^m/.test(b.key || '');
      if ((type === 3) === isMoon) return b;
    }
    return null;
  }
  function currentBodyId() { try { const c = OGX.state.current(); return c && c.id ? +c.id : null; } catch (e) { return null; } }

  // ------------------------------------------------------------------ threats (C2.6)
  function shipsFromText(t) {
    if (!t) return { ships: null, units: null };
    const ships = {}; let units = 0; let any = false;
    for (const part of String(t).replace(/^\(|\)$/g, '').split(';')) {
      const m = /^\s*([\d.]+)\s+(.+?)\s*$/.exec(part);
      if (!m) continue;
      const n = +m[1].replace(/\./g, '');
      units += n;
      const id = OGX.catalog.idFromTitle(m[2]);
      if (id) { ships[id] = (ships[id] || 0) + n; any = true; }
    }
    return { ships: any ? ships : null, units: units || null };
  }
  function threatFromEvent(e) {
    if (!e || e.own || !e.hostile || e.status !== 'flight') return null;
    const arrival = e.endUnix * 1000;
    const to = e.to || null;
    const moon = /\b(moon|луна|mond)\b/i.test(e.text || '');
    const toType = moon ? 3 : 1;
    const body = to ? bodyAt(to, toType) || (moon ? null : bodyAt(to, 1)) : null;
    const sh = shipsFromText(e.shipsText);
    // full player name (names may contain spaces: 'Jon Snow'): up to the PM link text or the next 'from'/'с'/coords [UPSTREAM cff_*]
    const txt = String(e.text || '').replace(/\s+/g, ' ');
    const nameM = /(?:player|игрок[а]?|Spieler) (.+?)(?: PM\b| from\b| von\b| с\b| \(| \[)/i.exec(txt) || /(?:player|игрок[а]?|Spieler)\s+([^\s(]+)/i.exec(txt);
    return {
      key: (e.fleetId !== null ? e.fleetId : e.key) + ':' + e.endUnix, fleetId: e.fleetId, mission: e.mission, arrival,
      from: e.from || null, to, bodyKey: body ? body.key : null, toType, ownerId: e.ownerId || null, ownerName: nameM ? nameM[1] : null,
      ships: sh.ships, units: sh.units, probesOnly: e.mission === 6 || !!(sh.ships && Object.keys(sh.ships).every((id) => +id === 210)),
    };
  }
  function threatFromFlight(f) {
    if (!f || f.own || f.status !== 'hostile' || f.returnFlight) return null;
    const endUnix = Math.round(f.arrival / 1000);
    const ships = f.ships && Object.keys(f.ships).length ? clone(f.ships) : null;
    return {
      key: (f.fleetId !== null && f.fleetId !== undefined ? f.fleetId : f.rowId) + ':' + endUnix, fleetId: f.fleetId != null ? f.fleetId : null,
      mission: f.missionType, arrival: f.arrival, from: f.from || null, to: f.to || null, bodyKey: f.destKey || (f.to ? (bodyAt(f.to, f.toType === 3 ? 3 : 1) || {}).key || null : null),
      toType: f.toType === 3 ? 3 : 1, ownerId: null, ownerName: null, ships, units: f.units || null,
      probesOnly: f.missionType === 6 || !!(ships && Object.keys(ships).every((id) => +id === 210)),
    };
  }
  /** ACS: events of mission 2 with the same target and arrival share the key of the first fleet id. */
  function groupAcs(list) {
    const acs = new Map();
    for (const t of list) {
      if (t.mission !== 2) continue;
      const g = t.to + '|' + t.arrival;
      if (!acs.has(g) || (t.fleetId !== null && t.fleetId < acs.get(g))) acs.set(g, t.fleetId);
    }
    const out = new Map();
    for (const t of list) {
      if (t.mission === 2) {
        const fid = acs.get(t.to + '|' + t.arrival);
        t.key = fid + ':' + Math.round(t.arrival / 1000);
        const have = out.get(t.key);
        if (have) {
          have.units = (have.units || 0) + (t.units || 0) || null;
          if (t.ships) { have.ships = have.ships || {}; for (const [id, n] of Object.entries(t.ships)) have.ships[id] = (have.ships[id] || 0) + n; }
          have.probesOnly = have.probesOnly && t.probesOnly;
          continue;
        }
      }
      out.set(t.key, t);
    }
    return [...out.values()];
  }
  /** Fresh threat list from one full event box (complete list): adds/updates and drops the missing ones. */
  async function updateThreats(found, { complete = true, src = 'page' } = {}) {
    if (!R.inited) return;
    const t = now();
    const list = groupAcs(found.filter(Boolean));
    const prev = R.threats;
    const next = {};
    const added = []; const changed = []; const gone = [];
    for (const th of list) {
      if (th.arrival < t - 60000) continue;
      const old = prev[th.key];
      const v = Object.assign({}, th, { firstSeen: old ? old.firstSeen : t, updated: t, ownerId: th.ownerId || (old && old.ownerId) || null, ownerName: th.ownerName || (old && old.ownerName) || null });
      next[th.key] = v;
      if (!old) added.push(v);
      else if (old.arrival !== v.arrival || old.units !== v.units || old.bodyKey !== v.bodyKey) changed.push(v);
    }
    for (const [k, old] of Object.entries(prev)) {
      if (next[k]) continue;
      if (old.arrival < t - 60000 || complete) gone.push(old);
      else next[k] = old;
    }
    if (!added.length && !changed.length && !gone.length) return;
    R.threats = next;
    await store.set('threats', next);
    for (const th of added) rec('threat', 'Враждебный флот: ' + missionRu(th.mission) + ' на ' + (th.to || '?') + ' в ' + fmtTime(th.arrival), { threat: th, src });
    for (const th of gone) rec('threat-gone', 'Угроза исчезла: ' + (th.to || '?') + ' (' + th.key + ')', { threat: th, src });
    try { OGX.bus.emit('bot:threat', { added: clone(added), changed: clone(changed), gone: clone(gone) }); } catch (e) { /* ignore */ }
    if (added.some((x) => !x.probesOnly && x.mission !== 10)) bot.notify('Враждебный флот летит на ' + (added[0].to || '?') + ' (' + fmtTime(added[0].arrival) + ')', { level: 'alarm', sound: true });
    evalLocks();
    publishStatus();
  }
  function missionRu(m) { try { return OGX.catalog.missionName(m) || ('миссия ' + m); } catch (e) { return 'миссия ' + m; } }
  function threatsFromDoc(doc) {
    try { return OGX.parse.gz.events(doc).map(threatFromEvent).filter(Boolean); } catch (e) { return []; }
  }
  function hasEventBox(doc) { try { return !!doc.querySelector('#messages_collapsed'); } catch (e) { return false; } }
  bot.threats = () => Object.values(R.threats).filter((t) => t.arrival > now() - 60000).map(clone).sort((a, b) => a.arrival - b.arrival);
  function computeLocks() {
    const t = now();
    const sec = Math.max(0, +core('threatLockSec') || 0) * 1000;
    const out = {};
    for (const th of Object.values(R.threats)) {
      if (th.probesOnly || th.mission === 10 || !th.bodyKey) continue;
      if (t >= th.arrival - sec && t <= th.arrival + 60000) {
        if (!out[th.bodyKey] || out[th.bodyKey].arrival > th.arrival) out[th.bodyKey] = th;
      }
    }
    return out;
  }
  function evalLocks() {
    const next = computeLocks();
    const prev = R.locked;
    if (R.leader) {
      for (const [k, th] of Object.entries(next)) if (!prev[k]) rec('lock', 'Тело ' + k + ' заблокировано: удар в ' + fmtTime(th.arrival), { bodyKey: k, threat: th.key, arrival: th.arrival });
      for (const k of Object.keys(prev)) if (!next[k]) rec('unlock', 'Тело ' + k + ' разблокировано', { bodyKey: k });
    }
    R.locked = next;
    gatePrecise('lock');
  }
  bot.lockedBodies = () => { const o = {}; for (const [k, v] of Object.entries(computeLocks())) o[k] = clone(v); return o; };
  function lockedFor(bodyKey) {
    if (!bodyKey) return null;
    const l = computeLocks();
    if (l[bodyKey]) return clone(l[bodyKey]);
    // own fleets returning to a locked-soon body (before arrival + 60 s) are reported by the caller via wctx.locked
    return null;
  }

  // ------------------------------------------------------------------ own fleet returns -> bot:fleet-returned
  let returnTimer = null;
  function trackReturns(list) {
    if (!Array.isArray(list)) return;
    const t = now();
    const seen = new Map();
    for (const f of list) {
      if (!f || !f.own || f.fleetId === null || f.fleetId === undefined) continue;
      // the last leg of a fleet: return leg arrival, or a Deploy outward arrival (no return)
      const end = f.arrival;
      const cur = seen.get(f.fleetId);
      if (!cur || end > cur.at) seen.set(f.fleetId, { fleetId: f.fleetId, mission: f.missionType, bodyKey: f.returnFlight ? f.destKey : (f.missionType === 4 ? f.destKey : f.originKey), at: end });
    }
    // vanished from a fresher list before their time -> returned/landed early (recall) or done
    for (const [id, r] of R.returns) {
      if (!seen.has(id) && r.at > t) { R.returns.delete(id); emitReturned(r, 'vanished'); }
    }
    for (const [id, r] of seen) R.returns.set(id, r);
    armReturnTimer();
  }
  function emitReturned(r, why) {
    noteShipsStale(r.bodyKey);
    try { OGX.bus.emit('bot:fleet-returned', { fleetId: r.fleetId, mission: r.mission, bodyKey: r.bodyKey || null, at: r.at, why }); } catch (e) { /* ignore */ }
  }
  function checkReturns() {
    const t = now();
    for (const [id, r] of R.returns) if (r.at <= t) { R.returns.delete(id); emitReturned(r, 'time'); }
    armReturnTimer();
  }
  function armReturnTimer() {
    if (returnTimer) { clock.cancel(returnTimer); returnTimer = null; }
    let min = Infinity;
    for (const r of R.returns.values()) min = Math.min(min, r.at);   // the minimum end time, never the first row
    if (!Number.isFinite(min)) return;
    returnTimer = clock.after(Math.max(0, min - now()) + 500, () => { returnTimer = null; checkReturns(); });
  }

  /** Sync mirror of the core flight cache ({ t, flights }); an older list never replaces a newer one. */
  function setFlights(c) {
    if (!c || !Array.isArray(c.flights)) return;
    const t = +c.t || 0;
    if (t && R.flightsT && t < R.flightsT) return;
    R.flights = c.flights;
    R.flightsT = t || R.flightsT;
  }
  /** bot:bodies-changed { added, removed } when the planet list gains or loses a body (colony founded, moon created, planet given up). */
  function bodiesChanged() {
    const keys = Object.keys(bodiesCache || {}).sort();
    if (!keys.length) return;
    const prev = R.bodyKeys;
    R.bodyKeys = keys;
    if (!prev) return;
    const added = keys.filter((k) => !prev.includes(k));
    const removed = prev.filter((k) => !keys.includes(k));
    if (!added.length && !removed.length) return;
    rec('state', 'Тела изменились: ' + (added.length ? '+' + added.join(',') : '') + (removed.length ? ' −' + removed.join(',') : ''), { added, removed });
    try { OGX.bus.emit('bot:bodies-changed', { added, removed }); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ ship counts in the state after own sends / returns
  // The fleetTable read of step 0 stores the counts BEFORE the send with a fresh time: take the sent ships off right after step 3,
  // so a module reading OGX.state bodies never plans with ships that just left; a returned fleet makes that body's counts stale.
  function patchBody(key, fn) {
    if (!key) return;
    try {
      OGX.storage.update('bodies', (old) => {
        if (!old || !old[key]) return old;
        const b = Object.assign({}, old[key], { ships: Object.assign({}, old[key].ships || {}) });
        fn(b);
        return Object.assign({}, old, { [key]: b });
      }, {}).then(() => refreshBodies()).catch(() => {});
    } catch (e) { /* ignore */ }
  }
  function noteShipsLeft(bodyId, ships) {
    patchBody(bodyKeyOf(bodyId), (b) => {
      for (const [id, n] of Object.entries(ships || {})) b.ships[id] = Math.max(0, (+b.ships[id] || 0) - (+n || 0));
      b.shipsT = now();
    });
  }
  function noteShipsStale(bodyKey) { patchBody(bodyKey, (b) => { b.shipsT = 0; }); }

  // ------------------------------------------------------------------ slot holds (integration)
  // A module that will need one fleet slot soon (botfarm: the escort probe of a flying attack) holds it; normal sends of OTHER
  // modules count every live hold as a used slot, so they cannot take it. The holder's own sends ignore its holds.
  function liveHolds() { const t = now(); R.holds = (R.holds || []).filter((h) => h.until > t); return R.holds; }
  function heldFor(module) { return liveHolds().filter((h) => h.module !== module).length; }

  // ------------------------------------------------------------------ slots (C2.5)
  function slotsFromFleetTable(ft, src = 'fleetTable') {
    if (!ft || !ft.slots) return null;
    const ex = ft.extraCounters && ft.extraCounters[0];
    return {
      fleet: { used: +ft.slots.used, max: +ft.slots.max },
      expedition: ft.expeditions ? { used: +ft.expeditions.used, max: +ft.expeditions.max } : { used: 0, max: 0 },
      asteroids: ex && Number.isFinite(+ex.used) ? { used: +ex.used, max: +ex.max } : null,
      t: now(), known: true, src,
    };
  }
  function setSlots(s) {
    if (!s) return;
    const old = R.slots;
    R.slots = s;
    if (!old || old.fleet.used !== s.fleet.used || old.fleet.max !== s.fleet.max || (old.expedition || {}).used !== (s.expedition || {}).used) {
      if (R.leader) rec('slots', 'Слоты: флот ' + s.fleet.used + '/' + s.fleet.max + ', экспедиции ' + s.expedition.used + '/' + s.expedition.max, { slots: s });
    }
  }
  function canSendWith(slots, cls, module) {
    const reserve = Math.max(0, +core('slotsReserve') || 0);
    if (!slots || !slots.known) return { ok: false, free: null, reserve, reason: 'unknown' };
    const free = slots.fleet.max - slots.fleet.used;
    const held = module ? heldFor(module) : 0;
    // force ignores the reserve and other modules' holds (defense / user-forced sends)
    if (cls === 'force') return { ok: free > 0, free, reserve, held, reason: free > 0 ? null : 'noSlots' };
    const ok = free - held > reserve;
    return { ok, free, reserve, held, reason: ok ? null : (free > 0 ? (held && free > reserve ? 'held' : 'reserve') : 'noSlots') };
  }

  // ------------------------------------------------------------------ limits (rolling 60 min)
  function limitUsed(k) { const t = now(); R.limits[k] = (R.limits[k] || []).filter((x) => x > t - HOUR); return R.limits[k].length; }
  /** need = how many units the action will count (limits.actions counts every HTTP request: fleet.send = fleetTable + steps
   *  1-3, probe = fleetTable + steps 1-2, ...): refused when used + need > max, so a limit is never overshot. */
  function limitCheck(k, prio, need = 1) {
    const max = +core(LIMIT_KEYS[k]) || 0;
    if (max <= 0) return { ok: false, max, used: limitUsed(k), need };
    if (prio === 'defense' && (k === 'actions' || k === 'fleetSends')) return { ok: true, max, used: limitUsed(k), need };
    const used = limitUsed(k);
    return { ok: used + Math.max(1, need) <= max, max, used, need };
  }
  const REQUESTS_PER_ACTION = { 'fleet.send': 4, 'probe.target': 3, 'messages.delete': 2, 'fleet.recall': 1, 'fleet.ajax': 1 };
  /** + 1 for the cp restore (plain GET page=overview) when the action switches the current body. */
  function requestsOf(e) {
    let cur = null;
    try { cur = currentBodyId(); } catch (x) { cur = null; }
    return (REQUESTS_PER_ACTION[e.type] || 1) + (e.bodyId && cur && +e.bodyId !== +cur ? 1 : 0);
  }
  /** Limits that refused an action and are still used up: shown in the status (pauseReason 'limit') until they reopen. */
  function limitsHit() {
    const out = [];
    for (const [k, at] of Object.entries(R.limitHit || {})) {
      const max = +core(LIMIT_KEYS[k]) || 0;
      // still hit while the limit has no room for the largest action (actions: fleet.send + cp restore = 5 requests)
      const room = k === 'actions' ? 5 : 1;
      if (max <= 0 || !(at > now()) || limitUsed(k) + room <= max) { delete R.limitHit[k]; continue; }
      out.push({ limit: k, used: limitUsed(k), max, reopensAt: at, label: (SETTINGS[LIMIT_KEYS[k]] || {}).label || k });
    }
    return out;
  }
  function limitCount(k) { (R.limits[k] = R.limits[k] || []).push(now()); persistLimits(); }
  let limitsPersistTimer = null;
  function persistLimits() {
    if (limitsPersistTimer) return;
    limitsPersistTimer = setTimeout(() => { limitsPersistTimer = null; if (R.leader) store.set('limits', R.limits); }, 500);
  }
  function limitReopensAt(k) {
    const arr = (R.limits[k] || []).slice().sort((a, b) => a - b);
    return arr.length ? arr[0] + HOUR + 1000 : now() + 60000;
  }
  function journalLimit(k, chk) {
    const t = now();
    if (chk.max > 0) {
      const first = !(R.limitHit && R.limitHit[k] > t);
      R.limitHit = R.limitHit || {};
      R.limitHit[k] = limitReopensAt(k);
      if (first) {
        publishStatus();
        try { bot.notify('Бот: лимит «' + ((SETTINGS[LIMIT_KEYS[k]] || {}).label || k) + '» исчерпан (' + chk.used + '/' + chk.max + '), действия ждут до ' + fmtTime(R.limitHit[k]), { level: 'warn' }); } catch (x) { /* ignore */ }
      }
    }
    if (R.limitJournaled[k] && t - R.limitJournaled[k] < 600000) return;
    R.limitJournaled[k] = t;
    rec('limit', 'Лимит «' + (SETTINGS[LIMIT_KEYS[k]] || {}).label + '» исчерпан: ' + chk.used + '/' + chk.max, { limit: k, used: chk.used, max: chk.max, reopensAt: limitReopensAt(k) });
  }

  // ------------------------------------------------------------------ sleep window (C3.5)
  function parseHM(s) { const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? (+m[1] * 60 + +m[2]) * 60000 : null; }
  function sleepWindows(t) {
    const f = parseHM(core('sleepFrom')); const to = parseHM(core('sleepTo'));
    if (f === null || to === null || f === to) return [];
    const tz = (OGX.time && Number.isFinite(OGX.time.tzOffsetMs)) ? OGX.time.tzOffsetMs : 0;
    const day = Math.floor((t + tz) / 86400000) * 86400000;
    const out = [];
    for (const d of [-1, 0, 1]) {
      const s = day + d * 86400000 + f;
      let e = day + d * 86400000 + to;
      if (e <= s) e += 86400000;
      const key = new Date(s).toISOString().slice(0, 10);
      let j = R.sleepPlan[key];
      if (!j) { j = R.sleepPlan[key] = { a: bot.rand(40000, 140000), b: bot.rand(40000, 140000), postponedUntil: null }; persistSleepPlan(); }
      out.push({ key, from: s - tz + j.a, to: e - tz + j.b, postponedUntil: j.postponedUntil });
    }
    return out;
  }
  function persistSleepPlan() {
    const keys = Object.keys(R.sleepPlan).sort();
    while (keys.length > 4) delete R.sleepPlan[keys.shift()];
    if (R.inited) store.set('sleepPlan', R.sleepPlan);
  }
  function returnsInside(w) {
    let last = null;
    for (const r of R.returns.values()) if (r.at >= w.from && r.at < w.to) last = Math.max(last || 0, r.at);
    return last;
  }
  /** Sleep evaluation in the leader: enter/leave the window, postpone while fleets return inside it. */
  function evalSleep() {
    const t = now();
    if (core('sleepOn') !== true) { if (R.asleep) wakeUp('off'); return; }
    const ws = sleepWindows(t);
    const w = ws.find((x) => t >= x.from && t < x.to);
    if (!w) { if (R.asleep) wakeUp('time'); return; }
    if (R.asleep) return;
    const plan = R.sleepPlan[w.key];
    if (core('sleepPreventIfFleets') !== false && plan && !plan.postponedUntil) {
      const last = returnsInside(w);
      if (last && last > t) {
        plan.postponedUntil = last + bot.rand(20000, 50000);
        persistSleepPlan();
        rec('sleep', 'Сон отложен до возвращения флотов: ' + fmtTime(plan.postponedUntil), { window: w, postponedUntil: plan.postponedUntil });
      }
    }
    if (plan && plan.postponedUntil && t < plan.postponedUntil) return;
    R.asleep = true; R.sleepUntil = w.to;
    rec('sleep', 'Бот спит до ' + fmtTime(w.to), { window: w });
    gatePrecise('sleep');
    publishStatus();
  }
  function wakeUp(why) {
    R.asleep = false; R.sleepUntil = null;
    rec('wake', 'Бот проснулся', { why });
    restartWorkers('wake');
    publishStatus();
  }
  function sleepCheck(returnAt) {
    if (core('sleepOn') !== true) return { ok: true, reason: null };
    if (R.asleep) return { ok: false, reason: 'sleeping' };
    const t = now();
    const next = sleepWindows(t).filter((w) => w.to > t).sort((a, b) => a.from - b.from)[0];
    if (next && Number.isFinite(+returnAt) && returnAt >= next.from && returnAt < next.to) return { ok: false, reason: 'returnsInSleep' };
    return { ok: true, reason: null };
  }

  // ------------------------------------------------------------------ user first (C3.7)
  let userBusyLast = 0;
  function markUserBusy(why, ms) {
    if (!R.inited) return;
    const t = now();
    if (why === 'click' && t - userBusyLast < 2000) return;
    userBusyLast = t;
    const v = { tab: R.tab, until: t + ms, why, t };
    R.userBusy = v;
    store.set('userBusy', v);
  }
  function userIsBusy() {
    const u = R.userBusy;
    if (!u) return false;
    const t = now();
    if (u.why === 'fleetStep') return u.until > t;
    const idle = Math.max(0, +core('userIdleSec') || 0) * 1000;
    return idle > 0 && (u.t || 0) + idle > t && u.until > t - 1;
  }

  // ------------------------------------------------------------------ leader election (C3.2)
  let leading = false;
  async function tryLead(why) {
    if (!R.inited || R.leader || leading || core('master') !== true || R.stopped) return;
    if (document.hidden && core('runHidden') === false) return;
    let lk = null;
    leading = true;
    try { lk = await OGX.storage.lock('bot.leader', LEADER_TTL); } catch (e) { lk = null; } finally { leading = false; }
    if (!lk || R.leader) return;
    if (core('master') !== true || R.stopped) { lk.release().catch(() => {}); return; }
    R.lock = lk; R.leader = true; R.leaderTab = R.tab;
    rec('leader', 'Эта вкладка ведёт бота', { why, tab: R.tab, visible: !document.hidden });
    await becomeLeader();
  }
  async function becomeLeader() {
    // load the shared runtime state of the previous leader
    const [q, timers, limits, st] = await Promise.all([store.get('queue', []), store.get('timers', []), store.get('limits', null), store.get('status', null)]);
    if (limits && typeof limits === 'object') for (const k of Object.keys(LIMIT_KEYS)) R.limits[k] = Array.isArray(limits[k]) ? limits[k] : [];
    if (st && st.consecutiveErrors) { R.consecutiveErrors = +st.consecutiveErrors || 0; R.backoffUntil = st.backoffUntil || null; }
    const mine = new Map(R.queue.map((e) => [e.id, e]));
    for (const e of Array.isArray(q) ? q : []) {
      if (mine.has(e.id)) continue;
      if (e.state === 'running') {
        e.state = 'uncertain';
        rec('action-uncertain', 'Действие могло выполниться при смене вкладки: ' + e.type + ' — проверяю', { action: e.id, type: e.type, module: e.module });
      } else if (e.state === 'pre') e.state = 'queued';
      R.queue.push(e);
    }
    dropModuleOff('leader');
    persistQueue();
    for (const tm of Array.isArray(timers) ? timers : []) if (!R.timers.has(tm.id)) R.timers.set(tm.id, tm);
    for (const tm of R.timers.values()) armTimer(tm);
    R.startPauseUntil = now() + bot.randMs([5000, 15000]);
    restartWorkers('leader');
    evalLocks();
    evalSleep();
    publishStatus();
    kick(0);
  }
  async function loseLead(why) {
    if (!R.leader) return;
    R.leader = false;
    const lk = R.lock; R.lock = null;
    for (const w of R.workers.values()) if (w.timer) { clock.cancel(w.timer); w.timer = null; }
    for (const tm of R.timers.values()) if (tm._h) { tm._h.cancel(); tm._h = null; }
    if (pumpTimer) { clock.cancel(pumpTimer); pumpTimer = null; }
    // the persisted queue stays for the next leader; callers in this tab get 'notLeader'
    for (const e of R.queue) if (e._h) { e._h.cancel(); e._h = null; }
    R.queue = [];
    for (const res of R.pending.values()) res({ ok: false, dry: false, refused: 'notLeader', verified: false, ms: 0, at: now() });
    R.pending.clear();
    for (const list of R.joins.values()) for (const res of list) res({ ok: false, dry: false, refused: 'notLeader', verified: false, ms: 0, at: now() });
    R.joins.clear();
    R.readCache.clear();
    rec('leader-lost', 'Вкладка больше не ведёт бота', { why });
    if (lk) { try { await lk.release(); } catch (e) { /* ignore */ } }
    publishStatus();
  }
  async function leaderTick() {
    if (!R.inited) return;
    const master = core('master') === true && !R.stopped;
    if (!master) { if (R.leader) await loseLead('master off'); return; }
    if (R.leader) {
      let ok = false;
      try { ok = await R.lock.refresh(LEADER_TTL); } catch (e) { ok = false; }
      if (!ok) { R.lock = null; await loseLead('lock lost'); return; }
      // visible-tab preference
      if (document.hidden && !R.running) {
        if (core('runHidden') === false) { await loseLead('hidden'); return; }
        const want = R.lastWantSeen;
        if (want && want.tab !== R.tab && now() - want.t < 10000) { await loseLead('visible tab asked'); return; }
      }
      store.set('status', localStatus());
      evalLocks();
      evalSleep();
      expireQueue();
      kick(0);
    } else {
      if (!document.hidden) store.set('leaderWant', { tab: R.tab, t: now() });
      await tryLead('tick');
    }
  }
  let tickTimer = null;
  function startTicking() {
    if (tickTimer) return;
    const loop = () => { tickTimer = clock.after(TICK_MS, async () => { try { await leaderTick(); } catch (e) { /* keep ticking */ } loop(); }); };
    loop();
  }

  // ------------------------------------------------------------------ workers (C2.3)
  bot.register = function (def) {
    if (!def || !def.id || typeof def.run !== 'function') throw new Error('OGX.bot.register: id and run required');
    const d = Object.assign({ module: String(def.id).split(':')[0], prio: 'fleet', allowDuringSleep: false }, def);
    const old = R.workers.get(d.id);
    if (old) { if (old.timer) clock.cancel(old.timer); for (const off of old.offs) off(); }
    const w = { def: d, nextAt: null, lastRun: null, lastResult: null, timer: null, offs: [], running: false };
    R.workers.set(d.id, w);
    for (const ev of d.wakeOn || []) w.offs.push(OGX.bus.on(ev, () => wakeWorker(w, 'event:' + ev)));
    if (R.inited && R.leader && bot.isActive(d.module)) { w.nextAt = now() + bot.randMs(d.startJitter || DEFAULT_JITTER[d.prio] || [20000, 50000]); armWorker(w); }
    publishStatus();
    return {
      id: d.id,
      wake: (reason, atMs) => wakeWorker(w, reason || 'wake', atMs),
      stop: () => { if (w.timer) clock.cancel(w.timer); for (const off of w.offs) off(); R.workers.delete(d.id); publishStatus(); },
    };
  };
  function wakeWorker(w, reason, atMs) {
    if (!R.workers.has(w.def.id)) return;
    const at = Number.isFinite(+atMs) ? +atMs : now();
    if (w.running) { w.wakeDuring = Math.min(w.wakeDuring || Infinity, at); return; }
    if (!w.nextAt || at < w.nextAt) { w.nextAt = at; w.wakeReason = reason; armWorker(w); publishStatus(); }
  }
  function restartWorkers(why) {
    if (!R.leader) return;
    for (const w of R.workers.values()) {
      if (!bot.isActive(w.def.module)) { if (w.timer) { clock.cancel(w.timer); w.timer = null; } w.nextAt = null; continue; }
      w.nextAt = now() + bot.randMs(w.def.startJitter || DEFAULT_JITTER[w.def.prio] || [20000, 50000]);
      w.wakeReason = why;
      armWorker(w);
    }
    publishStatus();
  }
  function armWorker(w) {
    if (w.timer) { clock.cancel(w.timer); w.timer = null; }
    if (!R.leader || !w.nextAt) return;
    w.timer = clock.after(Math.max(0, w.nextAt - now()), () => { w.timer = null; runWorkerSoon(w); });
  }
  // Workers run concurrently (one run per worker at a time): a worker awaiting its own queued action (e.g. a build held by
  // user-first) must not hold back another module's run (botsave reacting to a threat). Requests stay serialized by the executor.
  function runWorkerSoon(w) {
    if (w.running) { w.wakeDuring = Math.min(w.wakeDuring || Infinity, now()); return; }
    runWorker(w).catch((e) => { try { OGX.log.rec('B', 'botcore:error', 'Ошибка планировщика: ' + errText(e), { error: String(e) }); } catch (x) { /* ignore */ } });
  }
  function workerBlocked(w) {
    if (!R.leader || !R.inited) return 'notLeader';
    if (!bot.isActive(w.def.module)) return 'off';
    if (R.paused) return 'paused';
    if (R.asleep && !w.def.allowDuringSleep) return 'sleeping';
    if (R.backoffUntil && R.backoffUntil > now()) return 'backoff';
    return null;
  }
  async function runWorker(w) {
    const why = workerBlocked(w);
    if (why) {
      if (why === 'backoff') { w.nextAt = R.backoffUntil + bot.randMs([500, 3000]); armWorker(w); }
      else if (why === 'paused' || why === 'sleeping') { w.nextAt = now() + bot.randMs([20000, 50000]); armWorker(w); }
      else w.nextAt = null;
      publishStatus();
      return;
    }
    const runId = w.def.id + '#' + (++runSeq);
    const wctx = makeWctx(w, runId);
    w.running = true; R.workerRunning = (R.workerRunning || 0) + 1;
    publishStatus();
    let out = null; let failed = null;
    try { out = await w.def.run(wctx); } catch (e) { failed = e; }
    w.running = false; R.workerRunning = Math.max(0, (R.workerRunning || 0) - 1) || null;
    w.lastRun = now();
    if (failed) {
      w.lastResult = 'ошибка: ' + errText(failed);
      try { OGX.log.rec('B', w.def.module + ':error', 'Ошибка воркера: ' + errText(failed), { run: runId, error: failed instanceof Error ? failed : String(failed) }); } catch (e) { /* ignore */ }
      registerError('worker ' + w.def.id + ': ' + errText(failed));
      out = { nextInMs: bot.randMs(bot.INTERVALS.m6), reason: 'error' };
    }
    out = out && typeof out === 'object' ? out : {};
    if (!failed) w.lastResult = out.reason || 'ok';
    let next = Number.isFinite(+out.nextAt) ? +out.nextAt : Number.isFinite(+out.nextInMs) ? now() + Math.max(0, +out.nextInMs) : now() + bot.randMs(bot.INTERVALS.m6);
    if (w.wakeDuring && w.wakeDuring < next) next = w.wakeDuring;
    w.wakeDuring = null;
    w.nextAt = Math.max(next, now() + 500);
    w.wakeReason = null;
    armWorker(w);
    publishStatus();
  }
  let runSeq = 0;

  function moduleStore(module) {
    return {
      get: (key, def = null, opts) => OGX.storage.get(module + '.' + key, def, opts),
      set: (key, value, opts) => OGX.storage.set(module + '.' + key, value, opts),
      update: (key, fn, def = null, opts) => OGX.storage.update(module + '.' + key, fn, def, opts),
      remove: (key, opts) => OGX.storage.remove(module + '.' + key, opts),
      subscribe: (key, fn, opts) => OGX.storage.subscribe(module + '.' + key, fn, opts),
    };
  }
  function addLine(module, event, what) {
    R.lines.push({ t: now(), module, event, what: String(what || '').slice(0, 200) });
    if (R.lines.length > 200) R.lines.splice(0, R.lines.length - 200);
    if (R.inited) store.set('lines', R.lines.slice(-200));
  }
  function makeWctx(w, runId) {
    const module = w.def.module;
    const wctx = {
      module, runId, dryRun: bot.isDryRun(),
      now,
      cfg: (key) => sget(module + '.' + key),
      core: (key) => core(key),
      rec(event, what, data) {
        try { OGX.log.rec('B', module + ':' + event, String(what || event).slice(0, 300), Object.assign({ run: runId }, data || {})); } catch (e) { /* ignore */ }
        addLine(module, event, what);
      },
      decide(what, { why, inputs, chosen, alternatives } = {}) { wctx.rec('decision', what, { why, inputs, chosen, alternatives }); },
      act(spec) { return enqueue(Object.assign({}, spec, { module: spec && spec.module ? spec.module : module, run: runId }), w.def); },
      /** Additive: drops this module's queued (or precise, steps 1-2 done) actions with `dedupeKey` that have not started step 3;
       * their act() promise resolves { ok:false, refused:'expired', message:'отменено модулем' }. -> number cancelled */
      cancel(dedupeKey) { return cancelByKey(module, dedupeKey); },
      async slots() {
        if (R.slots && R.slots.known && now() - R.slots.t <= 60000) return clone(R.slots);
        const r = await enqueue({ type: 'read.fleetTable', module, prio: 'read', bodyId: currentBodyId(), params: {}, why: 'Слоты флота', run: runId }, w.def);
        if (r && r.ok && R.slots) return clone(R.slots);
        if (R.slots) return Object.assign(clone(R.slots), { src: 'cache' });
        return { fleet: { used: 0, max: 0 }, expedition: { used: 0, max: 0 }, asteroids: null, t: now(), known: false, src: 'cache' };
      },
      async canSend(cls = 'normal') { return canSendWith(await wctx.slots(), cls, module); },
      /** Additive: hold one fleet slot from now until `until` (ServerMs) against normal sends of other modules. -> id */
      holdSlot({ until, label = '' } = {}) {
        const id = module + ':slot:' + Math.random().toString(36).slice(2, 8);
        liveHolds().push({ id, module, until: Math.min(+until || now() + 600000, now() + 2 * HOUR), label });
        persist('holds', R.holds);
        return id;
      },
      releaseSlot(id) { R.holds = liveHolds().filter((h) => h.id !== id); persist('holds', R.holds); },
      async bodies() {
        const all = await refreshBodies();
        bodiesChanged();
        const t = now();
        const out = {};
        for (const [k, b] of Object.entries(all)) { try { out[k] = OGX.state.projected(b, t); } catch (e) { out[k] = b; } }
        return out;
      },
      flights() { return clone(R.flights) || []; },
      threats: () => bot.threats(),
      locked: (bodyKey) => lockedFor(bodyKey),
      available(bodyKey, { forClass } = {}) {
        const b = bodiesCache[bodyKey];
        const out = res0();
        if (b) {
          let p = b;
          try { p = OGX.state.projected(b, now()); } catch (e) { /* raw */ }
          for (const r of RES) out[r] = Math.max(0, Math.floor((p.res && p.res[r] && +p.res[r].amount) || 0));
        }
        for (const rv of liveReservations()) {
          if (rv.bodyKey !== bodyKey || rv.module === module) continue;
          for (const r of RES) out[r] -= +((rv.res || {})[r]) || 0;
        }
        out.deuterium -= Math.max(0, +core('deutReserve') || 0);
        for (const r of RES) out[r] = Math.max(0, out[r]);
        if (forClass) out.forClass = forClass;
        return out;
      },
      reserve(bodyKey, res, { ttlMs = 3600000, label = '' } = {}) {
        const id = module + ':' + (OGX.util.uid ? OGX.util.uid() : Math.random().toString(36).slice(2));
        R.reservations = liveReservations();
        R.reservations.push({ id, module, bodyKey, res: Object.assign(res0(), clone(res) || {}), until: now() + Math.min(Math.max(1000, +ttlMs || 3600000), 2 * HOUR), label });
        persist('reservations', R.reservations);
        return id;
      },
      release(id) { R.reservations = liveReservations().filter((r) => r.id !== id); persist('reservations', R.reservations); },
      sleepCheck: (returnAt) => sleepCheck(returnAt),
      store: (() => { const c = (OGX._ctxs || []).find((x) => x.def.name === module); return c ? c.ctx.store : moduleStore(module); })(),
    };
    return wctx;
  }

  // ------------------------------------------------------------------ timers (C2.8 at / onTimer)
  bot.onTimer = function (label, fn) {
    if (!label || typeof fn !== 'function') return () => {};
    R.timerHandlers.set(label, fn);
    return () => { if (R.timerHandlers.get(label) === fn) R.timerHandlers.delete(label); };
  };
  bot.at = function (serverMs, fn, { label = null, payload = null } = {}) {
    const id = 't' + (OGX.util && OGX.util.uid ? OGX.util.uid() : Math.random().toString(36).slice(2));
    const tm = { id, label, payload: clone(payload), at: +serverMs };
    if (typeof fn === 'function') R.timerFns.set(id, fn);
    R.timers.set(id, tm);
    persistTimers();
    rec('timer-armed', 'Таймер ' + (label || id) + ' на ' + fmtTime(tm.at), { id, label, at: tm.at });
    if (R.leader) armTimer(tm);
    return { cancel() { const t = R.timers.get(id); if (t && t._h) t._h.cancel(); R.timers.delete(id); R.timerFns.delete(id); persistTimers(); } };
  };
  function persistTimers() { if (R.inited) store.set('timers', [...R.timers.values()].map((t) => ({ id: t.id, label: t.label, payload: t.payload, at: t.at }))); }
  function armTimer(tm) {
    if (tm._h) tm._h.cancel();
    tm._h = clock.precise(toLocal(tm.at), () => fireTimer(tm));
  }
  function fireTimer(tm) {
    tm._h = null;
    if (!R.timers.has(tm.id) || !R.leader) return;
    R.timers.delete(tm.id);
    persistTimers();
    const late = now() - tm.at;
    const payload = Object.assign({}, tm.payload || {});
    if (late > 1000) { payload.lateMs = late; rec('timer-late', 'Таймер ' + (tm.label || tm.id) + ' опоздал на ' + Math.round(late / 1000) + ' с', { id: tm.id, label: tm.label, lateMs: late }); }
    rec('timer-fired', 'Таймер ' + (tm.label || tm.id), { id: tm.id, label: tm.label, at: tm.at, lateMs: Math.max(0, late) });
    const fn = R.timerFns.get(tm.id) || (tm.label && R.timerHandlers.get(tm.label));
    R.timerFns.delete(tm.id);
    if (fn) { try { const r = fn(payload); if (r && r.catch) r.catch((e) => registerError('timer ' + tm.label + ': ' + errText(e))); } catch (e) { registerError('timer ' + tm.label + ': ' + errText(e)); } }
  }

  // ------------------------------------------------------------------ errors and backoff (C3.6)
  function registerError(why) {
    R.consecutiveErrors++;
    const max = Math.max(1, +core('maxErrors') || 5);
    if (R.consecutiveErrors >= max) {
      R.backoffUntil = null;
      if (!R.paused) {
        R.paused = { reason: 'errors', t: now() };
        store.set('paused', R.paused);
        rec('pause', 'Пауза: ' + R.consecutiveErrors + ' ошибок подряд (' + why + ')', { reason: 'errors', errors: R.consecutiveErrors, last: why });
        bot.notify('Бот на паузе: ' + R.consecutiveErrors + ' ошибок подряд. Проверьте журнал и нажмите «Продолжить».', { level: 'alarm', sound: true });
      }
    } else {
      const step = BACKOFF[Math.min(R.consecutiveErrors - 1, BACKOFF.length - 1)];
      const ms = bot.randMs(step);
      R.backoffUntil = now() + ms;
      rec('backoff', 'Ошибка ' + R.consecutiveErrors + '/' + max + ': пауза ' + Math.round(ms / 1000) + ' с (' + why + ')', { errors: R.consecutiveErrors, ms, until: R.backoffUntil, why });
      kick(ms + 50);
    }
    publishStatus();
  }
  function registerSuccess() {
    if (R.consecutiveErrors || R.backoffUntil) { R.consecutiveErrors = 0; R.backoffUntil = null; publishStatus(); }
  }

  // ------------------------------------------------------------------ shared read cache
  // Identical reads (same type + page + mode + cp, the same messages category, the same galaxy:system) within readCacheSec
  // (fleetTable 30 s, galaxy 60 s at least) get the last answer instead of a new request; an identical read already queued or
  // running is joined. spec.fresh: true (a read right before an order) and prio 'defense' never take a cached answer. A write on a planet drops
  // that planet's cached pages; a fleet write drops every fleetTable (slots are global); messages.delete drops the messages.
  // The result has the same format as a real read (a cached doc is parsed again from its html for every caller).
  const CACHE_TYPES = new Set(['read.page', 'read.fleetTable', 'read.messages', 'read.galaxy', 'read.statistics']);
  const isReadType = (type) => /^read\./.test(String(type || ''));
  let dlog = null;
  function debug(...a) {
    try { if (!dlog && OGX.log && OGX.log.create) dlog = OGX.log.create('botcore'); if (dlog) dlog.debug(...a); } catch (e) { /* ignore */ }
  }
  function readCacheKey(spec) {
    if (!spec || !CACHE_TYPES.has(spec.type)) return null;
    const p = spec.params || {};
    const cp = spec.bodyId != null && +spec.bodyId > 0 ? +spec.bodyId : null;
    switch (spec.type) {
      case 'read.page': {
        if (!p.page) return null;
        const imp = /^imperium$/i.test(p.page);
        if (!imp && cp === null) return null;              // «the current planet» may be another planet next time
        const q = Object.assign({}, p.query || {}); if (p.mode) q.mode = p.mode;
        const qs = Object.keys(q).sort().map((k) => k + '=' + q[k]).join('&');
        return 'read.page|' + String(p.page).toLowerCase() + '|' + qs + '|' + (imp ? '*' : cp);
      }
      case 'read.fleetTable': return cp === null ? null : 'read.fleetTable|' + cp;
      case 'read.messages': return 'read.messages|' + (p.cat !== undefined && p.cat !== null ? p.cat : 100) + '|' + (p.site || 1);
      case 'read.galaxy': return +p.galaxy > 0 && +p.system > 0 ? 'read.galaxy|' + (+p.galaxy) + ':' + (+p.system) : null;
      case 'read.statistics': return 'read.statistics|' + (p.type || 1) + '|' + (p.range || 1);
      default: return null;
    }
  }
  /** Cache lifetime (ms) of a read type; 0 = no cache. */
  function readCacheTtl(type) {
    const v = core('readCacheSec');
    const sec = Math.max(0, Math.round(v === undefined || v === null || v === '' ? 20 : +v || 0));
    if (!sec) return 0;
    if (type === 'read.galaxy') return Math.max(sec, 60) * 1000;
    if (type === 'read.fleetTable') return Math.max(sec, 30) * 1000;
    return sec * 1000;
  }
  /** A message list read before an own fleet arrived may miss its report: not reused. */
  function messagesStale(t0) {
    const t = now();
    for (const f of R.flights || []) if (f && f.own && +f.arrival > t0 && +f.arrival <= t + 1000) return true;
    for (const r of R.returns.values()) if (r && +r.at > t0 && +r.at <= t + 1000) return true;
    return false;
  }
  /** Copy of a cached clean result for one caller: same fields, its own doc. */
  function cachedCopy(r) {
    const out = Object.assign({}, r);
    if (r.data) {
      out.data = Object.assign({}, r.data);
      if (typeof r.data.html === 'string') {
        try { out.data.doc = new DOMParser().parseFromString(r.data.html, 'text/html'); } catch (e) { /* keep the shared doc */ }
      }
      for (const k of ['fleetTable', 'slots', 'system', 'statistics']) if (r.data[k] && typeof r.data[k] === 'object') { try { out.data[k] = clone(r.data[k]); } catch (e) { /* keep */ } }
    }
    return out;
  }
  function readCacheGet(key, type) {
    const c = R.readCache.get(key);
    if (!c) return null;
    const ttl = readCacheTtl(type);
    if (!ttl || now() - c.t >= ttl || (type === 'read.messages' && messagesStale(c.t))) { R.readCache.delete(key); return null; }
    return c;
  }
  function readCachePut(e, r) {
    if (!e.cacheKey || !r || !r.ok || r.dry || !readCacheTtl(e.type)) return;
    R.readCache.set(e.cacheKey, { t: now(), r, bodyId: e.bodyId, type: e.type });
    if (R.readCache.size > 300) R.readCache.delete(R.readCache.keys().next().value);
  }
  /** A write was sent: drop what it may have changed. */
  function readCacheInvalidate(e) {
    if (!e || isReadType(e.type) || e.type === 'probe.target' || !R.readCache.size) return 0;
    const fleet = /^fleet\./.test(e.type);
    let n = 0;
    for (const [k, c] of R.readCache) {
      let drop = false;
      if (e.type === 'messages.delete') drop = c.type === 'read.messages';
      else if (c.type === 'read.page' || c.type === 'read.fleetTable') drop = (fleet && c.type === 'read.fleetTable') || c.bodyId == null || (e.bodyId != null && +c.bodyId === +e.bodyId) || /\|imperium\|/.test(k);
      if (drop) { R.readCache.delete(k); n++; }
    }
    if (n) debug('кэш чтений: сброшено ' + n + ' после ' + e.type + (e.bodyId ? ' на ' + e.bodyId : ''));
    return n;
  }
  function effNote(kind) {
    const a = R.eff[kind];
    if (!a) return;
    const t = now();
    a.push(t);
    while (a.length && a[0] <= t - HOUR) a.shift();
    if (a.length > 20000) a.splice(0, a.length - 20000);
  }
  function effSnapshot() {
    const t = now();
    const cnt = (k) => (R.eff[k] || []).filter((x) => x > t - HOUR).length;
    return { requests: (R.limits.actions || []).filter((x) => x > t - HOUR).length, reads: cnt('reads'), cached: cnt('hits'), builds: cnt('builds'), sends: cnt('sends') };
  }
  /** Last-hour efficiency: { requests (HTTP requests), reads (read actions sent), cached (reads answered from the cache), builds, sends }. */
  bot.efficiency = () => (R.leader || !R.inited ? effSnapshot() : (R.storedStatus && R.storedStatus.efficiency) || effSnapshot());
  bot._readCache = { key: readCacheKey, ttl: readCacheTtl, size: () => R.readCache.size, clear: () => R.readCache.clear() };

  // ------------------------------------------------------------------ action queue (C2.4)
  let actSeq = 0;
  function persistQueue() {
    if (!R.inited || !R.leader) return;
    store.set('queue', R.queue.map((e) => { const o = Object.assign({}, e); delete o._prep; delete o._h; return o; }));
  }
  function enqueue(spec, wdef) {
    return new Promise((resolve) => {
      const t = now();
      const fail = (refused, message) => {
        const r = { ok: false, dry: false, refused, message, verified: false, ms: 0, at: t };
        rec('action-refused', 'Отклонено: ' + (spec && spec.type) + ' — ' + refused, { module: spec && spec.module, type: spec && spec.type, refused, message, why: spec && spec.why, run: spec && spec.run });
        resolve(r);
      };
      if (!spec || !ACTION_TYPES.includes(spec.type)) { resolve({ ok: false, dry: false, error: 'unknown action type ' + (spec && spec.type), verified: false, ms: 0, at: t }); return; }
      if (!R.inited) return fail('stopped', 'runtime not ready');
      if (R.stopped || core('master') !== true) return fail('stopped', 'бот выключен');
      if (!R.leader) return fail('notLeader', 'эта вкладка не ведёт бота');
      if (moduleOff({ module: spec.module || NAME })) return fail('stopped', 'модуль ' + spec.module + ' выключен');
      // shared read cache: an identical read within readCacheSec, or one already waiting in the queue, answers this one
      const cacheKey = readCacheKey(spec);
      if (cacheKey && readCacheTtl(spec.type)) {
        const fresh = spec.fresh === true || spec.prio === 'defense';   // botsave under attack: always the server
        const c = fresh ? null : readCacheGet(cacheKey, spec.type);
        if (c) {
          effNote('hits');
          debug('кэш чтений: ' + spec.type + ' — ' + (spec.why || '') + ' (' + Math.round((t - c.t) / 1000) + ' с назад)', { module: spec.module, key: cacheKey });
          resolve(cachedCopy(c.r));
          return;
        }
        const same = R.queue.find((q) => q.cacheKey === cacheKey && (q.state === 'queued' || (!fresh && q.state === 'running')) && !q.precise && !q.at);
        if (same && !spec.at && !spec.precise) {
          effNote('hits');
          debug('кэш чтений: ' + spec.type + ' — ' + (spec.why || '') + ' ждёт такое же чтение в очереди', { module: spec.module, key: cacheKey, action: same.id });
          if (rank({ prio: spec.prio || 'read', type: spec.type }) < rank(same)) same.prio = spec.prio || same.prio;   // the more urgent caller lifts it
          const list = R.joins.get(same.id) || [];
          list.push(resolve);
          R.joins.set(same.id, list);
          return;
        }
      }
      if (spec.dedupeKey && R.queue.some((e) => e.dedupeKey === spec.dedupeKey)) return fail('duplicate', spec.dedupeKey);
      if (R.queue.length >= QUEUE_MAX) return fail('limit', 'очередь переполнена');
      const prio = spec.prio || (spec.type.startsWith('read.') ? 'read' : (wdef && wdef.prio) || 'fleet');
      const e = {
        id: 'a' + t.toString(36) + '-' + (++actSeq) + '-' + Math.random().toString(36).slice(2, 6), type: spec.type, module: spec.module || 'botcore', prio,
        cls: spec.cls || 'normal', bodyId: spec.bodyId != null ? +spec.bodyId : null, params: clone(spec.params || {}), why: String(spec.why || ''),
        plan: clone(spec.plan) || null, at: spec.at || null, precise: spec.precise ? clone(spec.precise) : null, deadline: spec.deadline || null,
        dedupeKey: spec.dedupeKey || null, state: 'queued', created: t, tries: 0, run: spec.run || null,
        allowDuringSleep: !!(wdef && wdef.allowDuringSleep), returnAt: Number.isFinite(+spec.returnAt) && +spec.returnAt > 0 ? +spec.returnAt : null,
        cacheKey: cacheKey || null,
      };
      if (e.precise) e.preAt = e.precise.at - bot.randMs([60000, 300000]);
      R.queue.push(e);
      R.pending.set(e.id, resolve);
      persistQueue();
      rec('action-queued', 'В очереди: ' + typeRu(e.type) + ' — ' + e.why, { action: e.id, module: e.module, type: e.type, prio, params: e.params, why: e.why, run: e.run, at: e.at, precise: e.precise });
      emitAction(e, 'queued');
      publishStatus();
      kick(0);
    });
  }
  function typeRu(t) {
    return { 'read.page': 'чтение страницы', 'read.fleetTable': 'чтение флота', 'read.messages': 'чтение сообщений', 'read.galaxy': 'просмотр галактики',
      'read.statistics': 'статистика', 'probe.target': 'проверка цели', 'fleet.send': 'отправка флота', 'fleet.recall': 'отзыв флота', 'fleet.ajax': 'быстрая отправка',
      'build.building': 'постройка', 'build.research': 'исследование', 'build.units': 'верфь', 'messages.delete': 'удаление сообщений', 'bonus.claim': 'бонус за онлайн' }[t] || t;
  }
  bot._typeRu = typeRu;
  function emitAction(e, phase, result) {
    try { OGX.bus.emit('bot:action', { id: e.id, module: e.module, type: e.type, phase, result: result ? clone(slimResult(result)) : undefined }); } catch (x) { /* ignore */ }
  }
  function slimResult(r) { const o = Object.assign({}, r); if (o.data) { o.data = Object.assign({}, o.data); delete o.data.doc; delete o.data.html; } return o; }
  function cancelQueued(refused, message) {
    const keep = [];
    for (const e of R.queue) {
      if (e.state === 'running') { keep.push(e); continue; }
      finishEntry(e, { ok: false, dry: false, refused, message, verified: false, ms: 0, at: now() }, { silentQueue: true });
    }
    R.queue = keep;
    persistQueue();
  }
  function cancelByKey(module, dedupeKey) {
    if (!dedupeKey) return 0;
    let n = 0;
    for (const e of R.queue.slice()) {
      if (e.module !== module || e.dedupeKey !== dedupeKey || e.state === 'running' || e.id === R.running) continue;
      if (e._h) { try { e._h.cancel(); } catch (x) { /* ignore */ } e._h = null; }
      finishEntry(e, { ok: false, dry: false, refused: 'expired', message: 'отменено модулем', verified: false, ms: 0, at: now() });
      n++;
    }
    if (n) kick(0);
    return n;
  }
  /** Finishes every not-running entry of a module that is off now (a prepared precise send is disarmed first). Entries in state
   *  'uncertain' only read and verify, they stay. */
  function dropModuleOff(why) {
    let n = 0;
    for (const e of R.queue.slice()) {
      if (e.state === 'running' || e.state === 'uncertain' || e.id === R.running || !moduleOff(e)) continue;
      if (e._h) { try { e._h.cancel(); } catch (x) { /* ignore */ } e._h = null; }
      finishEntry(e, Object.assign(MODULE_OFF(e), { data: { disarmedBy: why } }));
      n++;
    }
    if (n && R.leader) { kick(0); scheduleDrain(); }
    return n;
  }
  function expireQueue() {
    const t = now();
    for (const e of R.queue.slice()) {
      if (e.state === 'queued' && e.deadline && e.deadline < t) finishEntry(e, { ok: false, dry: false, refused: 'expired', message: 'не начато до срока', verified: false, ms: 0, at: t });
    }
  }

  // ------------------------------------------------------------------ executor
  let pumpTimer = null;
  let pumping = false;
  function kick(ms) {
    if (!R.leader) return;
    if (pumpTimer) clock.cancel(pumpTimer);
    pumpTimer = clock.after(Math.max(0, ms || 0), () => { pumpTimer = null; pump(); });
  }
  /** Lower runs first. A read (not defense/deadline) ranks after every write of its class, so builds and sends never wait
   *  behind reads that were queued earlier. */
  function rank(e) {
    const r = PRIO[e.prio] !== undefined ? PRIO[e.prio] : 4;
    return isReadType(e.type) && e.prio !== 'defense' && e.prio !== 'deadline' ? r + 0.5 : r;
  }
  /** next entry to run now, or the time to look again */
  function pick() {
    const t = now();
    let wait = Infinity;
    if (R.paused || R.stopped || core('master') !== true) return { wait: Infinity };
    if (R.backoffUntil && R.backoffUntil > t) return { wait: R.backoffUntil - t };
    const busy = userIsBusy();
    // a precise send whose step 3 is due soon blocks every other start
    const preSoon = R.queue.find((e) => e.state === 'pre' && e.precise && e.precise.at - t < 20000);
    const cands = [];
    for (const e of R.queue) {
      if (e.state === 'running' || e.state === 'pre') continue;
      if (e.state !== 'uncertain' && moduleOff(e)) { finishEntry(e, MODULE_OFF(e)); return { wait: 0 }; }
      if (e.deadline && e.deadline < t) { finishEntry(e, { ok: false, dry: false, refused: 'expired', message: 'не начато до срока', verified: false, ms: 0, at: t }); return { wait: 0 }; }
      if (e.precise) {
        if (e.preAt > t) { wait = Math.min(wait, e.preAt - t); continue; }
        cands.push({ e, r: -1 });
        continue;
      }
      if (preSoon) { wait = Math.min(wait, 5000); continue; }
      if (e.at && e.at > t) { wait = Math.min(wait, e.at - t); continue; }
      if (busy && e.prio !== 'defense' && e.prio !== 'deadline') { wait = Math.min(wait, 3000); continue; }
      if (R.asleep && !e.allowDuringSleep && e.state !== 'uncertain') { cands.push({ e, r: rank(e) }); continue; }   // refused 'sleep' when run
      cands.push({ e, r: e.state === 'uncertain' ? -2 : rank(e) });
    }
    if (!cands.length) return { wait };
    if (R.startPauseUntil > t) return { wait: R.startPauseUntil - t };
    cands.sort((a, b) => a.r - b.r || a.e.created - b.e.created);
    return { entry: cands[0].e };
  }
  async function pump() {
    if (pumping || !R.leader) return;
    pumping = true;
    try {
      for (;;) {
        if (!R.leader) break;
        const p = pick();
        if (!p.entry) { if (Number.isFinite(p.wait)) kick(Math.max(50, p.wait)); break; }
        await execute(p.entry);
      }
    } finally { pumping = false; }
    scheduleDrain();
  }
  function scheduleDrain() {
    if (R.drainTimer) { clearTimeout(R.drainTimer); R.drainTimer = null; }
    if (!R.leader || R.queue.some((e) => e.state !== 'pre') || R.lastCp === null) return;
    R.drainTimer = setTimeout(() => { R.drainTimer = null; restoreCp(); }, 3000);
  }
  async function restoreCp() {
    if (!R.leader || R.running || R.queue.some((e) => e.state !== 'pre')) return;
    const want = currentBodyId();
    if (!want || R.lastCp === null || +R.lastCp === +want) { R.lastCp = null; return; }
    const from = R.lastCp;
    const r = await rawRequest(null, { method: 'GET', page: 'overview', cp: want, label: 'cp-restore' });
    R.lastCp = null;
    rec('cp-restore', 'Текущая планета возвращена: ' + want, { cp: want, from, ok: !!(r && r.ok) });
  }

  async function execute(e) {
    const wasUncertain = e.state === 'uncertain';
    e.state = 'running'; e.started = now(); e.tries++;
    R.running = e.id;
    persistQueue();
    if (!wasUncertain) {
      // in dry-run a mutating action is only checked and journaled ('action-dry' follows): never «Выполняю»
      const dryStart = !DRY_FREE.has(e.type) && bot.isDryRun();
      rec('action-start', (dryStart ? 'Проверяю план (пробный режим, ничего не отправляю): ' : 'Выполняю: ') + typeRu(e.type) + ' — ' + e.why, { dry: dryStart, action: e.id, module: e.module, type: e.type, params: e.params, why: e.why, run: e.run, plan: e.plan });
      emitAction(e, 'start');
    }
    publishStatus();
    const t0 = Date.now();
    let result;
    R.actReq = { e, n: 0 };
    try {
      result = wasUncertain ? await verifyUncertain(e) : await runAction(e);
    } catch (err) {
      result = { ok: false, error: errText(err) };
    } finally { R.actReq = null; }
    if (result && result.deferred) { R.running = null; persistQueue(); publishStatus(); return; }
    result = Object.assign({ ok: false, dry: false, verified: false, ms: Date.now() - t0, at: result && result.at ? result.at : now() }, result);
    R.running = null;
    finishEntry(e, result);
  }
  function finishEntry(e, result, { silentQueue = false } = {}) {
    const i = R.queue.indexOf(e);
    if (i >= 0) R.queue.splice(i, 1);
    try { claimFinish(e, result); } catch (x) { /* ignore */ }
    if (!silentQueue) persistQueue();
    const r = result;
    const summary = { action: e.id, module: e.module, type: e.type, why: e.why, run: e.run, ok: r.ok, dry: !!r.dry, refused: r.refused || null, error: r.error || null,
      code: r.code !== undefined ? r.code : null, message: r.message || null, verified: !!r.verified, ms: r.ms, at: r.at, lateMs: r.lateMs !== undefined ? r.lateMs : null,
      data: r.data ? slimResult({ data: r.data }).data : null };
    let phase;
    if (r.dry) { phase = 'dry'; }
    else if (r.refused) {
      phase = 'refused';
      rec('action-refused', 'Отклонено: ' + typeRu(e.type) + ' — ' + refusedRu(r.refused) + (r.message ? ' (' + r.message + ')' : ''), summary);
    } else if (r.ok) {
      phase = 'done';
      if (r.verifyExpected && !r.verified) {
        rec('action-verify-fail', 'Не подтверждено: ' + typeRu(e.type) + ' — ' + (r.verifyNote || 'эффект не найден'), summary);
        registerError('verify ' + e.type);
      } else {
        rec('action-done', 'Готово: ' + typeRu(e.type) + ' — ' + e.why, summary);
        registerSuccess();
      }
    } else {
      phase = 'fail';
      rec('action-fail', 'Ошибка: ' + typeRu(e.type) + ' — ' + (r.message || r.error || 'неизвестно'), summary);
      if (!r.noBackoff) registerError(e.type + ': ' + (r.error || r.message));
    }
    const clean = Object.assign({}, r);
    delete clean.verifyExpected; delete clean.verifyNote; delete clean.noBackoff; delete clean.limitKey;
    // a write that reached the server (or may have) makes cached pages of its planet stale
    if (!r.dry) readCacheInvalidate(e);
    if (phase === 'done' || phase === 'fail') {
      if (isReadType(e.type)) effNote('reads');
      else if (r.ok && /^build\./.test(e.type)) effNote('builds');
      else if (r.ok && (e.type === 'fleet.send' || e.type === 'fleet.ajax')) effNote('sends');
    }
    if (phase === 'done' && e.cacheKey) readCachePut(e, clean);
    R.recent.push({ id: e.id, t: now(), module: e.module, type: e.type, why: e.why, phase, ok: !!r.ok, refused: r.refused || null, message: r.message || r.error || null, verified: !!r.verified });
    if (R.recent.length > 50) R.recent.splice(0, R.recent.length - 50);
    if (R.inited) store.set('recent', R.recent);
    emitAction(e, phase, clean);
    const res = R.pending.get(e.id);
    R.pending.delete(e.id);
    if (res) res(clean);
    const joined = R.joins.get(e.id);
    R.joins.delete(e.id);
    if (joined) for (const j of joined) { try { j(cachedCopy(clean)); } catch (x) { /* ignore */ } }
    publishStatus();
  }
  function refusedRu(r) {
    return { dryRun: 'пробный режим', limit: 'лимит', slots: 'нет свободных слотов', threat: 'тело под угрозой', sleep: 'режим сна', duplicate: 'дубликат',
      expired: 'просрочено', stopped: 'бот остановлен', notLeader: 'не ведущая вкладка', fuel: 'не хватает дейтерия', cargo: 'не хватает места', ships: 'нет кораблей',
      userActive: 'пользователь в игре', attackLimit: 'лимит атак в сутки на цель' }[r] || r;
  }

  // ------------------------------------------------------------------ HTTP layer (inside botcore only)
  /** Effective pause between actions: minGapMs..maxGapMs; a max set below the min counts as max = min (clamped, hint in «Общие»). */
  bot.gapRange = function () {
    const min = Math.max(300, Math.round(+core('minGapMs') || 300));
    const set = Math.round(+core('maxGapMs') || 600);
    return { min, max: Math.max(min, set), setMax: set, clamped: set < min };
  };
  function gapMs() {
    const g = bot.gapRange();
    return bot.randMs([g.min, g.max]);
  }
  /** Pause before a read (botcore.readGapMs, at least 100 ms); writes keep minGapMs..maxGapMs. */
  bot.readGapMs = function () {
    const v = Math.round(+core('readGapMs'));
    return Math.max(100, Number.isFinite(v) && v > 0 ? v : 150);
  };
  async function waitGap(gap) {
    const g = gap !== undefined ? gap : gapMs();
    const wait = R.lastReqEnd + g - Date.now();
    if (wait > 0) await new Promise((r) => clock.after(wait, r));
  }
  function relUrl(page, query, cp) {
    const u = new URLSearchParams();
    u.set('page', page);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) u.set(k, String(v));
    if (cp !== undefined && cp !== null) u.set('cp', String(cp));
    return 'game.php?' + u.toString();
  }
  function describe(method, page, query, form, cp) { return { method, url: relUrl(page, query, cp), page, form: form ? clone(form) : null, cp: cp === undefined ? null : cp }; }
  /** One request: gap, OGX.http with an explicit cp (or none), stop checks, document parse. Counts toward the actions limit. */
  async function rawRequest(entry, { method = 'GET', page, query = {}, form, cp, json = false, gap, label, kind = 'page', notAfter }) {
    // the user gap (minGapMs..maxGapMs) separates ACTIONS: the first request of an action waits for it, the following requests of
    // the same action (fleetTable + steps 1-3, verify reads) go right after the previous answer
    const act = entry && R.actReq && R.actReq.e === entry ? R.actReq : null;
    const readGap = !entry || isReadType(entry.type) || (entry.type === 'probe.target');
    await waitGap(gap !== undefined ? gap : act && act.n > 0 ? 0 : readGap ? bot.readGapMs() : undefined);
    if (act) act.n++;
    if (!R.leader) return { ok: false, error: 'notLeader', refused: 'notLeader' };
    // precise step 3: the last check right before the request leaves (a slow tab must not post into the wrong server second)
    if (notAfter && pNow() > notAfter) return { ok: false, refused: 'expired', error: 'expired', message: 'окно пропущено на ' + Math.round(pNow() - notAfter) + ' мс (перед запросом)', lateMs: Math.round(pNow() - notAfter), notSent: true };
    const opts = { method, query: Object.assign({}, query), expect: 'text', timeout: 25000 };
    if (form !== undefined) opts.form = form;
    if (cp !== undefined && cp !== null) opts.cp = cp; else opts.noCp = true;
    const t0 = Date.now();
    let r;
    try { r = await OGX.http.request(page, opts); } catch (e) { r = { ok: false, status: 0, error: errText(e) }; }
    const ms = Date.now() - t0;
    R.lastReqEnd = Date.now();
    R.rtt.push(ms); if (R.rtt.length > 5) R.rtt.shift();
    limitCount('actions');
    if (cp !== undefined && cp !== null) R.lastCp = +cp;
    const out = { ok: !!r.ok, status: r.status, url: r.url, redirected: !!r.redirected, text: r.text || '', ms, at: now(), label };
    if (r.loggedOut) {
      if (core('autoLogin') === true) await logoutPause({ url: r.url, label });
      else await hardStop('logout', 'выход из игры (сессия завершена)', { url: r.url, label });
      return Object.assign(out, { ok: false, stop: 'logout', error: 'logged out' });
    }
    if (!r.ok) return Object.assign(out, { error: r.error || ('http ' + r.status) });
    const text = out.text;
    if (json) {
      try { out.json = JSON.parse(text); } catch (e) { out.json = null; }
      if (out.json === null) {
        if (CAPTCHA_RE.test(text)) { await hardStop('captcha', 'капча на странице', { label }); return Object.assign(out, { ok: false, stop: 'captcha', error: 'captcha' }); }
        return Object.assign(out, { ok: false, error: 'invalid json' });
      }
      return out;
    }
    let doc = null;
    try { doc = new DOMParser().parseFromString(text, 'text/html'); } catch (e) { doc = null; }
    out.doc = doc;
    if (doc) clockSample(doc, t0, t0 + ms);
    const stop = stopCheck(doc, text, kind);
    if (stop) {
      const texts = { captcha: 'капча на странице', vacation: 'включён режим отпуска', unknownPage: 'неизвестная страница (' + (r.url || '') + ')' };
      await hardStop(stop, texts[stop], { url: r.url, label, status: r.status });
      return Object.assign(out, { ok: false, stop, error: stop });
    }
    if (kind === 'page' && doc) postProcessDoc(doc);
    return out;
  }
  function visibleText(doc) {
    try {
      const b = doc.body ? doc.body.cloneNode(true) : null;
      if (!b) return '';
      for (const s of b.querySelectorAll('script, style, noscript')) s.remove();
      return b.textContent || '';
    } catch (e) { return ''; }
  }
  function isCaptchaDoc(doc) {
    if (!doc) return false;
    try {
      if (doc.querySelector('form [name*="captcha" i], .g-recaptcha, .h-captcha, iframe[src*="captcha" i], #captcha, img[src*="captcha" i]')) return true;
    } catch (e) { /* old selector engines */ }
    return CAPTCHA_RE.test(visibleText(doc));
  }
  /** C3.6 / BOT_DESIGN §1.11: null = fine, else 'captcha' | 'vacation' | 'unknownPage'. kind: 'page' (full page) | 'fragment' (messages AJAX) */
  function stopCheck(doc, text, kind) {
    if (!doc) return 'unknownPage';
    if (isCaptchaDoc(doc)) return 'captcha';
    if (kind === 'fragment') return null;
    try { if (OGX.parse.gz.vacation(doc).vacation) return 'vacation'; } catch (e) { /* ignore */ }
    if (doc.querySelector('#planetSelector')) return null;
    if (doc.querySelector('.headerRS') && doc.querySelector('.mainRS')) return null;   // info / message page
    if (doc.querySelector('th.success')) return null;                                  // fleetStep3 result
    return 'unknownPage';
  }
  function postProcessDoc(doc) {
    try {
      if (hasEventBox(doc)) {
        updateThreats(threatsFromDoc(doc), { complete: true, src: 'bot' });
        OGX.flights._storeFromDoc(doc, 'bot').catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }
  function mergeState(doc) {
    try { OGX.state.merge(OGX.state.snapshotSync(doc), { t: now() }).catch(() => {}); } catch (e) { /* ignore */ }
    noteBonus(doc);
  }

  // ------------------------------------------------------------------ «Бонус за онлайн» (botcore.onlineBonus)
  // GALAXYZ shows a star (.infobox «Online bonus.» -> game.php?page=bonus) only while the bonus can be taken; the user's own
  // claim was page=bonus, then page=bonus&action=claim. Any page the bot or the user loads reports the star; the worker claims.
  const BONUS_STAR = 'a[href*="page=bonus"]';
  const BONUS_QUIET_MS = 10 * MIN;
  function noteBonus(doc) {
    try {
      if (!doc || !doc.querySelector || !doc.querySelector(BONUS_STAR)) return;
      if (R.bonusTried && now() - R.bonusTried < BONUS_QUIET_MS) return;
      R.bonusSeen = now();
      if (R.bonusWorker && core('onlineBonus') === true) R.bonusWorker.wake('bonus', now() + bot.randMs([3000, 15000]));
    } catch (e) { /* ignore */ }
  }
  function bonusClaimOf(doc) {
    if (!doc || !doc.querySelector) return null;
    const a = doc.querySelector('a[href*="page=bonus"][href*="action=claim"]');
    if (a) return { method: 'GET', query: { action: 'claim' } };
    const f = doc.querySelector('form[action*="page=bonus"][action*="action=claim"]');
    if (!f) return null;
    const form = {};
    for (const i of f.querySelectorAll('input[name]')) if (!/^(checkbox|radio)$/i.test(i.type || '') || i.checked) form[i.name] = i.value || '';
    return /post/i.test(f.getAttribute('method') || '') ? { method: 'POST', query: { action: 'claim' }, form } : { method: 'GET', query: Object.assign({ action: 'claim' }, form) };
  }
  async function actBonus(e) {
    R.bonusTried = now();
    const r1 = await rawRequest(e, { method: 'GET', page: 'bonus', cp: e.bodyId, label: 'bonus' });
    if (!r1.ok) return fromReq(r1);
    const how = bonusClaimOf(r1.doc);
    if (!how) return { ok: true, verified: true, at: r1.at, data: { claimed: false, note: 'на странице бонуса нет кнопки «забрать»' } };
    const r2 = await rawRequest(e, Object.assign({ page: 'bonus', cp: e.bodyId, label: 'bonus.claim' }, how));
    if (!r2.ok) return fromReq(r2, { verifyExpected: true });
    let info = null;
    try { info = OGX.parse.gz.infoMessage(r2.doc); } catch (x) { info = null; }
    const still = !!bonusClaimOf(r2.doc);
    return { ok: true, verified: !still, verifyExpected: true, verifyNote: still ? 'кнопка «забрать» осталась' : null, message: info || null, at: r2.at, data: { claimed: !still, text: info || null } };
  }
  function registerBonusWorker() {
    R.bonusWorker = bot.register({
      id: 'botcore:bonus', module: NAME, prio: 'build', startJitter: [20000, 60000],
      async run(w) {
        if (core('onlineBonus') !== true) return { nextInMs: bot.randMs([1800000, 3600000]), reason: 'выключено' };
        try { noteBonus(document); } catch (e) { /* ignore */ }
        const t = now();
        // the star seen in the last 30 min and not tried since: one claim attempt
        const due = !!R.bonusSeen && t - R.bonusSeen < 30 * MIN && !(R.bonusTried && R.bonusTried >= R.bonusSeen);
        if (!due) return { nextInMs: bot.randMs([1200000, 1800000]), reason: 'бонуса нет' };
        const r = await w.act({ type: 'bonus.claim', prio: 'build', why: 'Бонус за онлайн', dedupeKey: 'botcore:bonus' });
        if (r && r.ok && r.data && r.data.claimed) rec('bonus', 'Бонус за онлайн получен' + (r.message ? ': ' + r.message : ''), { message: r.message || null, verified: !!r.verified });
        else if (r && r.ok) rec('bonus', 'Бонус за онлайн: забирать пока нечего', { note: r.data && r.data.note });
        return { nextInMs: bot.randMs([1200000, 1800000]), reason: r && r.ok && r.data && r.data.claimed ? 'бонус получен' : 'проверено' };
      },
    });
  }

  // ------------------------------------------------------------------ actions
  function dryRequests(e) {
    const p = e.params || {};
    const cp = e.bodyId;
    switch (e.type) {
      case 'read.messages': return [describe('GET', 'messages', { mode: 'view', messcat: p.cat, site: p.site || 1, ajax: 1 }, null, null)];
      case 'read.galaxy': return [describe('GET', 'galaxy', { galaxy: p.galaxy, system: p.system }, null, null)];
      case 'fleet.send': {
        const t = p.target || {};
        const f1 = OGX.fleet.gz.step1Form({ galaxy: t.galaxy, system: t.system, position: t.position, type: t.type || 1, mission: p.mission, ships: p.ships });
        const f3 = { token: '<step2>', mission: +p.mission, metal: Math.floor(+(p.cargo || {}).metal || 0), crystal: Math.floor(+(p.cargo || {}).crystal || 0), deuterium: Math.floor(+(p.cargo || {}).deuterium || 0) };
        if (p.staytime !== undefined && p.staytime !== null) f3.staytime = '<option for ' + p.staytime + ' h>';
        return [describe('GET', 'fleetTable', {}, null, cp), describe('POST', 'fleetStep1', {}, f1, cp),
          describe('POST', 'fleetStep2', {}, { token: '<step1>', fleet_group: 0, target_mission: +p.mission || 0, galaxy: +t.galaxy, system: +t.system, planet: +t.position, type: +t.type || 1, speed: Math.max(1, Math.min(10, Math.round(+p.speed || 10))) }, cp),
          describe('POST', 'fleetStep3', {}, f3, cp)];
      }
      case 'fleet.recall': return [describe('POST', 'fleetTable', { action: 'sendfleetback' }, { fleetID: +p.fleetId }, cp)];
      case 'fleet.ajax': return [describe('GET', 'fleetAjax', { ajax: 1, mission: +p.mission, planetID: +p.planetId }, null, cp)];
      case 'build.building': return [describe('POST', 'buildings', {}, p.cmd === 'cancel' ? { cmd: 'cancel', listid: p.listid } : { cmd: p.cmd || 'insert', building: +p.id }, cp)];
      case 'build.research': return [describe('POST', 'research', {}, { cmd: 'insert', tech: +p.id }, cp)];
      case 'build.units': return [describe('POST', 'shipyard', { mode: unitsMode(p.units) }, unitsForm(p.units), cp)];
      case 'messages.delete': return [describe('POST', 'messages', {}, deleteForm(p.ids, p.cat), null)];
      case 'bonus.claim': return [describe('GET', 'bonus', {}, null, cp), describe('GET', 'bonus', { action: 'claim' }, null, cp)];
      default: return [];
    }
  }
  function unitsMode(units) { return Object.keys(units || {}).some((id) => +id >= 400) ? 'defense' : 'fleet'; }
  function unitsForm(units) {
    const f = { cmd: 'insert' };
    for (const [id, n] of Object.entries(units || {})) if (Math.floor(+n) > 0) f['fmenge[' + (+id) + ']'] = Math.floor(+n);
    return f;
  }
  function deleteForm(ids, cat) {
    const f = { mode: 'action', ajax: 1, messcat: cat !== undefined && cat !== null ? cat : 100, side: 1, actionTop: 'deletemarked', submitTop: 'Confirm' };
    for (const id of ids || []) f['messageID[' + (+id) + ']'] = 1;
    return f;
  }
  /** Local plan check for a dry-run send (no request): target, ships on the body (state), slots cache. */
  function dryCheck(e) {
    const p = e.params || {};
    const issues = [];
    if (e.type === 'fleet.send') {
      const t = p.target || {};
      if (!(+t.galaxy > 0 && +t.system > 0 && +t.position > 0)) issues.push('цель не задана');
      if (!p.ships || !Object.values(p.ships).some((n) => +n > 0)) issues.push('нет кораблей');
      if (!(+p.mission > 0)) issues.push('миссия не задана');
      const b = bodyById(e.bodyId);
      if (b && b.ships && b.shipsT) for (const [id, n] of Object.entries(p.ships || {})) if ((+b.ships[id] || 0) < +n) issues.push('мало кораблей ' + id + ': ' + (+b.ships[id] || 0) + ' < ' + n);
      const lock = lockedFor(bodyKeyOf(e.bodyId));
      if (lock && !(e.cls === 'force' && e.module === 'botsave')) issues.push('тело под угрозой');
      if (R.slots && R.slots.known) { const c = canSendWith(R.slots, e.cls, e.module); if (!c.ok) issues.push('слоты: ' + c.reason); }
    }
    if (e.type === 'fleet.recall' && !(+p.fleetId > 0)) issues.push('нет id флота');
    if ((e.type === 'build.building' || e.type === 'build.research') && !(+p.id > 0) && p.cmd !== 'cancel') issues.push('нет id');
    if (e.type === 'messages.delete' && !(p.ids && p.ids.length)) issues.push('нет сообщений');
    return issues;
  }

  async function runAction(e) {
    const mutating = !DRY_FREE.has(e.type);
    if (R.stopped || core('master') !== true) return { refused: 'stopped', message: 'бот выключен' };
    if (!R.leader) return { refused: 'notLeader' };
    if (moduleOff(e)) return MODULE_OFF(e);
    // 1. dry-run
    if (mutating && bot.isDryRun()) {
      const requests = dryRequests(e);
      const issues = dryCheck(e);
      rec('action-dry', 'Пробный режим, не отправлено: ' + typeRu(e.type) + ' — ' + e.why, { action: e.id, module: e.module, type: e.type, params: e.params, why: e.why, run: e.run, plan: e.plan, requests, issues });
      return { ok: issues.length === 0, dry: true, refused: 'dryRun', verified: false, message: issues.join('; ') || null, data: { requests, issues }, at: now() };
    }
    // 2. limits
    const lim = (k, need = 1) => { const c = limitCheck(k, e.prio, need); if (!c.ok) { journalLimit(k, c); return { refused: 'limit', limitKey: k, message: k + ' ' + c.used + '/' + c.max + (need > 1 ? ' (нужно ' + need + ')' : '') }; } return null; };
    let l = lim('actions', requestsOf(e));
    if (l) return l;
    if (e.type === 'fleet.send' || e.type === 'fleet.ajax') { l = lim('fleetSends'); if (l) return l; }
    if (e.type.startsWith('build.')) { l = lim('builds'); if (l) return l; }
    if (e.type === 'read.galaxy') { l = lim('galaxyViews'); if (l) return l; }
    // 3. sleep
    if (R.asleep && !e.allowDuringSleep && mutating) return { refused: 'sleep', message: 'режим сна до ' + fmtTime(R.sleepUntil) };
    // the return planned by the worker (spec.returnAt), shifted by the time the entry waited in the queue: a sleep window set or
    // reached meanwhile refuses the send here too (C3.5)
    if (e.returnAt && !e.allowDuringSleep && (e.type === 'fleet.send' || e.type === 'fleet.ajax')) {
      const backAt = e.returnAt + Math.max(0, now() - Math.max(e.created || 0, e.at || 0));
      const sc = sleepCheck(backAt);
      if (!sc.ok) return { refused: 'sleep', message: 'возврат ' + fmtTime(backAt) + ' попадает в сон', noBackoff: true };
    }
    // 4. threat lock
    if (e.type === 'fleet.send') {
      const lock = lockedFor(bodyKeyOf(e.bodyId));
      if (lock && !(e.cls === 'force' && e.module === 'botsave')) return { refused: 'threat', message: 'удар по ' + (lock.to || '') + ' в ' + fmtTime(lock.arrival) };
      // 5. one module per target (claims)
      const cl = claimCheck(e);
      if (cl) return cl;
    }
    switch (e.type) {
      case 'read.page': return actReadPage(e);
      case 'read.fleetTable': return actReadFleetTable(e);
      case 'read.messages': return actReadMessages(e);
      case 'read.galaxy': return actReadGalaxy(e);
      case 'read.statistics': return actReadStatistics(e);
      case 'probe.target': return actProbe(e);
      case 'fleet.send': return actSend(e);
      case 'fleet.recall': return actRecall(e);
      case 'fleet.ajax': return actAjax(e);
      case 'build.building': case 'build.research': case 'build.units': return actBuild(e);
      case 'messages.delete': return actDelete(e);
      case 'bonus.claim': return actBonus(e);
      default: return { error: 'unknown type' };
    }
  }
  const fromReq = (r, extra) => Object.assign({ ok: false, error: r.error || 'http ' + r.status, message: r.error, at: r.at }, r.stop ? { noBackoff: true } : {}, extra || {});

  async function actReadPage(e) {
    const p = e.params || {};
    if (!p.page || /^galaxy$/i.test(p.page)) return { ok: false, error: 'read.page: page missing or galaxy (use read.galaxy)', noBackoff: true };
    const q = Object.assign({}, p.query || {}); if (p.mode) q.mode = p.mode;
    const r = await rawRequest(e, { method: 'GET', page: p.page, query: q, cp: /^imperium$/i.test(p.page) ? null : e.bodyId, label: 'read.page' });
    if (!r.ok) return fromReq(r);
    mergeState(r.doc);
    return { ok: true, verified: true, data: { doc: r.doc, html: r.text }, at: r.at };
  }
  async function readFleetTableDoc(e, label) {
    const r = await rawRequest(e, { method: 'GET', page: 'fleetTable', cp: e.bodyId, label });
    if (!r.ok) return { r };
    let ft = null;
    try { ft = OGX.parse.gz.fleetTable(r.doc); } catch (x) { ft = null; }
    if (ft) { setSlots(slotsFromFleetTable(ft)); mergeState(r.doc); }
    return { r, ft };
  }
  async function actReadFleetTable(e) {
    const { r, ft } = await readFleetTableDoc(e, 'read.fleetTable');
    if (!r.ok) return fromReq(r);
    if (!ft) return { ok: false, error: 'fleetTable not parsed', at: r.at };
    return { ok: true, verified: true, data: { doc: r.doc, html: r.text, fleetTable: slimFleetTable(ft), slots: clone(R.slots) }, at: r.at };
  }
  function slimFleetTable(ft) { return { slots: ft.slots, expeditions: ft.expeditions, extraCounters: ft.extraCounters, flights: ft.flights, ships: ft.ships, bonus: ft.bonus }; }
  async function actReadMessages(e) {
    if (core('readMessages') === false) return { ok: false, error: 'readMessagesOff', message: 'чтение сообщений выключено (botcore.readMessages)', noBackoff: true };
    const p = e.params || {};
    const r = await rawRequest(e, { method: 'GET', page: 'messages', query: { mode: 'view', messcat: p.cat !== undefined ? p.cat : 100, site: p.site || 1, ajax: 1 }, label: 'read.messages', kind: 'fragment' });
    if (!r.ok) return fromReq(r);
    let items = null;
    try { items = OGX.messages.gz.listItems(r.doc); } catch (x) { items = null; }
    return { ok: true, verified: !!items, data: { doc: r.doc, html: r.text }, at: r.at };
  }
  async function actReadGalaxy(e) {
    const p = e.params || {};
    if (!(+p.galaxy > 0 && +p.system > 0)) return { ok: false, error: 'galaxy/system missing', noBackoff: true };
    limitCount('galaxyViews');
    const r = await rawRequest(e, { method: 'GET', page: 'galaxy', query: { galaxy: +p.galaxy, system: +p.system }, label: 'read.galaxy' });
    if (!r.ok) return fromReq(r);
    let sys = null;
    try { sys = OGX.galaxy.parseGz(r.doc); } catch (x) { sys = null; }
    if (!sys) return { ok: false, error: 'galaxy', message: OGX.parse.gz.infoMessage(r.doc) || 'страница галактики не прочитана', at: r.at };
    try { OGX.bus.emit('galaxy:system', { system: sys, source: 'scan' }); } catch (x) { /* ignore */ }
    return { ok: true, verified: true, data: { doc: r.doc, html: r.text, system: sys }, at: r.at };
  }
  async function actReadStatistics(e) {
    const p = e.params || {};
    const r = await rawRequest(e, { method: 'GET', page: 'statistics', query: { who: 1, type: p.type || 1, range: p.range || 1 }, label: 'read.statistics' });
    if (!r.ok) return fromReq(r);
    let st = null;
    try { st = OGX.parse.gz.statistics(r.doc); } catch (x) { st = null; }
    return { ok: true, verified: !!(st && st.rows && st.rows.length), data: { doc: r.doc, html: r.text, statistics: st }, at: r.at };
  }

  // fleet dispatch helpers --------------------------------------------------
  function target(p) { const t = p.target || {}; return { galaxy: +t.galaxy, system: +t.system, position: +(t.position !== undefined ? t.position : t.planet), type: +t.type || 1 }; }
  function mapStep3Text(text) {
    const s = String(text || '');
    // «Превышен лимит количества атак в сутки на данный пункт назначения.» — a per-target game rule, not a bot error (no error streak)
    if (/лимит\s+количества\s+атак|attacks?\s+per\s+day|attack\s+limit/i.test(s)) return 'attackLimit';
    if (/slot|слот/i.test(s)) return 'slots';
    if (/deuterium|fuel|дейтери|топлив/i.test(s)) return 'fuel';
    if (/space|cargo|capacity|raw materials|места|груз|вместим|сырь/i.test(s)) return 'cargo';
    if (/vacation|urlaub|отпуск/i.test(s)) return 'vacation';
    if (/noob|strong|protect|новичк|защит|сильн/i.test(s)) return 'noob';
    if (/ship|корабл/i.test(s)) return 'ships';
    return 'other';
  }
  /** step 0 (fleetTable) + step 1 + step 2; returns { s1, s2, ft, deut, fuel, duration, distance } or a result to return */
  async function dispatchPrep(e, { probeOnly = false } = {}) {
    const p = e.params || {};
    const t = target(p);
    const mission = +p.mission || 0;
    const { r: r0, ft } = await readFleetTableDoc(e, probeOnly ? 'probe.target:0' : 'fleet.send:0');
    if (!r0.ok) return { result: fromReq(r0) };
    if (!ft) return { result: { ok: false, error: 'fleetTable not parsed', at: r0.at } };
    const ships = p.ships || {};
    if (!probeOnly) {
      const sl = slotsFromFleetTable(ft);
      const c = canSendWith(sl, e.cls, e.module);
      if (!c.ok) return { result: { ok: false, refused: 'slots', message: 'свободно ' + c.free + ', резерв ' + c.reserve + (c.held ? ', занято другими модулями ' + c.held : ''), at: r0.at } };
      if (mission === 15 && sl && sl.expedition && sl.expedition.used >= sl.expedition.max) return { result: { ok: false, refused: 'slots', message: 'нет слота экспедиции', at: r0.at } };
    }
    // [UPSTREAM] ShowFleetStep3Page: a Transport with nothing loaded is refused ('No raw materials loaded!')
    if (!probeOnly && mission === 3) {
      const c = p.cargo || {};
      if ((+c.metal || 0) + (+c.crystal || 0) + (+c.deuterium || 0) < 1) return { result: { ok: false, refused: 'cargo', message: 'транспорт без груза', at: r0.at } };
    }
    const have = {};
    for (const s of ft.ships || []) have[s.id] = +s.count || 0;
    for (const [id, n] of Object.entries(ships)) {
      if (+n > 0 && (have[id] || 0) < +n) return { result: { ok: false, refused: 'ships', message: 'корабль ' + id + ': есть ' + (have[id] || 0) + ', нужно ' + n, at: r0.at } };
    }
    const deut = (OGX.fleet.gz.stock(r0.doc) || {}).deuterium;
    // step 1
    const f1 = OGX.fleet.gz.step1Form({ galaxy: t.galaxy, system: t.system, position: t.position, type: t.type, mission, ships });
    const r1 = await rawRequest(e, { method: 'POST', page: 'fleetStep1', form: f1, cp: e.bodyId, gap: 0, label: 'step1' });
    if (!r1.ok) return { result: fromReq(r1) };
    const s1 = OGX.parse.gz.fleetStep1(r1.doc);
    if (s1 && s1.data && +s1.data.gamespeed > 0) mergeState(r1.doc);   // server fleet speed (data.gamespeed) for every estimate
    if (!s1 || !s1.token) {
      const info = OGX.parse.gz.infoMessage(r1.doc);
      if (!info && /page=fleetTable/i.test(r1.url || '')) return { result: { ok: false, refused: 'ships', message: 'шаг 1 вернул fleetTable (нет кораблей?)', at: r1.at } };
      return { result: { ok: false, error: 'step1', message: info || 'шаг 1: нет формы', at: r1.at } };
    }
    // fuel / cargo on the step-1 data of the same token
    const data = s1.data || {};
    const origin = data.planet ? [data.planet.galaxy, data.planet.system, data.planet.planet].join(':') : ((bodyById(e.bodyId) || {}).coords || null);
    const distance = OGX.fleet.gz.distance(origin, [t.galaxy, t.system, t.position].join(':'));
    const speed = Math.max(1, Math.min(10, Math.round(+p.speed || 10)));
    const duration = distance !== null ? OGX.fleet.gz.duration(data, distance, speed) : null;
    const fuel = duration !== null && Number.isFinite(duration) ? OGX.fleet.gz.consumption(data, distance, duration) : null;
    // cargo above the stock on the fresh fleetTable page (step 0): the server min()s the load [UPSTREAM ShowFleetStep3Page:363-367];
    // the bot sends what is there (deuterium minus fuel and deutReserve) so the request and the journal match what leaves
    let cargoSend = null; let cargoClamped = null;
    if (!probeOnly && p.cargo) {
      const st = OGX.fleet.gz.stock(r0.doc) || {};
      cargoSend = {};
      for (const k of RES) {
        const want = Math.max(0, Math.floor(+p.cargo[k] || 0));
        const extra = k === 'deuterium' ? (fuel || 0) + Math.max(0, +core('deutReserve') || 0) : 0;
        const have = Number.isFinite(+st[k]) ? Math.max(0, Math.floor(+st[k]) - extra) : Infinity;
        cargoSend[k] = Math.min(want, have);
        if (cargoSend[k] < want) (cargoClamped = cargoClamped || {})[k] = { want, have };
      }
    }
    if (!probeOnly && fuel !== null) {
      const cargo = cargoSend || p.cargo || {};
      const need = (Math.floor(+cargo.deuterium || 0)) + fuel + Math.max(0, +core('deutReserve') || 0);
      if (Number.isFinite(+deut) && +deut < need) return { result: { ok: false, refused: 'fuel', message: 'дейтерий ' + Math.floor(deut) + ' < ' + need + ' (топливо ' + fuel + ')', at: r1.at, data: { consumption: fuel } } };
      const load = RES.reduce((s, k) => s + Math.floor(+cargo[k] || 0), 0);
      const room = +data.fleetroom;
      if (Number.isFinite(room) && load > room - fuel) return { result: { ok: false, refused: 'cargo', message: 'груз ' + load + ' > места ' + (room - fuel), at: r1.at, data: { consumption: fuel } } };
    }
    // step 2
    const f2 = OGX.fleet.gz.step2Form(s1, { galaxy: t.galaxy, system: t.system, position: t.position, type: t.type, mission, speed });
    const r2 = await rawRequest(e, { method: 'POST', page: 'fleetStep2', form: f2, cp: e.bodyId, gap: 0, label: 'step2' });
    if (!r2.ok) return { result: fromReq(r2) };
    const s2raw = OGX.parse.gz.fleetStep2(r2.doc);
    if (!s2raw) {
      // a server info text on step 2 describes the target's state (empty debris field, vacation, noob protection, no planet):
      // a game fact, not a bot failure -> no backoff. A page without form and without text still counts as an error.
      const info = OGX.parse.gz.infoMessage(r2.doc);
      const noDebris = !!info && (+t.type === 2 || +mission === 8) && /debris|обломк|trümmer|rubble/i.test(info);
      return { result: { ok: false, error: noDebris ? 'noDebris' : 'target', message: info || 'шаг 2: нет формы', at: r2.at, code: 'step2', noBackoff: !!info } };
    }
    const s2 = Object.assign({}, s2raw, { token: s2raw.token || s1.token });
    return { s1, s2, ft, deut, fuel, duration, distance, origin, speed, cargo: cargoSend, cargoClamped, t2: Date.now() };
  }
  async function actProbe(e) {
    const prep = await dispatchPrep(e, { probeOnly: true });
    if (prep.result) return prep.result;
    const s2 = prep.s2;
    return { ok: true, verified: true, at: now(),
      data: { missions: (s2.missions || []).map((m) => m.id), stayOptions: s2.stayOptions || [], consumption: s2.consumption !== undefined && s2.consumption !== null ? s2.consumption : prep.fuel, data: Object.assign({}, prep.s1.data || {}, s2.data || {}) } };
  }
  async function actSend(e) {
    const p = e.params || {};
    const mission = +p.mission;
    let prep = e._prep;
    if (!prep) {
      prep = await dispatchPrep(e);
      if (prep.result) return prep.result;
    }
    if (!(prep.s2.missions || []).some((m) => m.id === mission)) {
      return { ok: false, error: 'mission', message: 'миссия ' + mission + ' не предложена (' + (prep.s2.missions || []).map((m) => m.id).join(',') + ')', data: { missions: (prep.s2.missions || []).map((m) => m.id) }, at: now() };
    }
    // precise: steps 1-2 done early, step 3 at at - RTT/2
    if (e.precise && !e._prep) {
      // steps 1-2 done early (token lives 600 s); step 3 fires at at - RTT/2 from the worker clock (C3.4)
      e._prep = prep;
      e.state = 'pre';
      e.prepAt = Date.now();
      e.prepServer = now();
      armPrecise(e);
      return { deferred: true };
    }
    return await step3(e, prep);
  }
  function armPrecise(e) {
    const fireServer = e.precise.at - medianRtt() / 2;
    const c = preciseClock();
    rec('timer-armed', 'Точная отправка: шаг 3 в ' + fmtTime(e.precise.at), { action: e.id, at: e.precise.at, fireAt: fireServer, rtt: medianRtt(),
      clock: c ? { offMs: Math.round(c.off), widthMs: Math.round(c.width), samples: c.n, coarseDiffMs: Math.round(c.off - (now() - Date.now())) } : null });
    e._h = clock.precise(pToLocal(fireServer), () => { firePrecise(e, fireServer); });
  }
  /** A precise send prepared early (state 'pre', steps 1-2 posted up to 300 s before) passes the runAction() gates again right
   *  before step 3: stop/master, its module on, pause, dry-run, sleep, threat lock (botsave+force exempt) and the slots of a fleetTable read
   *  made after the prep. null = go on; else the result to finish the entry with (nothing more is sent). */
  function preciseGate(e) {
    if (R.stopped || core('master') !== true) return { ok: false, refused: 'stopped', message: 'бот выключен до шага 3 — флот не отправлен' };
    if (moduleOff(e)) return { ok: false, refused: 'stopped', message: 'модуль ' + e.module + ' выключен до шага 3 — флот не отправлен', noBackoff: true };
    if (R.paused) return { ok: false, refused: 'stopped', message: 'пауза (' + pauseRu(R.paused.reason) + ') до шага 3 — флот не отправлен' };
    if (bot.isDryRun()) {
      const requests = dryRequests(e).filter((q) => q.page === 'fleetStep3');
      rec('action-dry', 'Пробный режим включён до шага 3, не отправлено: ' + typeRu(e.type) + ' — ' + e.why, { action: e.id, module: e.module, type: e.type, params: e.params, why: e.why, run: e.run, plan: e.plan, requests, issues: [], preparedSteps: [1, 2] });
      return { ok: true, dry: true, refused: 'dryRun', message: 'пробный режим включён после шагов 1–2: шаг 3 не отправлен', data: { requests, issues: [] } };
    }
    if (R.asleep && !e.allowDuringSleep) return { ok: false, refused: 'sleep', message: 'режим сна до ' + fmtTime(R.sleepUntil) + ' — шаг 3 не отправлен' };
    const lock = lockedFor(bodyKeyOf(e.bodyId));
    if (lock && !(e.cls === 'force' && e.module === 'botsave')) return { ok: false, refused: 'threat', message: 'удар по ' + (lock.to || '') + ' в ' + fmtTime(lock.arrival) + ' — шаг 3 не отправлен' };
    if (R.slots && R.slots.known && e.prepServer && R.slots.t > e.prepServer) {
      const c = canSendWith(R.slots, e.cls, e.module);
      if (!c.ok) return { ok: false, refused: 'slots', message: 'свободно ' + c.free + ', резерв ' + c.reserve + ' — шаг 3 не отправлен' };
    }
    return null;
  }
  /** Re-checks every prepared precise send now (pause, dry-run toggle, new lock, falling asleep): refused ones are disarmed. */
  function gatePrecise(why) {
    if (!R.leader) return;
    let n = 0;
    for (const e of R.queue.slice()) {
      if (e.state !== 'pre' || e.id === R.running) continue;
      const g = preciseGate(e);
      if (!g) continue;
      if (e._h) { try { e._h.cancel(); } catch (x) { /* ignore */ } e._h = null; }
      finishEntry(e, Object.assign({ ok: false, dry: false, verified: false, ms: 0, at: now(), data: { disarmedBy: why } }, g));
      n++;
    }
    if (n) { kick(0); scheduleDrain(); }
  }
  async function firePrecise(e, fireServer) {
    e._h = null;
    if (!R.leader || !R.queue.includes(e)) return;
    const t0 = Date.now();
    while (R.running && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 5));   // pick() keeps starts away 20 s before
    if (!R.queue.includes(e)) return;
    const tol = e.precise.tolMs === undefined || e.precise.tolMs === null ? 1000 : Math.max(0, +e.precise.tolMs || 0);
    const late = pNow() - fireServer;
    let result;
    const gate = preciseGate(e);
    if (gate) result = gate;
    else if (Date.now() - e.prepAt > 590000) result = { ok: false, refused: 'expired', message: 'токен отправки истёк', at: now() };
    else if (late > tol) result = { ok: false, refused: 'expired', message: 'окно пропущено на ' + Math.round(late) + ' мс', lateMs: Math.round(late), at: now() };
    else {
      R.running = e.id; e.state = 'running';
      persistQueue(); publishStatus();
      rec('timer-fired', 'Точная отправка: шаг 3', { action: e.id, at: e.precise.at, lateMs: Math.round(late) });
      const t1 = Date.now();
      try { result = await step3(e, e._prep, { gap: 0, notAfter: fireServer + tol }); } catch (x) { result = { ok: false, error: errText(x) }; }
      result.ms = Date.now() - t1;
    }
    R.running = null;
    finishEntry(e, Object.assign({ ok: false, dry: false, verified: false, ms: 0, at: now() }, result));
    kick(0);
    scheduleDrain();
  }
  function medianRtt() {
    const a = R.rtt.slice().sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : 200;
  }
  async function step3(e, prep, { gap, notAfter } = {}) {
    const p = e.params || {};
    const mission = +p.mission;
    let f3;
    try { f3 = OGX.fleet.gz.step3Form(prep.s2, { mission, cargo: prep.cargo || p.cargo || {}, holdingtime: p.staytime }); } catch (x) { return { ok: false, error: 'mission', message: errText(x), at: now() }; }
    const sentAtServer = now();
    const r3 = await rawRequest(e, { method: 'POST', page: 'fleetStep3', form: f3, cp: e.bodyId, gap: gap !== undefined ? gap : 0, label: 'step3', notAfter });
    if (r3.notSent) return { ok: false, refused: 'expired', message: r3.message, lateMs: r3.lateMs, at: now() };
    limitCount('fleetSends');
    if (!r3.ok) return r3.stop ? fromReq(r3, { verifyExpected: true }) : await lostStep3(e, prep, r3);
    const res = OGX.fleet.gz.parseResult(r3.doc);
    if (!res.success) {
      const info = OGX.parse.gz.infoMessage(r3.doc) || res.message || '';
      const kind = mapStep3Text(info);
      if (['slots', 'fuel', 'cargo', 'ships', 'attackLimit'].includes(kind)) return { ok: false, refused: kind, message: info, code: 'step3', at: r3.at };
      if (/page=fleetTable/i.test(r3.url || '') && !info) return { ok: false, error: 'token', message: 'шаг 3 вернул fleetTable (токен?)', at: r3.at };
      return { ok: false, error: kind, message: info, code: 'step3', at: r3.at };
    }
    const tStr = [target(p).galaxy, target(p).system, target(p).position].join(':');
    let fleetId = res.fleetId != null ? res.fleetId : null;
    const evMatch = fleetId !== null && (res.missionId === null || res.missionId === undefined || res.missionId === mission) && (!res.to || res.to === tStr);
    let verified = !!(evMatch);
    let note = verified ? null : 'нет события в списке полётов';
    if (!verified && mission === 4) {
      // Deploy outward is not in the event box [UPSTREAM]: look for the row on page=fleetTable
      const { r, ft } = await readFleetTableDoc(e, 'fleet.send:verify');
      if (r.ok && ft) {
        const row = (ft.flights || []).filter((f) => !f.returning && f.missionId === 4 && f.target && f.target.replace(/[[\]]/g, '') === tStr).sort((a, b) => (b.fleetId || 0) - (a.fleetId || 0))[0];
        if (row) { verified = true; fleetId = row.fleetId; note = null; }
      }
    }
    const processed = res.arrival && prep.duration ? res.arrival - Math.round(OGX.fleet.gz.durationRaw(prep.s1.data, prep.distance, prep.speed) * 1000) : null;
    let lateMs;
    if (e.precise && processed !== null) lateMs = processed - e.precise.at;
    else if (p.expectArrival && res.arrival) lateMs = res.arrival - p.expectArrival;
    noteShipsLeft(e.bodyId, p.ships);
    if (verified && fleetId !== null && res.back) R.returns.set(fleetId, { fleetId, mission, bodyKey: bodyKeyOf(e.bodyId), at: mission === 4 ? res.arrival : res.back });
    armReturnTimer();
    return { ok: true, verified, verifyExpected: true, verifyNote: note, at: sentAtServer, lateMs,
      data: { fleetId, arrival: res.arrival || null, back: res.back || null, consumption: res.consumption != null ? res.consumption : prep.fuel, missions: (prep.s2.missions || []).map((m) => m.id),
        cargo: prep.cargo || null, cargoClamped: prep.cargoClamped || null,
        result: { missionId: res.missionId, from: res.from, to: res.to, distance: res.distance, ships: res.ships, arrivalText: res.arrivalText, returnText: res.returnText } } };
  }
  /** Step 3 failed at the transport level (status 0/5xx, reset, timeout): the server may have sent the fleet anyway. Read the
   *  fleetTable once (C3.3 'verify before retry') and look for a new outgoing row with the same mission and target that was not
   *  there at step 0. Found -> the send counts as done (claim kept, ships gone). Not found -> a plain error. Read failed ->
   *  error 'uncertain' (claim kept, ships marked stale): modules must not retry it blindly. */
  async function lostStep3(e, prep, r3) {
    const p = e.params || {};
    const lost = r3.error || ('http ' + r3.status);
    const tStr = [target(p).galaxy, target(p).system, target(p).position].join(':');
    const before = new Set(((prep.ft && prep.ft.flights) || []).map((f) => f.fleetId).filter((x) => x != null));
    const { r, ft } = await readFleetTableDoc(e, 'fleet.send:lost-step3');
    if (!r.ok || !ft) {
      noteShipsStale(bodyKeyOf(e.bodyId));
      return { ok: false, error: 'uncertain', message: 'ответ на шаг 3 потерян (' + lost + '), проверка не удалась — неизвестно, улетел ли флот; не повторять', at: now(), data: { lost } };
    }
    const row = (ft.flights || []).filter((f) => !f.returning && f.missionId === +p.mission && f.fleetId != null && !before.has(f.fleetId)
      && f.target && f.target.replace(/[[\]]/g, '') === tStr).sort((a, b) => (b.fleetId || 0) - (a.fleetId || 0))[0];
    if (!row) return { ok: false, error: lost, message: 'ответ на шаг 3 потерян (' + lost + '); по списку флотов отправки не было', at: r.at, data: { lost, checked: true } };
    noteShipsLeft(e.bodyId, p.ships);
    const arrival = row.timerUnix ? row.timerUnix * 1000 : null;
    rec('action-uncertain', 'Ответ на шаг 3 потерян (' + lost + '), но флот ' + row.fleetId + ' найден в списке — отправка состоялась', { action: e.id, fleetId: row.fleetId, lost });
    armReturnTimer();
    return { ok: true, verified: true, at: r.at, data: { fleetId: row.fleetId, arrival, back: null, consumption: prep.fuel, missions: (prep.s2.missions || []).map((m) => m.id),
      cargo: prep.cargo || null, cargoClamped: prep.cargoClamped || null, uncertain: true, lost } };
  }
  async function actRecall(e) {
    const id = +(e.params || {}).fleetId;
    if (!(id > 0)) return { ok: false, error: 'fleetId missing', noBackoff: true };
    const r = await rawRequest(e, { method: 'POST', page: 'fleetTable', query: { action: 'sendfleetback' }, form: { fleetID: id }, cp: e.bodyId, label: 'recall' });
    if (!r.ok && !r.stop && !r.refused) {
      // the answer was lost: the recall may have happened. One fleetTable read decides (C3.3 verify before retry).
      const { r: rv, ft: fv } = await readFleetTableDoc(e, 'fleet.recall:lost');
      if (rv.ok && fv) {
        const still = (fv.flights || []).find((f) => f.fleetId === id && f.recallable);
        if (!still) { claimRecalled(id); return { ok: true, verified: true, at: rv.at, data: { lost: r.error || ('http ' + r.status), checked: true } }; }
        return fromReq(r, { message: 'ответ на отзыв потерян; флот ' + id + ' всё ещё летит' });
      }
      return { ok: false, error: 'uncertain', message: 'ответ на отзыв потерян, проверка не удалась — не повторять вслепую', at: now() };
    }
    if (!r.ok) return fromReq(r, { verifyExpected: true });
    let ft = null;
    try { ft = OGX.parse.gz.fleetTable(r.doc); } catch (x) { ft = null; }
    if (ft) setSlots(slotsFromFleetTable(ft));
    const formLeft = !!(r.doc && r.doc.querySelector('form[action*="sendfleetback"] input[name="fleetID"][value="' + id + '"]'));
    const row = ft ? (ft.flights || []).find((f) => f.fleetId === id && f.recallable) : null;
    const verified = !!ft && !formLeft && !row;
    if (verified) claimRecalled(id);
    return { ok: true, verified, verifyExpected: true, verifyNote: verified ? null : 'форма отзыва осталась', at: r.at, data: { doc: r.doc } };
  }
  async function actAjax(e) {
    const p = e.params || {};
    if (![6, 8].includes(+p.mission) || !(+p.planetId > 0)) return { ok: false, error: 'mission 6|8 and planetId required', noBackoff: true };
    limitCount('fleetSends');
    const r = await rawRequest(e, { method: 'GET', page: 'fleetAjax', query: { ajax: 1, mission: +p.mission, planetID: +p.planetId }, cp: e.bodyId, json: true, label: 'fleetAjax' });
    if (!r.ok) return fromReq(r);
    const j = r.json || {};
    const code = j.code !== undefined ? +j.code : null;
    let mess = null;
    try { mess = OGX.api._parseFleetAjaxMess ? OGX.api._parseFleetAjaxMess(j.mess) : null; } catch (x) { mess = null; }
    if (code === 600) return { ok: true, verified: true, code, message: j.mess || '', at: r.at, data: Object.assign({}, j, { shipsSent: mess ? mess.ships : null, targetCoords: mess ? mess.coords : null }) };
    if (code === 612) return { ok: false, refused: 'slots', code, message: j.mess || '', at: r.at, data: j };
    if (code === 613) return { ok: false, refused: 'fuel', code, message: j.mess || '', at: r.at, data: j };
    if (code === 610 || code === 611) return { ok: false, refused: 'ships', code, message: j.mess || '', at: r.at, data: j };
    return { ok: false, error: 'fleetAjax ' + code, code, message: j.mess || '', at: r.at, data: j };
  }
  async function actBuild(e) {
    const p = e.params || {};
    let page; let form; let query = {};
    const body = bodyById(e.bodyId);
    if (e.type === 'build.building') {
      if (p.cmd === 'cancel') form = { cmd: 'cancel', listid: p.listid };
      else { if (!(+p.id > 0)) return { ok: false, error: 'id missing', noBackoff: true }; form = { cmd: p.cmd || 'insert', building: +p.id }; }
      page = 'buildings';
    } else if (e.type === 'build.research') {
      if (!(+p.id > 0)) return { ok: false, error: 'id missing', noBackoff: true };
      page = 'research'; form = { cmd: 'insert', tech: +p.id };
    } else {
      const units = p.units || {};
      const ids = Object.keys(units).filter((id) => Math.floor(+units[id]) > 0);
      if (!ids.length) return { ok: false, error: 'units missing', noBackoff: true };
      if (ids.some((id) => +id >= 400) && ids.some((id) => +id < 400)) return { ok: false, error: 'ships and defense in one order', noBackoff: true };
      page = 'shipyard'; query = { mode: unitsMode(units) }; form = unitsForm(units);
    }
    const before = stockOf(body);
    // the level BEFORE the order: the cost of level+1 for the stock check, and a finished item (fast servers) shows level+1
    // on the answer page with an empty queue box. state.research() is async; merging the answer must not change it first.
    const lvlBefore = await levelBefore(e, body);
    const r = await rawRequest(e, { method: 'POST', page, query, form, cp: e.bodyId, label: e.type });
    limitCount('builds');
    if (!r.ok) return fromReq(r, { verifyExpected: true });
    const info = OGX.parse.gz.infoMessage(r.doc);
    if (info) return { ok: false, error: 'info', message: info, at: r.at };
    mergeState(r.doc);
    const v = verifyBuild(e, r.doc, before, body, lvlBefore);
    return { ok: true, verified: v.ok, verifyExpected: true, verifyNote: v.note, at: r.at, data: { doc: r.doc, how: v.how } };
  }
  async function levelBefore(e, body) {
    const id = +((e.params || {}).id);
    if (!(id > 0) || e.type === 'build.units') return null;
    try {
      if (e.type === 'build.research') { const rs = await OGX.state.research(); const v = rs && rs.levels ? rs.levels[id] : undefined; return v === undefined || v === null ? null : +v; }
      const v = body && body.levels ? body.levels[id] : undefined;
      return v === undefined || v === null ? null : +v;
    } catch (x) { return null; }
  }
  /** Level of `id` on the answer page (techList of page=buildings / page=research), null when not listed. */
  function levelOnPage(doc, id) {
    try {
      const list = OGX.parse.techList(doc) || [];
      const it = list.find((x) => +x.id === +id);
      return it && Number.isFinite(+it.value) ? +it.value : null;
    } catch (x) { return null; }
  }
  function stockOf(body) {
    if (!body) return null;
    try { const p = OGX.state.projected(body, now()); const o = {}; for (const k of RES) o[k] = p.res && p.res[k] ? +p.res[k].amount : null; return o; } catch (x) { return null; }
  }
  function elementNames(id) {
    const c = OGX.catalog.get(+id) || {};
    return [c.en, c.ru, c.ruShort, c.machine].filter(Boolean).map((s) => String(s).toLowerCase());
  }
  function verifyBuild(e, doc, before, body, lvlBefore = null) {
    const p = e.params || {};
    if (e.type === 'build.units') {
      let q = null;
      try { q = OGX.parse.gz.shipyardQueue(doc); } catch (x) { q = null; }
      const ids = Object.keys(p.units || {}).map(Number);
      if (q && q.items.some((it) => ids.includes(it.id))) return { ok: true, how: 'queue' };
      return stockDrop(e, doc, before, body) || { ok: false, note: 'нет в очереди верфи' };
    }
    if (p.cmd === 'cancel') return { ok: true, how: 'cancel' };
    let box = null;
    try { box = OGX.parse.gz.queueBox(doc); } catch (x) { box = null; }
    if (box && !box.empty) {
      const large = doc.querySelector('#technologies .largebox');
      const html = large ? large.innerHTML.toLowerCase() : '';
      const id = +p.id;
      const named = elementNames(id).some((n) => n && html.includes(n));
      const byId = new RegExp('(building|tech|techid|listid|data-id|data-technology)\\D{0,4}' + id + '\\b').test(html);
      if (named || byId) return { ok: true, how: 'queueBox' };
    }
    // finished at once (the queue box is empty again): the answer page lists level+1
    const lvlNow = lvlBefore !== null ? levelOnPage(doc, p.id) : null;
    if (lvlNow !== null && lvlNow === lvlBefore + 1) return { ok: true, how: 'level' };
    return stockDrop(e, doc, before, body, lvlBefore) || { ok: false, note: 'нет в очереди и ресурсы не списаны' };
  }
  function stockDrop(e, doc, before, body, lvlBefore = null) {
    if (!before) return null;
    let after = null;
    try { after = OGX.fleet.gz.stock(doc); } catch (x) { after = null; }
    if (!after) return null;
    const p = e.params || {};
    const costs = [];
    try {
      if (e.type === 'build.units') {
        const cost = res0();
        for (const [id, n] of Object.entries(p.units || {})) { const c = OGX.calc.unitCost(+id, +n); for (const k of RES) cost[k] += +c[k] || 0; }
        costs.push(cost);
      } else if (lvlBefore !== undefined && lvlBefore !== null) costs.push(OGX.calc.cost(+p.id, +lvlBefore + 1));
      else {
        // level unknown before the order: the answer page shows it (queued -> level, finished at once -> level + 1)
        const lvlNow = levelOnPage(doc, p.id);
        if (lvlNow === null) return null;
        costs.push(OGX.calc.cost(+p.id, lvlNow + 1));
        if (lvlNow > 0) costs.push(OGX.calc.cost(+p.id, lvlNow));
      }
    } catch (x) { /* no cost */ }
    const dropped = (cost) => cost && RES.some((k) => +cost[k] > 0) && RES.every((k) => !(+cost[k] > 0) || (before[k] !== null && after[k] !== null && before[k] - after[k] >= 0.9 * cost[k]));
    return costs.some(dropped) ? { ok: true, how: 'stock' } : null;
  }
  async function actDelete(e) {
    const p = e.params || {};
    const ids = (p.ids || []).map(Number).filter((x) => x > 0);
    if (!ids.length) return { ok: false, error: 'ids missing', noBackoff: true };
    const r = await rawRequest(e, { method: 'POST', page: 'messages', form: deleteForm(ids, p.cat), label: 'messages.delete', kind: 'fragment' });
    if (!r.ok) return fromReq(r);
    if (core('readMessages') === false) return { ok: true, verified: false, at: r.at, message: 'не проверено: чтение сообщений выключено' };
    const r2 = await rawRequest(e, { method: 'GET', page: 'messages', query: { mode: 'view', messcat: p.cat !== undefined ? p.cat : 100, site: 1, ajax: 1 }, label: 'messages.delete:verify', kind: 'fragment' });
    if (!r2.ok) return { ok: true, verified: false, verifyExpected: true, verifyNote: 'повторное чтение не удалось', at: r.at };
    const left = ids.filter((id) => r2.doc && r2.doc.querySelector('#message_' + id));
    return { ok: true, verified: left.length === 0, verifyExpected: true, verifyNote: left.length ? 'остались: ' + left.join(',') : null, at: r.at, data: { left } };
  }
  /** An action found 'running' after a leader change: verify before any retry (C3.2). */
  async function verifyUncertain(e) {
    if (e.type === 'fleet.send') {
      const p = e.params || {};
      const { r, ft } = await readFleetTableDoc(e, 'uncertain');
      if (!r.ok || !ft) return fromReq(r || {}, { noBackoff: true });
      const tStr = [target(p).galaxy, target(p).system, target(p).position].join(':');
      const row = (ft.flights || []).find((f) => !f.returning && f.missionId === +p.mission && f.target && f.target.replace(/[[\]]/g, '') === tStr);
      if (row) return { ok: true, verified: true, at: r.at, data: { fleetId: row.fleetId, uncertain: true } };
      return { ok: false, error: 'uncertain', message: 'отправка не найдена после смены вкладки — не повторяю', noBackoff: true, at: r.at };
    }
    if (DRY_FREE.has(e.type) || e.type.startsWith('read.')) { e.state = 'running'; return runAction(e); }
    return { ok: false, error: 'uncertain', message: 'результат неизвестен после смены вкладки — не повторяю', noBackoff: true, at: now() };
  }

  // ------------------------------------------------------------------ master / settings reactions
  function onMasterChange() {
    const on = core('master') === true && !R.stopped;
    if (on) { startTicking(); tryLead('master on'); }
    else {
      cancelQueued('stopped', 'бот выключен');
      if (R.leader) loseLead('master off');
    }
    publishStatus();
  }
  let settingsTimer = null;
  const settingsChanged = new Set();
  function onSettingsChanged(path) {
    settingsChanged.add(path);
    if (settingsTimer) return;
    settingsTimer = setTimeout(() => {
      settingsTimer = null;
      const keys = [...settingsChanged]; settingsChanged.clear();
      if (R.leader) rec('settings', 'Настройки изменены: ' + keys.join(', '), { keys });
      if (keys.some((k) => k === 'botcore.master')) onMasterChange();
      if (R.leader) {
        evalSleep();
        const modulesTouched = new Set(keys.map((k) => k.split('.')[0]));
        if (modulesTouched.has('botcore')) restartWorkers('settings');
        else for (const w of R.workers.values()) {
          if (!modulesTouched.has(w.def.module)) continue;
          if (bot.isActive(w.def.module)) { w.nextAt = now() + bot.randMs(w.def.startJitter || DEFAULT_JITTER[w.def.prio] || [20000, 50000]); armWorker(w); }
          else { if (w.timer) clock.cancel(w.timer); w.timer = null; w.nextAt = null; }
        }
        dropModuleOff('settings');
        kick(0);
      }
      publishStatus();
    }, 2000);
    if (path === 'botcore.master' || path === 'botcore.dryRun') { gatePrecise(path); publishStatus(); }
    // a module switched off: its queued and prepared actions are dropped at once, not after the 2 s debounce
    else if (R.leader && /^bot\w+\.(on|enabled)$/.test(String(path || ''))) { gatePrecise(path); dropModuleOff(path); publishStatus(); }
  }

  // ------------------------------------------------------------------ «всё на авто» (0.3.2)
  // Every bot function is on by default since 0.3.2 (maximum autonomy). An install that already ran an older version keeps
  // its stored switches, so they are switched on here ONCE; whatever the user switches off afterwards stays off.
  const AUTO_ON = ['botcore.master', 'botcore.autoLogin', 'botbuild.on', 'botbuild.moons', 'botbuild.defense',
    'botsave.on', 'botsave.spyAttacker', 'botsave.sleepSave', 'botexpo.on', 'botexpo.colonize', 'botexpo.buildColonizers',
    'botdebris.on', 'botdebris.logistics', 'botdebris.repatriate', 'botfarm.on', 'botfarm.scanGalaxy', 'botfarm.buildShips',
    'botfarm.useFleetAjax', 'botfarm.deleteReports'];
  async function autoAllOnce(hadRun) {
    if (await store.get('autoAll', null)) return;
    if (hadRun) {
      const changed = [];
      for (const k of AUTO_ON) if (sget(k) !== true) { await OGX.settings.set(k, true); changed.push(k); }
      if (core('dryRun') !== false) { await OGX.settings.set('botcore.dryRun', false); changed.push('botcore.dryRun=false'); }
      if (!(Number(core('galaxyViewsPerHour')) > 0)) { await OGX.settings.set('botcore.galaxyViewsPerHour', 300); changed.push('botcore.galaxyViewsPerHour=300'); }
      if (changed.length) rec('settings', 'Все функции бота включены (0.3.2, максимальная автономность): ' + changed.join(', '), { changed });
    }
    await store.set('autoAll', 1);
  }

  // ------------------------------------------------------------------ module
  OGX.module({
    name: NAME,
    title: 'Бот: ядро',
    pages: '*',
    settings: SETTINGS,
    async init(ctx) {
      try {
        R.ctx = ctx;
        R.tab = OGX.storage.tabId;
        clock.init();
        const [stopped, paused, threats, battles, needs, reservations, intel, sleepPlan, recent, lines, status, userBusy, timers, claims] = await Promise.all(
          ['stopped', 'paused', 'threats', 'battles', 'needs', 'reservations', 'intel', 'sleepPlan', 'recent', 'lines', 'status', 'userBusy', 'timers', 'claims'].map((k) => store.get(k, null)));
        R.claims = claims && typeof claims === 'object' ? claims : {};
        R.holds = Array.isArray(await store.get('holds', null)) ? await store.get('holds', null) : [];
        R.stopped = stopped || null;
        R.paused = paused || null;
        R.threats = threats && typeof threats === 'object' ? threats : {};
        R.battles = battles && typeof battles === 'object' ? battles : {};
        R.needs = needs && typeof needs === 'object' ? needs : {};
        R.reservations = Array.isArray(reservations) ? reservations : [];
        R.intel = intel && typeof intel === 'object' ? intel : {};
        R.sleepPlan = sleepPlan && typeof sleepPlan === 'object' ? sleepPlan : {};
        R.recent = Array.isArray(recent) ? recent : [];
        R.lines = Array.isArray(lines) ? lines : [];
        R.storedStatus = status || null;
        await autoAllOnce(!!(status || (Array.isArray(lines) && lines.length) || (Array.isArray(recent) && recent.length)));
        R.userBusy = userBusy || null;
        for (const tm of Array.isArray(timers) ? timers : []) R.timers.set(tm.id, tm);
        await refreshBodies();
        await refreshCalcCaches();
        R.inited = true;
        registerBonusWorker();
        // «Автовход»: this page is a logged-in game page, so a pause 'logout' is over
        R.autoLogin = await alGet();
        if (R.paused && R.paused.reason === 'logout' && R.paused.resumeAfterLogin) await resumeAfterLogin();
        else if (R.autoLogin.pending) await alUpdate(() => ({ pending: null }));
        R.autoLogin = await alGet();
        OGX.storage.subscribe(AUTOLOGIN_KEY, (v) => { R.autoLogin = v || null; publishStatus(); }, { scope: 'global' });
        // the user's own «Выход»: never log back in behind his back
        ctx.on(document, 'click', (ev) => {
          const a = ev.isTrusted && ev.target && ev.target.closest ? ev.target.closest('a[href*="page=logout"]') : null;
          if (a) alUpdate(() => ({ userLogout: Date.now(), pending: null }));
        }, true);

        // cross-tab mirrors
        store.subscribe('status', (v, { remote }) => { if (remote && !(v && v.leaderTab === R.tab)) { R.storedStatus = v; publishStatus(); } });   // never our own status back (publish -> write -> echo loop)
        store.subscribe('stopped', (v, { remote }) => { if (remote) { R.stopped = v || null; if (R.stopped) cancelQueued('stopped', 'остановлен в другой вкладке'); onMasterChange(); } });
        store.subscribe('paused', (v, { remote }) => { if (remote) { R.paused = v || null; if (!v) { restartWorkers('resume'); kick(0); } else gatePrecise('pause'); publishStatus(); } });
        store.subscribe('threats', (v, { remote }) => {
          if (!remote) return;
          const prev = R.threats; R.threats = v && typeof v === 'object' ? v : {};
          const added = Object.keys(R.threats).filter((k) => !prev[k]).map((k) => clone(R.threats[k]));
          const gone = Object.keys(prev).filter((k) => !R.threats[k]).map((k) => clone(prev[k]));
          if (added.length || gone.length) { try { OGX.bus.emit('bot:threat', { added, changed: [], gone }); } catch (e) { /* ignore */ } }
          evalLocks(); publishStatus();
        });
        store.subscribe('battles', (v, { remote }) => {
          if (!remote) return;
          const prev = R.battles; R.battles = v && typeof v === 'object' ? v : {};
          for (const [id, b] of Object.entries(R.battles)) if (!prev[id] || prev[id].updated !== b.updated) { try { OGX.bus.emit('bot:battle-planned', clone(b)); } catch (e) { /* ignore */ } }
          for (const id of Object.keys(prev)) if (!R.battles[id]) { try { OGX.bus.emit('bot:battle-cancelled', { id, reason: 'remote' }); } catch (e) { /* ignore */ } }
        });
        store.subscribe('needs', (v, { remote }) => { if (remote) R.needs = v && typeof v === 'object' ? v : {}; });
        store.subscribe('claims', (v, { remote }) => { if (remote) R.claims = v && typeof v === 'object' ? v : {}; });
        store.subscribe('holds', (v, { remote }) => { if (remote) R.holds = Array.isArray(v) ? v : []; });
        store.subscribe('reservations', (v, { remote }) => { if (remote) R.reservations = Array.isArray(v) ? v : []; });
        store.subscribe('intel', (v, { remote }) => { if (remote) R.intel = v && typeof v === 'object' ? v : {}; });
        store.subscribe('recent', (v, { remote }) => { if (remote) { R.recent = Array.isArray(v) ? v : []; publishStatus(); } });
        store.subscribe('lines', (v, { remote }) => { if (remote) R.lines = Array.isArray(v) ? v : []; });
        store.subscribe('userBusy', (v) => { R.userBusy = v || null; });
        store.subscribe('leaderWant', (v) => { R.lastWantSeen = v || null; });
        store.subscribe('notify', (v, { remote }) => { if (remote && v && v.tab !== R.tab) showNotice(v); });   // own writes echo back as remote (storage.onChanged): shown already
        store.subscribe('timers', (v, { remote }) => {
          if (!remote || !R.leader) return;
          for (const tm of Array.isArray(v) ? v : []) if (!R.timers.has(tm.id)) { R.timers.set(tm.id, tm); armTimer(tm); }
        });
        // fast takeover after the leader released the lock (pagehide)
        OGX.storage.subscribe('lock.bot.leader', (v, { remote }) => { if (remote && !v && !R.leader) setTimeout(() => tryLead('released'), bot.rand(50, 400)); });
        OGX.settings.onChange('*', (path) => {
          if (!path) return;
          if (path.startsWith('botcore.') || MODULES.some((m) => path === m + '.on' || path === m + '.enabled') || [...R.workers.values()].some((w) => path.startsWith(w.def.module + '.'))) onSettingsChanged(path);
        });
        ctx.bus.on('state:updated', () => { refreshBodies().then(bodiesChanged); refreshCalcCaches(); });
        // other tabs store the event box too: keep the sync mirror (wctx.flights) current
        OGX.storage.subscribe('flights', (v, { remote }) => { if (remote) setFlights(v); });
        ctx.bus.on('flights:updated', (p) => {
          const list = p && Array.isArray(p.flights) ? p.flights : [];
          setFlights({ t: p && p.t, flights: list });
          trackReturns(list);
          updateThreats(list.map(threatFromFlight), { complete: true, src: 'flights' });
        });

        // this page: event box (threats), stop conditions, slots, fleet returns
        let cached = null;
        try { cached = await OGX.flights.cached(); } catch (e) { cached = null; }
        if (cached) setFlights(cached);
        bodiesChanged();
        if (hasEventBox(document)) {
          const fromDoc = threatsFromDoc(document);
          const fromFl = cached && Array.isArray(cached.flights) ? cached.flights.map(threatFromFlight).filter(Boolean) : [];
          // ownerId from the markup, the rest from either list
          const byKey = new Map(fromFl.map((t) => [t.key, t]));
          for (const t of fromDoc) byKey.set(t.key, Object.assign({}, byKey.get(t.key) || {}, t));
          await updateThreats([...byKey.values()], { complete: true, src: 'page' });
          if (cached) trackReturns(cached.flights);
        } else if (cached) trackReturns(cached.flights);
        try {
          if (OGX.page.is('fleet') && !OGX.page.info().step) {
            const ft = OGX.parse.gz.fleetTable(document);
            if (ft) setSlots(slotsFromFleetTable(ft));
          }
        } catch (e) { /* ignore */ }
        if (!R.slots) {
          try {
            const s = OGX.state.slots();
            if (s && s.fleet && s.fleetSrc === 'fleetTable' && s.expedition) R.slots = { fleet: s.fleet, expedition: s.expedition, asteroids: null, t: s.fleetT || s.t, known: true, src: 'cache' };
          } catch (e) { /* ignore */ }
        }
        // stop conditions on the page the user sees (only while the bot is on)
        if (core('master') === true && !R.stopped) {
          if (isCaptchaDoc(document)) await hardStop('captcha', 'капча на странице', { page: location.href });
          else { try { if (OGX.parse.gz.vacation(document).vacation) await hardStop('vacation', 'включён режим отпуска', { page: location.href }); } catch (e) { /* ignore */ } }
        }

        // user first: clicks/keys in the game (not in our own UI) and the user's own dispatch pages
        const userEv = (ev) => {
          if (!ev.isTrusted) return;
          const t = ev.target;
          if (t && t.closest && t.closest('.ogx-root, .ogx-panel, .ogx-modal-overlay')) return;
          markUserBusy('click', Math.max(0, +core('userIdleSec') || 0) * 1000);
        };
        ctx.on(document, 'mousedown', userEv, true);
        ctx.on(document, 'keydown', userEv, true);
        let stepTimer = null;
        try {
          const step = OGX.page.info().step;
          if (step === 1 || step === 2) {
            // short lease refreshed every 30 s: a mark left behind by a tab that closed without pagehide (crash, killed renderer,
            // bfcache) expires after 90 s instead of stalling the queue for the token's 10 minutes
            markUserBusy('fleetStep', 90000);
            stepTimer = setInterval(() => markUserBusy('fleetStep', 90000), 30000);
          }
        } catch (e) { /* ignore */ }

        // lifecycle
        ctx.on(document, 'freeze', () => rec('frozen', 'Вкладка заморожена браузером', { leader: R.leader }));
        ctx.on(document, 'resume', () => { rec('resumed', 'Вкладка разморожена', { leader: R.leader }); if (R.leader) { for (const tm of R.timers.values()) armTimer(tm); restartWorkers('resumed'); kick(0); } });
        ctx.on(document, 'visibilitychange', () => { if (!document.hidden && core('master') === true && !R.leader) { store.set('leaderWant', { tab: R.tab, t: now() }); tryLead('visible'); } });
        window.addEventListener('pagehide', () => {
          if (stepTimer) clearInterval(stepTimer);
          if (R.userBusy && R.userBusy.tab === R.tab && R.userBusy.why === 'fleetStep') { try { OGX.storage.set(S('userBusy'), null); } catch (e) { /* ignore */ } }
          if (R.leader) {
            const running = R.queue.find((e) => e.id === R.running);
            if (running) running.state = 'running';
            for (const e of R.queue) if (e.state === 'pre') e.state = 'queued';
            persistQueue();
            try { OGX.storage.set(S('status'), Object.assign(localStatus(), { leader: false, leaderTab: null })); } catch (e) { /* ignore */ }
            try { OGX.storage.remove('lock.bot.leader'); } catch (e) { /* ignore */ }
            R.leader = false;
            try { OGX.storage.flush(); } catch (e) { /* ignore */ }
            try { OGX.log.rec('B', NAME + ':leader-lost', 'Вкладка закрыта', { why: 'pagehide' }); } catch (e) { /* ignore */ }
          }
        });

        // dispose expired reservations now and then
        R.reservations = liveReservations();
        startTicking();
        if (core('master') === true && !R.stopped) await tryLead('init');
        publishStatus();
      } finally {
        resolveReady();
      }
    },
  });

  // test/diagnostic hooks (not part of the contract)
  bot._R = R;
  bot._clock = clock;
  bot._stopCheck = stopCheck;
  bot._mapStep3Text = mapStep3Text;
})(window.OGX);

/* «Автовход» — the content part on the universe login page (2Moons index.php: form#login with input[name=username] /
 * input[name=password] and a submit «Вход»). OGX.boot never starts there (not a game page), so this runs on its own at load
 * and does nothing unless botcore left a fresh pending record for THIS host ('*|*|botcore.autologin', written only when the
 * bot was on with botcore.autoLogin and saw a logout). Then it waits up to 10 s for the BROWSER's autofill and clicks «Вход».
 * The password is never read: only `value.length > 0` (a boolean «filled») or the :-webkit-autofill mark is checked; nothing
 * of the form is logged, stored or sent. At most 3 attempts per hour (timestamps in the record); every attempt goes to the
 * background journal (no page data, no credentials). */
(function () {
  'use strict';
  const KEY = '*|*|botcore.autologin';
  const LS_KEY = 'ogx.suite.' + KEY;           // localStorage fallback of OGX.storage (ext 'suite')
  const MAX_PER_HOUR = 3;
  const HOUR = 3600000;
  const WAIT_MS = 10000;
  const PENDING_TTL = 30 * 60000;
  const BUTTON_RE = /^\s*(вход|войти|войти в игру|login|log in|sign in|anmelden|einloggen|entrar|connexion)\s*$/i;
  const api = { area: null };
  let path = '';
  try { path = location.pathname || ''; } catch (e) { return; }
  if (typeof document === 'undefined' || !/(\/index\.php|\/)$/i.test(path)) return;

  function passwordField() {
    const list = [...document.querySelectorAll('input[type="password"]')];
    return list.find((i) => /^(password|pass|passwort|pw)$/i.test(i.name || i.id || '')) || list[0] || null;
  }
  const filled = (el) => { try { return !!el && el.value.length > 0; } catch (e) { return false; } };   // boolean only, never the value
  const autofillMark = (el) => { try { return !!el && el.matches(':-webkit-autofill'); } catch (e) { return false; } };
  const label = (el) => String((el.tagName === 'INPUT' ? el.value : el.textContent) || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  /** «Вход» of the login form: in the form by visible text, then the form's submit control, then by text anywhere on the page. */
  function submitButton(form) {
    const byText = (sc) => [...sc.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]')].find((el) => BUTTON_RE.test(label(el))) || null;
    if (form) {
      const b = byText(form) || form.querySelector('button[type="submit"], input[type="submit"], input[type="image"], button:not([type])');
      if (b) return b;
    }
    return byText(document);
  }
  function area() {
    try { if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return chrome.storage.local; } catch (e) { /* ignore */ }
    try { if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) return browser.storage.local; } catch (e) { /* ignore */ }
    return null;
  }
  function read() {
    return new Promise((resolve) => {
      const a = api.area;
      if (a) {
        try {
          const r = a.get([KEY], (v) => resolve((v && v[KEY]) || null));
          if (r && typeof r.then === 'function') r.then((v) => resolve((v && v[KEY]) || null), () => resolve(null));
        } catch (e) { resolve(null); }
        return;
      }
      try { resolve(JSON.parse(localStorage.getItem(LS_KEY) || 'null')); } catch (e) { resolve(null); }
    });
  }
  async function patch(fields) {
    const cur = (await read()) || {};
    const next = Object.assign({}, cur, fields);
    return new Promise((resolve) => {
      const a = api.area;
      if (a) {
        try {
          const r = a.set({ [KEY]: next }, () => resolve(next));
          if (r && typeof r.then === 'function') r.then(() => resolve(next), () => resolve(next));
        } catch (e) { resolve(next); }
        return;
      }
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch (e) { /* blocked */ }
      resolve(next);
    });
  }
  function journal(what, data) {
    const ev = { t: Date.now(), s: 'B', k: 'botcore:autologin', w: String(what).slice(0, 300), p: 'login', x: 'suite', tab: 'login', d: Object.assign({ host: location.host }, data || {}) };
    try {
      const rt = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome.runtime
        : (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) ? browser.runtime : null;
      if (rt) { const r = rt.sendMessage({ type: 'ogx:diag:put', events: [ev] }, () => { try { void chrome.runtime.lastError; } catch (e) { /* ignore */ } }); if (r && r.catch) r.catch(() => {}); }
    } catch (e) { /* journal unavailable */ }
    try { console.info('[OGX Suite/botcore]', what); } catch (e) { /* ignore */ }
    window.__ogxAutoLogin = (window.__ogxAutoLogin || []).concat([{ t: ev.t, w: ev.w, d: ev.d }]);   // tests / devtools
    return ev;
  }
  const say = (text, data) => { journal(text, data); return patch({ last: { t: Date.now(), text } }); };

  async function run() {
    const pw = passwordField();
    if (!pw) return;                                   // not a login page
    api.area = area();
    const rec = await read();
    const p = rec && rec.pending;
    if (!p || p.host !== location.host || !(Date.now() - p.t < PENDING_TTL)) return;   // the bot did not ask for it here
    if (rec.gaveUp && rec.gaveUp >= p.t) return;       // gave up for this logout already
    const attempts = (Array.isArray(rec.attempts) ? rec.attempts : []).filter((t) => Date.now() - t < HOUR);
    if (attempts.length >= MAX_PER_HOUR) {
      await say('Автовход: уже ' + MAX_PER_HOUR + ' попытки за час — больше не пробую, войдите вручную', { attempts: attempts.length });
      await patch({ gaveUp: Date.now(), attempts });
      return;
    }
    const t0 = Date.now();
    while (!filled(pw) && Date.now() - t0 < WAIT_MS) await new Promise((r) => setTimeout(r, 250));
    let how = 'filled';
    if (!filled(pw)) {
      // Chrome may hide an autofilled value until the first user gesture: the field then only carries :-webkit-autofill
      if (autofillMark(pw) && rec.markTried !== p.t) { how = 'autofill-mark'; await patch({ markTried: p.t }); }
      else {
        await say('Автовход: браузер не подставил пароль', { waitedMs: Date.now() - t0 });
        await patch({ gaveUp: Date.now() });
        return;
      }
    }
    const form = pw.form || pw.closest('form');
    const btn = submitButton(form);
    if (!btn && !(form && typeof form.requestSubmit === 'function')) {
      await say('Автовход: кнопка «Вход» не найдена', {});
      await patch({ gaveUp: Date.now() });
      return;
    }
    attempts.push(Date.now());
    await patch({ attempts });
    await say('Автовход: попытка ' + attempts.length + ' из ' + MAX_PER_HOUR + ' за час — нажимаю «' + (btn ? label(btn) || 'Вход' : 'Вход') + '»', { attempt: attempts.length, how, button: btn ? btn.tagName.toLowerCase() : 'requestSubmit' });
    if (btn) btn.click(); else form.requestSubmit();
  }
  const start = () => { run().catch((e) => { try { console.warn('[OGX Suite/botcore] autologin', e && e.message); } catch (x) { /* ignore */ } }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
