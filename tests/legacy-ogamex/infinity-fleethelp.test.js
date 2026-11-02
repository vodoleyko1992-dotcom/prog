'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / fleethelp: keep rules, /fleet buttons (through the bridge into a stubbed fleetDispatcher), the «Сбор» tab
// (numbers from a seeded Colony + the core estimate), «Подготовить» → core prefill applied through the stub, the walk,
// direct send (POST body, ?cp=3, cp restore), the server error message, keep editor, journal events and the safety check.
//   node tests/legacy-ogamex/infinity-fleethelp.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');
const { rewrite } = require('../server');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/fleethelp/fleethelp.js'), 'utf8');
const PANEL_FILE = path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js');
const PANEL_SRC = fs.existsSync(PANEL_FILE) ? fs.readFileSync(PANEL_FILE, 'utf8') : null;

let extCache = null;
function ext() {
  if (!extCache) {
    const modules = {};
    if (PANEL_SRC) modules.panel = PANEL_SRC;
    modules.fleethelp = SRC;
    extCache = coreExt({ name: 'infinity', modules });
  }
  return extCache;
}

const P = 'ogx-i-fleethelp-';
const CSRF = 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e';
const nbsp = (s) => String(s).replace(/[  ]/g, ' ');
const NOW = 1793321837000; // server time of the vega fixtures (perHour 0 below, so the time does not matter)

// Colony (p3) as if the user had visited it: resources without production, 30 LC + 10 SC.
const COLONY = {
  key: 'p3', id: 3, type: 'planet', planetId: 3, name: 'Colony', coords: '2:118:12', diameter: 14530, fieldsUsed: 52, fieldsMax: 188, tempMin: -61, tempMax: 21,
  res: { metal: { amount: 300000, storage: 10000000, perHour: 0 }, crystal: { amount: 150000, storage: 10000000, perHour: 0 }, deuterium: { amount: 60000, storage: 10000000, perHour: 0 }, t: NOW },
  energy: null, levels: {}, levelsT: {}, ships: { 202: 10, 203: 30, 204: 0 }, shipsT: NOW, defense: {}, defenseT: null, percents: {}, factor: null, percentsT: null,
  queues: { building: null, unit: null, t: null }, constructionFlag: false, seenAt: NOW, order: 1, moonKey: null,
};

// MAIN-world stub of the game's FleetDispatcher, installed before the inline `var fleetDispatcher = null` (a setter that ignores it).
function stubInit() {
  window.__ogxStubCalls = [];
  const target = { shipsToSend: [{ id: 203, number: 13 }], targetPlanet: { galaxy: 1, system: 42, position: 9, type: 1 }, mission: 3, speedPercent: 10,
    cargoMetal: 0, cargoCrystal: 0, cargoDeuterium: 0, expeditionTime: 1, holdingTime: 1, fleetHelper: { shipsData: {} }, currentPage: 'fleet1' };
  const stub = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol') return undefined;
      return (...args) => { window.__ogxStubCalls.push({ method: String(prop), args: JSON.parse(JSON.stringify(args)) }); return undefined; };
    },
  });
  Object.defineProperty(window, 'fleetDispatcher', { get: () => stub, set: () => {}, configurable: false });
  window.$ = window.$ || function () { return undefined; }; // the fixture's inline `$(function(){...})` without game JS
}

