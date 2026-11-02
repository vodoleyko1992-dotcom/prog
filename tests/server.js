'use strict';
// Mock OgameX server for the OGX test harness (DESIGN.md section 5.1). No dependencies.
//
//   const { startServer } = require('./server');
//   const srv = await startServer({ port: 0, scenario: 'vega', gameJs: false });
//   srv.origin / srv.requests / srv.unhandled / srv.assets / srv.state
//   srv.route(method, pathOrRegex, handler(req, res, ctx)) / srv.setScenario(name) / srv.reset() / srv.close()
//
// CLI: node tests/server.js --port 8080 --scenario vega [--game-js]
//
// Inspection endpoints (never recorded): GET /__ogx/requests, GET /__ogx/unhandled, GET /__ogx/state,
// POST /__ogx/state (JSON body merged into state), POST /__ogx/reset.

const http = require('http');
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', 'fixtures');
const SRC = path.resolve(__dirname, '..', '..', 'src', 'OGameX');

const TOKENS = {
  vega: 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e',
  orion: 'Qm3c4p0tXgF9b2kLr8VwZy1sNuHdEj6aTo5iCxYe',
};

// account: which sample account the scenario lives in. bodies: planet/moon ids of that account.
const SCENARIOS = {
  vega: { account: 'vega', playerId: 108, bodies: [1, 3, 5], moons: [5], home: 1 },
  compact: { account: 'vega', playerId: 108, bodies: [1, 3, 5], moons: [5], home: 1 },
  vacation: { account: 'vega', playerId: 108, bodies: [1, 3, 5], moons: [5], home: 1 },
  orion: { account: 'orion', playerId: 1, bodies: [4, 7, 9], moons: [9], home: 4 },
};

// Game JS (optional, gameJs: true): OgameX's own ingame bundle, minus pusher/echo/chat (same list as tools/render_galaxy.js).
const GAME_SCRIPTS = [
  'jquery-1.12.4.min.js', 'vendor/jquery-ui-1.12.1.js', 'vendor/anythingslider-1.9.7.js', 'vendor/jquery.ba-bbq-1.4pre.js',
  'vendor/jquery.colorpicker.js', 'jquery.js', 'inventory.js', 'jquery-spinners.js', 'messages.js', 'tooltips.js', 'trader.js',
  'timerhandler.js', 'e7c74974620fa35b197315ebdbb8c2.js', 'messages-pagination.js',
];
let gameBundleCache = null;
function gameBundle() {
  if (gameBundleCache == null) {
    try {
      gameBundleCache = GAME_SCRIPTS.map((f) => fs.readFileSync(path.join(SRC, 'resources/js/ingame', f), 'utf8')).join('\n;\n')
        // chat.js is left out (it needs pusher/echo); stub the calls the layout makes into it.
        + '\n;(function(){var o=window.ogame=window.ogame||{};if(!o.chat){o.chat=new Proxy({},{get:function(){return function(){};}});}})();\n';
    } catch (e) {
      gameBundleCache = '/* OgameX sources not found: ' + e.message + ' */';
    }
  }
  return gameBundleCache;
}

const fixtureCache = new Map();
function fixture(name) {
  if (!fixtureCache.has(name)) fixtureCache.set(name, fs.readFileSync(path.join(FIX, name), 'utf8'));
  return fixtureCache.get(name);
}
function fixtureExists(name) {
  return fs.existsSync(path.join(FIX, name));
}
const fixtureList = fs.readdirSync(FIX);

