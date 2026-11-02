'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / spy: espionage report collection on /messages (short + full fetch), derived loot/cargo, the «Шпионаж»
// table, one-click raid (send-fleet POST body), server error message, delete (POST /messages action=103), spy (mini fleet),
// prepare (prefill), simulator link (base64 prefill, window.open stubbed: no external request), bridge capture of a report
// opened by the game, message badges, journal events, and the non-OgameX safety check.
//   node tests/legacy-ogamex/infinity-spy.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');
const { rewrite } = require('../server');

const ROOT = path.resolve(__dirname, '..', '..');
const SPY_SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/spy/spy.js'), 'utf8');
const PANEL_FILE = path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js');
const PANEL_SRC = fs.existsSync(PANEL_FILE) ? fs.readFileSync(PANEL_FILE, 'utf8') : null;

let extCache = null;
function ext() {
  if (!extCache) {
    const modules = {};
    if (PANEL_SRC) modules.panel = PANEL_SRC;
    modules.spy = SPY_SRC;
    extCache = coreExt({ name: 'infinity', modules });
  }
  return extCache;
}

const P = 'ogx-i-spy-';
const CSRF = 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e';
const nbsp = (s) => String(s).replace(/[  ]/g, ' ');
const LC_ON_PLANET = 60;

// /messages as it looks after the game JS loaded the fleets tab and the espionage subtab; /fleet with 60 Large Cargo.
function installRoutes(env) {
  env.server.route('GET', '/messages', (req, res, ctx) => {
    ctx.rec.fixture = 'messages-page-loaded-espionage.html';
    return ctx.send(200, rewrite(T.fixture('messages-page-loaded-espionage.html'), ctx.origin), 'text/html; charset=utf-8');
  });
  env.server.route('GET', '/fleet', (req, res, ctx) => {
    ctx.rec.fixture = 'fleet-dispatch-planet.html (LC=60)';
    let html = T.fixture('fleet-dispatch-planet.html');
    html = html.replace('title="Large Cargo (18)"', `title="Large Cargo (${LC_ON_PLANET})"`)
      .replace(/(data-technology="203"[\s\S]*?<span class="amount" data-value=")18("[^>]*>\s*<span>)18/, `$1${LC_ON_PLANET}$2${LC_ON_PLANET}`)
      .replace(/("id": 203,\s*"number": )18/, `$1${LC_ON_PLANET}`); // inline shipsOnPlanet (fleet.md §2.3)
    return ctx.send(200, rewrite(html, ctx.origin), 'text/html; charset=utf-8');
  });
}