// /fleet for body 3: the prefill fixture rewritten to Colony (metas, currentPlanet), so the core prefill sees the right origin.
function installRoutes(env) {
  env.server.route('GET', '/fleet', (req, res, ctx) => {
    const cp = +(ctx.query.cp || ctx.state.currentBodyId || 1);
    const prefill = !!(ctx.query.galaxy && ctx.query.system && ctx.query.position);
    let name = prefill ? 'fleet-dispatch-prefill.html' : 'fleet-dispatch-planet.html';
    let html = T.fixture(name);
    if (cp === 3) {
      html = html.replace('<meta name="ogame-planet-id" content="1"', '<meta name="ogame-planet-id" content="3"')
        .replace('<meta name="ogame-planet-name" content="Homeworld"', '<meta name="ogame-planet-name" content="Colony"')
        .replace('<meta name="ogame-planet-coordinates" content="1:42:8"', '<meta name="ogame-planet-coordinates" content="2:118:12"')
        .replace(/var currentPlanet = \{[\s\S]*?\};/, 'var currentPlanet = {"galaxy":2,"system":118,"position":12,"type":1,"name":"Colony"};');
      name += ' (as Colony)';
    }
    ctx.rec.fixture = name;
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
async function stubCalls(page, method) {
  const all = await page.evaluate(() => window.__ogxStubCalls || []);
  return method ? all.filter((c) => c.method === method) : all;
}
async function waitStub(page, method, n = 1) {
  await page.waitForFunction(([m, k]) => (window.__ogxStubCalls || []).filter((c) => c.method === m).length >= k, [method, n], { timeout: 10000 });
  return stubCalls(page, method);
}
async function openTab(env, page) {
  await env.evalOgx(page, () => { const p = OGX.dom.sidePanel('infinity'); p.open(); p.selectTab('collect'); return true; }, null, 'infinity');
  await env.waitFor(page, `.${P}table`);
}
const row = (key) => `.ogx-tab-pane[data-tab="collect"] .${P}table tr[data-key="${key}"]`;
async function clickOk(page) {
  await page.waitForSelector('.ogx-modal .ogx-modal-buttons .ogx-btn:last-child', { state: 'visible', timeout: 5000 });
  await page.click('.ogx-modal .ogx-modal-buttons .ogx-btn:last-child');
}
async function waitToast(page, re) {
  await page.waitForFunction((src) => [...document.querySelectorAll('.ogx-toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 10000 });
}
// journal of this and the previous pages (the store), plus this page's unwritten events
async function journal(env, page) {
  return env.evalOgx(page, async () => {
    await OGX.diag.flush();
    const st = await OGX.diag.store();
    const q = await st.query({ last: 5000 });
    const all = (q.events || []).concat(OGX.diag.recent());
    return [...new Set(all.filter((e) => e.k === 'fleethelp' || (e.s === 'U' && /fleethelp/.test(e.w))).map((e) => e.s + ' ' + e.k + ' ' + e.w))];
  }, null, 'infinity');
}

T.test('fleethelp: /fleet buttons — all but keep, transport for resources, all resources but keep', async () => {
  const keep = { v: 1, default: { ships: {}, resources: {} }, bodies: { p1: { ships: { 203: 5 }, resources: { metal: 10000, crystal: 0, deuterium: 5000 } } } };
  const env = await T.launch({ ext: ext(), scenario: 'vega', storage: { '{host}|{pid}|fleethelp.keep': keep } });
  installRoutes(env);
  const page = await env.page();
  await page.context().addInitScript(stubInit);
  await env.open('/overview');
  await env.open('/fleet');
  await env.waitFor(page, `#${P}bar1`);
  // the bar sits right before the ship list inside #fleet1, the step-2 bar below the cargo box
  assert.equal(await page.$$eval(`#fleet1 #${P}bar1 + #buttonz`, (e) => e.length), 1);
  assert.equal(await page.$$eval(`#fleet2 #${P}bar2`, (e) => e.length), 1);
  assert.match(await page.textContent(`.${P}keeplink`), /резерв: свой/);

  // --- «Всё, кроме резерва»: LC = 18 − 5, everything else unchanged
  await page.click(`#${P}allbut`);
  const sel = await waitStub(page, 'selectShips');
  assert.deepEqual(sel[0].args[0], { 202: 25, 203: 13, 204: 40, 206: 12, 208: 1, 209: 6, 210: 15 });
  assert.ok((await stubCalls(page, 'resetShips')).length >= 1, 'bridge resets first');
  await page.waitForFunction((id) => /выбрано/.test(document.getElementById(id).textContent), P + 'status1');

  // --- «Транспорт для ресурсов»: resources minus keep, LC first (max 13 free), SC for the rest
  const info = await env.evalOgx(page, async () => {
    const st = await OGX.state.shipStats();
    const b = await OGX.state.body('p1');
    const p = OGX.state.projected(b);
    return { lc: st[203].cargo, sc: st[202].cargo, m: p.res.metal.amount, c: p.res.crystal.amount, d: p.res.deuterium.amount };
  }, null, 'infinity');
  const minTotal = Math.floor(info.m) - 10000 + Math.floor(info.c) + Math.floor(info.d) - 5000;
  await page.click(`#${P}transport`);
  const sel2 = await waitStub(page, 'selectShips', 2);
  const tr = sel2[1].args[0];
  assert.ok(Object.keys(tr).every((id) => id === '202' || id === '203'), JSON.stringify(tr));
  assert.ok(+tr[203] >= 1 && +tr[203] <= 13, 'LC within the free 13: ' + JSON.stringify(tr));
  const cap = (+tr[203] || 0) * info.lc + (+tr[202] || 0) * info.sc;
  assert.ok(cap >= minTotal && cap - Math.min(info.lc, info.sc) < minTotal + 2 * info.lc, `capacity ${cap} fits ${minTotal}`);

  // --- step 2 «Все ресурсы, кроме резерва»: 13 LC (stub shipsToSend) to 1:42:9, D → C → M, deuterium minus fuel
  // show step 2 as the game does after «Continue» with a valid mission (the game hides .briefing_overlay, bundle:33969)
  await page.evaluate(() => { document.getElementById('fleet1').style.display = 'none'; document.getElementById('fleet2').style.display = 'block'; for (const o of document.querySelectorAll('.briefing_overlay')) o.style.display = 'none'; });
  const est = await env.evalOgx(page, () => OGX.fleet.estimate({ from: '1:42:8', to: '1:42:9', ships: { 203: 13 }, mission: 3, speedPct: 10 }), null, 'infinity');
  await page.click(`#${P}allres`);
  const cargoCalls = await waitStub(page, 'updateCargo');
  assert.equal(cargoCalls.length, 1);
  const fd = await page.evaluate(() => ({ m: window.fleetDispatcher.cargoMetal, c: window.fleetDispatcher.cargoCrystal, d: window.fleetDispatcher.cargoDeuterium }));
  const fuel = Math.ceil(est.fuelBudget);
  assert.ok(fuel > 0);
  const grow = 600; // projection growth between the two reads (a few seconds at most)
  assert.ok(fd.m >= Math.floor(info.m) - 10000 && fd.m <= Math.floor(info.m) - 10000 + grow, 'metal ' + fd.m);
  assert.ok(fd.c >= Math.floor(info.c) && fd.c <= Math.floor(info.c) + grow, 'crystal ' + fd.c);
  assert.ok(fd.d >= Math.floor(info.d) - 5000 - fuel && fd.d <= Math.floor(info.d) - 5000 - fuel + grow, `deuterium ${fd.d} (fuel ${fuel})`);
  assert.ok(fd.m + fd.c + fd.d <= 13 * info.lc);
  assert.match(nbsp(await page.textContent(`#${P}status2`)), /груз .* из .*, топливо ~/);

  // --- keep editor from the «резерв» link (back on step 1): own rule of Homeworld, LC 5 → 7
  await page.evaluate(() => { document.getElementById('fleet2').style.display = 'none'; document.getElementById('fleet1').style.display = ''; });
  await page.click(`.${P}keeplink`);
  await page.waitForSelector(`.${P}modal input[data-k="203"]`, { state: 'visible' });
  assert.equal(await page.inputValue(`.${P}modal input[data-k="203"]`), '5');
  await page.fill(`.${P}modal input[data-k="203"]`, '7');
  await clickOk(page);
  await waitToast(page, /Резерв сохранён/);
  const k2 = await waitStore(env, 'fleethelp.keep', (v) => v && v.bodies.p1 && v.bodies.p1.ships[203] === 7);
  assert.equal(k2.bodies.p1.resources.metal, 10000);

  const ev = await journal(env, page);
  for (const want of ['U fleethelp fleet:all-but-keep', 'B fleethelp fleet:selectShips', 'U fleethelp fleet:transport', 'U fleethelp fleet:all-res-but-keep', 'B fleethelp fleet:setCargo', 'U fleethelp keep:save', 'B fleethelp keep:save']) {
    assert.ok(ev.includes(want), 'journal has ' + want + ' in ' + JSON.stringify(ev.slice(0, 40)));
  }
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.logs.filter((l) => /\/fleethelp\]/.test(l.text)).map((l) => l.text), [], 'no fleethelp warnings');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('fleethelp: «Сбор» tab numbers, «Подготовить» prefill through the stub, walk', async () => {
  const keep = { v: 1, default: { ships: { 202: 2 }, resources: { metal: 0, crystal: 0, deuterium: 10000 } }, bodies: {} };
  const env = await T.launch({ ext: ext(), scenario: 'vega', storage: { '{host}|{pid}|fleethelp.keep': keep, '{host}|{pid}|bodies': { p3: COLONY } } });
  installRoutes(env);
  const page = await env.page();
  await page.context().addInitScript(stubInit);
  await env.open('/overview');
  await openTab(env, page);
  await env.waitFor(page, row('p3'));
  // target defaults to the current body (Homeworld); the moon has no resource data
  assert.equal(await page.$eval(`.${P}target`, (s) => s.value), 'p1');
  assert.equal(await page.$$eval(row('p1'), (e) => e.length), 0);
  assert.match(nbsp(await page.textContent(row('m5'))), /Нет данных о ресурсах/);

  const fuel = +(await page.getAttribute(`${row('p3')} .${P}flight`, 'data-fuel'));
  const ships = JSON.parse(await page.getAttribute(`${row('p3')} .${P}ships`, 'data-ships'));
  const exp = await env.evalOgx(page, async (sh) => {
    const st = await OGX.state.shipStats();
    const e = await OGX.fleet.estimate({ from: '2:118:12', to: '1:42:8', ships: sh, mission: 3, speedPct: 10 });
    return { lc: st[203].cargo, sc: st[202].cargo, fuel: e.fuelBudget, fuelClient: e.fuelClient, duration: e.duration };
  }, ships, 'infinity');
  assert.equal(fuel, exp.fuel);
  const total = 300000 + 150000 + (60000 - 10000 - Math.ceil(fuel));
  assert.equal(+(await page.getAttribute(`${row('p3')} .${P}avail`, 'data-total')), total);
  assert.equal(+(await page.getAttribute(`${row('p3')} .${P}avail`, 'data-deuterium')), 50000 - Math.ceil(fuel));
  const need = Math.ceil(total / exp.lc);
  assert.equal(+(await page.getAttribute(`${row('p3')} .${P}need`, 'data-n')), need);
  assert.match(nbsp(await page.textContent(`${row('p3')} .${P}need`)), new RegExp(`БТ ${need} / МТ ${Math.ceil(total / exp.sc)}`));
  // ships: 30 LC available, keep only applies to SC (10 − 2 = 8)
  const lcUsed = Math.min(30, Math.floor(total / exp.lc));
  assert.equal(ships[203], lcUsed);
  assert.ok(!ships[202] || ships[202] <= 8, JSON.stringify(ships));
  assert.match(nbsp(await page.textContent(`${row('p3')} .${P}flight`)), /\d+:\d\d/);
  assert.match(nbsp(await page.textContent(`${row('p3')} .${P}flight`)), new RegExp('Д ' + nbsp(String(exp.fuelClient)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')));
  assert.equal(+(await page.getAttribute(`${row('p3')} .${P}flight`, 'data-duration')), exp.duration);
  // no direct send without the setting
  assert.equal(await page.$$eval(`${row('p3')} button[data-ogx-act="fleethelp:send"]`, (e) => e.length), 0);
  assert.match(nbsp(await page.textContent(`.${P}rule[data-key="default"]`)), /Д 10 000; МТ 2/);

  // --- «Подготовить» → /fleet?cp=3&galaxy=1&system=42&position=8&type=1&mission=3, prefill applied through the stub
  await Promise.all([page.waitForURL(/\/fleet\?/), page.click(`${row('p3')} button[data-ogx-act="fleethelp:prepare"]`)]);
  const u = new URL(page.url());
  assert.deepEqual(['cp', 'galaxy', 'system', 'position', 'type', 'mission'].map((k) => u.searchParams.get(k)), ['3', '1', '42', '8', '1', '3']);
  await env.waitReady(page);
  const sel = await waitStub(page, 'selectShips');
  assert.deepEqual(sel[0].args[0], Object.fromEntries(Object.entries(ships).map(([k, v]) => [k, v])));
  await waitStub(page, 'updateCargo');
  const fd = await page.evaluate(() => ({ m: window.fleetDispatcher.cargoMetal, c: window.fleetDispatcher.cargoCrystal, d: window.fleetDispatcher.cargoDeuterium, mission: (window.__ogxStubCalls.find((c) => c.method === 'selectMission') || {}).args }));
  const capacity = (ships[203] || 0) * exp.lc + (ships[202] || 0) * exp.sc;
  const d = Math.min(50000 - Math.ceil(fuel), capacity);
  const c = Math.min(150000, capacity - d);
  const m = Math.min(300000, capacity - d - c);
  assert.deepEqual([fd.m, fd.c, fd.d], [m, c, d]);
  assert.deepEqual(fd.mission, [3]);
  await env.waitFor(page, '#ogx-fleet-prefill');
  assert.equal(env.requests('POST', '/ajax/fleet/dispatch/send-fleet').length, 0, 'prefill never sends');

  // --- walk: back to the overview, «Подготовить следующий» → same source, walk stored, the /fleet bar offers to finish
  await env.open('/overview?cp=1');
  await openTab(env, page);
  await env.waitFor(page, row('p3'));
  assert.match(await page.textContent(`.${P}next`), /Подготовить следующий \(1\/1\)/);
  await Promise.all([page.waitForURL(/\/fleet\?cp=3/), page.click(`.${P}next`)]);
  await env.waitReady(page);
  const walk = await waitStore(env, 'fleethelp.walk', (v) => v && v.idx === 1);
  assert.deepEqual([walk.target, walk.keys], ['p1', ['p3']]);
  await env.waitFor(page, `#${P}walkbar`);
  assert.match(await page.textContent(`#${P}walkbar`), /Это последний источник/);
  await env.evalOgx(page, () => { OGX.dom.sidePanel('infinity').close(); return true; }, null, 'infinity'); // the open panel covers the page
  await page.click(`#${P}walkbar button[data-ogx-act="fleethelp:walk-stop"]`);
  await waitStore(env, 'fleethelp.walk', (v) => v === null || v === undefined);
  assert.equal(await page.$$eval(`#${P}walkbar`, (e) => e.length), 0);

  // --- keep editor in the tab: own rule for Colony (deuterium 20 000) changes the available amount
  await env.open('/overview?cp=1');
  await openTab(env, page);
  await page.click(`.${P}rule[data-key="p3"] button`);
  await page.waitForSelector(`.${P}modal input[data-k="deuterium"]`, { state: 'visible' });
  assert.equal(await page.inputValue(`.${P}modal input[data-k="deuterium"]`), '10000');
  await page.fill(`.${P}modal input[data-k="deuterium"]`, '20000');
  await clickOk(page);
  await waitStore(env, 'fleethelp.keep', (v) => v && v.bodies.p3 && v.bodies.p3.resources.deuterium === 20000);
  await page.waitForFunction((sel) => { const e = document.querySelector(sel); return e && +e.dataset.deuterium < 40000; }, `${row('p3')} .${P}avail`);

  const ev = await journal(env, page);
  for (const want of ['U fleethelp collect:prepare', 'B fleethelp collect:prefill', 'U fleethelp collect:next', 'B fleethelp walk:start', 'U fleethelp walk:stop', 'B fleethelp keep:save']) {
    assert.ok(ev.includes(want), 'journal has ' + want + ' in ' + JSON.stringify(ev.slice(0, 50)));
  }
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.logs.filter((l) => /\/fleethelp\]/.test(l.text)).map((l) => l.text), [], 'no fleethelp warnings');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('fleethelp: direct send posts mission 3 with cp=3, restores cp, shows the server error', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'fleethelp.allowDirectSend': true }, storage: { '{host}|{pid}|bodies': { p3: COLONY } } });
  installRoutes(env);
  const page = await env.open('/overview');
  await openTab(env, page);
  await env.waitFor(page, `${row('p3')} button[data-ogx-act="fleethelp:send"]`);
  const ships = JSON.parse(await page.getAttribute(`${row('p3')} .${P}ships`, 'data-ships'));
  const fuel = Math.ceil(+(await page.getAttribute(`${row('p3')} .${P}flight`, 'data-fuel')));

  env.clearRequests();
  await page.click(`${row('p3')} button[data-ogx-act="fleethelp:send"]`);
  await clickOk(page); // core confirmation
  await waitToast(page, /Флот отправлен/);
  const reqs = env.requests().filter((r) => !/eventbox|eventlist/.test(r.path));
  const iSend = reqs.findIndex((r) => r.method === 'POST' && r.path === '/ajax/fleet/dispatch/send-fleet');
  assert.ok(iSend >= 0, JSON.stringify(reqs.map((r) => r.method + ' ' + r.path)));
  const s = reqs[iSend];
  assert.equal(s.cp, 3);
  const f = s.form;
  assert.deepEqual([f.mission, f.galaxy, f.system, f.position, f.type, f.speed], ['3', '1', '42', '8', '1', '10']);
  assert.equal(f.am203, String(ships[203]));
  assert.equal(f._token, CSRF);
  assert.equal(f.deuterium, String(Math.min(60000 - Math.ceil(fuel), 30 * 1e9)));
  assert.equal(f.metal, '300000');
  assert.equal(f.crystal, '150000');
  const restore = reqs.slice(iSend + 1).find((r) => r.method === 'GET' && r.path === '/overview');
  assert.ok(restore, 'restore request after the send');
  assert.equal(restore.cp, 1);

  // server error → its message
  env.setState({ sendFleet: 'validation' });
  await page.click(`${row('p3')} button[data-ogx-act="fleethelp:send"]`);
  await clickOk(page);
  await waitToast(page, /Ошибка отправки: Fleet speed must be between/);

  // cancel in the confirmation → nothing sent
  env.clearRequests();
  await page.click(`${row('p3')} button[data-ogx-act="fleethelp:send"]`);
  await page.waitForSelector('.ogx-modal .ogx-modal-buttons .ogx-btn', { state: 'visible' });
  await page.click('.ogx-modal .ogx-modal-buttons .ogx-btn:first-child');
  await page.waitForTimeout(400);
  assert.equal(env.requests('POST', '/ajax/fleet/dispatch/send-fleet').length, 0);

  const ev = await journal(env, page);
  for (const want of ['U fleethelp collect:send', 'B fleethelp collect:send', 'U fleethelp collect:send-cancelled']) {
    assert.ok(ev.includes(want), 'journal has ' + want + ' in ' + JSON.stringify(ev.slice(0, 50)));
  }
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.logs.filter((l) => /\/fleethelp\]/.test(l.text)).map((l) => l.text), [], 'no fleethelp warnings');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('fleethelp: moon without ships (no #fleet1 ships) and no game dispatcher — no errors, DOM fallback', async () => {
  const keep = { v: 1, default: { ships: { 204: 10 }, resources: {} }, bodies: {} };
  const env = await T.launch({ ext: ext(), scenario: 'vega', storage: { '{host}|{pid}|fleethelp.keep': keep } });
  const page = await env.open('/fleet?cp=5');
  await env.waitFor(page, `#${P}bar1`);
  assert.equal(await page.isDisabled(`#${P}allbut`), true);
  // planet 1 without the stub: the bridge reports no dispatcher → the inputs are written directly
  const p2 = await env.open('/fleet?cp=1');
  await env.waitFor(p2, `#${P}bar1`);
  await p2.click(`#${P}allbut`);
  await p2.waitForFunction(() => { const i = document.querySelector('#fleet1 li[data-technology="204"] input'); return i && i.value === '30'; });
  assert.equal(await p2.inputValue('#fleet1 li[data-technology="203"] input'), '18');
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.logs.filter((l) => /\/fleethelp\]/.test(l.text)).map((l) => l.text), [], 'no fleethelp warnings');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('fleethelp: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
});