// Replace http://localhost (and the JSON-escaped form) not followed by ':' with the request origin.
function rewrite(text, origin) {
  const esc = origin.replace(/\//g, '\\/');
  return text.replace(/http:\\\/\\\/localhost(?![:\w.-])/g, esc).replace(/http:\/\/localhost(?![:\w.-])/g, origin);
}

// Occupied coordinates in the galaxy fixtures (for check-target).
let occupiedCache = null;
function occupied() {
  if (occupiedCache) return occupiedCache;
  occupiedCache = new Set();
  for (const f of fixtureList.filter((n) => /^galaxy-ajax-\d+-\d+.*\.json$/.test(n))) {
    try {
      const j = JSON.parse(fixture(f));
      const s = j.system || {};
      for (const row of s.galaxyContent || []) {
        const planets = Array.isArray(row.planets) ? row.planets : Object.values(row.planets || {});
        const own = row.player && row.player.playerId && row.player.playerId !== 99999;
        if (planets.length && own) occupiedCache.add(`${s.galaxy}:${s.system}:${row.position}`);
      }
    } catch (e) { /* ignore broken fixture */ }
  }
  return occupiedCache;
}

// Event-list fleet ids (recall-fleet succeeds only for these).
let eventIdsCache = null;
function eventIds() {
  if (eventIdsCache) return eventIdsCache;
  const html = fixture('fleet-eventlist.html');
  eventIdsCache = new Set();
  for (const m of html.matchAll(/data-fleet-id="(\d+)"/g)) eventIdsCache.add(m[1]);
  for (const m of html.matchAll(/id="eventRow-(\d+)"/g)) eventIdsCache.add(m[1]);
  return eventIdsCache;
}

// Inner HTML of <div id="stat_list_content"> on the highscore page (the page-1 AJAX fragment).
function highscoreFragment() {
  const html = fixture('galaxy-highscore-page.html');
  const startTag = html.search(/<div[^>]*id="stat_list_content"[^>]*>/);
  if (startTag < 0) return html;
  const open = html.indexOf('>', startTag) + 1;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = open;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index);
  }
  return html.slice(open);
}

const PLAIN_PAGES = {
  '/not-ogame': '<!doctype html><html><head><meta charset="utf-8"><title>Not OGame</title></head><body><h1>Just a page</h1><p>Nothing to see here.</p></body></html>',
  '/login': '<!doctype html><html><head><meta charset="utf-8"><meta name="csrf-token" content="' + TOKENS.vega + '"><title>OGameX login</title></head><body id="login"><!-- OGameX --><form method="post" action="/login"><input name="email"><input name="password" type="password"></form></body></html>',
  '/gameforge-like': '<!doctype html><html><head><meta charset="utf-8"><meta name="csrf-token" content="abc"><meta name="ogame-version" content="12.0.0"><meta name="ogame-player-id" content="1"><title>OGame</title></head><body id="overview"><div id="planetList"><div class="smallplanet" id="planet-33620000"></div></div></body></html>',
};

