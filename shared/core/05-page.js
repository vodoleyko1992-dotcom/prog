/* shared/core/05-page.js — engine detection (GALAXYZ / 2Moons and lanedirt OgameX) and page routing. Owner: core.
 * GALAXYZ (ogamex.eu, specs/galaxyz/layout.md §1-2): /<Universe>/game.php?page=<name>[&mode=<mode>][&cp=<bodyId>],
 * meta generator "GALAXYZ 1.8.git". OgameX (lanedirt): routes by pathname (/overview, /fleet, ...). */
(function (OGX) {
  'use strict';
  const page = (OGX.page = OGX.page || {});

  const GZ_GEN = /^(GALAXYZ|2Moons)\b/i;
  const headScripts = (doc) => {
    try { return Array.from((doc.head || doc).querySelectorAll('script:not([src])')).map((s) => s.textContent).join('\n'); } catch (e) { return ''; }
  };
  function generatorOf(doc) {
    try { const m = doc.querySelector('meta[name="generator"]'); return m ? m.getAttribute('content') || '' : ''; } catch (e) { return ''; }
  }

  /**
   * page.detect(doc, loc) -> { ok, engine: 'galaxyz'|'ogamex'|null, candidate, reason, generator, version, popup }
   * Cheap and safe on any site: a few DOM queries, no storage, no network. `candidate` = the page looks like a game page
   * (generator meta, /game.php, or OgameX metas) — only then does a refusal deserve a diagnostics line (reason).
   */
  page.detect = function (doc = document, loc = location) {
    const out = { ok: false, engine: null, candidate: false, reason: null, generator: null, version: null, popup: false };
    try {
      if (/(^|\.)ogame\.gameforge\.com$/i.test(String(loc && loc.hostname || ''))) { out.reason = 'gameforge host'; return out; }
      if (!doc || !doc.querySelector) { out.reason = 'no document'; return out; }
      const gen = generatorOf(doc);
      const path = String(loc && loc.pathname || '');
      const proto = String(loc && loc.protocol || '');
      if (GZ_GEN.test(gen)) {
        Object.assign(out, { engine: /^GALAXYZ/i.test(gen) ? 'galaxyz' : '2moons', candidate: true, generator: gen, version: gen.split(/\s+/)[1] || null });
        // live: /<Universe>/game.php; DOMParser / saved files (no real location) are accepted
        if (proto && proto !== 'file:' && proto !== 'about:' && !/\/game\.php$/i.test(path)) { out.reason = out.engine + ': path is not /game.php (' + path.slice(0, 60) + ')'; return out; }
        if (!/\bserverTime\s*=\s*new Date\(/.test(headScripts(doc))) { out.reason = out.engine + ': no serverTime in <head> (login or error page)'; return out; }
        if (!doc.querySelector('#planetSelector')) {
          out.popup = !!(doc.body && doc.body.classList.contains('popup'));
          out.reason = out.engine + ': no #planetSelector (' + (out.popup ? 'popup window' : 'not a full game page') + ')';
          return out;
        }
        out.engine = 'galaxyz'; // plain 2Moons is served by the same adapter
        out.ok = true;
        return out;
      }
      const csrf = doc.querySelector('meta[name="csrf-token"]');
      const ver = doc.querySelector('meta[name="ogame-version"]');
      if (csrf && ver) {
        Object.assign(out, { engine: 'ogamex', candidate: true, version: ver.getAttribute('content') });
        if (!doc.querySelector('#planetList')) { out.reason = 'ogamex: no #planetList'; return out; }
        const head = doc.head;
        if (head && [...head.childNodes].some((n) => n.nodeType === 8 && /OGameX/.test(n.data))) { out.ok = true; return out; }
        out.ok = !!doc.querySelector('#siteFooter a.homeLink[href*="github.com/lanedirt/ogamex" i]');
        if (!out.ok) out.reason = 'ogamex: no OGameX marker (head comment / footer link)';
        return out;
      }
      if (/\/game\.php$/i.test(path)) { out.candidate = true; out.reason = 'game.php without generator meta' + (gen ? ' (' + gen.slice(0, 40) + ')' : ''); return out; }
      out.reason = 'not a game page';
      return out;
    } catch (e) {
      out.reason = 'detect failed: ' + (e && e.message);
      return out;
    }
  };
  /** true on a GALAXYZ or OgameX game page (page.detect().ok). */
  page.isOgx = function (doc = document, loc = location) {
    return page.detect(doc, loc).ok;
  };
  /** Engine of a (fetched) document without location checks: 'galaxyz' when the generator meta says so. */
  page.engineOf = function (doc) {
    if (!doc || !doc.querySelector) return page.engine;
    if (GZ_GEN.test(generatorOf(doc))) return 'galaxyz';
    if (doc.querySelector('meta[name="ogame-version"]')) return 'ogamex';
    return page.engine;
  };
  /** Engine of this tab: 'galaxyz' | 'ogamex' | null (set on the first detect of the live document / by boot). */
  page.engine = null;
  page.isGz = () => page.engine === 'galaxyz';
  page.setEngine = function (engine) {
    page.engine = engine || null;
    cached = null;
    try { if (OGX.util) OGX.util.numberDialect = engine === 'galaxyz' ? 'galaxyz' : 'ogamex'; } catch (e) { /* ignore */ }
  };

  // ------------------------------------------------------------------ OgameX routes (pathname)
  // Longest prefix first (layout.md §10).
  const ROUTES = [
    ['/resources/settings', 'resourceSettings', true],
    ['/fleet/movement', 'movement', true],
    ['/planet-move', 'planetMove', true],
    ['/overview', 'overview', true],
    ['/resources', 'resources', true],
    ['/facilities', 'facilities', true],
    ['/research', 'research', true],
    ['/shipyard', 'shipyard', true],
    ['/defense', 'defense', true],
    ['/fleet', 'fleet', true],
    ['/galaxy', 'galaxy', true],
    ['/messages', 'messages', true],
    ['/highscore', 'highscore', true],
    ['/buddies', 'buddies', true],
    ['/merchant', 'merchant', false],
    ['/alliance', 'alliance', false],
    ['/premium', 'premium', true],
    ['/shop', 'shop', true],
    ['/rewards', 'rewards', true],
    ['/characterclass', 'characterclass', true],
    ['/chat', 'chat', true],
    ['/options', 'options', true],
    ['/admin', 'admin', false],
  ];
  page.ROUTES = ROUTES;
  /** PageName for an OgameX pathname: exact match for most pages, prefix match for merchant/alliance/admin sub-pages. */
  page.nameFor = function (pathname) {
    let p = String(pathname || '/').replace(/\/+$/, '');
    if (p === '' || p === '/') return 'overview';
    p = p.toLowerCase();
    for (const [path, name, exact] of ROUTES) {
      if (p === path) return name;
      if (!exact && p.startsWith(path + '/')) return name;
    }
    return 'other';
  };

  // ------------------------------------------------------------------ GALAXYZ routes (?page=&mode=)
  // GALAXYZ page (lower case) -> [PageName, aliases]. Aliases keep the module `pages:` filters of OgameX names working
  // (PORT_PLAN §2.6): page=buildings holds mines, storage and facilities; page=resources is the production settings.
  const GZ_ROUTES = {
    overview: ['overview', []],
    buildings: ['buildings', ['resources', 'facilities']],
    resources: ['resourceSettings', []],
    research: ['research', []],
    shipyard: ['shipyard', []],             // mode=defense -> 'defense' (below)
    fleettable: ['fleet', ['movement']],
    fleetstep1: ['fleet', []],
    fleetstep2: ['fleet', []],
    fleetstep3: ['fleet', []],
    galaxy: ['galaxy', []],
    messages: ['messages', []],
    statistics: ['highscore', []],
    imperium: ['empire', []],
    officier: ['premium', []],
    trader: ['merchant', []],
    fleetdealer: ['merchant', []],
    alliance: ['alliance', []],
    buddylist: ['buddies', []],
    settings: ['options', []],
    relocate: ['planetMove', []],
  };
  page.GZ_ROUTES = GZ_ROUTES;
  /** PageName (+ aliases, fleet step) for a GALAXYZ page/mode pair. Unknown pages -> 'other'. */
  page.nameForGz = function (gzPage, mode) {
    const p = String(gzPage || 'overview').toLowerCase();
    if (p === 'shipyard') return { name: String(mode || '').toLowerCase() === 'defense' ? 'defense' : 'shipyard', aliases: [], step: null };
    const r = GZ_ROUTES[p];
    const step = /^fleetstep([123])$/.exec(p);
    return r ? { name: r[0], aliases: r[1].slice(), step: step ? +step[1] : null } : { name: 'other', aliases: [], step: null };
  };
  // OgameX path (what modules pass to page.url / http) -> GALAXYZ page (+ fixed query, + renamed query keys).
  const GZ_PATHS = {
    '/': ['overview'], '/overview': ['overview'], '/resources': ['buildings'], '/facilities': ['buildings'], '/research': ['research'],
    '/shipyard': ['shipyard', { mode: 'fleet' }], '/defense': ['shipyard', { mode: 'defense' }],
    '/fleet': ['fleetTable', null, { position: 'planet', type: 'planettype', mission: 'target_mission' }],
    '/fleet/movement': ['fleetTable'], '/galaxy': ['galaxy', null, { position: 'planet' }], '/messages': ['messages'],
    '/highscore': ['statistics'], '/resources/settings': ['resources'], '/premium': ['officier'], '/merchant': ['trader'],
    '/alliance': ['alliance'], '/buddies': ['buddyList'], '/options': ['settings'], '/planet-move': ['relocate'], '/empire': ['imperium'],
  };
  page.GZ_PATHS = GZ_PATHS;
  // OgameX paths with an id segment -> GALAXYZ page + query [UPSTREAM 2Moons]: ShowAlliancePage::info/apply (HTTP::_GP('id')),
  // ShowPlayerCardPage (id; base.js Dialog.Playercard opens game.php?page=playerCard&id=), ShowRaportPage (raport=<id>).
  const GZ_PATTERNS = [
    [/^\/alliance\/info\/(\d+)$/, (m) => ['alliance', { mode: 'info', id: m[1] }]],
    [/^\/alliance\/apply\/(\d+)$/, (m) => ['alliance', { mode: 'apply', id: m[1] }]],
    [/^\/(?:player|playercard)\/(\d+)$/, (m) => ['playerCard', { id: m[1] }]],
    [/^\/(?:messages\/)?raport\/([\w-]+)$/, (m) => ['raport', { raport: m[1] }]],
  ];
  page.GZ_PATTERNS = GZ_PATTERNS;
  // Routes that are not one-to-one: both OgameX paths open the same GALAXYZ page (page=buildings holds mines, storage
  // and facilities). Callers that need one of them read page.gzRoute(path).shared.
  const GZ_SHARED = { '/resources': ['/resources', '/facilities'], '/facilities': ['/resources', '/facilities'] };
  /**
   * page.gzRoute(path) -> { page, query, rename, shared: string[]|null } | null — the GALAXYZ target of an OgameX path
   * ('/fleet', '/alliance/info/7', '/empire'), without building a URL; null for an unknown path.
   */
  page.gzRoute = function (path) {
    const key = String(path || '').split('?')[0].replace(/\/+$/, '').toLowerCase() || '/';
    const m = GZ_PATHS[key];
    if (m) return { page: m[0], query: Object.assign({}, m[1] || {}), rename: m[2] ? Object.assign({}, m[2]) : null, shared: GZ_SHARED[key] ? GZ_SHARED[key].slice() : null };
    for (const [re, fn] of GZ_PATTERNS) {
      const x = re.exec(key);
      if (x) { const [pg, q] = fn(x); return { page: pg, query: q, rename: null, shared: null }; }
    }
    return null;
  };
  // PageName -> OgameX path, for page.urlFor (engine-neutral links by page name).
  const NAME_PATHS = { overview: '/overview', resources: '/resources', facilities: '/facilities', buildings: '/resources', research: '/research',
    shipyard: '/shipyard', defense: '/defense', fleet: '/fleet', movement: '/fleet/movement', galaxy: '/galaxy', messages: '/messages',
    highscore: '/highscore', resourceSettings: '/resources/settings', premium: '/premium', merchant: '/merchant', alliance: '/alliance',
    buddies: '/buddies', options: '/options', planetMove: '/planet-move', empire: '/empire' };
  /** page.urlFor(pageName, query={}) -> absolute URL of a PageName on this engine ('empire' -> GALAXYZ page=imperium), null if unknown. */
  page.urlFor = function (name, query = {}) {
    const p = NAME_PATHS[name];
    return p ? page.url(p, query) : null;
  };
  function gzQueryString(doc) {
    const m = /var\s+queryString\s*=\s*"([^"]*)"/.exec(headScripts(doc) || '') || /var\s+queryString\s*=\s*"([^"]*)"/.exec(scriptsAll(doc));
    return m ? m[1].replace(/\\\//g, '/') : null;
  }
  function scriptsAll(doc) {
    try { return Array.from(doc.querySelectorAll('script:not([src])')).map((s) => s.textContent).join('\n'); } catch (e) { return ''; }
  }
  /** GALAXYZ route of a document: URL first, `var queryString` for DOMParser documents and pages reached by POST. */
  page.routeGz = function (doc = document, href) {
    let gzPage = null; let mode = null; let cp = null;
    // DOMParser documents inherit this tab's URL: for them only queryString (or an explicit href) counts
    const h = href !== undefined ? href : (doc === document ? location.href : '');
    try { if (h) { const u = new URL(h); gzPage = u.searchParams.get('page'); mode = u.searchParams.get('mode'); cp = u.searchParams.get('cp'); } } catch (e) { /* ignore */ }
    const qs = gzQueryString(doc);
    if (qs !== null) {
      const q = new URLSearchParams(qs);
      if (!gzPage && q.get('page')) gzPage = q.get('page');
      if (!mode && q.get('mode')) mode = q.get('mode');
    }
    // the action of a POSTed form may sit in the path query (fleetTable&action=sendfleetback): keep the plain page name
    gzPage = gzPage || 'overview';
    const r = page.nameForGz(gzPage, mode);
    const isInfo = !!(doc && doc.querySelector && !doc.querySelector('#rechts') && doc.querySelector('#inhalt > .headerRS + .mainRS'));
    return Object.assign(r, { raw: gzPage, mode: mode || null, cp: cp ? +cp : null, queryString: qs, info: isInfo && !r.step });
  };

  // ------------------------------------------------------------------ info
  let cached = null;
  /**
   * PageInfo = { name, aliases, path, query, bodyId, isAdmin, origin, engine,
   *              GALAXYZ only: raw (page=), mode, step (fleetStep 1..3), cp, universe, base (absolute game.php URL), info (message page) }
   */
  page.info = function () {
    if (cached) return cached;
    const loc = location;
    if (page.engine === null) { try { const d = page.detect(document, loc); if (d.ok) page.setEngine(d.engine); } catch (e) { /* ignore */ } }
    if (page.engine === 'galaxyz') {
      const r = page.routeGz(document);
      const src = scriptsAll(document);
      cached = {
        name: r.name, aliases: r.aliases, raw: r.raw, mode: r.mode, step: r.step, cp: r.cp, info: r.info,
        path: loc.pathname, query: new URLSearchParams(loc.search),
        bodyId: (document.body && document.body.id) || '',
        isAdmin: +((/var\s+auth\s*=\s*(\d+)/.exec(src) || [])[1] || 0) > 0,
        origin: loc.origin, engine: 'galaxyz',
        universe: (loc.pathname.match(/^\/([^/]+)\/game\.php$/i) || [])[1] || null,
        base: loc.origin + loc.pathname.replace(/[^/]*$/, '') + 'game.php',
      };
      return cached;
    }
    cached = {
      name: page.nameFor(loc.pathname),
      aliases: [],
      path: loc.pathname,
      query: new URLSearchParams(loc.search),
      bodyId: (document.body && document.body.id) || '',
      isAdmin: !!document.getElementById('adminbar'),
      origin: loc.origin,
      engine: page.engine,
    };
    return cached;
  };
  page._resetInfo = () => { cached = null; };
  /** true when the page name or one of its aliases is in names. */
  page.is = (...names) => { const i = page.info(); return names.includes(i.name) || (i.aliases || []).some((a) => names.includes(a)); };

  /** Absolute game.php URL of this universe (GALAXYZ). */
  page.gzBase = function () {
    try { const i = page.info(); if (i.base) return i.base; } catch (e) { /* ignore */ }
    return location.origin + location.pathname.replace(/[^/]*$/, '') + 'game.php';
  };
  /**
   * page.url(path, query={}) -> absolute URL (null/undefined values dropped).
   * OgameX: path relative to the origin. GALAXYZ: an OgameX path ('/fleet', '/galaxy', ...) is translated through GZ_PATHS
   * (query keys renamed, e.g. position -> planet), id paths through GZ_PATTERNS ('/alliance/info/7' -> page=alliance&mode=info&id=7,
   * '/player/5' -> page=playerCard&id=5, '/raport/ID' -> page=raport&raport=ID), '/resources' and '/facilities' both -> page=buildings
   * (see page.gzRoute().shared), '/empire' -> page=imperium; 'game.php?page=..' / '?page=..' is resolved against this universe,
   * and a bare name ('fleetStep1', 'TechnologyDetailsAjax') becomes ?page=<name>.
   */
  page.url = function (path, query = {}) {
    let u;
    if (page.engine === 'galaxyz') u = gzUrl(String(path == null ? '' : path), query || {});
    else {
      u = new URL(path, location.origin);
      for (const [k, v] of Object.entries(query || {})) {
        if (v === undefined || v === null) continue;
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  };
  function gzUrl(path, query) {
    const base = page.gzBase();
    let u;
    let rename = null;
    if (/^https?:\/\//i.test(path)) u = new URL(path);
    else if (/^(\.\/)?game\.php/i.test(path) || path.startsWith('?')) u = new URL(path.replace(/^\.\//, ''), base);
    else if (path.startsWith('/')) {
      const m = page.gzRoute(path);
      u = new URL(base);
      if (m) {
        u.searchParams.set('page', m.page);
        for (const [k, v] of Object.entries(m.query || {})) u.searchParams.set(k, v);
        rename = m.rename;
      } else u = new URL(path, location.origin); // unknown OgameX path: left as is (the game answers 404)
      const qs = path.split('?')[1];
      if (qs) for (const [k, v] of new URLSearchParams(qs)) u.searchParams.set(rename && rename[k] || k, v);
    } else {
      u = new URL(base);
      const [name, qs] = path.split('?');
      if (name) u.searchParams.set('page', name);
      if (qs) for (const [k, v] of new URLSearchParams(qs)) u.searchParams.set(k, v);
    }
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(rename && rename[k] || k, String(v));
    }
    return u;
  }
  page.go = (path, query = {}) => location.assign(page.url(path, query));
  /**
   * page.bodyUrl(id) -> absolute URL of this page with cp=<id>, every other query parameter kept (what the game's planet
   * links / selector do: OgameX main.blade.php:1733-1735, GALAXYZ base.js:282). GALAXYZ: fleetStep1-3 and info pages are
   * POST results (-> page=fleetTable / overview) and a galaxy view costs deuterium (-> overview), so those switch the body
   * on another page. The hash is dropped.
   */
  page.bodyUrl = function (id) {
    if (page.engine === 'galaxyz') {
      try {
        const i = page.info();
        if (i.step) return page.url('/fleet', { cp: id });
        if (i.info || page.is('galaxy')) return page.url('/overview', { cp: id });
      } catch (e) { /* same page */ }
    }
    const u = new URL(location.href);
    u.searchParams.set('cp', String(id));
    u.hash = '';
    return u.toString();
  };

  /**
   * Storage identity of this tab: { host, playerId }. OgameX: location.host + numeric player id.
   * GALAXYZ: the universe is part of the host ('ogamex.eu/aeternum') and the player is keyed by name ('n:<name>'), because
   * the numeric id is not in the page header (only on pages like tournament, PORT_PLAN §3 03-storage).
   */
  page.identity = function (snap) {
    const p = (snap && snap.player) || {};
    if (page.engine === 'galaxyz') {
      const uni = (location.pathname.match(/^\/([^/]+)\/game\.php$/i) || [])[1];
      return { host: location.host + (uni ? '/' + uni : ''), playerId: p.name ? 'n:' + p.name : (p.id || null) };
    }
    return { host: location.host, playerId: p.id || null };
  };
})(window.OGX);
