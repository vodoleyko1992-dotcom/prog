'use strict';
// Mock GALAXYZ (ogamex.eu, 2Moons fork) server for the OGX test harness. No dependencies.
//
//   const { startGzServer } = require('./gz-server');
//   const srv = await startGzServer({ port: 0, universe: 'Aeternum', gameJs: true });
//   srv.origin / srv.requests / srv.unhandled / srv.assets / srv.state / srv.account
//   srv.route(method, pageOrRegex, handler(req, res, ctx)) / srv.reset() / srv.clearLog() / srv.find(method, what) / srv.close()
//
// CLI: node tests/gz-server.js --port 8080 [--no-game-js]   then open http://localhost:8080/Aeternum/game.php?page=overview
//
// Pages: the REAL pages saved from ogamex.eu/Aeternum (fixtures/galaxyz/pages, file name = ?page=[-mode]) are served at
// /<Universe>/game.php?page=<name>[&mode=<mode>][&cp=<id>]; `_f=<file>` picks a saved file directly (messages-spy). The pages
// are static: cp is recorded and remembered (state.cp) but every body shows the same saved page. Absolute links to
// https://ogamex.eu are rewritten to this server. Assets (./<x>_files/*.js|css|gif, ./scripts/game/*.js, styles/images/*)
// are looked up by base name: fixtures/galaxyz/assets (the live JS/CSS of the overview page), then
// fixtures/galaxyz/upstream/js (upstream 2Moons scripts the fork loads, [UPSTREAM]); a missing script is an empty stub, a
// missing image a transparent gif. gameJs: false serves a tiny jQuery stub instead of every script (inline code stays quiet).
//
// Answers (shapes from the real inline JS where seen, else upstream 2Moons, tagged in the code):
//   GET  page=TechnologyDetailsAjax|ResearchDetailsAjax|ShipDetailsAjax|CommanderDetailsAjax&technology=ID
//        -> JSON text {target, content:{[target]: html}} (text/html) [REAL shape, HYPOTHETICAL panel html]
//   POST page=buildings cmd=insert|destroy|cancel building=ID, page=research cmd=insert tech=ID
//        -> 302 game.php?page=buildings|research [UPSTREAM redirectTo]; state.buildError = 'text' -> info page instead
//   POST page=shipyard fmenge[ID]=N -> the shipyard page (fleet or defense by id) [UPSTREAM: no redirect]
//   POST page=resources prod[ID]=.. -> 302 page=resources ; POST page=trader -> info page "Exchange done" [UPSTREAM]
//   POST page=fleetTable&action=sendfleetback fleetID -> fleetTable without that fleet's recall form
//   GET  page=fleetStep1&mode=checkTarget -> JSON "OK" (state.checkTarget = 'error text' to refuse) [UPSTREAM]
//   POST page=fleetStep1 ship<ID>=N ... -> real fleetStep1 page with a fresh token and the posted target; no ships -> 302 fleetTable
//   POST page=fleetStep2 token ... -> real fleetStep2 page (missions from state.missions, default [7] as saved); bad token -> 302
//   POST page=fleetStep3 token mission ... -> real fleetStep3 result (refresh meta removed unless keepRefresh);
//        state.fleetError = 'text' -> info page; bad token -> 302 fleetTable; more ships than state.bodyShips[origin] (some of them
//        present; none present = 302 fleetTable at step 1, as the world) -> info page 'Not all ships present.' / 'Не все корабли доступны.' (state.lang) [UPSTREAM ShowFleetStep3Page:176]
//   GET  page=fleetAjax&mission=&planetID= -> JSON {slots, ships, code, mess} (state.fleetAjax overrides) [UPSTREAM]
//   GET  page=settings -> REAL overview chrome + a settings form in the shape of 2Moons settings_default.tpl (spycount =
//        state.spycount) [HYPOTHETICAL markup: no live settings page saved]; POST page=settings -> recorded, 302 page=settings
//        (world mode: spycount = world.player.spyProbes, the account's probes per one-click spy; the POST updates it)
//   GET  page=messages&mode=view&messcat=N&site=S&ajax=1 -> form fragment: 0/100 cut from the REAL pages, others [UPSTREAM]
//   POST page=messages mode=action -> 302 page=messages [UPSTREAM]
//   /<Universe>/index.php -> login page (not a game page) [HYPOTHETICAL: never captured live] ; /other -> unrelated site
// Everything else on game.php is recorded as unhandled (404 info page).
//
// Inspection endpoints (never recorded): GET /__ogx/requests, GET /__ogx/unhandled, GET /__ogx/state,
// POST /__ogx/state (JSON body merged into state), POST /__ogx/reset.
//
// World mode (opt-in, BOT_DESIGN §10): startGzServer({ world: 'basic' | WorldSpec | World }) -> srv.world (tests/gz-world.js). Game pages
// are then rendered from the stateful world (the saved pages with their dynamic parts replaced); routes the world does not answer fall
// through to the static behaviour above. GET /__ogx/world -> snapshot, POST /__ogx/world {cmd, args} -> world.command(cmd, args).
// Without `world` nothing changes.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GZ = path.join(__dirname, '..', 'fixtures', 'galaxyz');
const PAGES = process.env.OGX_GZ_PAGES || path.join(GZ, 'pages');
const ASSET_DIRS = [path.join(GZ, 'assets'), path.join(GZ, 'upstream', 'js')];
const LIVE_ORIGIN = 'https://ogamex.eu';
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const HTML = 'text/html; charset=UTF-8';

// Mission names as the fork prints them on fleetStep2 (7 "Colonize" is REAL; the others follow upstream FLEET.php).
const MISSION_NAMES = { 1: 'Attack', 2: 'Alliance Attack', 3: 'Transport', 4: 'Deploy', 5: 'Hold', 6: 'Spy', 7: 'Colonize', 8: 'Recycle', 9: 'Destroy', 11: 'DM Investigation', 15: 'Expedition' };
// Saved file token (fleetStep1/2 carry the same one) -> replaced by the session token of the mock.
const SAVED_TOKEN = 'd583ed8b434e588148fe929b8f939eab';

