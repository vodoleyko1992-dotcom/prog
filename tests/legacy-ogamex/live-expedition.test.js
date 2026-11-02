'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// live/expedition: random expedition button + expedition max find (DESIGN §4.1.6, OL rows 16-17).
//   node tests/legacy-ogamex/live-expedition.test.js
// Uses ogamex-live (manifest) when it lists the module, otherwise a throw-away extension with the real shared core
// + this module (tests/core-ext.js).
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD = path.join(ROOT, 'ogamex-live', 'modules', 'expedition', 'expedition.js');

function ext() {
  const mf = path.join(ROOT, 'ogamex-live', 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if ((m.content_scripts || []).some((cs) => (cs.js || []).includes('modules/expedition/expedition.js'))) return 'live';
  } catch (e) { /* no manifest yet */ }
  return coreExt({ name: 'live', modules: { expedition: fs.readFileSync(MOD, 'utf8') } });
}

const P = '.ogx-l-expedition-';
const NB = ' ';
const ru = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const expected = T.fixtureJson('ogamelive-expected-parse.json');

async function mandatory(env) {
  assert.deepEqual(env.ogxErrors().map((l) => l.text), [], 'no [OGX errors');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), [], 'no unhandled requests');
}

async function rowTexts(page, box, key) {
  return page.$$eval(`${box} ${P}row-${key} td`, (tds) => tds.map((td) => td.textContent.trim()));
}

async function waitText(page, sel, re, timeout = 8000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeout) {
    last = await page.$$eval(sel, (e) => (e[0] ? e[0].textContent : '')).catch(() => '');
    if (re.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`timeout waiting for ${sel} ~ ${re}; last: ${last}`);
}

async function waitCall(env, page, method, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const calls = await env.stubCalls(page);
    if (calls.some((c) => c.method === method)) return calls;
    await page.waitForTimeout(100);
  }
  throw new Error('timeout waiting for fleetDispatcher.' + method + ': ' + JSON.stringify(await env.stubCalls(page)));
}

