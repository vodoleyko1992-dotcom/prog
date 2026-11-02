'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / todo: «+» on list items (next level / units from #build_amount), «+ в план» in the details panel,
// the «План» tab numbers (cost, time, affordability, totals), «Построить» POST bodies and server messages (success, error,
// unit success → removed), reorder/remove, automatic removal of done items, the planet-list ready dot, the journal and
// the safety check on non-OgameX pages.
//   node tests/legacy-ogamex/infinity-todo.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/todo/todo.js'), 'utf8');
const PANEL_FILE = path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js');
const PANEL_SRC = fs.existsSync(PANEL_FILE) ? fs.readFileSync(PANEL_FILE, 'utf8') : null;

let extCache = null;
function ext() {
  if (!extCache) {
    const modules = {};
    if (PANEL_SRC) modules.panel = PANEL_SRC;
    modules.todo = SRC;
    extCache = coreExt({ name: 'infinity', modules });
  }
  return extCache;
}

const P = 'ogx-i-todo-';
const CSRF = 'Qm3c4p0tXgF9b2kLr8VwZy1sNuHdEj6aTo5iCxYe'; // orion
const nb = (s) => String(s).replace(/[  ]/g, ' ');

async function waitStore(env, key, pred, timeout = 10000) {
  const t0 = Date.now();
  let v = null;
  while (Date.now() - t0 < timeout) {
    v = await env.get(key);
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timeout waiting for ' + key + ': ' + JSON.stringify(v).slice(0, 500));
}
async function waitToast(page, re) {
  try {
    await page.waitForFunction((src) => [...document.querySelectorAll('.ogx-toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 10000 });
  } catch (e) {
    const seen = await page.$$eval('.ogx-toast', (els) => els.map((t) => t.textContent)).catch(() => []);
    throw new Error('toast ' + re + ' not shown; toasts: ' + JSON.stringify(seen));
  }
}
async function openTab(env, page) {
  await env.evalOgx(page, () => { const p = OGX.dom.sidePanel('infinity'); p.open(); p.selectTab('todo'); return true; }, null, 'infinity');
  await env.waitFor(page, `.${P}tab`);
}
async function clickOk(page) {
  await page.waitForSelector('.ogx-modal .ogx-modal-buttons .ogx-btn:last-child', { state: 'visible', timeout: 5000 });
  await page.click('.ogx-modal .ogx-modal-buttons .ogx-btn:last-child');
}
const rowSel = (list, n) => `.${P}list[data-list="${list}"] .${P}table tbody tr:nth-child(${n})`;
async function journal(env, page) {
  return env.evalOgx(page, () => OGX.diag.recent().filter((e) => e.k === 'todo' || (e.s === 'U' && /todo/.test(e.w))).map((e) => e.s + ' ' + e.k + ' ' + e.w), null, 'infinity');
}
function form(r) { return r.form || {}; }

T.test('todo: «+» on Crystal Mine, tab numbers, «Построить» success and error', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion' });
  const page = await env.open('/facilities'); // robotics/nanite levels for the build time
  await env.waitFor(page, `#technologies li.technology[data-technology="14"] > .${P}plus`);
  await waitStore(env, 'bodies', (b) => b && b.p4 && b.p4.levels && b.p4.levels[14] > 0); // written before we navigate away
  await env.open('/resources');
  await env.waitFor(page, `#technologies li.technology[data-technology="2"] > .${P}plus`);
  assert.equal(await page.$$eval(`#technologies li.technology > .${P}plus`, (e) => e.length), await page.$$eval('#technologies li.technology', (e) => e.length));

  // --- «+» on Crystal Mine (level 19, level 20 already in the game queue: cancelbuilding(2,1288,…) in the fixture) → level 21
  await page.click(`#technologies li.technology[data-technology="2"] > .${P}plus`);
  const plans = await waitStore(env, 'todo.plans', (v) => v && v.bodies && v.bodies.p4 && v.bodies.p4.length === 1);
  assert.equal(plans.v, 1);
  assert.equal(plans.bodies.p4[0].objectId, 2);
  assert.equal(plans.bodies.p4[0].targetLevel, 21);
  await waitToast(page, /В план: Рудник кристалла, ур\. 21/);
  await page.waitForFunction((s) => document.querySelector(s).textContent === '→21', `#technologies li.technology[data-technology="2"] > .${P}plus`);

  // --- «+» on Metal Mine (22, 23 under construction) → 24; second «+» → 25
  await page.click(`#technologies li.technology[data-technology="1"] > .${P}plus`);
  await waitStore(env, 'todo.plans', (v) => v.bodies.p4.length === 2);
  await page.click(`#technologies li.technology[data-technology="1"] > .${P}plus`);
  const p3 = await waitStore(env, 'todo.plans', (v) => v.bodies.p4.length === 3);
  assert.deepEqual(p3.bodies.p4.map((i) => [i.objectId, i.targetLevel]), [[2, 21], [1, 24], [1, 25]]);

  // --- tab numbers, computed by the core in the same world
  await openTab(env, page);
  const exp = await env.evalOgx(page, async () => {
    const b = await OGX.state.body('p4');
    const s = await OGX.state.server();
    const now = OGX.time.serverNow();
    const p = OGX.state.projected(b, now);
    const res = {};
    for (const k of ['metal', 'crystal', 'deuterium']) res[k] = Object.assign({}, p.res[k], { t: now });
    const c = OGX.calc.cost(2, 21);
    const lv = b.levels;
    const t = OGX.calc.buildTime(2, 21, { robotics: lv[14] || 0, nanite: lv[15] || 0, economySpeed: s.economySpeed || 1 });
    const c24 = OGX.calc.cost(1, 24), c25 = OGX.calc.cost(1, 25);
    const tot = { metal: c.metal + c24.metal + c25.metal, crystal: c.crystal + c24.crystal + c25.crystal, deuterium: 0 };
    return {
      cost: 'М ' + OGX.fmt.num(c.metal) + ' · К ' + OGX.fmt.num(c.crystal),
      time: OGX.fmt.durationShort(t),
      wait: OGX.calc.timeUntilAffordable(c, res, now),
      total: 'М ' + OGX.fmt.num(tot.metal) + ' · К ' + OGX.fmt.num(tot.crystal),
      robotics: lv[14], nanite: lv[15],
    };
  }, null, 'infinity');
  assert.ok(exp.robotics > 0, 'robotics known from the facilities? ' + JSON.stringify(exp));
  assert.equal(nb(await page.textContent(rowSel('p4', 1) + ` .${P}cost`)), nb(exp.cost));
  assert.equal(nb(exp.cost), 'М 580 284 · К 290 142'); // floor(48·1.6^20), floor(24·1.6^20)
  assert.equal(nb(await page.textContent(rowSel('p4', 1) + ` .${P}time`)), nb(exp.time));
  const st = nb(await page.textContent(rowSel('p4', 1) + ` .${P}status`));
  if (exp.wait === 0) assert.equal(st, 'можно строить'); else assert.match(st, /^через /);
  assert.equal(nb(await page.textContent(`.${P}list[data-list="p4"] .${P}tcost`)), nb(exp.total));
  assert.match(await page.textContent(rowSel('p4', 1) + ` .${P}name`), /сейчас 19/);
  assert.equal(await page.$$eval(`.${P}list[data-list="research"]`, (e) => e.length), 1);

  // --- reorder: move Metal Mine 24 up, then back
  await page.click(rowSel('p4', 2) + ` .${P}up`);
  await waitStore(env, 'todo.plans', (v) => v.bodies.p4[0].objectId === 1);
  await page.waitForFunction((s) => /Рудник металла, ур\. 24/.test(document.querySelector(s).textContent), rowSel('p4', 1));
  await page.click(rowSel('p4', 1) + ` .${P}down`);
  await waitStore(env, 'todo.plans', (v) => v.bodies.p4[0].objectId === 2);

  // --- «Построить» Crystal Mine 20: confirm, POST body, server message
  env.clearRequests();
  await page.waitForFunction((s) => /Рудник кристалла/.test(document.querySelector(s).textContent), rowSel('p4', 1));
  await page.click(rowSel('p4', 1) + ` .${P}build`);
  await clickOk(page);
  await waitToast(page, /Building construction started\./);
  const posts = env.requests('POST', '/resources/add-buildrequest');
  assert.equal(posts.length, 1);
  assert.deepEqual({ technologyId: form(posts[0]).technologyId, amount: form(posts[0]).amount, mode: form(posts[0]).mode, _token: form(posts[0])._token },
    { technologyId: '2', amount: '1', mode: '1', _token: CSRF });
  const sent = await waitStore(env, 'todo.plans', (v) => v.bodies.p4[0].sentAt > 0);
  assert.equal(sent.bodies.p4.length, 3, 'building item stays until the level is reached');
  await page.waitForFunction((s) => /заказано/.test(document.querySelector(s).textContent), rowSel('p4', 1) + ` .${P}status`);

  // --- error fixture: the server message is shown
  env.setState({ addBuild: 'error' });
  await page.click(rowSel('p4', 2) + ` .${P}build`);
  await clickOk(page);
  await waitToast(page, /Ошибка: Maximum number of items already in queue\./);
  const p2 = env.requests('POST', '/resources/add-buildrequest');
  assert.equal(p2.length, 2);
  assert.equal(form(p2[1]).technologyId, '1');

  // --- cancel in the dialog sends nothing
  env.clearRequests();
  await page.click(rowSel('p4', 3) + ` .${P}build`);
  await page.waitForSelector('.ogx-modal .ogx-modal-buttons .ogx-btn:first-child', { state: 'visible' });
  await page.click('.ogx-modal .ogx-modal-buttons .ogx-btn:first-child');
  await page.waitForTimeout(300);
  assert.equal(env.requests('POST').length, 0);

  // --- remove
  await page.click(rowSel('p4', 3) + ` .${P}del`);
  await waitStore(env, 'todo.plans', (v) => v.bodies.p4.length === 2);

  const j = await journal(env, page);
  for (const want of ['B todo plan:add', 'B todo build', 'B todo plan:move', 'B todo plan:remove', 'U todo plus', 'U todo build']) {
    assert.ok(j.some((x) => x.startsWith(want)), want + ' in ' + JSON.stringify(j));
  }
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('todo: ships from the details panel (#build_amount), unit order removes the item; research list', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion' });
  const page = await env.open('/shipyard');
  await env.waitFor(page, `#technologies li.technology[data-technology="203"] > .${P}plus`);
  // simulate the game's details AJAX render
  const html = T.fixtureJson('buildings-ajax-shipyard-203.json').content.technologydetails;
  await page.evaluate((h) => { document.getElementById('technologydetails_content').innerHTML = h; }, html);
  await env.waitFor(page, `#technologydetails .${P}dplus`);
  // the details wrapper is hidden without the game JS: set the value and click through the DOM
  await page.$eval('#build_amount', (el) => { el.value = '10'; });
  await page.$eval(`#technologydetails .${P}dplus`, (el) => el.click());
  const plans = await waitStore(env, 'todo.plans', (v) => v && v.bodies && v.bodies.p4 && v.bodies.p4.length === 1);
  assert.deepEqual([plans.bodies.p4[0].objectId, plans.bodies.p4[0].amount], [203, 10]);
  // «+» on the list item uses the same amount while the details of 203 are open
  await page.click(`#technologies li.technology[data-technology="203"] > .${P}plus`);
  await waitStore(env, 'todo.plans', (v) => v.bodies.p4.length === 2 && v.bodies.p4[1].amount === 10);
  // «+» on Small Cargo (details of another object open) → 1
  await page.click(`#technologies li.technology[data-technology="202"] > .${P}plus`);
  const p3 = await waitStore(env, 'todo.plans', (v) => v.bodies.p4.length === 3);
  assert.equal(p3.bodies.p4[2].amount, 1);

  await openTab(env, page);
  const exp = await env.evalOgx(page, async () => {
    const c = OGX.calc.unitCost(203, 10);
    return 'М ' + OGX.fmt.num(c.metal) + ' · К ' + OGX.fmt.num(c.crystal);
  }, null, 'infinity');
  assert.equal(nb(await page.textContent(rowSel('p4', 1) + ` .${P}cost`)), nb(exp));
  assert.equal(nb(exp), 'М 60 000 · К 60 000');

  env.clearRequests();
  await page.click(rowSel('p4', 1) + ` .${P}build`);
  await clickOk(page);
  await waitToast(page, /Added to build order\./);
  const posts = env.requests('POST', '/shipyard/add-buildrequest');
  assert.equal(posts.length, 1);
  assert.deepEqual({ technologyId: form(posts[0]).technologyId, amount: form(posts[0]).amount, _token: form(posts[0])._token }, { technologyId: '203', amount: '10', _token: CSRF });
  await waitStore(env, 'todo.plans', (v) => v.bodies.p4.length === 2);

  // --- research: «+» on Plasma (7, 8 running) → 9 in the player-wide list
  await env.open('/research');
  await env.waitFor(page, `#technologies li.technology[data-technology="122"] > .${P}plus`);
  await page.click(`#technologies li.technology[data-technology="122"] > .${P}plus`);
  const pr = await waitStore(env, 'todo.plans', (v) => v.research && v.research.length === 1);
  assert.deepEqual([pr.research[0].objectId, pr.research[0].targetLevel], [122, 9]);
  await openTab(env, page);
  const rexp = await env.evalOgx(page, () => { const c = OGX.calc.cost(122, 9); return 'М ' + OGX.fmt.num(c.metal) + ' · К ' + OGX.fmt.num(c.crystal) + ' · Д ' + OGX.fmt.num(c.deuterium); }, null, 'infinity');
  assert.equal(nb(await page.textContent(rowSel('research', 1) + ` .${P}cost`)), nb(rexp));
  env.clearRequests();
  await page.click(rowSel('research', 1) + ` .${P}build`);
  await clickOk(page);
  await waitToast(page, /Building construction started\./);
  const rp = env.requests('POST', '/research/add-buildrequest');
  assert.equal(rp.length, 1);
  assert.equal(form(rp[0]).technologyId, '122');
  assert.equal(form(rp[0])._token, CSRF);

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('todo: done items removed on visit, ready dot, invalid token message', async () => {
  const seed = { v: 1, bodies: {
    p4: [{ id: 'a', objectId: 2, targetLevel: 19, addedAt: 1 }, { id: 'b', objectId: 202, amount: 1, addedAt: 1 }],
    p7: [{ id: 'c', objectId: 214, amount: 1000, addedAt: 1 }],
  }, research: [{ id: 'r1', objectId: 122, targetLevel: 7, addedAt: 1 }, { id: 'r2', objectId: 122, targetLevel: 9, addedAt: 1 }] };
  const env = await T.launch({ ext: ext(), scenario: 'orion', storage: { '{host}|{pid}|todo.plans': seed } });
  const page = await env.open('/resources');
  const v = await waitStore(env, 'todo.plans', (x) => x && x.bodies.p4 && x.bodies.p4.length === 1);
  assert.equal(v.bodies.p4[0].id, 'b');
  assert.equal(v.research.length, 2, 'research levels unknown before /research');
  await waitToast(page, /выполнено — Рудник кристалла, ур\. 19/);
  // first item of Homeworld (1 small cargo) is affordable → dot; Colony has no resource data → no dot
  await env.waitFor(page, `#planetList .smallplanet[data-planet-id="4"] > .${P}ready`);
  assert.equal(await page.$$eval(`#planetList .${P}ready`, (e) => e.length), 1);

  await env.open('/research');
  const v2 = await waitStore(env, 'todo.plans', (x) => x.research.length === 1);
  assert.equal(v2.research[0].id, 'r2');

  // invalid token answer shows the server message
  await env.open('/resources');
  // item 'b' is a Small Cargo → POST /shipyard/add-buildrequest
  env.server.route('POST', '/shipyard/add-buildrequest', (req, res, ctx) => ctx.json('buildings-addbuildrequest-invalid-token.json'));
  await openTab(env, page);
  await page.click(rowSel('p4', 1) + ` .${P}build`);
  await clickOk(page);
  await waitToast(page, /Ошибка: Invalid token\./);
  const still = await env.get('todo.plans');
  assert.equal(still.bodies.p4.length, 1, 'unit item kept after a failed order');

  // setting off → no dot
  await env.evalOgx(page, () => OGX.settings.set('todo.showReadyDot', false), null, 'infinity');
  await waitStore(env, 'settings', (x) => x && x.todo && x.todo.showReadyDot === false);
  await env.open('/resources');
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval(`#planetList .${P}ready`, (e) => e.length), 0);

  assert.deepEqual(env.ogxErrors(), []);
});

T.test('todo: other body via withPlanet (cp restore) and the add form', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion' });
  const page = await env.open('/resources?cp=7');
  await env.open('/resources?cp=4');
  await openTab(env, page);
  // add Robotics 1.. via the form to Colony (p7)
  await page.selectOption(`.${P}f-list`, 'p7');
  await page.selectOption(`.${P}f-obj`, '14');
  const lvl = await page.inputValue(`.${P}f-val`);
  assert.ok(+lvl >= 1);
  await page.click(`.${P}f-add`);
  const v = await waitStore(env, 'todo.plans', (x) => x && x.bodies && x.bodies.p7 && x.bodies.p7.length === 1);
  assert.deepEqual([v.bodies.p7[0].objectId, v.bodies.p7[0].targetLevel], [14, +lvl]);
  env.clearRequests();
  await page.waitForSelector(rowSel('p7', 1) + ` .${P}build`);
  await page.click(rowSel('p7', 1) + ` .${P}build`);
  await clickOk(page);
  await waitToast(page, /Building construction started\./);
  const post = env.requests('POST', '/facilities/add-buildrequest');
  assert.equal(post.length, 1);
  assert.equal(String(post[0].cp), '7');
  assert.equal(form(post[0]).technologyId, '14');
  const restore = env.requests('GET', '/overview');
  assert.ok(restore.some((r) => String(r.cp) === '4'), 'cp restored to 4: ' + JSON.stringify(restore.map((r) => r.url)));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('todo: IRN lab level honours per-planet requirements; list pages settle (no self-triggered mutations)', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion' });
  const page = await env.open('/resources');
  await env.waitFor(page, `#technologies li.technology[data-technology="2"] > .${P}plus`);
  const lv = await env.evalOgx(page, () => {
    const bodies = {
      p1: { key: 'p1', type: 'planet', levels: { 31: 10 } },
      p2: { key: 'p2', type: 'planet', levels: { 31: 6 } },
      p3: { key: 'p3', type: 'planet', levels: { 31: 5 } },
      p4: { key: 'p4', type: 'planet' }, // levels unknown → does not qualify
    };
    const research = { levels: { 123: 1 } };
    const f = OGX.todo._test.labLevel;
    return { hyper: f(bodies, research, bodies.p1, 114), energy: f(bodies, research, bodies.p1, 113),
      noIrn: f(bodies, { levels: {} }, bodies.p1, 113),
      hyper8: f(Object.assign({}, bodies, { p2: { key: 'p2', type: 'planet', levels: { 31: 8 } } }), research, bodies.p1, 114) };
  }, null, 'infinity');
  // hyperspace tech (114) needs research_lab 7 on the planet: labs 6/5 do not count (OgameX ObjectService::objectRequirementsMet)
  assert.equal(lv.hyper, 10);
  assert.equal(lv.hyper8, 18);
  // energy tech (113) needs research_lab 1: the best other lab joins with IRN 1
  assert.equal(lv.energy, 16);
  assert.equal(lv.noIrn, 10);

  // the «+» decoration must not re-trigger itself: count mutations under #technologies after the page settled
  for (const url of ['/resources', '/research', '/shipyard']) {
    const pg = await env.open(url);
    await env.waitFor(pg, `#technologies li.technology > .${P}plus`);
    await pg.waitForTimeout(1000);
    // one foreign mutation (like the game's countdown) kicks the module observer once; it must not keep itself running
    await pg.evaluate(() => { document.querySelector('#technologies li.technology').appendChild(document.createElement('i')); });
    await pg.waitForTimeout(800);
    const n = await pg.evaluate((pfx) => new Promise((res) => {
      let c = 0;
      const box = document.getElementById('technologies');
      const mo = new MutationObserver((ms) => { for (const m of ms) if (m.target.closest && m.target.closest('.' + pfx + 'plus')) c++; });
      mo.observe(box, { childList: true, subtree: true, attributes: true, characterData: true });
      setTimeout(() => { mo.disconnect(); res(c); }, 2500);
    }), P);
    assert.equal(n, 0, url + ': «+» buttons rewritten ' + n + ' times while idle');
  }
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('todo: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion' });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
});