// jQuery stand-in for gameJs: false — chainable no-ops, so the pages' inline $(...) code runs without errors.
const JQUERY_STUB = `/* gz-server: jQuery stub (gameJs: false) */
(function () {
  var chain = new Proxy(function () {}, { get: function (t, p) { if (p === 'length') return 0; if (p === Symbol.iterator) return [][Symbol.iterator]; if (p === 'then') return undefined; return chain; }, apply: function () { return chain; } });
  var $ = function (a) { if (typeof a === 'function') { try { document.addEventListener('DOMContentLoaded', a); } catch (e) {} } return chain; };
  ['ajax', 'get', 'post', 'getJSON', 'each', 'extend', 'parseJSON', 'cookie', 'fn', 'ui', 'fancybox', 'validationEngine', 'trim', 'map', 'inArray', 'isFunction', 'noop', 'when', 'Deferred'].forEach(function (k) { $[k] = chain; });
  window.jQuery = window.$ = $;
})();`;

const read = (f) => fs.readFileSync(f, 'utf8');
const cache = new Map();
function pageFile(name) {
  const f = path.join(PAGES, path.basename(name) + '.html');
  if (!fs.existsSync(f)) return null;
  if (!cache.has(f)) cache.set(f, read(f));
  return cache.get(f);
}
/** Saved page names (file names without .html). */
function pageNames() { return fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).sort(); }

/** Account facts of the saved pages (overview): universe player name and bodies of #planetSelector. */
function readAccount() {
  const html = pageFile('overview') || '';
  const name = (/id="playerName"[^]*?class="textBeefy"><a[^>]*>([^<]+)</.exec(html) || [])[1] || null;
  const sel = (/<select id="planetSelector"[^>]*>([^]*?)<\/select>/.exec(html) || [])[1] || '';
  const bodies = [...sel.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)].map((m) => ({ id: +m[1], label: m[2].trim() }));
  return { player: name, bodies, home: bodies.length ? bodies[0].id : null };
}

/** saved file for page/mode/messcat of a game.php request (null = not saved). */
function fileFor(gzPage, mode, q) {
  const p = String(gzPage || 'overview');
  const lc = p.toLowerCase();
  if (q._f) return path.basename(q._f);
  if (lc === 'shipyard') return String(mode || '').toLowerCase() === 'defense' ? 'shipyard-defense' : 'shipyard-fleet';
  if (lc === 'messages') return String(q.category || q.messcat || '') === '0' ? 'messages-spy' : 'messages-all';
  const hit = pageNames().find((n) => n.toLowerCase() === lc);
  return hit || null;
}

/** <form ...> containing #messagestable of a saved messages page (the AJAX fragment of mode=view). */
function messagesFragment(html) {
  const at = html.indexOf('id="messagestable"');
  if (at < 0) return null;
  const start = html.lastIndexOf('<form', at);
  const end = html.indexOf('</form>', at);
  if (start < 0 || end < 0) return null;
  return html.slice(start, end + 7);
}

function parseForm(raw, type) {
  if (!raw) return {};
  if (/json/.test(type || '')) { try { return JSON.parse(raw); } catch (e) { return {}; } }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = k in out ? [].concat(out[k], v) : v;
  return out;
}
function readBody(req) {
  return new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', () => resolve('')); });
}

/** 2Moons settings_default.tpl-shaped form (fields of ShowSettingsPage::send) [HYPOTHETICAL markup]. */
function settingsForm(st) {
  return `<div id="ogx-mock-settings"><form action="game.php?page=settings" method="post"><input type="hidden" name="mode" value="send">
<table><tr><td>Username</td><td><input name="username" value="vodoleyko1992" type="text"></td></tr>
<tr><td>Language</td><td><select name="language"><option value="en">English</option><option value="ru" selected>Русский</option></select></td></tr>
<tr><td>Timezone</td><td><select name="timezone"><option value="Europe/Berlin" selected>Europe/Berlin</option></select></td></tr>
<tr><td>Planet sort</td><td><select name="planetSort"><option value="0" selected>0</option><option value="1">1</option></select></td></tr>
<tr><td>Spy probes</td><td><input name="spycount" id="spycount" size="2" value="${st.spycount}" type="text"></td></tr>
<tr><td>Fleet messages</td><td><input name="fleetActions" value="3" type="text"></td></tr>
<tr><td>Galaxy spy</td><td><input name="galaxySpy" type="checkbox" value="1" checked></td></tr>
<tr><td>Block PM</td><td><input name="blockPM" type="checkbox" value="1"></td></tr>
<tr><td>Vacation</td><td><input name="vacation" type="checkbox" value="1"></td></tr>
<tr><td>Delete</td><td><input name="delete" type="checkbox" value="1"></td></tr>
<tr><td colspan="2"><input type="submit" value="Save"></td></tr></table></form></div>`;
}

// Step-3 refusal texts of the static mock by state.lang [UPSTREAM language/en|ru/INGAME.php]; tests that set fleetError /
// fleetErrorAt pass their own text. STEP3_TEXTS is exported so tests assert botcore's mapping on the exact strings.
const STEP3_TEXTS = {
  en: { ships: 'Not all ships present.', slots: 'Without slots avaliable', fuel: 'Not enough deuterium available.',          // en:358, 322, 369
    cargo: 'You have not enough cargo space available.', attackLimit: 'Bash Rule', noResource: 'No raw materials loaded!' },   // en:370, 361, 356
  ru: { ships: 'Не все корабли доступны.', slots: 'Нет свободных слотов.', fuel: 'Не хватает дейтерия.',                     // ru:343, 306, 354
    cargo: 'Недостаточная грузоподъёмность.', attackLimit: 'Превышен лимит количества атак в сутки на данный пункт назначения.',   // ru:355, 346
    noResource: 'Ресурсы не погружены.' },                                                                                    // ru:341
};
const step3Text = (st, code) => (STEP3_TEXTS[st.lang] || STEP3_TEXTS.en)[code] || STEP3_TEXTS.en[code];