T.test('expedition: info box with max find from the mock highscore (Collector), override, selection coverage, slots', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/fleet');
  await env.waitFor(page, '#fleet1 ' + P + 'box1 ' + P + 'table');
  await env.waitFor(page, '#fleet2 ' + P + 'box2');

  // top score came from POST /ajax/highscore page 1 (rank 1 "Bolt" 1,284,330) -> base 1 800 000 for a Collector
  const hs = env.requests('POST', '/ajax/highscore');
  assert.equal(hs.length, 1, 'one highscore request');
  assert.equal(String(hs[0].form.type || hs[0].query.type), '0');
  assert.match(await page.textContent('#fleet1 ' + P + 'top'), new RegExp('^1' + NB + '284' + NB + '330 \\(статистика'));
  const pc = await env.evalOgx(page, async () => (await OGX.state.player()).playerClass);
  assert.equal(pc, 'miner');

  const B1 = '#fleet1 ' + P + 'box1';
  const stats = await env.evalOgx(page, async () => { const s = await OGX.state.shipStats(); return { lc: s[203].cargo, ts: s[217].cargo, tsName: OGX.catalog.shortName(217) }; });
  assert.ok(stats.lc > 0 && stats.ts > 0, JSON.stringify(stats));
  // the minimum is counted in Battle Transporters (217) only
  const minShips = (m) => ru(Math.ceil(m / stats.ts));
  assert.match(await page.textContent(B1 + ' thead'), new RegExp('Мин\\. ' + stats.tsName.replace(/\./g, '\\.') + '$'));
  assert.deepEqual(await rowTexts(page, B1, 'normal'), ['Обычная', ru(1800000), ru(1200000), ru(600000), minShips(1800000)]);
  assert.deepEqual(await rowTexts(page, B1, 'rare'), ['Редкая', ru(5400000), ru(3600000), ru(1800000), minShips(5400000)]);
  assert.deepEqual(await rowTexts(page, B1, 'exceptional'), ['Исключительная', ru(18000000), ru(12000000), ru(6000000), minShips(18000000)]);
  // (the lanedirt find is module-local since the core calc.expeditionMaxFind follows 2Moons: the rows above check it)

  // expedition slots from #fleet1 #slots ("Expeditions: 1/2")
  assert.match(await page.textContent(B1 + ' ' + P + 'slots'), /Слоты экспедиций: 1\/2/);
  assert.match(await page.textContent(B1 + ' ' + P + 'cover'), /Выберите корабли/);

  // override top points: rank-1 points of the page-2 fixture (21 339) -> ogamelive-expected-parse.json expedition[0]
  const exp0 = expected.expedition[0];
  assert.equal(expected.topScorePage2.points, 21339);
  await page.fill(B1 + ' ' + P + 'topinput', '21339');
  await page.press(B1 + ' ' + P + 'topinput', 'Enter');
  await waitText(page, B1 + ' ' + P + 'top', /вручную/);
  assert.deepEqual((await rowTexts(page, B1, 'normal')).slice(1, 4), [ru(exp0.metal), ru(exp0.crystal), ru(exp0.deuterium)]);
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('expedition.topPointsOverride')), 21339);
  assert.equal(await env.get('settings').then((s) => s.expedition.topPointsOverride), 21339);
  // the #fleet2 box follows
  await waitText(page, '#fleet2 ' + P + 'top', /вручную/);
  assert.equal((await rowTexts(page, '#fleet2 ' + P + 'box2', 'normal'))[1], ru(exp0.metal));

  // selection: 18 LC (all on the planet) vs 500 000 metal
  await page.fill('#fleet1 li[data-technology="203"] input', '18');
  const need = exp0.metal;
  const cargo = 18 * stats.lc;
  const covers = cargo >= need;
  const txt = await waitText(page, B1 + ' ' + P + 'cover', /Грузоподъёмность/);
  assert.ok(txt.includes(ru(cargo)), txt);
  assert.match(txt, covers ? /хватает для обычной/ : /не хватает/);
  // 2 LC: never enough
  await page.fill('#fleet1 li[data-technology="203"] input', '2');
  // 18 LC may already be short: wait for the 2-LC deficit, not just any «не хватает»
  const txt2 = await waitText(page, B1 + ' ' + P + 'cover', new RegExp('не хватает ' + ru(need - 2 * stats.lc)));
  assert.ok(txt2.includes('не хватает ' + ru(need - 2 * stats.lc)), txt2);
  assert.ok(txt2.includes('ещё ' + ru(Math.ceil((need - 2 * stats.lc) / stats.ts)) + ' ' + stats.tsName), txt2);

  // diagnostics: U events for our inputs
  await env.evalOgx(page, () => OGX.diag.flush());
  const ev = await env.evalOgx(page, () => OGX.diag.recent({ s: 'U' }).map((e) => e.k + ' ' + e.w));
  assert.ok(ev.some((e) => /topOverride|change/.test(e)), JSON.stringify(ev));
  await mandatory(env);
});

