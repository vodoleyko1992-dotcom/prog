/* shared/core/23-learn.js — self-learning ("самообучение"). Owner: core.
 * Learns, per OgameX page, the structural tokens (ids, classes, data-* names, meta names) and the hit rate of every
 * selector the add-ons query through OGX.dom.$/$$/waitFor (or OGX.learn.sel); per AJAX endpoint the JSON key schema of
 * each response kind (ok/err). Raises L-alerts (journal source L, deduplicated per key for 6 h) on drift and implausible
 * parser values, and stores a sanitized DOM snapshot with each alert batch. State: server-scope key 'diag.learn'. */
(function (OGX) {
  'use strict';
  const L = OGX.diaglib;
  const learn = (OGX.learn = OGX.learn || {});
  const KEY = 'diag.learn';
  const OPTS = { scope: 'server' };

  learn.config = {
    sel: { minVisits: 6, minRate: 0.85, missStreak: 3, maxPerPage: 400 },
    tok: { minVisits: 5, presentRate: 0.9, goneStreak: 2, newCount: 2, maxPerPage: 1500, maxPerVisit: 1500 },
    api: { minN: 5, keyRate: 0.95, newEndpointAfter: 30, maxKeys: 300, maxEndpoints: 300 },
    dedupMs: 6 * 3600 * 1000,
    saveMs: 5000,
    visitEndMs: 20000,
    alertLog: 200,
  };

  let state = null;            // loaded state
  let active = false;
  let visit = null;            // { page, tokens: Set, sels: Map, t0, committed: Set }
  const pendingApi = [];       // observations before the state is loaded
  let dirty = false;
  let saveTimer = null;
  let lastSnapT = 0;

  const enabled = () => { try { return OGX.settings.get('diag.learn') !== false; } catch (e) { return true; } };
  const now = () => Date.now();
  function fresh() { return { v: 1, t0: now(), pages: {}, api: {}, apiTotal: 0, alerts: {}, alertLog: [] }; }
  function valid(s) { return s && typeof s === 'object' && s.v === 1 && s.pages && s.api ? s : null; }
  learn.state = () => state;
  learn.isActive = () => active;
  const norm = (s) => String(s).replace(/\d+/g, '#');
  /**
   * Learning key of the current page: the page name, plus the variants whose markup legitimately differs, so normal play
   * never looks like drift: ':moon' when the active body is a moon (planet and moon versions of overview/fleet/... differ)
   * and ':noships' for the fleet page without ships (#warning instead of the ship table). Planet pages keep the plain
   * name (state learned before this split stays valid).
   */
  learn.pageKey = function (doc = document) {
    let i;
    try { i = OGX.page.info(); } catch (e) { return 'other'; }
    if (i.name === 'other') return 'other:' + (i.engine === 'galaxyz' ? String(i.raw || '').toLowerCase() : L.normalizePath(i.path));
    // GALAXYZ: one PageName can cover several game pages with their own markup (fleet = fleetTable + fleetStep1..3,
    // merchant = trader + fleetDealer): the raw page is part of the key, and info/message pages get ':info'
    const raw = i.engine === 'galaxyz' ? String(i.raw || '').toLowerCase() : '';
    let key = i.name + (raw && raw !== i.name.toLowerCase() ? ':' + raw : '') + (i.engine === 'galaxyz' && i.info ? ':info' : '');
    try {
      let cur = OGX.state && OGX.state.current ? OGX.state.current() : null;
      if (!cur && OGX.parse && OGX.parse.currentBody) cur = OGX.parse.currentBody(doc);
      if (cur && cur.isMoon) key += ':moon';
    } catch (e) { /* ignore */ }
    try { if (i.name === 'fleet' && doc.getElementById('warning') && !doc.getElementById('allornone')) key += ':noships'; } catch (e) { /* ignore */ }
    return key;
  };
  function visitPage() { return learn.pageKey(document); }

  // ------------------------------------------------------------------ tokens
  /** Structural tokens of a document: '#id', '.class', '[data-x]', 'meta:name' (digits -> '#'), our ogx-* subtrees skipped. */
  learn.tokens = function (doc = document, max = learn.config.tok.maxPerVisit) {
    const ids = new Set(); const data = new Set(); const cls = new Set(); const metas = new Set();
    try { for (const m of doc.querySelectorAll('head meta[name]')) metas.add('meta:' + norm(m.getAttribute('name'))); } catch (e) { /* ignore */ }
    const body = doc.body;
    if (body) {
      const skip = (el) => (el.id && /^ogx-/.test(el.id)) || (typeof el.className === 'string' && /(^|\s)ogx-/.test(el.className));
      const tw = doc.createTreeWalker(body, 1, { acceptNode: (el) => (skip(el) ? 2 /* REJECT */ : 1) });
      let n = 0;
      for (let el = tw.currentNode; el && n < 30000; el = tw.nextNode(), n++) {
        if (el.id) ids.add('#' + norm(el.id));
        if (typeof el.className === 'string' && el.className) for (const c of el.className.split(/\s+/)) if (c && !/^ogx-/.test(c)) cls.add('.' + norm(c));
        const at = el.attributes;
        for (let i = 0; i < at.length; i++) { const a = at[i].name; if (a.startsWith('data-') && !a.startsWith('data-ogx')) data.add('[' + norm(a) + ']'); }
      }
    }
    // volatile tokens (fleet event box, mission/tooltip classes, queue icons, ...: L.VOLATILE_TOKEN) are not layout
    const out = [...metas, ...ids, ...data, ...cls].filter((t) => !L.isVolatileToken(t));
    return out.length > max ? out.slice(0, max) : out;
  };

  // ------------------------------------------------------------------ selectors
  /**
   * OGX.learn.sel(selector) -> Element|null : counted document.querySelector.
   * OGX.learn.sel(selector, found, root?)   : records a query made elsewhere (core DOM helpers call this).
   * Only queries against the live document count; selectors for our own ogx-* elements are ignored.
   */
  learn.sel = function (selector, found, root) {
    if (arguments.length < 2) {
      let el = null;
      try { el = document.querySelector(selector); } catch (e) { el = null; }
      track(selector, !!el, document);
      return el;
    }
    track(selector, !!found, root);
    return found;
  };
  function track(selector, hit, root) {
    if (!visit || typeof selector !== 'string' || /ogx/i.test(selector)) return;
    if (root && root !== document && !(root.ownerDocument === document && root.isConnected)) return;
    const k = norm(selector.trim()).slice(0, 200);
    if (!k) return;
    if (visit.sels.has(k)) { if (hit) visit.sels.set(k, true); return; }
    if (visit.sels.size >= 500) return;
    visit.sels.set(k, hit);
  }

  // ------------------------------------------------------------------ alerts
  const alerts = [];           // batch raised by the current apply
  function alert(key, kind, what, data) {
    const t = now();
    const last = state.alerts[key];
    if (last && t - last < learn.config.dedupMs) return false;
    state.alerts[key] = t;
    const a = { t, key, kind, what, data };
    state.alertLog.push(a);
    if (state.alertLog.length > learn.config.alertLog) state.alertLog.splice(0, state.alertLog.length - learn.config.alertLog);
    alerts.push(a);
    return true;
  }
  function pruneAlertKeys() {
    const t = now();
    for (const [k, v] of Object.entries(state.alerts)) if (t - v > learn.config.dedupMs * 4) delete state.alerts[k];
  }
  function emitAlerts() {
    if (!alerts.length) return;
    const batch = alerts.splice(0, alerts.length);
    for (const a of batch) OGX.log.rec('L', a.kind, a.what, Object.assign({ key: a.key }, a.data || {}));
    try { OGX.bus.emit('learn:alert', batch); } catch (e) { /* ignore */ }
    if (OGX.diag && OGX.diag.snapshot && now() - lastSnapT > 5000) {
      lastSnapT = now();
      OGX.diag.snapshot('learn: ' + batch.map((a) => a.key).join(' | '), { force: false });
    }
    markDirty();
  }

  // ------------------------------------------------------------------ visit commit
  /** Applies one page visit { page, tokens: string[]|null, sels: Map|object } to the state; raises alerts. */
  function applyVisit(v) {
    const cfg = learn.config;
    const p = state.pages[v.page] || (state.pages[v.page] = { visits: 0, lastT: 0, tokens: {}, sels: {} });
    const V = p.visits;
    // tokens
    if (v.tokens) {
      const present = new Set(v.tokens.filter((t) => !L.isVolatileToken(t)));
      // volatile tokens learned by an older version: forget them (they never alert)
      for (const tok of Object.keys(p.tokens)) if (L.isVolatileToken(tok)) delete p.tokens[tok];
      const gone = []; const added = [];
      for (const [tok, a] of Object.entries(p.tokens)) {
        if (present.has(tok)) continue;
        const base = V - a[1];
        if (base >= cfg.tok.minVisits && a[0] / base >= cfg.tok.presentRate) {
          a[1]++;
          if (a[1] === cfg.tok.goneStreak) gone.push(tok);
        } else if (a[1] > 0) a[1]++;
      }
      for (const tok of present) {
        const a = p.tokens[tok];
        if (!a) {
          if (Object.keys(p.tokens).length >= cfg.tok.maxPerPage) continue;
          p.tokens[tok] = [1, 0, V + 1, V + 1];
          if (cfg.tok.newCount <= 1 && V >= cfg.tok.minVisits) added.push(tok);
        } else {
          a[0]++; a[1] = 0; a[3] = V + 1;
          if (a[0] === cfg.tok.newCount && a[2] > cfg.tok.minVisits) added.push(tok);
        }
      }
      const fresh = (list, kind) => list.filter((t) => { const k = kind + ':' + v.page + ':' + t; const last = state.alerts[k]; return !(last && now() - last < cfg.dedupMs); });
      const g = fresh(gone, 'tok-gone');
      if (g.length) {
        for (const t of g) state.alerts['tok-gone:' + v.page + ':' + t] = now();
        alert('tokens-gone:' + v.page + ':' + g.slice(0, 3).join(','), 'tokens-gone', `${v.page}: пропали ${g.length} стабильных элементов вёрстки`, { page: v.page, tokens: g.slice(0, 40), visits: V + 1 });
      }
      const n = fresh(added, 'tok-new');
      if (n.length) {
        for (const t of n) state.alerts['tok-new:' + v.page + ':' + t] = now();
        alert('tokens-new:' + v.page + ':' + n.slice(0, 3).join(','), 'tokens-new', `${v.page}: появились ${n.length} новых элементов вёрстки`, { page: v.page, tokens: n.slice(0, 40), visits: V + 1 });
      }
      // prune rare tokens of a mature page
      const keys = Object.keys(p.tokens);
      if (keys.length > cfg.tok.maxPerPage * 0.9 && V > 20) {
        for (const k of keys) { const a = p.tokens[k]; if (a[0] / Math.max(1, V + 1 - a[2] + 1) < 0.1 && V + 1 - a[3] > 10) delete p.tokens[k]; }
      }
    }
    // selectors
    const sels = v.sels instanceof Map ? Array.from(v.sels.entries()) : Object.entries(v.sels || {});
    for (const [sel, hit] of sels) {
      let a = p.sels[sel];
      if (!a) {
        if (Object.keys(p.sels).length >= cfg.sel.maxPerPage) continue;
        a = p.sels[sel] = [0, 0, 0];
      }
      if (hit) { a[2] = 0; } else {
        const base = a[0] - a[2];
        a[2]++;
        if (a[2] === cfg.sel.missStreak && base >= cfg.sel.minVisits && a[1] / base >= cfg.sel.minRate) {
          alert('sel-miss:' + v.page + ':' + sel, 'selector-miss', `${v.page}: селектор «${sel}» не найден ${a[2]} визита подряд (раньше ${Math.round(100 * a[1] / base)}% из ${base})`, { page: v.page, sel, rate: +(a[1] / base).toFixed(3), base });
        }
      }
      a[0]++; if (hit) a[1]++;
    }
    p.visits = V + (v.tokens ? 1 : 0);
    p.lastT = now();
    if (!v.tokens && !p.visits) p.visits = 0;
  }
  learn._applyVisit = (v) => { if (!state) state = fresh(); applyVisit(v); const out = alerts.slice(); emitAlerts(); markDirty(); return out; };

  // ------------------------------------------------------------------ API schema
  /**
   * OGX.learn.api(endpoint, response): endpoint 'METHOD /normalized/path'; response { status, json } or
   * { status, keys: string[] | null, kind? }. Called by OGX.http (our requests) and by the journal for the game's requests.
   */
  learn.api = function (endpoint, response) {
    if (!enabled()) return;
    const r = response || {};
    const keys = Array.isArray(r.keys) ? r.keys : r.json !== undefined && r.json !== null && typeof r.json === 'object' ? L.jsonSchema(r.json) : null;
    const kind = r.kind || L.responseKind(r.status, r.json);
    const obs = { ep: String(endpoint), kind: keys ? kind : kind + '-raw', keys };
    if (!state) { if (pendingApi.length < 500) pendingApi.push(obs); return; }
    applyApi(obs);
    emitAlerts();
    markDirty();
  };
  function applyApi(o) {
    const cfg = learn.config.api;
    let e = state.api[o.ep];
    if (!e) {
      if (Object.keys(state.api).length >= cfg.maxEndpoints) return;
      if (state.apiTotal >= cfg.newEndpointAfter) alert('api-new:' + o.ep, 'api-new', `новый эндпоинт ${o.ep}`, { ep: o.ep, kind: o.kind, keys: o.keys ? o.keys.slice(0, 30) : null });
      e = state.api[o.ep] = { n: 0, first: now(), last: 0, kinds: {} };
    }
    const k = e.kinds[o.kind] || (e.kinds[o.kind] = { n: 0, keys: {} });
    if (o.keys) {
      const have = new Set(o.keys);
      if (k.n >= cfg.minN) {
        const lost = Object.entries(k.keys).filter(([key, n]) => n / k.n >= cfg.keyRate && !have.has(key)).map(([key]) => key);
        const gained = o.keys.filter((key) => !(key in k.keys));
        const fl = lost.filter((key) => !recentKey('api-lost-k:' + o.ep + ':' + o.kind + ':' + key));
        if (fl.length) {
          for (const key of fl) state.alerts['api-lost-k:' + o.ep + ':' + o.kind + ':' + key] = now();
          alert('api-lost:' + o.ep + ':' + o.kind + ':' + fl.slice(0, 3).join(','), 'api-key-lost', `${o.ep} (${o.kind}): пропали ключи ${fl.slice(0, 10).join(', ')}`, { ep: o.ep, kind: o.kind, lost: fl.slice(0, 40), n: k.n });
        }
        const fg = gained.filter((key) => !recentKey('api-gain-k:' + o.ep + ':' + o.kind + ':' + key));
        if (fg.length) {
          for (const key of fg) state.alerts['api-gain-k:' + o.ep + ':' + o.kind + ':' + key] = now();
          alert('api-gain:' + o.ep + ':' + o.kind + ':' + fg.slice(0, 3).join(','), 'api-key-new', `${o.ep} (${o.kind}): новые ключи ${fg.slice(0, 10).join(', ')}`, { ep: o.ep, kind: o.kind, gained: fg.slice(0, 40), n: k.n });
        }
      }
      for (const key of o.keys) {
        if (key in k.keys) k.keys[key]++;
        else if (Object.keys(k.keys).length < cfg.maxKeys) k.keys[key] = 1;
      }
    }
    k.n++;
    e.n++; e.last = now();
    state.apiTotal = (state.apiTotal || 0) + 1;
  }
  function recentKey(k) { const t = state.alerts[k]; return !!(t && now() - t < learn.config.dedupMs); }

  // ------------------------------------------------------------------ plausibility
  const NONNEG = /^(amount|storage|metal|crystal|deuterium|darkMatter|darkmatter|fieldsUsed|fieldsMax|diameter|level|value|target|current|count|points|rank|capacity|cargo)$/;
  /** Scans numeric leaves: NaN/Infinity anywhere, negatives on resource/level keys. -> [{ path, value }] */
  learn.implausible = function (obj, maxDepth = 6) {
    const bad = [];
    const walk = (v, path, d) => {
      if (bad.length >= 10 || d > maxDepth || v === null || v === undefined) return;
      if (typeof v === 'number') {
        const leaf = path.split('.').pop().replace(/\[\d+\]$/, '');
        if (!Number.isFinite(v)) bad.push({ path, value: String(v) });
        else if (v < 0 && NONNEG.test(leaf)) bad.push({ path, value: v });
        return;
      }
      if (typeof v !== 'object' || (typeof Node !== 'undefined' && v instanceof Node)) return;
      if (Array.isArray(v)) { v.slice(0, 50).forEach((x, i) => walk(x, path + '[' + i + ']', d + 1)); return; }
      for (const k of Object.keys(v)) walk(v[k], path ? path + '.' + k : k, d + 1);
    };
    try { walk(obj, '', 0); } catch (e) { /* ignore */ }
    return bad;
  };
  /** Checks a parser/derived result; raises 'implausible' when it has NaN or negative resource values. -> boolean ok */
  learn.check = function (name, obj) {
    if (!active || !state) return true;
    const bad = learn.implausible(obj);
    if (!bad.length) return true;
    alert('implausible:' + name + ':' + bad[0].path.replace(/\[\d+\]/g, '[]'), 'implausible', `${name}: неправдоподобные значения ${bad.slice(0, 3).map((b) => b.path + '=' + b.value).join(', ')}`, { name, bad, page: visitPage() });
    emitAlerts();
    return false;
  };
  /** Single value check: { min=0, max=Infinity, int=false }. -> boolean ok */
  learn.value = function (name, value, { min = 0, max = Infinity, int = false } = {}) {
    const ok = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!int || Number.isInteger(value));
    if (!ok && active && state) {
      alert('implausible:' + name, 'implausible', `${name}: неправдоподобное значение ${String(value)}`, { name, value: typeof value === 'number' ? String(value) : value, min, max: Number.isFinite(max) ? max : null, page: visitPage() });
      emitAlerts();
    }
    return ok;
  };
  // Core parsers are checked automatically (results only, the parsers are unchanged).
  if (OGX.parse) {
    for (const name of ['inlineResources', 'resourceTooltips', 'planetList', 'overviewInfo', 'fleetPage', 'player', 'techList', 'resourceSettings', 'techDetails']) {
      const fn = OGX.parse[name];
      if (typeof fn !== 'function' || fn.__ogxLearn) continue;
      const w = function (...args) {
        const r = fn.apply(this, args);
        try { if (active && r && typeof r === 'object') learn.check('parse.' + name, r); } catch (e) { /* never break a parser */ }
        return r;
      };
      w.__ogxLearn = true;
      OGX.parse[name] = w;
    }
  }

  // ------------------------------------------------------------------ persistence
  function markDirty() {
    dirty = true;
    if (saveTimer || !active) return;
    saveTimer = setTimeout(() => { saveTimer = null; learn.save(); }, learn.config.saveMs);
  }
  /** Writes the state now (throttled automatically; pagehide calls it). */
  learn.save = function ({ flush = false } = {}) {
    if (!active || !state || !dirty) return Promise.resolve();
    dirty = false;
    pruneAlertKeys();
    const p = OGX.storage.set(KEY, state, OPTS);
    if (flush) OGX.storage.flush();
    return p;
  };
  /** Commits the current page visit (tokens + selector results). Later selector queries are committed on pagehide. */
  learn.endVisit = function () {
    if (!active || !visit || !state) return [];
    const sels = new Map();
    for (const [k, v] of visit.sels) if (!visit.committed.has(k)) { sels.set(k, v); visit.committed.add(k); }
    const v = { page: visit.page, tokens: visit.tokensDone ? null : visit.tokens, sels };
    visit.tokensDone = true;
    if (!v.tokens && !sels.size) return [];
    applyVisit(v);
    const out = alerts.slice();
    emitAlerts();
    markDirty();
    return out;
  };
  /** Resets the learning state of this server. */
  learn.reset = async function () {
    state = fresh();
    dirty = true;
    await learn.save();
    if (visit) { visit.tokensDone = false; visit.committed = new Set(); }
    return true;
  };

  // ------------------------------------------------------------------ init (OGX.boot, after diag.init)
  learn.init = async function (snap) {
    if (active || !enabled()) return;
    visit = { page: visitPage(), tokens: [], sels: new Map(), committed: new Set(), tokensDone: false, t0: now() };
    try { visit.tokens = learn.tokens(document); } catch (e) { visit.tokens = []; }
    let s = null;
    try { s = valid(await OGX.storage.get(KEY, null, OPTS)); } catch (e) { s = null; }
    state = s || fresh();
    active = true;
    for (const o of pendingApi.splice(0)) applyApi(o);
    try { if (snap) { for (const f of ['inline', 'tooltips', 'overviewInfo', 'player']) if (snap[f]) learn.check('snapshot.' + f, snap[f]); } } catch (e) { /* ignore */ }
    emitAlerts();
    try {
      OGX.storage.subscribe(KEY, (v, info) => { if (info && info.remote && !dirty && valid(v)) state = v; }, OPTS);
    } catch (e) { /* ignore */ }
    if (learn.config.visitEndMs > 0) setTimeout(() => { try { learn.endVisit(); } catch (e) { /* ignore */ } }, learn.config.visitEndMs);
    window.addEventListener('pagehide', () => {
      try { learn.endVisit(); learn.save({ flush: true }); } catch (e) { /* ignore */ }
    });
  };
  // game requests journaled before this file loaded (the page hook's replay on 'ogx:net-ready' in 22-diag.js)
  try { const q = OGX.diag && OGX.diag._preLearn; if (q) for (const [ep, obs] of q.splice(0)) learn.api(ep, obs); } catch (e) { /* ignore */ }
})(window.OGX);