function defaultState() {
  return {
    scenario: 'galaxyz',
    cp: null,             // last cp sent (sticky like the real session)
    token: null,          // fleet session token (fleetStep1 -> 2 -> 3)
    fleet: null,          // { ships, target, mission, speed } of the current dispatch
    missions: null,       // fleetStep2 missions offered (null = [7] as on the saved page)
    checkTarget: 'OK',    // fleetStep1&mode=checkTarget answer
    fleetError: null,     // fleetStep3 refusal text (info page)
    fleetAjax: null,      // fleetAjax JSON override
    spycount: 1,          // page=settings: the account's probes per one-click spy (John's live value: shipsSent 1)
    buildError: null,     // buildings/research/shipyard refusal text (info page)
    builds: [],           // accepted build orders { page, cmd, id, amount }
    sent: [],             // fleets accepted by fleetStep3 { mission, cargo, ships, target, speed, origin }
    // collect v2 extensions (all optional; unset = the saved pages as they are)
    cargoPerShip: null,   // { id: cargo }: fleetStep1/2 inline data computed from the posted ships (fleetroom = sum n x cargo)
    consumption: null,    // fleetStep2 consumption (data.consumption and #consumption) when cargoPerShip is set (default 118)
    enforceRoom: false,   // fleetStep3: cargo > fleetroom - consumption -> info 'Not enough cargo space', nothing sent [UPSTREAM]
    bodyShips: null,      // { cp: { id: n } }: fleetTable rows of that body, imperium ship rows; more ships than that are accepted at
                          // step 1 (unless none of them is there: 302 fleetTable, as the world) and refused at step 3 with fl_not_all_ship_avalible
    lang: 'en',           // 'en' | 'ru': the step-3 refusal texts of the mock (STEP3_TEXTS) [UPSTREAM language/<lang>/INGAME.php]
    bodyRes: null,        // { cp: { metal, crystal, deuterium } }: header stock of pages shown for that cp, imperium resource rows
    planets: null,        // [{ id, name, coords, moon?: { id, name } }]: #planetSelector, planet list and imperium columns of every page
    fleetErrorAt: null,   // { n: 'text' }: the n-th fleetStep3 POST (1-based) is refused with that info text
    step3Count: 0,        // fleetStep3 POSTs seen
    recalled: [],         // fleet ids recalled
    trades: [],           // trader POST bodies
    latencyMs: 0,
  };
}