T.test('expedition: button sets random target within ±5, mission 15, duration, speed; no submit by default', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'expedition.randomSystems': 5 } });
  const page = await env.open('/fleet');
  await env.waitFor(page, '#fleet2 #target .coords ' + P + 'btn');
  assert.equal(await page.inputValue(P + 'rand'), '5');
  assert.match(await page.textContent(P + 'btninfo'), /1 ч, 100%/);
  await env.pageStub(page, 'fleetDispatcher', { currentPage: 'fleet2', shipsToSend: [{ id: 203, number: 5 }], targetPlanet: { galaxy: 1, system: 42, position: 8, type: 1 } });
  await page.evaluate(() => { document.getElementById('fleet2').style.display = 'block'; document.getElementById('fleet1').style.display = 'none'; });
  env.clearRequests();

  const systems = new Set();
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => { window.__ogxStubCalls = []; });
    await page.click(P + 'btn');
    const calls = await waitCall(env, page, 'setFleetPercent');
    const fd = await page.evaluate(() => ({ t: window.fleetDispatcher.targetPlanet, e: window.fleetDispatcher.expeditionTime }));
    assert.equal(fd.t.galaxy, 1);
    assert.equal(fd.t.position, 16);
    assert.equal(fd.t.type, 1);
    assert.ok(fd.t.system >= 37 && fd.t.system <= 47, 'system ' + fd.t.system);
    systems.add(fd.t.system);
    assert.equal(fd.e, 1);
    const names = calls.map((c) => c.method);
    assert.ok(names.includes('updateTarget'), names.join(','));
    assert.deepEqual(calls.find((c) => c.method === 'selectMission').args, [15]);
    assert.deepEqual(calls.find((c) => c.method === 'setFleetPercent').args, [10]);
    assert.ok(names.indexOf('selectMission') < names.indexOf('setFleetPercent'));
    assert.ok(!names.includes('trySubmitFleet2'), 'no submit with autoSubmit off');
    assert.ok(!names.includes('switchToPage'), 'already on step 2');
    await page.waitForTimeout(50);
  }
  assert.ok(systems.size >= 2, 'random systems ' + [...systems]);

  // wrap: offset -99 from system 42 -> 442 (1..499)
  await page.fill(P + 'rand', '99');
  await page.press(P + 'rand', 'Tab');
  await env.evalOgx(page, () => { Math.random = () => 0; });
  await page.evaluate(() => { window.__ogxStubCalls = []; });
  await page.click(P + 'btn');
  await waitCall(env, page, 'setFleetPercent');
  assert.equal(await page.evaluate(() => window.fleetDispatcher.targetPlanet.system), 442);
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('expedition.randomSystems')), 99);

  await page.waitForTimeout(400);
  assert.deepEqual(env.requests('POST', '/ajax/fleet/dispatch/send-fleet').length, 0, 'no send-fleet request');
  // B events recorded through OGX.log.wrap
  await env.evalOgx(page, () => OGX.diag.flush());
  const b = await env.evalOgx(page, () => OGX.diag.recent({ s: 'B' }).filter((e) => e.k === 'expedition').map((e) => e.w));
  assert.ok(b.includes('randomExpedition') && b.includes('random-target'), JSON.stringify(b));
  const u = await env.evalOgx(page, () => OGX.diag.recent({ s: 'U' }).map((e) => e.w));
  assert.ok(u.some((w) => /expedition:random/.test(w)), JSON.stringify(u));
  await mandatory(env);
});

T.test('expedition: remembers duration/speed from a game expedition send; autoSubmit submits', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'expedition.autoSubmit': true } });
  const page = await env.open('/fleet');
  await env.waitFor(page, P + 'btn');
  const token = await page.getAttribute('meta[name="csrf-token"]', 'content');
  // the game's own send (jQuery $.post = XHR), relayed by the page hook
  const body = await page.evaluate((tok) => new Promise((res) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/ajax/fleet/dispatch/send-fleet');
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    x.onload = () => res(x.responseText);
    x.send('_token=' + tok + '&am203=5&galaxy=1&system=40&position=16&type=1&mission=15&speed=7&holdingtime=3&union=0');
  }), token);
  assert.match(body, /"success":true/);
  await waitText(page, P + 'btninfo', /3 ч, 70%/);
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('expedition.rememberedDuration')), 3);
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('expedition.rememberedSpeed')), 7);

  // a non-expedition send does not change it
  await page.evaluate((tok) => new Promise((res) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/ajax/fleet/dispatch/send-fleet');
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.onload = () => res(x.responseText);
    x.send('_token=' + tok + '&am203=5&galaxy=1&system=40&position=7&type=1&mission=3&speed=5&holdingtime=0');
  }), token);
  await page.waitForTimeout(500);
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('expedition.rememberedSpeed')), 7);

  await env.pageStub(page, 'fleetDispatcher', { currentPage: 'fleet2', shipsToSend: [{ id: 203, number: 5 }] });
  await page.evaluate(() => { document.getElementById('fleet2').style.display = 'block'; });
  await page.click(P + 'btn');
  const calls = await waitCall(env, page, 'trySubmitFleet2');
  assert.deepEqual(calls.find((c) => c.method === 'setFleetPercent').args, [7]);
  assert.equal(await page.evaluate(() => window.fleetDispatcher.expeditionTime), 3);
  assert.equal(await page.evaluate(() => window.fleetDispatcher.targetPlanet.system), 42, 'randomSystems 0 -> own system');
  await mandatory(env);
});

T.test('expedition: moon without ships, overview and non-OgameX pages stay clean', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/fleet?cp=5');                    // fleet-dispatch-noships
  await env.waitFor(page, '#fleet1 ' + P + 'box1');
  assert.equal(await page.$$eval(P + 'box1', (e) => e.length), 1);
  await env.open('/overview');
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('[class*="ogx-l-expedition"]', (e) => e.length), 0);
  await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  await mandatory(env);
});