async function waitStore(env, key, pred, timeout = 15000) {
  const t0 = Date.now();
  let v = null;
  while (Date.now() - t0 < timeout) {
    v = await env.get(key);
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timeout waiting for ' + key + ': ' + JSON.stringify(v).slice(0, 400));
}

async function openTab(env, page) {
  await env.evalOgx(page, () => { const p = OGX.dom.sidePanel('infinity'); p.open(); p.selectTab('spy'); return true; }, null, 'infinity');
  await env.waitFor(page, `.${P}table`);
}
const row = (id) => `.ogx-tab-pane[data-tab="spy"] .${P}table tr[data-key="${id}"]`;
async function clickOk(page) {
  await page.waitForSelector('.ogx-modal .ogx-modal-buttons .ogx-btn:last-child', { state: 'visible', timeout: 5000 });
  await page.click('.ogx-modal .ogx-modal-buttons .ogx-btn:last-child');
}
async function waitToast(page, re) {
  await page.waitForFunction((src) => [...document.querySelectorAll('.ogx-toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 10000 });
}

async function expectedCargo(env, page) {
  return env.evalOgx(page, async () => {
    const stats = await OGX.state.shipStats();
    const player = await OGX.state.player();
    return { cap: stats[203].cargo, cls: player.playerClass };
  }, null, 'infinity');
}

T.test('spy: collects 3 reports with full details, table numbers, badges, raid POST, error message, delete', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.httpGapMs': 200 } });
  installRoutes(env);
  await env.open('/fleet'); // the fleet page tells the store how many ships planet 1 has
  await waitStore(env, 'bodies', (v) => v && v.p1 && v.p1.shipsT && v.p1.ships[203] === LC_ON_PLANET);
  const page = await env.open('/messages');

  // --- collection: 3 espionage reports (not the "espionage detected" 2049), full reports fetched from the mock
  const reports = await waitStore(env, 'spy.reports', (v) => v && v.items && Object.keys(v.items).length === 3 && Object.values(v.items).every((r) => r.full));
  assert.equal(reports.v, 1);
  assert.deepEqual(Object.keys(reports.items).sort(), ['2038', '2044', '2051']);
  const r51 = reports.items['2051'];
  assert.deepEqual({ m: r51.resources.metal, c: r51.resources.crystal, d: r51.resources.deuterium }, { m: 1468279, c: 500451, d: 65266 });
  assert.equal(r51.ships['202'], 40);
  assert.equal(r51.defense['401'], 150);
  assert.equal(reports.items['2044'].attackParams.type, 3);
  assert.equal(reports.items['2044'].known.defense, false);
  assert.ok(reports.items['2038'].debris.metal > 0, 'debris of 2038');
  const detailReqs = env.requests('GET', /^\/ajax\/messages\/\d+$/).map((r) => r.path).sort();
  assert.deepEqual(detailReqs, ['/ajax/messages/2038', '/ajax/messages/2044', '/ajax/messages/2051']);
  for (const r of env.requests('GET', /^\/ajax\/messages\/\d+$/)) assert.equal(r.query.subtab, 'espionage');

  // --- derived numbers: Collector → 50 %
  const { cap, cls } = await expectedCargo(env, page);
  assert.equal(cls, 'miner');
  const loot = { metal: Math.floor(1468279 * 0.5), crystal: Math.floor(500451 * 0.5), deuterium: Math.floor(65266 * 0.5) };
  assert.equal(loot.metal, 734139);
  const lootTotal = loot.metal + loot.crystal + loot.deuterium;
  const n = Math.ceil((lootTotal * (1 + 10 / 100)) / cap);
  assert.ok(n > 18 && n <= LC_ON_PLANET, 'needs more LC than the original fixture has: ' + n);

  // --- message badges (one per espionage report, none on the "detected" message)
  await page.waitForFunction(() => document.querySelectorAll('li.msg .ogx-i-spy-badge').length === 3);
  const badge51 = nbsp(await page.textContent('li.msg[data-msg-id="2051"] .ogx-i-spy-badge'));
  assert.match(badge51, /Добыча 50%: 1 016 997/);
  assert.ok(badge51.includes('БТ: ' + n), badge51);
  assert.equal(await page.$$eval('li.msg[data-msg-id="2049"] .ogx-i-spy-badge', (e) => e.length), 0);

  // --- table
  await openTab(env, page);
  await env.waitFor(page, row(2051));
  assert.equal(await page.$$eval(`.ogx-tab-pane[data-tab="spy"] .${P}table tbody tr[data-key]`, (e) => e.length), 3);
  const lootEl = `${row(2051)} .${P}loot`;
  assert.equal(await page.getAttribute(lootEl, 'data-metal'), '734139');
  assert.equal(await page.getAttribute(lootEl, 'data-total'), String(lootTotal));
  assert.match(nbsp(await page.getAttribute(lootEl, 'title')), /М 734 139 · К 250 225 · Д 32 633/);
  assert.equal(nbsp(await page.textContent(lootEl)), '1 016 997');
  assert.equal(nbsp(await page.textContent(`${row(2051)} .${P}cargo`)), String(n));
  assert.equal(nbsp(await page.textContent(`${row(2044)} td:nth-child(2)`)), '[1:45:9] Л');
  // flight time column filled (current body 1:42:8 known)
  assert.match(nbsp(await page.textContent(`${row(2051)} td:nth-child(9)`)), /\d/);
  // sorting by loot (click header twice → asc)
  await page.click(`.ogx-tab-pane[data-tab="spy"] .${P}table th[data-key="loot"]`);
  const order1 = await page.$$eval(`.ogx-tab-pane[data-tab="spy"] .${P}table tbody tr[data-key]`, (e) => e.map((x) => x.dataset.key));
  await page.click(`.ogx-tab-pane[data-tab="spy"] .${P}table th[data-key="loot"]`);
  const order2 = await page.$$eval(`.ogx-tab-pane[data-tab="spy"] .${P}table tbody tr[data-key]`, (e) => e.map((x) => x.dataset.key));
  assert.deepEqual(order2, order1.slice().reverse());
  assert.ok(order1[0] === '2051' || order2[0] === '2051');

  // --- raid (one click + the core confirmation), success
  env.clearRequests();
  assert.equal(await page.isDisabled(`${row(2051)} button[data-ogx-act="spy:raid"]`), false, await page.getAttribute(`${row(2051)} button[data-ogx-act="spy:raid"]`, "title"));
  await page.click(`${row(2051)} button[data-ogx-act="spy:raid"]`);
  await clickOk(page);
  await waitToast(page, /Флот отправлен/);
  const sends = env.requests('POST', '/ajax/fleet/dispatch/send-fleet');
  assert.equal(sends.length, 1);
  const f = sends[0].form;
  assert.equal(f.mission, '1');
  assert.equal(f.am203, String(n));
  assert.deepEqual([f.galaxy, f.system, f.position, f.type], ['1', '45', '9', '1']);
  assert.equal(f.speed, '10');
  assert.equal(f._token, CSRF);
  assert.equal(Object.keys(f).filter((k) => /^am\d+$/.test(k)).length, 1);
  const raids = await waitStore(env, 'spy.raids', (v) => v && v.items && v.items.length === 1);
  assert.equal(raids.items[0].reportId, 2051);
  assert.equal(raids.items[0].ok, true);
  await page.waitForSelector(`${row(2051)} .${P}raided`);

  // --- raid, server error → the server message is shown
  env.setState({ sendFleet: 'error' });
  await page.click(`${row(2051)} button[data-ogx-act="spy:raid"]`);
  await clickOk(page);
  await waitToast(page, /Not enough units on the planet/);
  await waitStore(env, 'spy.raids', (v) => v && v.items.length === 2 && v.items[1].ok === false);

  // --- delete
  env.clearRequests();
  await page.click(`${row(2051)} button[data-ogx-act="spy:delete"]`);
  await clickOk(page);
  await waitToast(page, /Доклад удалён/);
  const del = env.requests('POST', '/messages');
  assert.equal(del.length, 1);
  assert.equal(del[0].form.messageId, '2051');
  assert.equal(del[0].form.action, '103');
  await waitStore(env, 'spy.reports', (v) => v && !v.items['2051'] && v.items['2044']);
  assert.equal(await page.$$eval('li.msg[data-msg-id="2051"]', (e) => e.length), 0);

  // --- journal: user clicks and wrapped actions
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => e.k === 'spy' || (e.s === 'U' && /spy:/.test(e.w))).map((e) => e.s + ' ' + e.k + ' ' + e.w), null, 'infinity');
  for (const want of ['U spy raid', 'B spy raid:send', 'U spy delete', 'B spy message:delete', 'B spy report:fetch', 'B spy report:full']) {
    assert.ok(ev.includes(want), 'journal has ' + want + ' in ' + JSON.stringify(ev.slice(0, 40)));
  }

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('spy: insufficient ships disable Рейд, spy/prepare/simulator, bridge capture without auto-fetch', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.httpGapMs': 200, 'spy.autoFetchFull': false, 'spy.cargoShip': 202 } });
  installRoutes(env);
  await env.open('/fleet');
  await waitStore(env, 'bodies', (v) => v && v.p1 && v.p1.shipsT && v.p1.ships[202] === 25);
  const page = await env.open('/messages');

  // short reports only (no detail requests), approximate resources from the list
  const reports = await waitStore(env, 'spy.reports', (v) => v && v.items && Object.keys(v.items).length === 3);
  assert.equal(reports.items['2051'].full, false);
  assert.equal(reports.items['2051'].resources.metal, 1468000);
  await page.waitForTimeout(500);
  assert.equal(env.requests('GET', /^\/ajax\/messages\/\d+$/).length, 0);

  // the game opens report 2044 in its overlay → captured from the page XHR
  await page.evaluate(() => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('GET', '/ajax/messages/2044?tab=fleets&subtab=espionage');
    x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    x.onload = () => resolve(x.status);
    x.send();
  }));
  const after = await waitStore(env, 'spy.reports', (v) => v && v.items['2044'] && v.items['2044'].full === true);
  assert.deepEqual(after.items['2044'].ships, { 203: 30, 207: 6 });

  await openTab(env, page);
  await env.waitFor(page, row(2051));
  // 25 SC on the planet; 2051 needs far more → disabled with a reason
  assert.equal(await page.isDisabled(`${row(2051)} button[data-ogx-act="spy:raid"]`), true, await page.getAttribute(`${row(2051)} button[data-ogx-act="spy:raid"]`, "title") + " / " + await page.textContent(`${row(2051)}`));
  assert.match(nbsp(await page.getAttribute(`${row(2051)} button[data-ogx-act="spy:raid"]`, 'title')), /На планете 25 .*нужно \d+/);
  assert.match(nbsp(await page.textContent(`${row(2051)} .${P}loot`)), /^≈/);

  // spy (mini fleet, mission 6) on the moon of 2044
  env.clearRequests();
  await page.click(`${row(2044)} button[data-ogx-act="spy:spy"]`);
  await waitToast(page, /Зонды отправлены/);
  const mini = env.requests('POST', '/ajax/fleet/dispatch/send-mini-fleet');
  assert.equal(mini.length, 1);
  assert.deepEqual([mini[0].form.mission, mini[0].form.galaxy, mini[0].form.system, mini[0].form.position, mini[0].form.type], ['6', '1', '45', '9', '3']);

  // simulator: window.open stubbed in the isolated world (no external request)
  await env.evalOgx(page, () => { window.__ogxOpened = []; window.open = (u) => { window.__ogxOpened.push(u); return null; }; return true; }, null, 'infinity');
  await page.click(`${row(2044)} button[data-ogx-act="spy:sim"]`);
  const opened = await env.evalOgx(page, () => window.__ogxOpened, null, 'infinity');
  assert.equal(opened.length, 1);
  assert.ok(opened[0].startsWith('https://trashsim.oplanet.eu/ru#prefill='), opened[0]);
  const prefill = JSON.parse(Buffer.from(opened[0].split('#prefill=')[1], 'base64').toString('utf8'));
  assert.deepEqual(prefill['1'][0].ships, { 203: { count: 30 }, 207: { count: 6 } });
  assert.equal(prefill['1'][0].planet.type, 3);
  assert.equal(prefill['0'][0].class, 1);

  // no request from the simulator click; prepare → prefill stored and navigation to /fleet with the target
  assert.equal(env.requests('GET', /trashsim/).length, 0);
  await Promise.all([page.waitForURL(/\/fleet\?/), page.click(`${row(2044)} button[data-ogx-act="spy:prepare"]`)]);
  const u = new URL(page.url());
  assert.deepEqual([u.searchParams.get('galaxy'), u.searchParams.get('system'), u.searchParams.get('position'), u.searchParams.get('type'), u.searchParams.get('mission')], ['1', '45', '9', '3', '1']);
  await env.waitReady(page);

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('spy: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
});
