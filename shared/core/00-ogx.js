/* shared/core/00-ogx.js — namespace, logger, error isolation, module registry, boot lifecycle. Owner: core. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';

  OGX.version = OGX.version || '0.3.2';
  if (OGX.ext === undefined) OGX.ext = null;
  if (OGX.active === undefined) OGX.active = false;
  OGX.modules = OGX.modules || {};
  OGX.errors = OGX.errors || [];
  OGX.style = OGX.style || {};

  // ------------------------------------------------------------------ logger
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  const extLabel = () => (OGX.ext === 'live' ? 'Live' : OGX.ext === 'infinity' ? 'Infinity' : OGX.ext === 'suite' ? 'Suite' : OGX.ext === 'bot' ? 'Bot' : 'Core');
  function currentLevel() {
    try {
      const s = OGX.settings && OGX.settings.get && OGX.settings.get('core.logLevel');
      if (s && LEVELS[s]) return LEVELS[s];
    } catch (e) { /* settings not ready */ }
    return LEVELS.warn;
  }
  function pushError(where, args) {
    const err = args.find((a) => a instanceof Error);
    const message = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a))).join(' ');
    OGX.errors.push({ t: Date.now(), where, message, stack: err && err.stack ? String(err.stack) : null });
    if (OGX.errors.length > 50) OGX.errors.splice(0, OGX.errors.length - 50);
  }
  function safeJson(v) {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  OGX.log = OGX.log || {};
  // Event journal entry points; 22-diag.js replaces these no-op defaults (see CORE_API "Diagnostics").
  if (!OGX.log.rec) OGX.log.rec = function () { return null; };
  if (!OGX.log.wrap) OGX.log.wrap = function (m, fn) { return fn; };
  // Diagnostic journal: every log call (all levels) goes into an in-memory ring buffer; warn/error entries are
  // also persisted (player scope, key 'diag.log', last DIAG_KEEP) so a user can download a report after a failure.
  const RING_MAX = 500;
  const DIAG_KEEP = 300;
  const ring = [];
  let diagPending = [];
  let diagTimer = null;
  const fmtArg = (a) => (a instanceof Error ? a.message + (a.stack ? '\n' + String(a.stack).split('\n').slice(1, 6).join('\n') : '')
    : typeof a === 'string' ? a : safeJson(a));
  function record(lvl, tag, args) {
    let msg;
    try { msg = args.map(fmtArg).join(' '); } catch (e) { msg = '(unprintable)'; }
    if (msg.length > 4000) msg = msg.slice(0, 4000) + '…';
    const entry = { t: Date.now(), lvl, tag, msg, page: pageName() };
    ring.push(entry);
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
    if (LEVELS[lvl] >= LEVELS.warn) {
      diagPending.push(entry); scheduleDiag();
      // event journal (22-diag.js): warnings and errors of every logger become S events with the stack
      if (typeof OGX.log.rec === 'function') {
        const err = args.find((a) => a instanceof Error);
        const kind = lvl === 'warn' ? 'warn' : tag === 'uncaught' ? 'uncaught' : tag === 'rejection' ? 'rejection' : 'error';
        OGX.log.rec('S', kind, tag, { msg: msg.split('\n')[0].slice(0, 1000), stack: err && err.stack ? String(err.stack).split('\n').slice(0, 12).join('\n') : undefined });
      }
    }
  }
  function pageName() {
    try { return OGX.page && OGX.page.info ? OGX.page.info().name : null; } catch (e) { return null; }
  }
  function storageReady() { return !!(OGX.storage && OGX.storage.ns && OGX.active); }
  function scheduleDiag() {
    if (diagTimer || !storageReady()) return;
    diagTimer = setTimeout(() => { diagTimer = null; flushDiag(); }, 2000);
  }
  function flushDiag() {
    if (!diagPending.length || !storageReady()) return Promise.resolve();
    const add = diagPending; diagPending = [];
    try {
      return Promise.resolve(OGX.storage.update('diag.log', (old) => {
        const list = Array.isArray(old) ? old.concat(add) : add.slice();
        return list.length > DIAG_KEEP ? list.slice(list.length - DIAG_KEEP) : list;
      }, [])).catch(() => undefined);
    } catch (e) { return Promise.resolve(); }
  }
  OGX.log._flushDiag = flushDiag;
  OGX.log.entries = (minLevel = 'debug') => ring.filter((e) => LEVELS[e.lvl] >= (LEVELS[minLevel] || 0)).slice();
  OGX.log.persisted = async function () {
    if (!storageReady()) return [];
    await flushDiag();
    try { const v = await OGX.storage.get('diag.log', []); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  };
  OGX.log.clear = async function () {
    ring.length = 0; diagPending = []; OGX.errors.length = 0;
    if (storageReady()) { try { await OGX.storage.remove('diag.log'); } catch (e) { /* ignore */ } }
  };
  OGX.log.report = async function () {
    const line = (e) => `${new Date(e.t).toISOString()} ${String(e.lvl).toUpperCase().padEnd(5)} [${e.tag}]${e.page ? ' (' + e.page + ')' : ''} ${e.msg}`;
    const out = [];
    out.push('=== OGX diagnostic report ===');
    out.push('ext: ' + (OGX.ext || '-') + '  core: ' + OGX.version + '  generated: ' + new Date().toISOString());
    try { out.push('url: ' + location.origin + location.pathname + location.search); } catch (e) { /* ignore */ }
    try { out.push('userAgent: ' + navigator.userAgent); } catch (e) { /* ignore */ }
    try { out.push('page: ' + pageName() + '  player: ' + (OGX.storage && OGX.storage.ns ? OGX.storage.ns.playerId : '-') + '  storage: ' + (OGX.storage && OGX.storage.backendName)); } catch (e) { /* ignore */ }
    try { out.push('modules: ' + OGX._ctxs.map((c) => c.def.name).join(', ')); } catch (e) { /* ignore */ }
    try { out.push('settings.core: ' + safeJson(OGX.settings.all('core'))); } catch (e) { /* ignore */ }
    out.push('', '--- errors (this page) ---');
    for (const e of OGX.errors) out.push(`${new Date(e.t).toISOString()} [${e.where}] ${e.message}` + (e.stack ? '\n  ' + e.stack.split('\n').slice(0, 8).join('\n  ') : ''));
    out.push('', '--- journal (saved warnings and errors, previous pages included) ---');
    for (const e of await OGX.log.persisted()) out.push(line(e));
    out.push('', '--- journal (this page, all levels) ---');
    for (const e of ring) out.push(line(e));
    return out.join('\n');
  };
  OGX.log.download = async function () {
    const text = await OGX.log.report();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (OGX.dom && OGX.dom.download) OGX.dom.download(`ogx-${OGX.ext || 'core'}-log-${stamp}.txt`, text, 'text/plain');
    return text;
  };
  OGX.log.create = function (tag) {
    const prefix = () => `[OGX ${extLabel()}/${tag}]`;
    const out = (lvl, method) => (...a) => {
      if (lvl === 'error') pushError(tag, a);
      try { record(lvl, tag, a); } catch (e) { /* never break logging */ }
      if (LEVELS[lvl] < currentLevel()) return;
      try { (console[method] || console.log).call(console, prefix(), ...a); } catch (e) { /* console unavailable */ }
    };
    return { debug: out('debug', 'debug'), info: out('info', 'info'), warn: out('warn', 'warn'), error: out('error', 'error') };
  };
  const log = OGX.log.create('core');
  OGX._log = log;

  // ------------------------------------------------------------------ safe
  OGX.safe = function (fn, where) {
    if (typeof fn !== 'function') return () => undefined;
    const tag = where || fn.name || 'callback';
    const L = OGX.log.create(tag);
    return function ogxSafe(...args) {
      try {
        const r = fn.apply(this, args);
        if (r && typeof r.then === 'function') {
          return r.then(undefined, (e) => { L.error('failed:', e); return undefined; });
        }
        return r;
      } catch (e) {
        L.error('failed:', e);
        return undefined;
      }
    };
  };

  // ------------------------------------------------------------------ module registry
  const pendingSchemas = [];
  OGX.module = function (def) {
    if (!def || typeof def.name !== 'string' || !def.name) throw new Error('OGX.module: name required');
    if (OGX.modules[def.name]) throw new Error('OGX.module: duplicate module ' + def.name);
    if (typeof def.init !== 'function') throw new Error('OGX.module: init required for ' + def.name);
    OGX.modules[def.name] = def;
    const schema = Object.assign({
      enabled: { type: 'bool', default: true, label: 'Включить модуль «' + (def.title || def.name) + '»', section: 'Модули' },
    }, def.settings || {});
    if (OGX.settings && OGX.settings.define) OGX.settings.define(def.name, schema);
    else pendingSchemas.push([def.name, schema]);
  };
  OGX._flushPendingSchemas = function () {
    while (pendingSchemas.length) {
      const [ns, schema] = pendingSchemas.shift();
      OGX.settings.define(ns, schema);
    }
  };

  // ------------------------------------------------------------------ module context
  function pageMatches(def, info) {
    if (def.pages === '*' || def.pages === undefined) return true;
    const list = Array.isArray(def.pages) ? def.pages : [def.pages];
    return list.includes(info.name) || (info.aliases || []).some((a) => list.includes(a));   // GALAXYZ aliases (page=buildings = resources + facilities)
  }
  OGX._pageMatches = pageMatches;

  function makeCtx(ext, name) {
    const listeners = [];
    const everies = [];
    const ctx = {
      ext, name,
      log: OGX.log.create(name),
      page: OGX.page.info(),
      settings: {
        get: (key) => OGX.settings.get(name + '.' + key),
        set: (key, value) => OGX.settings.set(name + '.' + key, value),
        all: () => OGX.settings.all(name),
        onChange: (fn) => OGX.settings.onChange(name, (path, value) => fn(path.slice(name.length + 1), value)),
      },
      store: {
        get: (key, def = null, opts) => OGX.storage.get(name + '.' + key, def, opts),
        set: (key, value, opts) => OGX.storage.set(name + '.' + key, value, opts),
        update: (key, fn, def = null, opts) => OGX.storage.update(name + '.' + key, fn, def, opts),
        remove: (key, opts) => OGX.storage.remove(name + '.' + key, opts),
        subscribe: (key, fn, opts) => OGX.storage.subscribe(name + '.' + key, fn, opts),
      },
      css: (text) => OGX.dom.injectStyle(`ogx-${String(ext || 'x')[0]}-${name}`, text),
      on(target, type, handler, opts) {
        if (!target || !target.addEventListener) return () => {};
        const h = OGX.safe(handler, name + ':' + type);
        target.addEventListener(type, h, opts);
        const off = () => { try { target.removeEventListener(type, h, opts); } catch (e) { /* gone */ } };
        listeners.push(off);
        return off;
      },
      every(ms, fn) {
        const entry = { ms: Math.max(0, +ms || 0), last: 0, fn: OGX.safe(fn, name + ':every') };
        everies.push(entry);
        return () => { const i = everies.indexOf(entry); if (i >= 0) everies.splice(i, 1); };
      },
      bus: OGX.bus,
      state: OGX.state,
      _dispose() { while (listeners.length) listeners.pop()(); everies.length = 0; },
      _everies: everies,
    };
    return ctx;
  }

  // ------------------------------------------------------------------ boot
  OGX._ctxs = OGX._ctxs || [];
  /**
   * boot options (DESIGN 2.2; the last three are used by the combined extension OgameX Suite, see specs/SUITE.md):
   *   sections: { live: [names], infinity: [names], bot: [names] } — module -> section; a module's ctx.ext is its section,
   *             and html[data-ogx-<section>] is set (boot/ready) for every section with at least one enabled module.
   *   gate():   async, after the synchronous snapshot; false = stop here (e.g. host not in the allow-list). Nothing is stored.
   *   filter(name): sync, false = module switched off globally (on top of the per-account setting <name>.enabled).
   */
  OGX.boot = async function ({ ext, modules = [], sections = null, gate = null, filter = null } = {}) {
    // 1. Detection first: nothing else (no storage, no logging above debug) on foreign sites.
    let det = null;
    try { det = OGX.page.detect(document, location); } catch (e) { det = { ok: false, reason: String(e && e.message) }; }
    if (!det.ok) {
      log.debug('not a game page:', det.reason);
      // A page that looks like a game page but was refused (e.g. a GALAXYZ page without serverTime): one background-journal
      // line with the reason (no page data), so «nothing shows» reports explain themselves. Only when the generator meta
      // names a known engine: a bare /game.php on some other site is not ours to record (no storage, no journal there).
      if (det.candidate && det.engine) { try { if (OGX.diag && OGX.diag.recordGated) OGX.diag.recordGated('not-detected', { reason: det.reason, engine: det.engine, generator: det.generator }); } catch (e) { /* ignore */ } }
      return;
    }
    OGX.page.setEngine(det.engine);
    if (OGX._booted) return;
    OGX._booted = true;
    // 2. Synchronous snapshot before the first await (tooltips are stripped by the game's Tipped later).
    let snap;
    try { snap = OGX.state.snapshotSync(document); } catch (e) { log.error('snapshot failed', e); snap = null; }
    if (typeof gate === 'function') {
      let pass = true;
      try { pass = (await gate()) !== false; } catch (e) { pass = true; }
      if (!pass) { OGX._booted = false; log.debug('boot stopped by gate'); return; }
    }
    // 2b. Identity. GALAXYZ keys the player namespace by name ('n:<name>'): without a name every account of this
    // universe would share the namespace '0' (wrong planets, wrong prefs). Refuse the page, read-only: nothing stored,
    // no modules, one background-journal line with the reason.
    let ident = null;
    try { ident = OGX.page.identity(snap); } catch (e) { ident = null; }
    if (OGX.page.isGz() && (!ident || ident.playerId === null || ident.playerId === undefined || ident.playerId === '')) {
      const reason = 'galaxyz: player name not found (#playerName) - storage namespace unknown';
      log.warn('boot refused:', reason);
      OGX.refused = { reason, t: Date.now() };
      try { document.documentElement.dataset['ogx' + (ext ? ext[0].toUpperCase() + ext.slice(1) : 'Core')] = 'refused'; } catch (e) { /* ignore */ }
      try { if (OGX.diag && OGX.diag.recordGated) OGX.diag.recordGated('no-player', { detail: reason, engine: det.engine }); } catch (e) { /* ignore */ }
      return;
    }
    const sectionOf = {};
    if (sections && typeof sections === 'object') for (const [sec, list] of Object.entries(sections)) for (const n of list || []) sectionOf[n] = sec;
    OGX._sectionOf = sectionOf;
    const isOn = (name) => {
      if (typeof filter === 'function') { try { if (filter(name) === false) return false; } catch (e) { /* filter broken: keep on */ } }
      try { return OGX.settings.get(name + '.enabled') !== false; } catch (e) { return true; }
    };
    OGX._moduleOn = isOn;
    let sectionMarks = [];
    const setSectionMarks = (v) => { for (const sec of sectionMarks) { try { root.dataset['ogx' + sec[0].toUpperCase() + sec.slice(1)] = v; } catch (e) { /* ignore */ } } };
    // 3. Mark the page.
    OGX.ext = ext || null;
    OGX.active = true;
    const Ext = ext ? ext[0].toUpperCase() + ext.slice(1) : 'Core';
    const root = document.documentElement;
    const setMark = (v) => { try { root.dataset['ogx' + Ext] = v; } catch (e) { /* ignore */ } };
    setMark('boot');
    log.info('boot', OGX.version, 'page', OGX.page.info().name);
    try {
      if (!snap) snap = { player: { id: null }, parsedAtMs: Date.now(), page: OGX.page.info().name, current: null, planets: [] };
      // 4. Storage.
      if (!ident) ident = OGX.page.identity(snap);
      await OGX.storage.init({ ext: OGX.ext, host: ident.host, playerId: ident.playerId });
      // 5. Settings, time, style, bridge.
      OGX._flushPendingSchemas();
      await OGX.settings.load();
      // Sections with at least one enabled module get their own page mark (coexistence signal for other modules).
      sectionMarks = [...new Set(modules.filter((n) => sectionOf[n] && sectionOf[n] !== ext && OGX.modules[n] && isOn(n)).map((n) => sectionOf[n]))];
      setSectionMarks('boot');
      // Event journal and self-learning (22-diag.js, 23-learn.js) start before everything else that can fail.
      OGX.safe(() => OGX.diag && OGX.diag.init(snap), 'diag')();
      await OGX.safe(() => OGX.learn && OGX.learn.init(snap), 'learn')();
      OGX.time.init(snap);
      await OGX.safe(() => OGX.time.ready, 'time')();
      OGX.dom.injectStyle('ogx-core', OGX.style.core || '');
      OGX.safe(() => OGX.bridge.init(), 'bridge')();
      // 6. State and the core page features.
      await OGX.safe(() => OGX.state.merge(snap), 'state')();
      OGX.safe(() => OGX.state.init && OGX.state.init(), 'state')();
      OGX.safe(() => OGX.flights.init && OGX.flights.init(), 'flights')();
      OGX.safe(() => OGX.galaxy.init(), 'galaxy')();
      OGX.safe(() => OGX.fleet.initPrefill(), 'fleet')();
      // 7. Modules, in loader order, each isolated.
      const info = OGX.page.info();
      const times = {};
      for (const name of modules) {
        const def = OGX.modules[name];
        if (!def) { log.warn('module not registered:', name); continue; }
        if (!isOn(name) || !pageMatches(def, info)) continue;
        let ctx;
        try { ctx = makeCtx(sectionOf[name] || OGX.ext, name); } catch (e) { log.error('ctx for ' + name, e); continue; }
        OGX._ctxs.push({ def, ctx });
        const t0 = Date.now();
        let failure = null;
        await OGX.safe(async (c) => { try { return await def.init(c); } catch (e) { failure = e; throw e; } }, name)(ctx);
        times[name] = Date.now() - t0;
        if (failure) OGX.log.rec('S', 'module-init-fail', name, { error: failure instanceof Error ? failure : String(failure), ms: times[name] });
      }
      OGX.log.rec('S', 'ready', info.name, { ms: Math.round((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0), modules: times });
      OGX.safe(() => OGX.diag && OGX.diag.publishContext(), 'diag')();
    } catch (e) {
      log.error('boot failed', e);
      try { OGX.log.rec('S', 'boot-fail', 'boot', { error: e }); } catch (x) { /* ignore */ }
    }
    // Uncaught errors and rejections from OGX code are captured by 22-diag.js (installed in diag.init).
    // 8. Ready, tick.
    setSectionMarks('ready');
    setMark('ready');
    OGX.bus.emit('ready');
    startTick();
    // 9. pagehide: flush and dispose.
    window.addEventListener('pagehide', OGX.safe(() => {
      try { flushDiag(); OGX.storage.flush(); } catch (e) { /* ignore */ }
      for (const { def, ctx } of OGX._ctxs) {
        if (def.dispose) OGX.safe(def.dispose.bind(def), def.name + ':dispose')(ctx);
        ctx._dispose();
      }
    }, 'pagehide'));
  };

  function runTick() {
    const now = OGX.time.serverNow();
    OGX.bus.emit('tick', now);
    OGX.safe(() => OGX.dom.updateCountdowns(now), 'countdowns')();
    const local = Date.now();
    for (const { ctx } of OGX._ctxs) {
      for (const e of ctx._everies.slice()) {
        if (local - e.last >= e.ms) { e.last = local; e.fn(now); }
      }
    }
  }
  OGX._runTick = runTick;
  function startTick() {
    if (OGX._tickTimer) clearInterval(OGX._tickTimer);
    let ms = 1000;
    try { ms = Math.max(250, Math.min(5000, +OGX.settings.get('core.tickMs') || 1000)); } catch (e) { ms = 1000; }
    OGX._tickTimer = setInterval(() => {
      if (document.hidden) return;
      runTick();
    }, ms);
    if (!OGX._tickWatch) {
      OGX._tickWatch = true;
      try { OGX.settings.onChange('core.tickMs', () => startTick()); } catch (e) { /* ignore */ }
    }
  }
})(window.OGX);