async function startGzServer(opts = {}) {
  const port = opts.port || 0;
  const universe = opts.universe || 'Aeternum';
  const gameJs = opts.gameJs !== false;
  const keepRefresh = !!opts.keepRefresh;
  let state = defaultState();
  const extraRoutes = [];
  const account = readAccount();
  let world = null; let worldHandle = null;
  if (opts.world) {
    const W = require('./gz-world');
    world = opts.world && typeof opts.world === 'object' && opts.world.clock && typeof opts.world.process === 'function' ? opts.world : W.createWorld(opts.world);
    worldHandle = W.worldHandler(world, { pageFile, infoPage, messagesFragment, settingsForm });
  }
  const srv = {
    origin: null,
    port: null,
    universe,
    account,
    gameJs,
    requests: [],
    unhandled: [],
    assets: [],
    get state() { return state; },
    set state(v) { state = v; },
    pages: pageNames,
    world,
    /** game.php path of this universe: srv.gamePath({ page: 'shipyard', mode: 'defense', cp: 254103 }) */
    gamePath(q = {}) {
      const u = new URLSearchParams();
      for (const [k, v] of Object.entries(typeof q === 'string' ? { page: q } : q)) if (v !== undefined && v !== null) u.set(k, String(v));
      return `/${universe}/game.php` + (String(u) ? '?' + String(u) : '');
    },
    /** game.php path of a saved page file name ('shipyard-defense', 'messages-spy') */
    pathFor(name) {
      const [pg, mode] = String(name).split('-');
      if (pg === 'messages') return srv.gamePath({ page: 'messages', _f: name });
      return srv.gamePath({ page: pg, mode });
    },
    // per-test answer: srv.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({...})); match = page name (case-insensitive),
    // RegExp on 'page=<page>[&mode=<mode>]', or a path starting with '/'
    route(method, match, handler) { extraRoutes.unshift({ method: method.toUpperCase(), match, handler }); return srv; },
    setScenario() { return srv; },
    reset() { srv.clearLog(); state = defaultState(); extraRoutes.length = 0; return srv; },
    clearLog() { srv.requests.length = 0; srv.unhandled.length = 0; srv.assets.length = 0; return srv; },
    // srv.find('POST', 'fleetStep3') / srv.find('GET', /page=TechnologyDetailsAjax/) / srv.find(null, '/Aeternum/index.php')
    //   string: path, or GALAXYZ page name (case-insensitive), or route 'page=x&mode=y'; RegExp: tested on the url and the route
    find(method, what) {
      return srv.requests.filter((r) => (!method || r.method === method.toUpperCase()) && matches(r, what));
    },
    close() { return new Promise((r) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); }); },
  };
  function matches(r, what) {
    if (!what) return true;
    if (what instanceof RegExp) return what.test(r.url) || (r.route != null && what.test(r.route));
    const w = String(what);
    if (w.startsWith('/')) return r.path === w;
    if (/^page=/i.test(w)) return r.route != null && r.route.toLowerCase() === w.toLowerCase();
    return r.page != null && r.page.toLowerCase() === w.toLowerCase();
  }

  const send = (res, status, body, type = HTML, headers = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    try { await handle(req, res); } catch (e) { send(res, 500, 'gz mock server error: ' + (e && e.stack || e), 'text/plain'); }
  });

  async function handle(req, res) {
    const host = req.headers.host || `localhost:${srv.port}`;
    const origin = `http://${host}`;
    const url = new URL(req.url, origin);
    const p = url.pathname;
    const method = req.method.toUpperCase();
    const raw = method === 'GET' || method === 'HEAD' ? '' : await readBody(req);

    if (p.startsWith('/__ogx/')) {
      if (p === '/__ogx/requests') return send(res, 200, JSON.stringify(srv.requests), 'application/json');
      if (p === '/__ogx/unhandled') return send(res, 200, JSON.stringify(srv.unhandled), 'application/json');
      if (p === '/__ogx/state' && method === 'GET') return send(res, 200, JSON.stringify(state), 'application/json');
      if (p === '/__ogx/state' && method === 'POST') { Object.assign(state, JSON.parse(raw || '{}')); return send(res, 200, JSON.stringify(state), 'application/json'); }
      if (p === '/__ogx/reset' && method === 'POST') { srv.reset(); return send(res, 200, '{"ok":true}', 'application/json'); }
      if (p === '/__ogx/world' && world && method === 'GET') return send(res, 200, JSON.stringify(world.snapshot()), 'application/json');
      if (p === '/__ogx/world' && world && method === 'POST') {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch (e) { return send(res, 400, JSON.stringify({ ok: false, error: 'bad json' }), 'application/json'); }
        try { const result = world.command(body.cmd, body.args || {}); return send(res, 200, JSON.stringify({ ok: true, result: result && typeof result === 'object' ? (result.id ?? true) : result }), 'application/json'); }
        catch (e) { return send(res, 400, JSON.stringify({ ok: false, error: String(e && e.message || e) }), 'application/json'); }
      }
      return send(res, 404, '{}', 'application/json');
    }
    const ext = path.extname(p).toLowerCase();
    if (ext && ext !== '.php' && ext !== '.html') { srv.assets.push({ t: Date.now(), method, path: p }); return serveAsset(res, p, ext); }
    if (p === '/favicon.ico') return send(res, 200, TRANSPARENT_GIF, 'image/gif');
    // cronjob.php?cronjobID=N: the 1x1 gif the layout embeds to run cron jobs [UPSTREAM cronjob.php]; saved as <x>_files/cronjob.php
    if (/\/cronjob\.php$/i.test(p)) { srv.assets.push({ t: Date.now(), method, path: p }); return send(res, 200, TRANSPARENT_GIF, 'image/gif'); }

    const query = Object.fromEntries(url.searchParams);
    const form = parseForm(raw, req.headers['content-type']);
    const gameRe = new RegExp(`^/${universe}/game\\.php$`, 'i');
    const isGame = gameRe.test(p);
    // 2Moons reads parameters with HTTP::_GP ($_REQUEST): the query wins over the body for page/mode
    const gzPage = isGame ? String(query.page || form.page || 'overview') : null;
    const mode = isGame ? (query.mode || form.mode || null) : null;
    const cpRaw = query.cp;
    const cp = cpRaw != null && /^\d+$/.test(cpRaw) ? Number(cpRaw) : null;
    if (cp != null) state.cp = cp;
    const rec = { t: Date.now(), method, path: p, url: p + url.search, query, form, raw, headers: req.headers, cp, host,
      page: gzPage, mode, route: isGame ? 'page=' + gzPage + (mode ? '&mode=' + mode : '') : null };
    srv.requests.push(rec);
    if (state.latencyMs) await new Promise((r) => setTimeout(r, state.latencyMs));

    const base = `${origin}/${universe}/game.php`;
    // one pass: a second split on 'http://ogamex.eu' would hit the already rewritten origin (http://ogamex.eu:<port>:<port>)
    const rewrite = (html) => html.replace(/https?:\/\/ogamex\.eu(?![:\w.-])/g, origin);
    const sendPage = (name, transform) => {
      let html = pageFile(name);
      if (html == null) return unhandled(404, 'no saved page ' + name);
      rec.fixture = name;
      if (!keepRefresh) html = html.replace(/<meta http-equiv="refresh"[^>]*>/i, '');
      if (transform) html = transform(html);
      html = bodyTransforms(html, name, state);
      return send(res, 200, rewrite(html));
    };
    const json = (value) => send(res, 200, JSON.stringify(value), HTML);          // 2Moons sendJSON: no JSON content type
    const redirect = (q) => send(res, 302, '', HTML, { Location: base + '?' + q });
    const info = (message, buttons = []) => {
      rec.info = message;
      return sendPage('fleetStep3', (html) => infoPage(html, message, buttons));
    };
    const unhandled = (status = 404, why = 'no route') => {
      rec.unhandled = why;
      srv.unhandled.push(rec);
      return send(res, status, `<!doctype html><title>${status}</title><h1>${status}</h1><p>gz mock: ${why}: ${method} ${rec.url}</p>`);
    };
    const ctx = { url, query, form, raw, method, origin, base, state, rec, srv, page: gzPage, mode, send: (...a) => send(res, ...a), sendPage, json, redirect, info, unhandled, rewrite };

    for (const r of extraRoutes) {
      if (r.method !== method && r.method !== '*') continue;
      const m = r.match;
      const hit = m instanceof RegExp ? m.test(rec.route || p) : String(m).startsWith('/') ? p === m : gzPage != null && gzPage.toLowerCase() === String(m).toLowerCase();
      if (hit) return r.handler(req, res, ctx);
    }

    if (p === '/' || p === `/${universe}` || p === `/${universe}/`) return send(res, 302, '', HTML, { Location: `${origin}/${universe}/index.php` });
    if (world && method === 'POST' && new RegExp(`^/${universe}/index\\.php$`, 'i').test(p)) { world.login(); return send(res, 302, '', HTML, { Location: `${origin}/${universe}/game.php?page=overview` }); }
    // [HYPOTHETICAL] logged-out page (tests-mock-21): the real GALAXYZ index.php (field names, universe selector, captcha) and the
    // post-login redirect were never saved; botcore autoLogin (form#login + input[type=password]) is proven only against this.
    // Capture the live page into fixtures/galaxyz/pages and serve it here before trusting gz-bot-autologin for the live server.
    if (new RegExp(`^/${universe}/index\\.php$`, 'i').test(p)) {
      return send(res, 200, '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aeternum</title></head><body><form id="login" action="index.php?page=login" method="post"><input name="username"><input name="password" type="password"></form></body></html>');
    }
    if (p === '/other') return send(res, 200, '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="generator" content="WordPress 6.4"><title>Other site</title></head><body><h1>Not a game</h1><select id="planetSelector"></select></body></html>');
    if (!isGame) return unhandled(404);

    if (worldHandle) { await worldHandle(ctx); if (res.headersSent) return; }
    return game(ctx);
  }

  function game(ctx) {
    const { query, form, method, state: st, sendPage, json, redirect, info, unhandled } = ctx;
    const lc = ctx.page.toLowerCase();
    const mode = String(ctx.mode || '').toLowerCase();
    const num = (v, d = 0) => (v === undefined || v === '' || isNaN(+v) ? d : +v);
    const param = (k) => (query[k] !== undefined ? query[k] : form[k]);

    // ---- AJAX details panels [REAL shape {target, content}; panel html HYPOTHETICAL like specs/galaxyz/fixtures/buildings-details-ajax-*]
    const details = { technologydetailsajax: 'buildings', researchdetailsajax: 'research', shipdetailsajax: 'shipyard', commanderdetailsajax: 'officier' }[lc];
    if (details) {
      const id = num(param('technology'), NaN);
      if (!Number.isFinite(id)) return json({ target: 'technologydetails', content: { technologydetails: '' } });
      return json(detailsJson(id, details));
    }

    // REAL (user log 2026-10-31): the live server answers page=overview&ajax=1 with 503
    if (lc === 'overview' && String(param('ajax') || '') === '1') return ctx.send(503, '<!doctype html><title>503</title><h1>Service Unavailable</h1>');

    // ---- fleet [fleet.md §2; UPSTREAM ShowFleetStep1/2/3Page, ShowFleetAjaxPage, ShowFleetTablePage]
    if (lc === 'fleetstep1' && mode === 'checktarget') return json(st.checkTarget);
    if (lc === 'fleetstep1' && method === 'POST') {
      const ships = {};
      for (const [k, v] of Object.entries(form)) { const m = /^ship(\d+)$/.exec(k); if (m && Math.round(+v) >= 1 && m[1] !== '212') ships[m[1]] = Math.round(+v); }
      if (!Object.keys(ships).length) return redirect('page=fleetTable');   // FleetFunctions::GotoFleetPage
      const origin = ctx.rec.cp != null ? ctx.rec.cp : st.cp;
      // as the world (BOT_CONTRACT A14): step 1 goes back to fleetTable only when none of the posted ships is on the body; more
      // ships than the body holds pass step 1 (upstream ShowFleetStep1Page:39-51 does not count them) and step 3 refuses (below)
      const onBody = st.bodyShips && st.bodyShips[origin];
      if (onBody && Object.keys(ships).every((id) => !(+onBody[id] > 0))) return redirect('page=fleetTable');
      st.token = crypto.randomBytes(16).toString('hex');
      const target = { galaxy: num(form.galaxy, 2), system: num(form.system, 68), planet: num(form.planet, 5), type: num(form.type, 1) };
      st.fleet = { ships, target, mission: num(form.target_mission, 0), speed: null, origin };
      return sendPage('fleetStep1', (html) => setInlineData(html, step1Data(st, ships)).split(SAVED_TOKEN).join(st.token)
        .replace(/(id="galaxy" name="galaxy"[^>]*value=")\d*/, '$1' + target.galaxy)
        .replace(/(id="system" name="system"[^>]*value=")\d*/, '$1' + target.system)
        .replace(/(id="planet" name="planet"[^>]*value=")\d*/, '$1' + target.planet)
        .replace(/(name="target_mission" value=")\d*/, '$1' + st.fleet.mission));
    }
    if (lc === 'fleetstep2' && method === 'POST') {
      if (!st.token || form.token !== st.token) return redirect('page=fleetTable');
      st.fleet.speed = num(form.speed, 10);
      st.fleet.target = { galaxy: num(form.galaxy, st.fleet.target.galaxy), system: num(form.system, st.fleet.target.system), planet: num(form.planet, st.fleet.target.planet), type: num(form.type, st.fleet.target.type) };
      const missions = Array.isArray(st.missions) && st.missions.length ? st.missions : [7];
      return sendPage('fleetStep2', (html) => step2Data(html, st).split(SAVED_TOKEN).join(st.token)
        .replace(/<input id="radio_7"[^]*?<br>/, missions.map((id, i) => `<input id="radio_${id}" type="radio" name="mission" value="${id}"${i === 0 && st.fleet.mission === id ? ' checked="checked"' : ''}><label for="radio_${id}"><span></span>${MISSION_NAMES[id] || 'Mission ' + id}</label><br>`).join('\n')));
    }
    if (lc === 'fleetstep3' && method === 'POST') {
      if (!st.token || form.token !== st.token) return redirect('page=fleetTable');
      const fleet = st.fleet;
      st.token = null; st.fleet = null;                                         // the session token is used up
      st.step3Count = (st.step3Count || 0) + 1;
      if (st.fleetError) return info(st.fleetError, [{ url: 'game.php?page=fleetTable', label: 'Back' }]);
      if (st.fleetErrorAt && st.fleetErrorAt[st.step3Count]) return info(st.fleetErrorAt[st.step3Count], [{ url: 'game.php?page=fleetTable', label: 'Back' }]);
      const onBody0 = st.bodyShips && st.bodyShips[fleet.origin];
      if (onBody0 && Object.entries(fleet.ships).some(([id, n]) => n > (+onBody0[id] || 0))) return info(step3Text(st, 'ships'), [{ url: 'game.php?page=fleetTable', label: 'Back' }]);
      const cargo = { metal: num(form.metal), crystal: num(form.crystal), deuterium: num(form.deuterium) };
      if (st.enforceRoom) {
        const room = fleetRoom(st, fleet.ships) - consumptionOf(st);
        if (cargo.metal + cargo.crystal + cargo.deuterium > room) return info(st.lang === 'ru' ? step3Text(st, 'cargo') : 'Not enough cargo space', [{ url: 'game.php?page=fleetTable', label: 'Back' }]);
      }
      st.sent.push({ mission: num(form.mission, 0), cargo, staytime: form.staytime !== undefined ? num(form.staytime) : null, ships: fleet.ships, target: fleet.target, speed: fleet.speed, origin: fleet.origin, t: Date.now() });
      const onBody = st.bodyShips && st.bodyShips[fleet.origin];
      if (onBody) for (const [id, n] of Object.entries(fleet.ships)) onBody[id] = Math.max(0, (+onBody[id] || 0) - n);
      return sendPage('fleetStep3');
    }
    if (lc === 'fleetstep2' || lc === 'fleetstep3') {
      // GET of a step page: what the browser sees when it reloads the saved page (tests open it directly)
      return sendPage(lc === 'fleetstep2' ? 'fleetStep2' : 'fleetStep3');
    }
    if (lc === 'fleetajax') {
      const mission = num(param('mission'), 0);
      return json(st.fleetAjax || { slots: 1, ships: mission === 8 ? { 209: 0 } : { 210: 0 }, code: 600, mess: (mission === 8 ? 'Send Recycler' : 'Send Spy Probe') + ' ...' });
    }
    if (lc === 'settings') {
      if (method === 'POST') return redirect('page=settings');
      ctx.rec.fixture = 'settings (derived)';
      return sendPage('overview', (html) => html.replace('<body id="overview"', '<body id="settings"').replace(/(<body id="settings"[^>]*>)/, '$1' + settingsForm(st)));
    }
    if (lc === 'fleettable') {
      const fleetId = num(param('fleetID'), 0);
      if (String(param('action') || '').toLowerCase() === 'sendfleetback' && fleetId) st.recalled.push(fleetId);
      const ftCp = ctx.rec.cp != null ? ctx.rec.cp : st.cp;
      return sendPage('fleetTable', (html) => fleetTablePrefill(fleetTableShips(removeRecallForms(html, st.recalled), st.bodyShips && st.bodyShips[ftCp]), query));
    }

    // ---- build orders [UPSTREAM ShowBuildingsPage:245-268, ShowResearchPage:331-355, ShowShipyardPage:146-180]
    if ((lc === 'buildings' || lc === 'research') && method === 'POST' && (form.cmd || query.cmd)) {
      const cmd = String(param('cmd'));
      const id = num(lc === 'research' ? (param('tech') !== undefined ? param('tech') : param('building')) : param('building'), 0);
      if (st.buildError) return info(st.buildError);
      st.builds.push({ page: lc, cmd, id, amount: 1, listid: param('listid') !== undefined ? num(param('listid')) : null });
      return redirect('page=' + lc);
    }
    if (lc === 'shipyard' && method === 'POST') {
      const order = {};
      for (const [k, v] of Object.entries(form)) { const m = /^fmenge\[(\d+)\]$/.exec(k); if (m && num(v) > 0) order[m[1]] = num(v); }
      if (st.buildError) return info(st.buildError);
      for (const [id, n] of Object.entries(order)) st.builds.push({ page: 'shipyard', cmd: 'insert', id: +id, amount: n });
      const defense = Object.keys(order).some((id) => +id >= 400) || mode === 'defense';
      return sendPage(defense ? 'shipyard-defense' : 'shipyard-fleet');
    }
    if (lc === 'resources' && method === 'POST') return redirect('page=resources');
    if (lc === 'trader' && method === 'POST') {
      st.trades.push(form);
      return info('Exchange done', [{ url: 'game.php?page=trader', label: 'Back' }]);   // tr_exchange_done
    }

    // ---- messages [UPSTREAM message.js getMessages, ShowMessagesPage]
    if (lc === 'messages' && mode === 'view') {
      const cat = num(param('messcat'), 100);
      const site = num(param('site'), 1);
      ctx.rec.fixture = 'messages view ' + cat + '/' + site;
      let frag = null;
      if (site <= 1 && (cat === 0 || cat === 100)) frag = messagesFragment(pageFile(cat === 0 ? 'messages-spy' : 'messages-all') || '');
      else {
        const f = path.join(GZ, 'upstream', `messages-view-cat${cat}${site > 1 ? '-p' + site : ''}.html`);
        if (fs.existsSync(f)) frag = read(f);
      }
      if (frag == null) frag = `<form action="game.php?page=messages" method="post"><input type="hidden" name="mode" value="action"><input type="hidden" name="ajax" value="1"><input type="hidden" name="messcat" value="${cat}"><input type="hidden" name="side" value="${site}"><div class="mainRS"><table id="messagestable" class="hard-table" style="width:760px;"><tbody><tr><th colspan="4">Messages</th></tr><tr><td colspan="4">-</td></tr></tbody></table></div></form>`;
      return ctx.send(200, ctx.rewrite(frag));
    }
    if (lc === 'messages' && method === 'POST') return redirect('page=messages&category=' + num(param('messcat'), 100) + '&side=' + num(param('side'), 1));

    // ---- plain pages
    if (method === 'GET' || method === 'POST') {
      const f = fileFor(ctx.page, ctx.mode, query);
      if (f && pageFile(f) != null) return sendPage(f);
    }
    return unhandled(404, 'no saved page for ' + ctx.rec.route);
  }

  function serveAsset(res, p, ext) {
    const name = path.basename(decodeURIComponent(p));
    if (ext === '.js' && !gameJs) return send(res, 200, /^jquery\.js$/i.test(name) ? JQUERY_STUB : '/* gz-server: game JS disabled */', MIME['.js']);
    for (const dir of ASSET_DIRS) {
      const f = path.join(dir, name);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return send(res, 200, fs.readFileSync(f), MIME[ext] || 'application/octet-stream');
    }
    if (ext === '.js') return send(res, 200, `/* gz-server: ${name} not captured */`, MIME['.js']);
    if (ext === '.css') return send(res, 200, '', MIME['.css']);
    return send(res, 200, TRANSPARENT_GIF, 'image/gif');
  }

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, () => resolve()); });
  srv.port = server.address().port;
  srv.origin = `http://localhost:${srv.port}`;
  return srv;
}

// ------------------------------------------------------------------ collect v2 helpers (state.cargoPerShip, bodyShips, bodyRes, planets)
const SHIP_NAMES = { 202: 'Small Cargo', 203: 'Large Cargo', 204: 'Light Fighter', 205: 'Heavy Fighter', 206: 'Cruiser', 207: 'Battleship', 208: 'Colony Ship',
  209: 'Recycler', 210: 'Spy Probe', 211: 'Bomber', 213: 'Destroyer', 214: 'Deathstar', 215: 'Battlecruiser', 216: 'Lune Noir', 217: 'Battle Transporter',
  218: 'Avatar', 219: 'Giga Recycler', 220: 'Intergalactic Ark' };
const IMPERIUM_SHIP_IDS = [202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220];
const dots = (n) => String(Math.floor(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function fleetRoom(st, ships) {
  if (!st.cargoPerShip) return 7500;   // the saved fleetStep1/2 data
  return Object.entries(ships || {}).reduce((s, [id, n]) => s + (+st.cargoPerShip[id] || 0) * n, 0);
}
const consumptionOf = (st) => (st.cargoPerShip ? (st.consumption != null ? +st.consumption : 118) : 118);
/** `data = {...};` line of a step page replaced (null = unchanged). */
function setInlineData(html, data) {
  if (!data) return html;
  return html.replace(/^(\s*data\s*=\s*)\{.*\};\s*$/m, (m, pre) => pre + JSON.stringify(data) + ';');
}
function step1Data(st, ships) {
  if (!st.cargoPerShip) return null;
  const d = { fleetroom: String(fleetRoom(st, ships)), gamespeed: 7, fleetspeedfactor: 1, planet: { galaxy: '2', system: '68', planet: '5', planet_type: '1' }, maxspeed: 0, ships: {}, fleetMinDuration: 5 };
  let min = Infinity;
  for (const [id, n] of Object.entries(ships)) { const sp = 10000; d.ships[id] = { consumption: '100', speed: sp, amount: String(n) }; min = Math.min(min, sp); }
  d.maxspeed = Number.isFinite(min) ? min : 0;
  return d;
}
function step2Data(html, st) {
  if (!st.cargoPerShip || !st.fleet) return html;
  const room = fleetRoom(st, st.fleet.ships);
  const cons = consumptionOf(st);
  return setInlineData(html, { fleetroom: String(room), consumption: String(cons) }).replace(/(<span id="consumption"[^>]*>)[^<]*/, '$1' + cons);
}
/** fleetTable ship rows replaced by `ships` ({ id: n }, n > 0 listed; the satellite row stays); none -> the no-ships #warning. */
function fleetTableShips(html, ships) {
  if (!ships) return html;
  const rowRe = /<tr>\s*<td><img src="\.\/7_files\/(\d+)\.gif"[\s\S]*?<\/tr>/g;
  const row = (id, n) => `<tr><td><img src="./7_files/${id}.gif" alt="${SHIP_NAMES[id] || id}" width="25" height="25" align="left"> <span class="tooltip" data-tooltip-content="Speed:  10000">${SHIP_NAMES[id] || 'Ship ' + id}</span></td><td id="ship${id}_value">${dots(n)}</td><td><a class="button black small" href="javascript:maxShip('ship${id}');">max</a></td><td><input name="ship${id}" id="ship${id}_input" size="10" value="0"></td></tr>`;
  const listed = Object.entries(ships).filter(([id, n]) => +n > 0 && +id !== 212);
  let first = true;
  let out = html.replace(rowRe, (m, id) => {
    if (id === '212') return m;
    if (!first) return '';
    first = false;
    return listed.map(([i, n]) => row(i, n)).join('');
  });
  if (!listed.length) out = out.replace(/(<form action="[^"]*page=fleetStep1")/, '<div id="warning" class="warning">No ships on this planet</div>$1');
  return out;
}
/** GET prefill (galaxy, system, planet, planettype, target_mission) copied into the hidden fields [UPSTREAM ShowFleetTablePage:206-210]. */
function fleetTablePrefill(html, q) {
  let out = html;
  const put = (name, v) => { if (v !== undefined) out = out.replace(new RegExp(`(<input type="hidden" name="${name}" value=")\\d*`), '$1' + (+v || 0)); };
  put('galaxy', q.galaxy); put('system', q.system); put('planet', q.planet); put('type', q.planettype); put('target_mission', q.target_mission);
  return out;
}
/** Every page: header stock of the shown body (bodyRes), planet selector + planet list (planets), imperium columns. */
function bodyTransforms(html, name, st) {
  const cp = st.cp;
  if (st.bodyRes && cp != null && st.bodyRes[cp]) {
    const r = st.bodyRes[cp];
    for (const k of ['metal', 'crystal', 'deuterium']) if (r[k] != null) html = html.replace(new RegExp(`(id="current_${k}" data-real=")[\\d.]+`), '$1' + Math.floor(+r[k]));
  }
  if (Array.isArray(st.planets) && st.planets.length) html = rewritePlanets(html, st.planets, cp);
  if (name === 'imperium' && (st.planets || st.bodyShips || st.bodyRes)) html = rewriteImperium(html, st);
  return html;
}
function rewritePlanets(html, list, cp) {
  const ids = list.flatMap((p) => [p.id].concat(p.moon ? [p.moon.id] : []));
  const cur = ids.includes(+cp) ? +cp : list[0].id;
  const opts = [];
  for (const p of list) {
    opts.push(`<option value="${p.id}"${p.id === cur ? ' selected="selected"' : ''}>${p.name} [${p.coords}]</option>`);
    if (p.moon) opts.push(`<option value="${p.moon.id}"${p.moon.id === cur ? ' selected="selected"' : ''}>${p.moon.name || 'Луна'} (Moon) [${p.coords}]</option>`);
  }
  html = html.replace(/(<select id="planetSelector"[^>]*>)[\s\S]*?(<\/select>)/, (m, a, b) => a + '\n' + opts.join('\n') + '\n' + b);
  const blocks = html.match(/<div id="planetList">\s*<div class="smallplanet">[\s\S]*?<\/a>\s*<\/div>\s*<\/div>/g);
  if (blocks && blocks.length) {
    const tpl = blocks[0];
    const tCp = (/cp=(\d+)/.exec(tpl) || [])[1];
    const tName = ((/<span class="planet-name">([^<]*)<\/span>/.exec(tpl) || [])[1] || '').trim();
    const tCoords = ((/<span class="planet-koords">\[(\d+:\d+:\d+)\]/.exec(tpl) || [])[1] || '');
    const [tg, ts, tp] = tCoords.split(':');
    const gen = list.map((p) => {
      const [g, s2, pp] = p.coords.split(':');
      let b = tpl.split('cp=' + tCp).join('cp=' + p.id).split(tName).join(p.name).split('[' + tCoords + ']').join('[' + p.coords + ']')
        .split(`galaxy=${tg}&amp;system=${ts}&amp;position=${tp}`).join(`galaxy=${g}&amp;system=${s2}&amp;position=${pp}`)
        .replace(/ active active-planet/, '');
      if (p.id === cur) b = b.replace('class="planetlink ', 'class="planetlink  active active-planet ');
      return b;
    }).join('\n');
    const start = html.indexOf(blocks[0]);
    const last = blocks[blocks.length - 1];
    const end = html.lastIndexOf(last) + last.length;
    html = html.slice(0, start) + gen + html.slice(end);
  }
  return html.replace(/(<div id="countColonies">\s*<p class="textCenter"><span>)\[\d+ \/ (\d+)\]/, `$1[${list.length} / $2]`);
}
/** imperium.html table.empire: one column per planet (and moon) of st.planets (the order shuffled like the real page: by cp
 * descending), cells cloned from the last saved column; bodyRes / bodyShips values; a body with zero: true shows 0 everywhere. */
function rewriteImperium(html, st) {
  const a = html.indexOf('<table class="empire');
  const b = html.indexOf('</table>', a);
  if (a < 0 || b < 0) return html;
  let t = html.slice(a, b);
  const origCps = [...t.split(/<\/tr>/)[1].matchAll(/cp=(\d+)/g)].map((m) => +m[1]);
  const cols = Array.isArray(st.planets) && st.planets.length
    ? st.planets.flatMap((p) => [{ id: p.id, name: p.name, coords: p.coords, zero: !!p.zero }].concat(p.moon ? [{ id: p.moon.id, name: p.moon.name || 'Луна', coords: p.coords, zero: !!p.moon.zero }] : []))
    : origCps.map((id) => ({ id, keep: true }));
  if (st.planets && st.imperiumOrder !== 'list') cols.sort((x, y) => y.id - x.id);
  let section = '';
  let idx = 0;
  t = t.replace(/<tr>([\s\S]*?)<\/tr>/g, (full, inner) => {
    const th = /<th colspan="\d+">([^<]*)<\/th>/.exec(inner);
    if (th) { section = th[1].trim(); idx = 0; return full.replace(/colspan="\d+"/, `colspan="${2 + cols.length}"`); }
    const cells = inner.match(/<td[^>]*>[\s\S]*?<\/td>/g);
    if (!cells || cells.length < 3) return full;
    const label = cells[0].replace(/<[^>]+>/g, '').trim();
    const per = cells.slice(2);
    const rowIdx = idx++;
    const out = cols.map((c) => {
      const si = origCps.indexOf(c.id);
      let cell = per[si >= 0 ? si : per.length - 1];
      if (c.keep && !st.bodyShips && !st.bodyRes) return cell;
      if (section === 'Empire' && label === 'Planet') return cell.replace(/cp=\d+/, 'cp=' + c.id);
      if (section === 'Empire' && label === 'Name') return si >= 0 && !c.name ? cell : `<td>${c.name}</td>`;
      if (section === 'Empire' && label === 'Coordinates') return c.coords ? cell.replace(/\[\d+:\d+:\d+\]/, `[${c.coords}]`) : cell;
      if (section === 'Empire') return cell;
      let v = c.zero ? 0 : null;
      const res = st.bodyRes && st.bodyRes[c.id];
      const sh = st.bodyShips && st.bodyShips[c.id];
      if (section === 'Resources' && res) { const k = { Metal: 'metal', Crystal: 'crystal', Deuterium: 'deuterium' }[label]; if (k && res[k] != null) v = res[k]; }
      if (section === 'Ships' && sh) v = +sh[IMPERIUM_SHIP_IDS[rowIdx]] || 0;
      if (section === 'Technologies' && c.zero) v = null;
      return v === null ? cell : `<td>${dots(v)}</td>`;
    });
    return '<tr>' + cells[0] + cells[1] + out.join('') + '</tr>';
  });
  return html.slice(0, a) + t + html.slice(b);
}

/** Info page (printMessage) [UPSTREAM error.default.tpl] in the frame of the REAL fleetStep3 page: .headerRS + .mainRS table.table519. */
function infoPage(html, message, buttons) {
  const btn = buttons && buttons.length ? '<p>' + buttons.map((b) => `<a href="${b.url}"><button>${b.label}</button></a>`).join('') + '</p>' : '';
  const body = `<table class="table519">\n\t<tr>\n\t\t<th>Info</th>\n\t</tr>\n\t<tr>\n\t\t<td><p>${message}</p>${btn}</td>\n\t</tr>\n</table>\n`;
  const a = html.indexOf('<div class="mainRS">');
  const b = html.indexOf('<div class="footerRS">', a);
  if (a < 0 || b < 0) return html;
  return html.slice(0, a) + '<div class="mainRS">\n' + body + '</div>\n' + html.slice(b);
}

/** fleetTable with the recall forms of the given fleet ids removed (the server answers with the list after a recall). */
function removeRecallForms(html, ids) {
  let out = html;
  for (const id of ids) out = out.replace(new RegExp(`<form[^>]*sendfleetback[^>]*>\\s*<input name="fleetID" value="${+id}"[^]*?</form>`, 'g'), '');
  return out;
}

/**
 * Details panel JSON of TechnologyDetailsAjax & co. Shape {target, content: {[target]: html}} is REAL (inline JS of the list
 * pages); the html follows the HYPOTHETICAL panel of specs/galaxyz/fixtures/buildings-details-ajax-1-HYPOTHETICAL.json.
 */
function detailsJson(id, gzPage) {
  const field = gzPage === 'research' ? 'tech' : gzPage === 'shipyard' ? `fmenge[${id}]` : 'building';
  const unit = gzPage === 'shipyard';
  const form = gzPage === 'officier' ? '' : `
    <form class="build_form" action="game.php?page=${gzPage === 'shipyard' ? 'shipyard' : gzPage}" method="post" data-tech-ok="1" data-room-ok="1" data-max-reached="0" data-buyable="1" data-busy="0">
      <input type="hidden" name="cmd" value="insert">
      ${unit ? `<input type="number" id="b_input_${id}" class="upgrade-input" name="${field}" value="1" min="1">` : `<input type="hidden" name="${field}" value="${id}">`}
      <div class="build-it_wrap"><button type="submit" class="upgrade build_submit"><span class="tooltipTop" title="Build">Build</span></button></div>
    </form>`;
  return {
    target: 'technologydetails',
    content: {
      technologydetails: `<div id="technologydetails" data-tech="${id}">
    <h3>Element ${id} <span class="level">(Level 1)</span></h3>
    <ul class="costs" data-tech-id="${id}" data-level="1" data-max="255" data-factor="2">
      <li class="cost-item" data-res="901" data-base="1000" data-have="2064425065"><img src="metal.gif" alt=""><span class="res-amount">1.000</span><span class="lack" hidden></span></li>
    </ul>${form}
  </div>`,
    },
  };
}

module.exports = { startGzServer, pageNames, readAccount, fileFor, PAGES, GZ, MISSION_NAMES, STEP3_TEXTS, infoPage, rewritePlanets, rewriteImperium, fleetTableShips };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  startGzServer({ port: Number(get('--port', 8080)), gameJs: !args.includes('--no-game-js'), keepRefresh: args.includes('--keep-refresh'), world: get('--world', undefined) }).then((srv) => {
    console.log(`mock GALAXYZ on ${srv.origin}  -> ${srv.origin}${srv.gamePath('overview')}`);
    console.log(`request log: ${srv.origin}/__ogx/requests`);
  });
}
