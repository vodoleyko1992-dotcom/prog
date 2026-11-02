/* shared/core/12-http.js — same-origin HTTP helpers (CSRF, 419 retry, polite background queue, ?cp= switching)
 * and endpoint wrappers. Owner: core. No request ever leaves location.origin. Fetched HTML is parsed with DOMParser
 * and never inserted into the page.
 * GALAXYZ (specs/galaxyz/*.md): every request goes to <universe>/game.php?page=...; OgameX paths ('/fleet', '/overview')
 * are translated by OGX.page.url. No CSRF (no _token, no X-CSRF-TOKEN, no 419); logged out = redirect away from game.php.
 * `cp` is sticky server-side (the session's active planet for ALL tabs), so withPlanet always restores it. */
(function (OGX) {
  'use strict';
  const http = (OGX.http = OGX.http || {});
  const api = (OGX.api = OGX.api || {});
  const log = OGX.log.create('http');
  const JUNK_TOKEN = '91cf2833548771ba423894d1f3dddb3c';
  const gzMode = () => !!(OGX.page && OGX.page.isGz && OGX.page.isGz());
  let csrfToken = null;
  let activeCp = null; // body id forced by withPlanet (diagnostics only: never applied to requests that did not name a cp)

  http.csrf = function () {
    if (csrfToken) return csrfToken;
    try { csrfToken = OGX.parse.csrf(document) || null; } catch (e) { csrfToken = null; }
    return csrfToken || '';
  };
  http._setCsrf = (t) => { csrfToken = t || null; };

  function fetchFn() {
    // Firefox content scripts: content.fetch carries the page's origin and cookies (layout.md §7).
    try { if (typeof content !== 'undefined' && content && typeof content.fetch === 'function') return content.fetch.bind(content); } catch (e) { /* not Firefox */ }
    return fetch.bind(window);
  }

  function buildUrl(path, query, cp) {
    const gzm = gzMode();
    const u = gzm ? new URL(OGX.page.url(path, query)) : new URL(path, location.origin);   // GALAXYZ: query applied (and renamed) by page.url
    if (u.origin !== location.origin) throw new Error('OGX.http: cross-origin request refused: ' + u.origin);
    if (!gzm) for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    if (cp !== undefined && cp !== null && cp !== false) u.searchParams.set('cp', String(cp));
    return u;
  }
  function formBody(form) {
    const b = form instanceof URLSearchParams ? new URLSearchParams(form) : new URLSearchParams();
    if (!(form instanceof URLSearchParams)) {
      for (const [k, v] of Object.entries(form || {})) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) for (const x of v) b.append(k, String(x)); else b.set(k, String(v));
      }
    }
    if (!b.has('_token') && !gzMode()) b.set('_token', http.csrf());
    return b;
  }
  function afterJson(json) {
    if (!json || typeof json !== 'object') return;
    try {
      const t = json.newAjaxToken;
      if (typeof t === 'string' && t.length >= 20 && t !== JUNK_TOKEN) csrfToken = t;
      const st = json.serverTime !== undefined ? json.serverTime : json.server_time;
      if (st !== undefined && Number.isFinite(+st) && OGX.time && OGX.time.calibrate) OGX.time.calibrate(+st);
    } catch (e) { log.warn('afterJson', e); }
  }

  // Every request is journaled (N, by 'ogx') and its JSON key schema is learned (OGX.learn.api) — see 22-diag.js.
  const sizes = new WeakMap();
  async function doRequest(path, opts, retried) {
    const t0 = Date.now();
    const out = await doRequestRaw(path, opts, retried);
    try {
      if (OGX.diag && OGX.diag._ogxNet && !opts.noJournal) {
        OGX.diag._ogxNet({ method: opts.method || 'GET', url: out.reqUrl || out.url, finalUrl: out.url, status: out.status, ms: Date.now() - t0, size: sizes.get(out),
          error: out.ok ? null : out.error || null, json: out.json, body: opts.form !== undefined ? formBody(opts.form).toString() : null });
      }
    } catch (e) { /* never break a request */ }
    return out;
  }
  /** cp of a request that did not name one. Never the cp of a running withPlanet: that is a module global, and a refresh
   * in this tab would otherwise hand its body to an unrelated click (a fleet would leave from the refreshed planet).
   * GALAXYZ: the selected planet is sticky server-side and any request with cp (a refresh, another tab) moves it, so a
   * state-changing request (POST from a click, not the background queue) always names this page's body. */
  function implicitCp(method, opts) {
    if (!gzMode() || method !== 'POST' || opts.background) return null;
    return currentBodyId();
  }
  async function doRequestRaw(path, opts, retried) {
    const method = (opts.method || 'GET').toUpperCase();
    const cp = opts.cp !== undefined ? opts.cp : (opts.noCp ? null : implicitCp(method, opts));
    let url;
    try { url = buildUrl(path, opts.query, cp); } catch (e) { return { ok: false, status: 0, url: String(path), redirected: false, loggedOut: false, error: e.message }; }
    const headers = Object.assign({
      'X-Requested-With': 'XMLHttpRequest',
      Accept: opts.expect === 'json' ? 'application/json, text/javascript, */*; q=0.01' : 'text/html, application/json, */*; q=0.01',
      'X-CSRF-TOKEN': http.csrf(),
      'X-OGX': '1', // marks our own requests so the page hook does not journal them twice (userscript runs in the page world)
    }, opts.headers || {});
    if (gzMode()) delete headers['X-CSRF-TOKEN'];
    const init = { method, headers, credentials: 'include', redirect: 'follow', keepalive: !!opts.keepalive };
    if (opts.form !== undefined && method !== 'GET') {
      init.body = formBody(opts.form);
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    } else if (method !== 'GET' && method !== 'HEAD' && opts.body !== undefined) {
      init.body = opts.body;
    }
    let timer = null;
    if (typeof AbortController !== 'undefined' && !opts.keepalive) {
      const ac = new AbortController();
      init.signal = ac.signal;
      timer = setTimeout(() => ac.abort(), opts.timeout || 20000);
      if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
    }
    let res;
    try {
      res = await fetchFn()(url.toString(), init);
    } catch (e) {
      if (timer) clearTimeout(timer);
      return { ok: false, status: 0, url: url.toString(), redirected: false, loggedOut: false, error: e && e.name === 'AbortError' ? 'timeout' : String(e && e.message || e) };
    }
    if (timer) clearTimeout(timer);
    const finalUrl = res.url || url.toString();
    let finalPath = '';
    try { finalPath = new URL(finalUrl).pathname; } catch (e) { finalPath = ''; }
    const out = { ok: res.ok, status: res.status, url: finalUrl, redirected: !!res.redirected, loggedOut: false };
    // the journal records the URL as requested (with cp): a 2Moons redirect drops cp from the final URL
    Object.defineProperty(out, 'reqUrl', { value: url.toString(), enumerable: false });
    // GALAXYZ: an expired session redirects to index.php?code=3 [UPSTREAM includes/common.php:119]
    const gzOut = gzMode() && res.redirected && !/\/game\.php$/i.test(finalPath);
    if ((res.redirected && /^\/login\b/.test(finalPath)) || res.status === 401 || gzOut) {
      out.loggedOut = true; out.ok = false; out.error = 'logged out';
      try { await res.text(); } catch (e) { /* drain */ }
      return out;
    }
    if (res.status === 419 && !gzMode()) {
      try { await res.text(); } catch (e) { /* drain */ }
      if (!retried) {
        try { if (OGX.diag && OGX.diag._ogxNet) OGX.diag._ogxNet({ method, url: url.toString(), status: 419, error: 'csrf, retrying' }); } catch (e) { /* ignore */ }
        const fresh = await refreshToken();
        if (fresh) return doRequestRaw(path, opts, true);
      }
      out.loggedOut = true; out.ok = false; out.error = 'csrf';
      return out;
    }
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    let text = '';
    try { text = await res.text(); } catch (e) { out.ok = false; out.error = 'read failed'; return out; }
    sizes.set(out, text.length);
    const wantJson = opts.expect === 'json' || (opts.expect === 'auto' || !opts.expect) && ctype.includes('json');
    // GALAXYZ AJAX answers are JSON text served as text/html: expect 'json' parses them
    if (wantJson || (ctype.includes('text/plain') && /^\s*[{[]/.test(text) && opts.expect !== 'text' && opts.expect !== 'doc')) {
      try { out.json = JSON.parse(text); afterJson(out.json); } catch (e) {
        out.text = text;
        if (opts.expect === 'json') { out.ok = false; out.error = 'invalid json'; }
      }
    } else {
      out.text = text;
      if (opts.expect === 'doc' || opts.expect === 'auto' && ctype.includes('html')) out.doc = new DOMParser().parseFromString(text, 'text/html');
    }
    if (!res.ok && !out.error) out.error = 'http ' + res.status;
    return out;
  }

  async function refreshToken() {
    if (gzMode()) return false;
    try {
      const r = await fetchFn()(new URL('/overview', location.origin).toString(), { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!r.ok) return false;
      const html = await r.text();
      const m = /<meta name="csrf-token" content="([^"]+)"/.exec(html);
      if (m) { csrfToken = m[1]; return true; }
    } catch (e) { log.warn('token refresh failed', e); }
    return false;
  }

  // ------------------------------------------------------------------ polite background queue
  const queue = [];
  let pumping = false;
  let lastEnd = 0;
  function gapMs() { try { return +OGX.settings.get('core.httpGapMs') || 400; } catch (e) { return 400; } }
  function mayRunHidden() { try { return !!OGX.settings.get('core.backgroundWhenHidden'); } catch (e) { return false; } }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        while (document.hidden && !mayRunHidden()) await OGX.util.sleep(500);
        const wait = lastEnd + gapMs() - Date.now();
        if (wait > 0) await OGX.util.sleep(wait);
        const job = queue.shift();
        try { job.resolve(await doRequest(job.path, job.opts)); } catch (e) { job.resolve({ ok: false, status: 0, url: job.path, redirected: false, loggedOut: false, error: String(e) }); }
        lastEnd = Date.now();
      }
    } finally { pumping = false; }
  }
  http.queueLength = () => queue.length;

  /** HttpResult = { ok, status, url, redirected, loggedOut, json?, text?, doc?, error? }. Never throws for HTTP failures. */
  http.request = function (path, opts = {}) {
    const o = Object.assign({ method: 'GET', expect: 'auto', timeout: 20000 }, opts);
    if (o.background) {
      return new Promise((resolve) => { queue.push({ path, opts: o, resolve }); pump(); });
    }
    return doRequest(path, o, false);
  };
  http.get = (path, opts = {}) => http.request(path, Object.assign({}, opts, { method: 'GET' }));
  http.post = (path, form, opts = {}) => http.request(path, Object.assign({}, opts, { method: 'POST', form: form || {} }));

  /** Current body id of this page (from the snapshot). */
  function currentBodyId() {
    try { const c = OGX.state && OGX.state.current && OGX.state.current(); if (c && c.id) return c.id; } catch (e) { /* not ready */ }
    try { return OGX.parse.metas(document).planetId; } catch (e) { return null; }
  }
  // Restore request of withPlanet: a plain page=overview. The live ogamex.eu answers page=overview&ajax=1 with HTTP 503
  // (user log 2026-10-31), so GALAXYZ gets the full page too.
  const restoreQuery = () => ({});

  /** Runs fn(bodyId) under the cross-tab lock 'cp', then restores the current planet. Every request made inside fn must pass
   * { cp: bodyId } itself: the cp is NOT applied implicitly (other requests of this tab run concurrently and must keep theirs). */
  http.withPlanet = async function (bodyId, fn, { restoreTo, lockWaitMs = 60000 } = {}) {
    let lock = null;
    const t0 = Date.now();
    while (!(lock = await OGX.storage.lock('cp', 120000))) {
      if (Date.now() - t0 > lockWaitMs) throw new Error('OGX.http.withPlanet: lock "cp" busy');
      await OGX.util.sleep(500);
    }
    const original = restoreTo !== undefined && restoreTo !== null ? restoreTo : currentBodyId();
    const prev = activeCp;
    activeCp = bodyId;
    let restored = false;
    const restoreKeepalive = () => {
      if (restored || original === null || original === undefined) return;
      restored = true;
      try { fetchFn()(buildUrl('/overview', restoreQuery(), original).toString(), { credentials: 'include', keepalive: true }); } catch (e) { /* ignore */ }
    };
    window.addEventListener('pagehide', restoreKeepalive);
    const refresher = setInterval(() => { lock.refresh().catch(() => {}); }, 30000);
    try {
      return await fn(bodyId);
    } finally {
      activeCp = prev;
      clearInterval(refresher);
      window.removeEventListener('pagehide', restoreKeepalive);
      if (!restored && original !== null && original !== undefined) {
        restored = true;
        await doRequest('/overview', { method: 'GET', expect: 'text', query: restoreQuery(), cp: original, timeout: 20000 }, false);
      }
      await lock.release();
    }
  };
  http._activeCp = () => activeCp;

  // ------------------------------------------------------------------ endpoint wrappers
  const err = (r) => ({ error: r.error || (r.loggedOut ? 'logged out' : 'http ' + r.status), status: r.status, loggedOut: !!r.loggedOut });
  const bg = (o) => (o && o.background !== undefined ? o.background : false);

  api.page = async function (path, { cp, query, background } = {}) {
    const r = await http.get(path, { cp, query, expect: 'text', background: bg({ background }) });
    if (!r.ok) return err(r);
    return { html: r.text, doc: new DOMParser().parseFromString(r.text || '', 'text/html'), url: r.url, redirected: r.redirected };
  };
  api.techDetails = async function (id, { cp, background } = {}) {
    if (gzMode()) {
      // {target, content: {[target]: html}} as text [REAL-JS buildings.md §4]; the panel markup is [UNVERIFIED]
      const n = +id;
      const pg = n < 100 ? 'TechnologyDetailsAjax' : n < 200 ? 'ResearchDetailsAjax' : n < 600 ? 'ShipDetailsAjax' : 'CommanderDetailsAjax';
      const query = { technology: n };
      if (pg === 'CommanderDetailsAjax') query.type = 'undefined';
      const g = await http.get(pg, { query, cp, expect: 'json', background });
      if (!g.ok || !g.json) return err(g);
      const d = OGX.parse.techDetails(g.json);
      if (!d.id) d.id = n;
      d.html = (g.json.content && g.json.target && g.json.content[g.json.target]) || null;
      return d;
    }
    const r = await http.get('/ajax/resources', { query: { technology: id }, cp, expect: 'json', background });
    if (!r.ok || !r.json) return err(r);
    const d = OGX.parse.techDetails(r.json);
    if (!d.id) d.id = +id;
    return d;
  };
  api.techtree = async function (tab, objectId, { background } = {}) {
    if (gzMode()) { const g = await http.get('techtree', { expect: 'text', background }); return g.ok ? g.text : err(g); }   // all requirements in one page
    const r = await http.get('/ajax/techtree', { query: { tab, object_id: objectId }, expect: 'text', background });
    return r.ok ? r.text : err(r);
  };
  const unsupported = (what) => ({ error: what + ': not available on GALAXYZ', status: 0, loggedOut: false, unsupported: true });
  api.serverSettings = async function ({ background } = {}) {
    if (gzMode()) return unsupported('serverSettings');
    const r = await http.get('/overlay/server-settings', { expect: 'text', background });
    return r.ok ? OGX.parse.serverSettings(r.text) : err(r);
  };
  api.eventList = async function ({ background } = {}) {
    // GALAXYZ: no event-list endpoint; the event box is on every full page -> page=fleetTable html (parse.gz.events)
    if (gzMode()) { const g = await http.get('fleetTable', { expect: 'text', background }); return g.ok ? g.text : err(g); }
    const r = await http.get('/ajax/fleet/eventlist/fetch', { expect: 'text', background });
    return r.ok ? r.text : err(r);
  };
  api.eventBox = async function ({ background } = {}) {
    if (gzMode()) return unsupported('eventBox');
    const r = await http.get('/ajax/fleet/eventbox/fetch', { expect: 'json', background });
    if (!r.ok || !r.json) return err(r);
    const j = r.json;
    return { hostile: +j.hostile || 0, neutral: +j.neutral || 0, friendly: +j.friendly || 0, eventType: j.eventType || null, eventTime: +j.eventTime || 0, eventText: j.eventText || '' };
  };
  api.movement = async function ({ background } = {}) {
    if (gzMode()) {
      const g = await http.get('fleetTable', { expect: 'text', background });
      return g.ok ? { doc: new DOMParser().parseFromString(g.text || '', 'text/html'), html: g.text } : err(g);
    }
    const r = await http.get('/fleet/movement', { expect: 'text', background });
    if (!r.ok) return err(r);
    let p = '';
    try { p = new URL(r.url).pathname.replace(/\/+$/, ''); } catch (e) { p = ''; }
    if (r.redirected && p === '/fleet') return { empty: true };
    return { doc: new DOMParser().parseFromString(r.text || '', 'text/html'), html: r.text };
  };
  function shipsForm(ships) {
    const f = {};
    for (const [id, n] of Object.entries(ships || {})) if (+n > 0) f['am' + id] = Math.floor(+n);
    return f;
  }
  api.checkTarget = async function ({ galaxy, system, position, type = 1, ships, union = 0 }, { cp } = {}) {
    if (gzMode()) {
      // fleetStep1&mode=checkTarget -> JSON string "OK" or a localized error [REAL-JS fleet.md §2]; no shipsData
      const g = await http.get('fleetStep1', { query: { mode: 'checkTarget', galaxy, system, planet: position, planet_type: type }, cp, expect: 'json' });
      if (g.json === undefined) return err(g);
      return { ok: g.json === 'OK', message: g.json === 'OK' ? '' : String(g.json) };
    }
    const r = await http.post('/ajax/fleet/dispatch/check-target', Object.assign({ galaxy, system, position, type, union }, shipsForm(ships)), { cp, expect: 'json' });
    if (!r.json) return err(r);
    return r.json;
  };
  /**
   * GALAXYZ dispatch = three form POSTs (fleet.md §2): fleetStep1 (ships, target) -> token, fleetStep2 (token, speed) -> missions,
   * fleetStep3 (mission, cargo, staytime) -> th.success. cp (origin) is sent on every step. Same result shape as OgameX + step.
   */
  async function sendFleetGz(req, cp) {
    const fail = (step, message, extra) => Object.assign({ success: false, step, message: message || 'error', errors: [{ message: message || 'error', error: step }] }, extra || {});
    const P = OGX.parse.gz;
    const tgt = { galaxy: req.galaxy, system: req.system, planet: req.position, type: req.type || 1 };
    const f1 = Object.assign({ target_mission: req.mission || 0 }, tgt);
    for (const [id, n] of Object.entries(req.ships || {})) if (+n > 0) f1['ship' + id] = Math.floor(+n);
    const r1 = await http.post('fleetStep1', f1, { cp, expect: 'doc' });
    if (!r1.ok || !r1.doc) return fail(1, r1.error);
    const s1 = P.fleetStep1(r1.doc);
    if (!s1 || !s1.token) return fail(1, P.infoMessage(r1.doc) || 'fleetStep1: no form (no ships?)', { url: r1.url });
    const r2 = await http.post('fleetStep2', Object.assign({ token: s1.token, fleet_group: req.union || 0, target_mission: req.mission || 0, speed: Math.max(1, Math.min(10, Math.round(+req.speed || 10))) }, tgt), { cp, expect: 'doc' });
    if (!r2.ok || !r2.doc) return fail(2, r2.error);
    const s2 = P.fleetStep2(r2.doc);
    if (!s2) return fail(2, P.infoMessage(r2.doc) || 'fleetStep2: no form', { url: r2.url });
    if (!s2.missions.some((m) => m.id === +req.mission)) return fail(2, 'mission ' + req.mission + ' not available', { missions: s2.missions.map((m) => m.id) });
    const c = req.cargo || {};
    const f3 = { token: s1.token, mission: +req.mission, metal: Math.max(0, Math.floor(c.metal || 0)), crystal: Math.max(0, Math.floor(c.crystal || 0)), deuterium: Math.max(0, Math.floor(c.deuterium || 0)) };
    if (s2.stayOptions.length) f3.staytime = req.holdingtime || s2.stayOptions[0].value;
    const r3 = await http.post('fleetStep3', f3, { cp, expect: 'doc' });
    if (!r3.ok || !r3.doc) return fail(3, r3.error);
    const s3 = P.fleetStep3(r3.doc);
    if (!s3.success) return fail(3, s3.message);
    return { success: true, step: 3, message: s3.title || '', errors: [], result: s3 };
  }
  api.sendFleet = async function (req, { cp } = {}) {
    if (gzMode()) return sendFleetGz(req, cp);
    const form = Object.assign({
      galaxy: req.galaxy, system: req.system, position: req.position, type: req.type || 1, mission: req.mission, speed: req.speed || 10,
      metal: Math.max(0, Math.floor((req.cargo && req.cargo.metal) || 0)), crystal: Math.max(0, Math.floor((req.cargo && req.cargo.crystal) || 0)),
      deuterium: Math.max(0, Math.floor((req.cargo && req.cargo.deuterium) || 0)), holdingtime: req.holdingtime || 0, union: req.union || 0,
    }, shipsForm(req.ships));
    const r = await http.post('/ajax/fleet/dispatch/send-fleet', form, { cp, expect: 'json' });
    if (!r.json) return { success: false, message: r.error || 'http ' + r.status, errors: [{ message: r.error || 'http ' + r.status, error: r.status }] };
    const j = r.json;
    const errors = Array.isArray(j.errors) ? j.errors : [];
    return { success: j.success === true, message: j.message || (errors[0] && errors[0].message) || '', errors };
  };
  // ------------------------------------------------------------------ GALAXYZ coords -> DB planet id (fleetAjax needs planetID)
  const coordsOf = (x) => {
    if (!x) return null;
    if (typeof x === 'string' || Array.isArray(x)) { const a = OGX.util && OGX.util.coordsArr ? OGX.util.coordsArr(x) : null; return a ? { galaxy: +a[0], system: +a[1], position: +a[2] } : null; }
    const g = +x.galaxy, s = +x.system, p = +(x.position ?? x.planet);
    return g && s && p ? { galaxy: g, system: s, position: p } : null;
  };
  const cstr = (c) => c.galaxy + ':' + c.system + ':' + c.position;
  /** id of the body at c in a ParsedSystem position (type 1 planet / 2 debris -> the planet row id, 3 -> the moon id). */
  function idFromPosition(p, type) {
    if (!p) return null;
    if (+type === 3) return p.moon && p.moon.id ? +p.moon.id : null;
    return p.planetId ? +p.planetId : null;
  }
  /**
   * GALAXYZ: coords -> the target's DB planet id, from data already on hand (never a request: galaxy views cost deuterium).
   * Sources in order: the galaxy page open in this tab, the galaxy cache (galaxy.cached, filled by every galaxy page the user opened),
   * the player index (galaxy.players planets), own bodies (planet list of this page). Spy reports and messages carry NO planet ids
   * [REAL messages-spy.html: only page=galaxy and page=fleetTable&galaxy&system&planet links].
   * ({ galaxy, system, position|planet, type=1 } | 'g:s:p' | [g,s,p], type?) ->
   *   { planetId, source: 'galaxy-page'|'galaxy-cache'|'player-index'|'own-body', t (ServerMs of that data) | null, coords, type }
   *   | { planetId: null, error, suggestion, galaxyUrl, coords, type }.
   */
  api.resolvePlanetId = async function (target, typeArg) {
    const c = coordsOf(target);
    const type = +(typeArg ?? (target && typeof target === 'object' && !Array.isArray(target) ? target.type : null) ?? 1) || 1;
    if (!c) return { planetId: null, error: 'bad coordinates', suggestion: null, galaxyUrl: null, coords: null, type };
    const key = cstr(c);
    const hit = (planetId, source, t) => ({ planetId, source, t: t ?? null, coords: key, type });
    const G = OGX.galaxy;
    try {
      if (G && OGX.page.is && OGX.page.is('galaxy') && G.parseGz) {
        const sys = G.parseGz(document);
        if (sys && sys.galaxy === c.galaxy && sys.system === c.system) {
          const id = idFromPosition(sys.positions.find((p) => p.position === c.position), type);
          if (id) return hit(id, 'galaxy-page', sys.t);
        }
      }
    } catch (e) { log.warn('resolvePlanetId page', e && e.message); }
    try {
      const sys = G && G.cached ? await G.cached(c.galaxy, c.system) : null;
      const id = sys ? idFromPosition(sys.positions.find((p) => +p.position === c.position), type) : null;
      if (id) return hit(id, 'galaxy-cache', sys.t);
    } catch (e) { log.warn('resolvePlanetId cache', e && e.message); }
    try {
      const idx = (await OGX.storage.get('galaxy.players', {}, { scope: 'server' })) || {};
      for (const e of Object.values(idx)) {
        const pl = e && Array.isArray(e.planets) ? e.planets.find((x) => x.coords === key) : null;
        const id = pl ? (type === 3 ? pl.moonId : pl.planetId) : null;
        if (id) return hit(+id, 'player-index', pl.lastSeenT);
      }
    } catch (e) { log.warn('resolvePlanetId index', e && e.message); }
    try {
      const own = OGX.parse.gz.bodies(document).list.find((b) => b.coords === key && !!b.isMoon === (type === 3));
      if (own && own.id) return hit(+own.id, 'own-body', null);
    } catch (e) { /* no planet list */ }
    let galaxyUrl = null;
    try { galaxyUrl = OGX.page.url('galaxy', { galaxy: c.galaxy, system: c.system }); } catch (e) { galaxyUrl = null; }
    return { planetId: null, coords: key, type, galaxyUrl,
      error: 'GALAXYZ: id цели ' + key + (type === 3 ? ' (луна)' : '') + ' неизвестен',
      suggestion: 'Откройте систему ' + c.galaxy + ':' + c.system + ' в галактике (просмотр стоит дейтерий), затем повторите' };
  };
  /** fleetAjax answer text "Send 3 Spy Probe to 2:70:9 ..." (fa_sending, any language) -> { ships, coords } [UPSTREAM ShowFleetAjaxPage:230]. */
  function parseFleetAjaxMess(mess) {
    const m = String(mess || '');
    const co = /(\d+):(\d+):(\d+)\s*\.*\s*$/.exec(m);
    const head = co ? m.slice(0, co.index) : m;
    const n = /(\d[\d.]*)/.exec(head);
    return { ships: n ? parseInt(n[1].replace(/\./g, ''), 10) : null, coords: co ? co[1] + ':' + co[2] + ':' + co[3] : null };
  }
  api._parseFleetAjaxMess = parseFleetAjaxMess;
  /**
   * fleetAjax answer codes [UPSTREAM 2Moons ShowFleetAjaxPage::show; older XNova flotenajax codes 602/614-616 kept for forks]:
   * 600 sent, 601 target planet missing, 602 no moon, 603 noob protection (target too weak), 604 target too strong, 605 target in
   * vacation, 610 not enough ships / unknown mission, 611 no probes (mission 6, fa_no_spios) / no recyclers (8) on the CURRENT planet,
   * 612 no free fleet slot, 613 not enough deuterium / no room for the fuel, 615 no room for the fuel, 616 multi alarm,
   * 618 spying on yourself, 619 action not allowed (admin protection), 620 own vacation mode, 699 mission module disabled.
   * (code, mission) -> readable Russian text; an unknown code -> «код N» (never "undefined").
   */
  const FA_CODES = {
    600: 'флот отправлен',
    601: 'цель не найдена (планета не существует)',
    602: 'у цели нет луны',
    603: 'игрок под защитой новичков (слишком слабый)',
    604: 'игрок слишком сильный (защита новичков)',
    605: 'игрок в режиме отпуска',
    610: 'на планете недостаточно кораблей',
    612: 'нет свободных слотов флота',
    613: 'недостаточно дейтерия или места в трюме для топлива',
    614: 'планета не существует',
    615: 'недостаточно места в трюме для топлива',
    616: 'отправка заблокирована (мульти-тревога)',
    618: 'нельзя шпионить за собственной планетой',
    619: 'действие запрещено (цель под защитой администрации)',
    620: 'вы в режиме отпуска',
    699: 'миссия отключена на сервере',
  };
  function fleetAjaxText(code, mission) {
    if (code === null || code === undefined || !Number.isFinite(+code)) return null;
    code = +code;
    if (code === 611) return +mission === 6 ? 'на планете нет шпионских зондов' : +mission === 8 ? 'на планете нет переработчиков' : 'на планете нет нужных кораблей';
    if (code === 610 && +mission === 6) return 'на планете недостаточно шпионских зондов';
    return FA_CODES[code] || 'код ' + code;
  }
  api.fleetAjaxText = fleetAjaxText;

  /**
   * Origin of a one-click spy: the own body (planet or moon) with probes (210) nearest to the target — galaxy distance, then
   * system, then position; ties: the current body, then more probes. Counts from the cached bodies (imperium / fleet pages,
   * OGX.state.bodies). No body with a known probe count > 0 -> the current body (source 'current', probes as cached or null).
   * (target { galaxy, system, position }) -> { id, coords, name, probes (number|null), current (bool), source: 'nearest'|'current' }.
   */
  api.pickSpyOrigin = async function (target) {
    const curId = currentBodyId();
    let bodies = {};
    try { bodies = (OGX.state && OGX.state.bodies ? await OGX.state.bodies() : await OGX.storage.get('bodies', {})) || {}; } catch (e) { bodies = {}; }
    const list = Object.values(bodies).filter((b) => b && b.id && typeof b.coords === 'string');
    const probesOf = (b) => (b && b.ships && b.ships[210] !== undefined && b.ships[210] !== null && Number.isFinite(+b.ships[210]) ? +b.ships[210] : null);
    const cur = list.find((b) => +b.id === +curId) || null;
    const fallback = { id: curId ? +curId : null, coords: cur ? cur.coords : null, name: cur ? cur.name || null : null, probes: probesOf(cur), current: true, source: 'current' };
    const c = coordsOf(target);
    if (!c) return fallback;
    const cand = list.map((b) => {
      const a = OGX.util && OGX.util.coordsArr ? OGX.util.coordsArr(b.coords) : b.coords.split(':').map(Number);
      return a ? { b, probes: probesOf(b), dg: Math.abs(+a[0] - c.galaxy), ds: Math.abs(+a[1] - c.system), dp: Math.abs(+a[2] - c.position) } : null;
    }).filter((x) => x && x.probes > 0);
    if (!cand.length) return fallback;
    cand.sort((x, y) => x.dg - y.dg || x.ds - y.ds || x.dp - y.dp || (+y.b.id === +curId) - (+x.b.id === +curId) || y.probes - x.probes);
    const w = cand[0].b;
    return { id: +w.id, coords: w.coords, name: w.name || null, probes: cand[0].probes, current: +w.id === +curId, source: 'nearest' };
  };

  /**
   * One-click spy (6) / recycle (8). OgameX: POST send-mini-fleet. GALAXYZ: GET fleetAjax&ajax=1&mission&planetID [UPSTREAM]; planetId
   * is resolved from coords (api.resolvePlanetId) when not given. The server picks the ship count (spy: min(the account's probe
   * setting spio_anz, probes on the planet), recycle: by debris), shipCount is ignored there. Spy (6): shipCount defaults to
   * api.spyProbes() (setting spy.probes), capped at the origin's cached probes; the origin is api.pickSpyOrigin (the nearest own body
   * with probes) unless opts.cp names one; another body than the current one is used through http.withPlanet (cp switched for the
   * request, then restored). Fewer probes sent than wanted -> api.checkSpySent (journal + one toast per session).
   * Result: { success, message (Russian text of the code on a refusal, never "undefined"), serverMessage, shipsSent (number; null when
   * the answer has none), code, slots, shipsLeft, planetId, resolvedBy, targetCoords, mismatch, origin, shipCount } | unresolved:
   * { success: false, shipsSent: 0, unresolved: true, message, suggestion, galaxyUrl }. mismatch = the server named other coords than
   * requested (stale cached id; the fleet WAS sent).
   */
  api.sendMiniFleet = async function (req, opts) {
    const r = await sendMiniFleet(req, opts);
    if (+req.mission === 6) { try { await api.checkSpySent(r, req.shipCount); } catch (e) { log.warn('checkSpySent', e && e.message); } }
    return r;
  };
  async function sendMiniFleet({ mission, galaxy, system, position, type = 1, shipCount, planetId }, { cp } = {}) {
    if (!(+shipCount > 0)) shipCount = +mission === 6 ? api.spyProbes() : 1;
    // spy origin: the nearest body with probes (cached counts); an explicit cp wins
    let origin = null;
    if (+mission === 6 && (cp === undefined || cp === null)) {
      try { origin = await api.pickSpyOrigin({ galaxy, system, position }); } catch (e) { log.warn('pickSpyOrigin', e && e.message); origin = null; }
      if (origin && Number.isFinite(origin.probes) && origin.probes > 0) shipCount = Math.min(+shipCount, origin.probes);
    }
    const switchTo = origin && origin.id && !origin.current ? origin.id : null;
    const via = (fn) => (switchTo ? http.withPlanet(switchTo, (id) => fn(id)) : fn(cp));
    let res;
    if (gzMode()) {
      let resolvedBy = planetId ? 'given' : null;
      if (!planetId) {
        const r = await api.resolvePlanetId({ galaxy, system, position, type: +mission === 8 ? 2 : type });
        if (!r.planetId) return { success: false, message: r.error, suggestion: r.suggestion, galaxyUrl: r.galaxyUrl, shipsSent: 0, code: null, unresolved: true };
        planetId = r.planetId; resolvedBy = r.source;
      }
      const g = await via((c) => http.get('fleetAjax', { query: { ajax: 1, mission, planetID: planetId }, cp: c, expect: 'json' }));
      const j = g.json && typeof g.json === 'object' ? g.json : {};
      const code = j.code !== undefined && j.code !== null && Number.isFinite(+j.code) ? +j.code : null;
      const ok = code === 600;
      const mess = typeof j.mess === 'string' && j.mess.trim() ? j.mess : null;
      const pm = parseFleetAjaxMess(mess);
      const want = galaxy && system && position ? galaxy + ':' + system + ':' + position : null;
      const message = ok ? mess || FA_CODES[600]
        : code !== null ? fleetAjaxText(code, mission)
          : g.error || (g.json === undefined || g.json === null ? 'http ' + g.status : 'нет кода в ответе сервера');
      res = { success: ok, message, serverMessage: mess, shipsSent: ok ? pm.ships : 0, code,
        slots: j.slots !== undefined ? +j.slots : null, shipsLeft: j.ships || null, planetId: +planetId, resolvedBy,
        targetCoords: pm.coords, mismatch: !!(ok && want && pm.coords && pm.coords !== want) };
    } else {
      const r = await via((c) => http.post('/ajax/fleet/dispatch/send-mini-fleet', { mission, galaxy, system, position, type, shipCount }, { cp: c, expect: 'json' }));
      if (!r.json) res = { success: false, message: r.error || 'http ' + r.status, shipsSent: 0 };
      else {
        const resp = r.json.response || {};
        res = { success: resp.success === true, message: resp.message || (resp.success === true ? '' : 'ошибка сервера'), shipsSent: +resp.shipsSent || 0 };
      }
    }
    if (origin) {
      res.origin = origin; res.shipCount = +shipCount;
      // the probes left the origin: the next pick must not count them (a later imperium / fleet page read wins)
      if (res.success && origin.id && Number.isFinite(res.shipsSent) && res.shipsSent > 0 && OGX.state && OGX.state.applySent) {
        try { await OGX.state.applySent({ originId: origin.id, ships: { 210: res.shipsSent } }); } catch (e) { log.warn('applySent', e && e.message); }
      }
    }
    return res;
  }

  // ------------------------------------------------------------------ probes per spy (setting spy.probes vs the game's spycount)
  const SPY_PROBES_DEFAULT = 1100;
  const SPYCOUNT_KEY = 'gz.spycount';   // server scope: { value, t, source: 'settings'|'fleetAjax' }
  /** Probes we want per spy: setting spy.probes (default 1100). */
  api.spyProbes = function () {
    let v;
    try { v = parseInt(OGX.settings.get('spy.probes'), 10); } catch (e) { v = NaN; }
    return Number.isFinite(v) && v > 0 ? v : SPY_PROBES_DEFAULT;
  };
  /** GALAXYZ: the account's probe setting (spycount on page=settings) as last seen: { value, t, source } | null. */
  api.gzSpyCount = async function () {
    const v = await OGX.storage.get(SPYCOUNT_KEY, null, { scope: 'server' });
    return v && +v.value > 0 ? v : null;
  };
  /** Stores the account's spycount; records it and a warning when it differs from spy.probes. Returns the stored object. */
  api.saveGzSpyCount = async function (value, source) {
    const n = parseInt(value, 10);
    if (!(n > 0)) return null;
    const prev = await api.gzSpyCount();
    const o = { value: n, t: Date.now(), source: source || 'settings' };
    await OGX.storage.set(SPYCOUNT_KEY, o, { scope: 'server' });
    const want = api.spyProbes();
    if (!prev || prev.value !== n) {
      OGX.log.rec('B', 'spy', 'spycount', { value: n, source: o.source, want, prev: prev ? prev.value : null });
      if (n !== want) OGX.log.rec('B', 'spy', 'spycount:mismatch', { value: n, want, text: api.spyCountWarning(n, want) });
    }
    return o;
  };
  api.spyCountWarning = (n, want) => 'В настройках игры стоит ' + n + ' зонд' + ruPlural(n) + ' на шпионаж, а нужно ' + want +
    ' — один клик шпионажа отправит ' + n;
  function ruPlural(n) {
    const a = n % 100, b = n % 10;
    if (a >= 11 && a <= 14) return 'ов';
    return b === 1 ? '' : b >= 2 && b <= 4 ? 'а' : 'ов';
  }
  let spyShortToasted = false;
  /**
   * After a spy mini-fleet: shipsSent < wanted (shipCount or spy.probes) -> journal 'spy' 'probes:short' and one toast per session.
   * GALAXYZ: probes left on the planet (answer.ships[210] > 0) prove the account setting limited the send: shipsSent = spycount.
   */
  api.checkSpySent = async function (res, shipCount) {
    if (!res || !res.success || !Number.isFinite(res.shipsSent) || res.shipsSent <= 0) return null;
    const want = +shipCount > 0 ? +shipCount : api.spyProbes();
    const left = res.shipsLeft && typeof res.shipsLeft === 'object' && res.shipsLeft[210] !== undefined ? +res.shipsLeft[210] : null;
    if (gzMode() && left !== null && left > 0) await api.saveGzSpyCount(res.shipsSent, 'fleetAjax');
    if (res.shipsSent >= want) return null;
    const why = left === 0 ? 'planet' : left > 0 ? 'setting' : 'unknown';
    const text = 'Отправлено ' + res.shipsSent + ' зонд' + ruPlural(res.shipsSent) + ' из ' + want + ': ' +
      (why === 'planet' ? 'на планете больше нет зондов' : 'в настройках игры (Настройки → количество шпионских зондов) стоит ' + res.shipsSent);
    OGX.log.rec('B', 'spy', 'probes:short', { sent: res.shipsSent, want, left, why, text });
    let shown = spyShortToasted;
    try { shown = shown || !!sessionStorage.getItem('ogx:spyShortToast'); sessionStorage.setItem('ogx:spyShortToast', '1'); } catch (e) { /* storage blocked */ }
    spyShortToasted = true;
    if (!shown && OGX.dom && OGX.dom.toast) OGX.dom.toast(text, { type: 'warn', ms: 9000 });
    return { sent: res.shipsSent, want, why, toast: !shown };
  };
  api.recall = async function (missionId) {
    if (gzMode()) {
      // POST page=fleetTable&action=sendfleetback fleetID -> the fleetTable page; recalled = the row lost its recall form
      const g = await http.post('fleetTable', { fleetID: missionId }, { query: { action: 'sendfleetback' }, expect: 'doc' });
      if (!g.ok || !g.doc) return { success: false, status: g.status };
      const row = OGX.parse.gz.fleetTable(g.doc).flights.find((f) => f.fleetId === +missionId);
      return { success: !row || !row.recallable, status: g.status, doc: g.doc };   // doc: the fleetTable page (event box, movement)
    }
    const r = await http.post('/ajax/fleet/dispatch/recall-fleet', { fleet_mission_id: missionId }, { expect: 'json' });
    return { success: !!(r.json && r.json.success === true), status: r.status };
  };
  api.templates = async function () {
    if (gzMode()) return [];   // no fleet templates on GALAXYZ
    const r = await http.get('/ajax/fleet/templates', { expect: 'json' });
    if (!r.ok || !r.json) return err(r);
    return (r.json.templates || []).map((t) => {
      const ships = {};
      for (const [id, n] of Object.entries(t.ships || {})) if (+n > 0) ships[+id] = +n;
      return { id: t.id, name: t.name, ships };
    });
  };
  api.galaxy = async function (galaxy, system, { background = false } = {}) {
    // GALAXYZ: the galaxy view is a full page that costs deuterium per view: no silent background calls until the galaxy port
    if (gzMode()) return Object.assign(unsupported('galaxy'), { json: null });
    const r = await http.post('/ajax/galaxy', { galaxy, system }, { noCp: true, cp: null, expect: 'json', background });
    if (!r.ok || !r.json) return Object.assign(err(r), { json: r.json || null });
    return { json: r.json };
  };
  /**
   * OgameX: POST /ajax/highscore -> html. GALAXYZ [UPSTREAM]: GET page=statistics&who=1|2&type&range (category 1 players / 2 alliances,
   * type mapped 0->1 points, 1->4 buildings, 2->3 research, 3->2 fleet; page N -> range (N-1)*100+1) -> the page html; with searchRelId
   * GET page=playerCard&id=N (the statistics page cannot filter by player) -> its html prefixed with `<!--ogx-playercard:N-->`.
   * Both html forms go through parse.highscorePlayers. Errors: { error, status, loggedOut }.
   */
  api.highscore = async function ({ category = 1, type = 0, page, searchRelId, background } = {}) {
    if (gzMode()) {
      if (searchRelId !== undefined && searchRelId !== null) return api.playerCard(searchRelId, { background, raw: true });
      const gt = OGX.parse.gz.STAT_TYPE_FROM_OGX[+type] || 1;
      const query = { who: +category === 2 ? 2 : 1, type: gt, range: page ? (Math.max(1, +page) - 1) * 100 + 1 : 1 };
      const g = await http.get('statistics', { query, expect: 'text', background });
      return g.ok ? g.text : err(g);
    }
    const form = { category, type };
    if (page !== undefined && page !== null) form.page = page;
    if (searchRelId !== undefined && searchRelId !== null) form.searchRelId = searchRelId;
    const r = await http.post('/ajax/highscore', form, { expect: 'text', background });
    return r.ok ? r.text : err(r);
  };
  /** GALAXYZ: GET page=playerCard&id=N [UPSTREAM popup] -> parse.gz.playerCard result (raw: true -> marked html). OgameX: unsupported. */
  api.playerCard = async function (id, { background, raw } = {}) {
    if (!gzMode()) return { error: 'playerCard: GALAXYZ only (OgameX: api.highscore searchRelId)', status: 0, loggedOut: false, unsupported: true };
    const g = await http.get('playerCard', { query: { id: +id }, expect: 'text', background });
    if (!g.ok) return err(g);
    const html = '<!--ogx-playercard:' + (+id) + '-->' + (g.text || '');
    return raw ? html : OGX.parse.gz.playerCard(html);
  };
  const SEARCH_TYPE = { 2: 'playername', 3: 'planetname', 4: 'allyname', 5: 'allytag' };
  /**
   * OgameX: POST /ajax/search -> json { status, results }. GALAXYZ [UPSTREAM page=search&mode=result&ajax=1&type&search]: the same
   * json shape built from the result table: { status: 'success', results: [player: { id, type: 'player', name, owner_id, owner_name,
   * coordinates, allianceId, allianceName, rank } | planet: { id: null (no planet id), type: 'planet', name: planet name, owner_id,
   * owner_name, coordinates, rank } | alliance: { id: null, type: 'alliance', name, tag, members, points }], engine: 'galaxyz',
   * unverified: true }; category 2 players, 3 planets, 4 alliance names, 5 alliance tags (GALAXYZ only). Empty term -> status 'error'.
   */
  api.search = async function (term, category = 2) {
    if (gzMode()) {
      const t = String(term || '').trim();
      if (!t) return { status: 'error', message: 'no search term', results: [], engine: 'galaxyz' };
      const type = SEARCH_TYPE[+category] || 'playername';
      const g = await http.get('search', { query: { mode: 'result', ajax: 1, type, search: t }, expect: 'text' });
      if (!g.ok) return err(g);
      const r = OGX.parse.gz.searchResult(g.text || '');
      if (r.error) return { status: 'error', message: r.error, results: [], engine: 'galaxyz', unverified: true };
      const results = r.rows.map((x) => (r.kind === 'alliance'
        ? { id: null, type: 'alliance', name: x.name, tag: x.tag, members: x.members, points: x.points }
        : type === 'planetname'
          ? { id: null, type: 'planet', name: x.planetName, owner_id: x.id, owner_name: x.name, coordinates: x.coords, rank: x.rank }
          : { id: x.id, type: 'player', name: x.name, owner_id: x.id, owner_name: x.name, coordinates: x.coords, planetName: x.planetName,
            allianceId: x.allianceId, allianceName: x.allianceName, rank: x.rank }));
      return { status: 'success', results, engine: 'galaxyz', unverified: true };
    }
    const r = await http.post('/ajax/search', { searchtext: term, category }, { expect: 'json' });
    if (!r.ok || !r.json) return err(r);
    return r.json;
  };
  api.messagesList = async function (tab, subtab, page = 1, { background } = {}) {
    if (gzMode()) {
      // GALAXYZ: tab = messcat (0 spy, 3 combat, 4 system, 5 transport, 15 expedition, 100 all...), subtab ignored.
      // WARNING: listing a category marks its messages read on the server (messages.md §0.1).
      const g = await http.get('messages', { query: { mode: 'view', messcat: tab, site: page || 1, ajax: 1 }, expect: 'text', background });
      if (!g.ok) return err(g);
      return { doc: new DOMParser().parseFromString(g.text || '', 'text/html'), html: g.text || '' };
    }
    const query = { tab };
    if (subtab) query.subtab = subtab;
    if (page) query.pagination = page;
    const r = await http.get('/ajax/messages', { query, expect: 'text', background });
    if (!r.ok) return err(r);
    return { doc: new DOMParser().parseFromString(r.text || '', 'text/html'), html: r.text || '' };
  };
  api.message = async function (id, tab, subtab, { background } = {}) {
    // GALAXYZ: no per-message endpoint, the list row holds the whole body: use OGX.messages.fetchDetail / messages.full
    if (gzMode()) return unsupported('message (use OGX.messages.fetchDetail or OGX.messages.full)');
    const query = {};
    if (tab) query.tab = tab;
    if (subtab) query.subtab = subtab;
    const r = await http.get('/ajax/messages/' + encodeURIComponent(id), { query, expect: 'text', background });
    if (!r.ok) return err(r);
    return { doc: new DOMParser().parseFromString(r.text || '', 'text/html'), html: r.text || '' };
  };
  /**
   * GALAXYZ combat report popup: GET page=raport&raport=<32 hex> [UPSTREAM ShowRaportPage:51-93] -> { doc, html, reportId } | error.
   * Expedition battles link CombatReport.php?raport=ID, which redirects to the same page. OgameX: unsupported.
   */
  api.raport = async function (reportId, { background } = {}) {
    if (!gzMode()) return { error: 'raport: GALAXYZ only (OgameX: api.message)', status: 0, loggedOut: false, unsupported: true };
    if (!/^[\w-]{1,64}$/.test(String(reportId || ''))) return { error: 'bad report id', status: 0, loggedOut: false };
    const g = await http.get('raport', { query: { raport: String(reportId) }, expect: 'text', background });
    if (!g.ok) return err(g);
    return { doc: new DOMParser().parseFromString(g.text || '', 'text/html'), html: g.text || '', reportId: String(reportId) };
  };
  async function confirmed(text, opts) {
    if (opts && opts.confirm === false) return true;
    let need = true;
    try { need = OGX.settings.get('core.confirmActions') !== false; } catch (e) { need = true; }
    if (!need) return true;
    return OGX.dom.confirm(text, { okLabel: 'Да', danger: !!(opts && opts.danger) });
  }
  api._confirmed = confirmed;
  /** Deletes one message (POST /messages action=103). Confirms when core.confirmActions (pass {confirm:false} after an own dialog). */
  api.deleteMessage = async function (id, opts = {}) {
    if (!(await confirmed('Удалить сообщение?', Object.assign({ danger: true }, opts)))) return false;
    if (gzMode()) {
      const f = { mode: 'action', ajax: 1, messcat: opts.cat !== undefined ? opts.cat : 100, side: 1, actionTop: 'deletemarked', submitTop: 'Confirm' };
      f['messageID[' + (+id) + ']'] = 1;
      const g = await http.post('messages', f, { expect: 'text' });
      return !!g.ok;
    }
    const r = await http.post('/messages', { messageId: id, action: 103, ajax: 1 }, { expect: 'json' });
    return !!(r.json && r.json[String(id)] === true);
  };
  /** Adds a build order (buildings.md §8). The defense page posts to /shipyard/add-buildrequest. */
  api.addBuild = async function (page, id, { amount = 1, downgrade = false, cp, confirm } = {}) {
    const ep = { resources: 'resources', facilities: 'facilities', buildings: 'buildings', research: 'research', shipyard: 'shipyard', defense: 'shipyard' }[page];
    if (!ep) return { ok: false, message: 'unknown page ' + page };
    const what = OGX.catalog.name(id) + (amount > 1 ? ' × ' + OGX.fmt.num(amount) : '');
    if (!(await confirmed((downgrade ? 'Снести уровень: ' : 'Построить: ') + what + '?', { confirm }))) return { ok: false, message: 'Отменено', cancelled: true };
    if (gzMode()) {
      // GALAXYZ form POSTs (buildings.md §6); no answer text: the returned page is re-parsed (ok = no info page). One level per call.
      const n = +id;
      let gp; let f;
      if (n >= 100 && n < 200) { gp = 'research'; f = { cmd: 'insert', tech: n }; }
      else if (n >= 200 && n < 600) { gp = 'shipyard'; f = { cmd: 'insert' }; f['fmenge[' + n + ']'] = Math.max(1, Math.floor(+amount || 1)); }
      else { gp = 'buildings'; f = { cmd: downgrade ? 'destroy' : 'insert', building: n }; }
      const g = await http.post(gp, f, { cp, expect: 'doc' });
      if (!g.ok || !g.doc) return { ok: false, message: g.error || 'http ' + g.status };
      const info = OGX.parse.gz.infoMessage(g.doc);
      return { ok: !info, message: info || '', doc: g.doc };
    }
    const r = await http.post(`/${ep}/add-buildrequest`, { technologyId: String(id), amount: String(amount), mode: downgrade ? '3' : '1' }, { cp, expect: 'json' });
    if (!r.json) return { ok: false, message: r.error || 'http ' + r.status };
    const j = r.json;
    return { ok: j.status === 'success' || j.success === true, message: j.message || (j.errors && j.errors[0] && j.errors[0].message) || '' };
  };
})(window.OGX);