const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function defaultState(scenario) {
  const sc = SCENARIOS[scenario];
  if (!sc) throw new Error('unknown scenario ' + scenario + ' (known: ' + Object.keys(SCENARIOS).join(', ') + ')');
  return {
    scenario,
    account: sc.account,
    playerId: sc.playerId,
    currentBodyId: sc.home,
    csrf: TOKENS[sc.account],
    lastPageAccount: sc.account,
    eventbox: 'normal', // 'normal' | 'empty'
    sendFleet: 'success', // 'success' | 'error' | 'validation'
    miniFleet: 'success', // 'success' | 'error'
    addBuild: 'success', // 'success' | 'error' | 'busy' | 'upgrading' | 'vacation'
    downgrade: 'success', // 'success' | 'error'
    discoverer: false, // galaxy 1:42 -> discoverer variant
    latencyMs: 0, // artificial delay for every non-asset response
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function parseForm(raw, contentType) {
  const out = {};
  if (!raw) return out;
  if (/application\/json/i.test(contentType || '')) {
    try { const j = JSON.parse(raw); if (j && typeof j === 'object') Object.assign(out, j); } catch (e) { /* ignore */ }
    return out;
  }
  const p = new URLSearchParams(raw);
  for (const [k, v] of p) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

async function startServer(opts = {}) {
  const port = opts.port || 0;
  let state = defaultState(opts.scenario || 'vega');
  const gameJs = !!opts.gameJs;
  const extraRoutes = []; // {method, match, handler}
  const srv = {
    origin: null,
    port: null,
    requests: [],
    unhandled: [],
    assets: [],
    get state() { return state; },
    set state(v) { state = v; },
    gameJs,
    route(method, match, handler) { extraRoutes.unshift({ method: method.toUpperCase(), match, handler }); return srv; },
    setScenario(name) { const keep = state.latencyMs; state = defaultState(name); state.latencyMs = keep; return srv; },
    reset() { srv.requests.length = 0; srv.unhandled.length = 0; srv.assets.length = 0; state = defaultState(state.scenario); extraRoutes.length = 0; return srv; },
    clearLog() { srv.requests.length = 0; srv.unhandled.length = 0; srv.assets.length = 0; return srv; },
    // requests filtered: srv.find('POST', '/ajax/fleet/dispatch/send-fleet')
    find(method, pathOrRe) {
      return srv.requests.filter((r) => (!method || r.method === method) && (typeof pathOrRe === 'string' ? r.path === pathOrRe : !pathOrRe || pathOrRe.test(r.path)));
    },
    close() { return new Promise((r) => server.close(() => r())); },
  };

  const send = (res, status, body, type = 'text/html; charset=utf-8', headers = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      send(res, 500, 'mock server error: ' + (e && e.stack || e), 'text/plain');
    }
  });

  async function handle(req, res) {
    const host = req.headers.host || `localhost:${srv.port}`;
    const origin = `http://${host}`;
    const url = new URL(req.url, origin);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    const raw = method === 'GET' || method === 'HEAD' ? '' : await readBody(req);

    // ---- inspection endpoints ----
    if (p.startsWith('/__ogx/')) {
      if (p === '/__ogx/requests') return send(res, 200, JSON.stringify(srv.requests), 'application/json');
      if (p === '/__ogx/unhandled') return send(res, 200, JSON.stringify(srv.unhandled), 'application/json');
      if (p === '/__ogx/state' && method === 'GET') return send(res, 200, JSON.stringify(state), 'application/json');
      if (p === '/__ogx/state' && method === 'POST') { Object.assign(state, JSON.parse(raw || '{}')); return send(res, 200, JSON.stringify(state), 'application/json'); }
      if (p === '/__ogx/reset' && method === 'POST') { srv.reset(); return send(res, 200, '{"ok":true}', 'application/json'); }
      return send(res, 404, '{}', 'application/json');
    }

    // ---- static assets (not recorded in requests) ----
    if (/^\/(build|img|fonts|video|cdn|css|js)\//.test(p) || p === '/favicon.ico' || p === '/robots.txt') {
      srv.assets.push({ t: Date.now(), method, path: p });
      return serveAsset(res, p);
    }

    const query = Object.fromEntries(url.searchParams);
    const form = parseForm(raw, req.headers['content-type']);
    const cpRaw = url.searchParams.get('cp');
    const cp = cpRaw != null && /^\d+$/.test(cpRaw) ? Number(cpRaw) : null;
    const sc = SCENARIOS[state.scenario];
    if (cp != null && sc.bodies.includes(cp)) state.currentBodyId = cp;
    const rec = { t: Date.now(), method, path: p, url: url.pathname + url.search, query, form, raw, headers: req.headers, cp, host };
    srv.requests.push(rec);

    if (state.latencyMs) await new Promise((r) => setTimeout(r, state.latencyMs));

    const ctx = { url, path: p, query, form, raw, method, origin, state, rec, srv, fixture, rewrite, send: (...a) => send(res, ...a) };

    // replies
    const page = (name) => {
      const html = fixture(name);
      const m = html.match(/name="csrf-token" content="([^"]+)"/);
      if (m) state.lastPageAccount = m[1] === TOKENS.orion ? 'orion' : 'vega';
      rec.fixture = name;
      return send(res, 200, rewrite(html, origin));
    };
    const json = (name, status = 200, type = 'application/json') => { rec.fixture = name; return send(res, status, rewrite(fixture(name), origin), type); };
    const jsonBody = (obj, status = 200) => send(res, status, JSON.stringify(obj), 'application/json');
    const html = (name, status = 200) => { rec.fixture = name; return send(res, status, rewrite(fixture(name), origin)); };
    const unhandled = (status = 404, why = 'no route') => {
      rec.unhandled = why;
      srv.unhandled.push(rec);
      return send(res, status, `<!doctype html><title>${status}</title><h1>${status}</h1><p>mock: ${why}: ${method} ${p}</p>`);
    };
    Object.assign(ctx, { page, json, jsonBody, html, unhandled });

    // ---- per-test routes ----
    for (const r of extraRoutes) {
      if (r.method !== method && r.method !== '*') continue;
      if (typeof r.match === 'string' ? r.match === p : r.match.test(p)) {
        rec.custom = true;
        return r.handler(req, res, ctx);
      }
    }

    // ---- CSRF for every non-GET ----
    if (method !== 'GET' && method !== 'HEAD') {
      const tok = form._token || req.headers['x-csrf-token'];
      const ok = [state.csrf, TOKENS[state.lastPageAccount]].includes(tok);
      if (!ok) { rec.csrf = false; return jsonBody({ message: 'CSRF token mismatch.' }, 419); }
      rec.csrf = true;
    }

    const body = state.currentBodyId;
    const acct = sc.account;

    // ---- non-OgameX pages ----
    if (PLAIN_PAGES[p] && method === 'GET') return send(res, 200, PLAIN_PAGES[p]);
    if (p === '/' && method === 'GET') return send(res, 301, '', 'text/html', { Location: '/overview' + url.search });

    // ---- full pages ----
    if (method === 'GET') {
      const has = (k) => url.searchParams.get(k) != null && url.searchParams.get(k) !== '';
      const vegaPages = {
        '/overview': () => (state.scenario === 'compact' ? 'layout-overview-compact.html' : body === 5 ? 'layout-overview-moon.html' : body === 3 ? 'layout-overview-compact.html' : 'layout-overview-planet.html'),
        '/fleet': () => (body === 5 ? 'fleet-dispatch-noships.html' : has('galaxy') && has('system') && has('position') ? 'fleet-dispatch-prefill.html' : 'fleet-dispatch-planet.html'),
        '/fleet/movement': () => 'fleet-movement.html',
        '/galaxy': () => (state.scenario === 'vacation' ? 'galaxy-page-vacation.html' : has('galaxy') && has('system') ? 'galaxy-page-query.html' : 'galaxy-page.html'),
        '/messages': () => 'messages-page.html',
        '/highscore': () => 'galaxy-highscore-page.html',
        '/buddies': () => 'galaxy-buddies-page.html',
      };
      const orionPages = {
        '/overview': () => (body === 9 ? 'buildings-overview-moon.html' : 'buildings-overview.html'),
        '/resources': () => (body === 7 ? 'buildings-resources-colony.html' : body === 9 ? 'buildings-resources-moon.html' : 'buildings-resources.html'),
        '/facilities': () => (body === 9 ? 'buildings-facilities-moon.html' : 'buildings-facilities.html'),
        '/research': () => 'buildings-research.html',
        '/shipyard': () => 'buildings-shipyard.html',
        '/defense': () => 'buildings-defense.html',
        '/resources/settings': () => 'buildings-resource-settings.html',
      };
      const own = acct === 'orion' ? orionPages : vegaPages;
      const other = acct === 'orion' ? vegaPages : orionPages;
      if (own[p]) return page(own[p]());
      if (other[p]) { rec.fallback = true; return page(other[p]()); }
    }

    // ---- AJAX ----
    let m;
    // technology details
    if (method === 'GET' && (m = p.match(/^\/ajax\/(resources|facilities|research|shipyard|defense)$/))) {
      const id = String(query.technology || '');
      if (id === '1' && acct === 'vega') return json('layout-ajax-resources-technology-1.json');
      const cands = fixtureList.filter((n) => new RegExp(`^buildings-ajax-[a-z]+-${id}(-moon)?\\.json$`).test(n));
      if (id && cands.length) return json(cands.find((n) => n.startsWith(`buildings-ajax-${m[1]}-`)) || cands[0]);
      if (id === '1') return json('layout-ajax-resources-technology-1.json');
      return unhandled(500, 'no technology fixture for ' + id);
    }
    if (method === 'GET' && p === '/ajax/techtree') {
      const n1 = `ogamelive-techtree-tab${query.tab}-${query.object_id}.html`;
      const n2 = `buildings-techtree-tab${query.tab}-${query.object_id}.html`;
      if (fixtureExists(n1)) return html(n1);
      if (fixtureExists(n2)) return html(n2);
      return unhandled(404, 'no techtree fixture');
    }
    if (method === 'GET' && p === '/overlay/server-settings') return html('layout-overlay-server-settings.html');
    if (method === 'GET' && p === '/overlay/search') return html('galaxy-search-overlay.html');

    // fleet events
    if (method === 'GET' && p === '/ajax/fleet/eventlist/fetch') return html('fleet-eventlist.html');
    if (method === 'GET' && p === '/ajax/fleet/eventbox/fetch') return json(state.eventbox === 'empty' ? 'fleet-eventbox-empty.json' : 'fleet-eventbox.json');
    if (method === 'POST' && p === '/ajax/fleet/eventlist/checkevents') return json('fleet-checkevents.json', 200, 'text/plain; charset=UTF-8');

    // dispatch
    if (method === 'POST' && p === '/ajax/fleet/dispatch/check-target') {
      const [g, s, pos] = [form.galaxy, form.system, form.position].map(Number);
      if (![g, s, pos].every(Number.isFinite) || g > 9 || !g || !s || !pos || pos > 16) return json('fleet-check-target-invalid.json');
      if (pos === 16) return json('fleet-check-target-expedition.json');
      if (!occupied().has(`${g}:${s}:${pos}`)) return json('fleet-check-target-empty-slot.json');
      return json('fleet-check-target-player.json');
    }
    if (method === 'POST' && p === '/ajax/fleet/dispatch/send-fleet') {
      const ships = Object.keys(form).filter((k) => /^am\d+$/.test(k) && Number(form[k]) > 0);
      const mission = Number(form.mission);
      const speed = Number(form.speed);
      const coordsOk = ['galaxy', 'system', 'position', 'type'].every((k) => form[k] !== undefined && form[k] !== '' && Number.isFinite(Number(form[k])));
      const valid = ships.length > 0 && ([1, 2, 3, 4, 5, 6, 7, 8, 9, 15].includes(mission)) && speed >= 1 && speed <= 10 && Number.isInteger(speed * 2) && coordsOk;
      rec.valid = valid;
      if (!valid) return json('fleet-send-fleet-validation-error.json');
      if (state.sendFleet === 'validation') return json('fleet-send-fleet-validation-error.json');
      return json(state.sendFleet === 'error' ? 'fleet-send-fleet-error.json' : 'fleet-send-fleet-success.json');
    }
    if (method === 'POST' && p === '/ajax/fleet/dispatch/send-mini-fleet') {
      if (Number(form.shipCount) === 0 || state.miniFleet === 'error') return json('fleet-send-mini-fleet-error.json');
      return json('fleet-send-mini-fleet-success.json');
    }
    if (method === 'POST' && p === '/ajax/fleet/dispatch/recall-fleet') {
      if (eventIds().has(String(form.fleet_mission_id))) return json('fleet-recall-success.json');
      return json('fleet-recall-failure.json', 500);
    }
    if (method === 'GET' && p === '/ajax/fleet/templates') return json('fleet-templates.json');
    if (method === 'POST' && p === '/ajax/fleet/templates') return json('fleet-template-save.json');
    if (method === 'DELETE' && /^\/ajax\/fleet\/templates\/\d+$/.test(p)) return json('fleet-template-delete.json');
    if (method === 'POST' && p === '/ajax/phalanx/scan') {
      const ok = String(form.galaxy) === '1' && String(form.system) === '45';
      return json(ok ? 'fleet-phalanx-scan.json' : 'fleet-phalanx-scan-error.json');
    }
    if (method === 'POST' && p === '/ajax/jumpgate/execute') return json('fleet-jumpgate-execute.json');

    // galaxy
    if (method === 'POST' && p === '/ajax/galaxy') {
      if (state.scenario === 'vacation') return json('galaxy-ajax-vacation-403.json', 403);
      const g = Number(form.galaxy);
      const s = Number(form.system);
      const base = `galaxy-ajax-${g}-${s}`;
      if (body === 5 && fixtureExists(base + '-from-moon.json')) return json(base + '-from-moon.json');
      if (state.discoverer && fixtureExists(base + '-discoverer.json')) return json(base + '-discoverer.json');
      if (fixtureExists(base + '.json')) return json(base + '.json');
      // empty system: rewrite galaxy/system of the empty fixture
      const j = JSON.parse(rewrite(fixture('galaxy-ajax-1-44-empty.json'), origin));
      if (j.system) {
        j.system.galaxy = g; j.system.system = s;
        for (const row of j.system.galaxyContent || []) { if ('galaxy' in row) row.galaxy = g; if ('system' in row) row.system = s; }
      }
      let out = JSON.stringify(j).replace(/galaxy=1&system=44/g, `galaxy=${g}&system=${s}`).replace(/\[1:44:/g, `[${g}:${s}:`);
      out = out.replace(/\//g, '\\/');
      rec.fixture = 'galaxy-ajax-1-44-empty.json (rewritten)';
      return send(res, 200, out, 'application/json');
    }

    // highscore (params in query string or form)
    if (method === 'POST' && p === '/ajax/highscore') {
      const prm = { ...query, ...form };
      const cat = Number(prm.category || 1);
      const type = Number(prm.type || 0);
      const pg = Number(prm.page || 1);
      if (cat === 2) return html('galaxy-highscore-ajax-alliances.html');
      if (type === 3) return html('galaxy-highscore-ajax-players-military.html');
      if (type === 0 && pg === 2) return html('galaxy-highscore-ajax-players-page2.html');
      if (type === 0 && (pg === 1 || prm.searchRelId)) { rec.fixture = 'galaxy-highscore-page.html#stat_list_content'; return send(res, 200, rewrite(highscoreFragment(), origin)); }
      return unhandled(404, 'no highscore fixture');
    }
    if (method === 'GET' && p === '/ajax/highscore') return send(res, 405, 'Method Not Allowed', 'text/plain');

    // search
    if (method === 'POST' && p === '/ajax/search') {
      if (!String(form.searchtext || '').trim()) return json('galaxy-search-empty-term.json');
      const f = { 2: 'galaxy-search-players.json', 3: 'galaxy-search-planets.json', 4: 'galaxy-search-alliances.json' }[Number(form.category)];
      return f ? json(f) : json('galaxy-search-empty-term.json');
    }

    // messages
    if (method === 'GET' && p === '/ajax/messages') {
      const tab = query.tab || 'fleets';
      const sub = query.subtab || '';
      const pg = Number(query.pagination || 1);
      if (!sub) {
        if (fixtureExists(`messages-ajax-tab-${tab}.html`)) return html(`messages-ajax-tab-${tab}.html`);
        if (['economy', 'universe', 'system', 'favorites'].includes(tab)) return send(res, 200, '');
        return unhandled(404, 'no messages tab fixture');
      }
      const n = `messages-ajax-${tab}-${sub}${pg > 1 ? '-page' + pg : ''}.html`;
      if (fixtureExists(n)) return html(n);
      if (pg > 1 && fixtureExists(`messages-ajax-${tab}-${sub}.html`)) return send(res, 200, '');
      return unhandled(404, 'no messages fixture ' + n);
    }
    if (method === 'GET' && (m = p.match(/^\/ajax\/messages\/(\d+)$/))) {
      const f = fixtureList.find((n) => n.startsWith(`messages-ajax-message-${m[1]}-`));
      if (f) return html(f);
      rec.fixture = null;
      return send(res, 500, '<!doctype html><title>Server Error</title><h1>500</h1>');
    }
    if (method === 'POST' && p === '/messages') return jsonBody({ [String(form.messageId)]: true });

    // building queue
    if (method === 'POST' && (m = p.match(/^\/(resources|facilities|research|shipyard|defense)\/add-buildrequest$/))) {
      if (!form._token || ![state.csrf, TOKENS[state.lastPageAccount]].includes(form._token)) return json('buildings-addbuildrequest-invalid-token.json');
      const id = Number(form.technologyId);
      const unit = (id >= 202 && id <= 219) || (id >= 401 && id <= 503);
      if (state.addBuild === 'vacation') return json('buildings-addbuildrequest-vacation.json');
      if (state.addBuild === 'busy') return json('buildings-addbuildrequest-shipyard-busy.json');
      if (state.addBuild === 'upgrading') return json('buildings-addbuildrequest-shipyard-upgrading.json');
      if (state.addBuild === 'error') return json('buildings-addbuildrequest-error.json');
      return json(unit ? 'buildings-addbuildrequest-unit-success.json' : 'buildings-addbuildrequest-success.json');
    }
    if (method === 'POST' && /^\/(resources|facilities|research)\/cancel-buildrequest$/.test(p)) return json('buildings-cancelbuildrequest-success.json');
    if (method === 'POST' && /^\/(resources|facilities)\/downgrade$/.test(p)) return json(state.downgrade === 'error' ? 'buildings-addbuildrequest-downgrade-error.json' : 'buildings-addbuildrequest-downgrade-success.json');
    if (method === 'POST' && /^\/ajax\/(facilities\/halve-building|research\/halve-research|shipyard\/halve-unit)$/.test(p)) return json(form.queueItemId === '0' ? 'buildings-halve-error.json' : 'buildings-halve-building-success.json');

    // buddies / alliance
    if (method === 'GET' && p === '/buddies/online') return json('galaxy-buddies-online.json');
    if (method === 'GET' && p === '/buddies/request-dialog') return html('galaxy-buddies-request-dialog.html');
    if (method === 'POST' && p === '/buddies/send-request') return json('galaxy-buddies-sendrequest-success.json');
    if (method === 'GET' && p === '/alliance/info/12') return html('galaxy-alliance-info.html');

    return unhandled(404);
  }

  function serveAsset(res, p) {
    const ext = path.extname(p).toLowerCase();
    if (/^\/build\/assets\/ingame-.*\.js$/.test(p)) return send(res, 200, gameJs ? gameBundle() : '/* ogx mock: game JS disabled (startServer({gameJs:true}) to enable) */', MIME['.js']);
    if (/^\/build\/assets\/ingame-.*\.css$/.test(p)) {
      const dir = path.join(SRC, 'public/build/assets');
      try {
        const css = fs.readdirSync(dir).find((n) => /^ingame-.*\.css$/.test(n));
        if (css) return send(res, 200, fs.readFileSync(path.join(dir, css)), MIME['.css']);
      } catch (e) { /* fall through */ }
      return send(res, 200, '', MIME['.css']);
    }
    const file = path.join(SRC, 'public', p);
    if (file.startsWith(path.join(SRC, 'public')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, fs.readFileSync(file), MIME[ext] || 'application/octet-stream');
    }
    if (ext === '.js') return send(res, 200, '', MIME['.js']);
    if (ext === '.css') return send(res, 200, '', MIME['.css']);
    return send(res, 200, TRANSPARENT_GIF, 'image/gif');
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });
  srv.port = server.address().port;
  srv.origin = `http://localhost:${srv.port}`;
  return srv;
}

module.exports = { startServer, SCENARIOS, TOKENS, rewrite, fixture };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  startServer({ port: Number(get('--port', 8080)), scenario: get('--scenario', 'vega'), gameJs: args.includes('--game-js') }).then((srv) => {
    console.log(`mock OgameX (${srv.state.scenario}) on ${srv.origin}  -> ${srv.origin}/overview`);
    console.log(`request log: ${srv.origin}/__ogx/requests`);
  });
}
