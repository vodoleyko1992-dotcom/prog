'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// live/planetbar: production overlay in the planet list (DESIGN §4.1.2).
//   node tests/legacy-ogamex/live-planetbar.test.js
// Uses ogamex-live (manifest) when it lists the module, otherwise a throw-away extension with the real shared core
// + this module (tests/core-ext.js), which has the same manifest shape.
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD = path.join(ROOT, 'ogamex-live', 'modules', 'planetbar', 'planetbar.js');

function ext() {
  const mf = path.join(ROOT, 'ogamex-live', 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if ((m.content_scripts || []).some((cs) => (cs.js || []).includes('modules/planetbar/planetbar.js'))) return 'live';
  } catch (e) { /* no manifest yet */ }
  return coreExt({ name: 'live', modules: { planetbar: fs.readFileSync(MOD, 'utf8') } });
}

const P = '.ogx-l-planetbar-';
const num = (s) => +String(s || '').replace(/[^\d-]/g, '');
const visible = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null && getComputedStyle(e).display !== 'none').length);

async function mandatory(env) {
  assert.deepEqual(env.ogxErrors(), [], 'no [OGX errors');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), [], 'no unhandled requests');
}

T.test('planetbar: overlay on /overview (vega), live stock, tooltip, energy, build flag, ships after /fleet', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  await env.waitFor(page, '#planetList ' + P + 'prod');

  // exactly one overlay per row
  const perRow = await page.$$eval('#planetList > .smallplanet', (rows) => rows.map((r) => r.querySelectorAll('.ogx-l-planetbar-prod').length));
  assert.deepEqual(perRow, [1, 1]);

  // current planet 1: metal ≈ 152,347 (inline reloadResources), growing with 4,128/h
  const metalSel = '#planet-1 .ogx-l-planetbar-planet .ogx-l-planetbar-r-metal.ogx-l-planetbar-stock';
  const m1 = num(await page.textContent(metalSel + ' .ogx-l-planetbar-val'));
  assert.ok(m1 >= 152347 && m1 < 152347 + 30, 'metal ' + m1);
  await page.waitForTimeout(2200);
  const m2 = num(await page.textContent(metalSel + ' .ogx-l-planetbar-val'));
  assert.ok(m2 > m1, `metal grows ${m1} -> ${m2}`);
  const crystal = num(await page.textContent('#planet-1 .ogx-l-planetbar-planet .ogx-l-planetbar-r-crystal.ogx-l-planetbar-stock .ogx-l-planetbar-val'));
  assert.ok(crystal >= 98712 && crystal < 98712 + 30, 'crystal ' + crystal);

  // tooltip: capacity + time until full; computed by calc.secondsUntilFull
  const tip = await page.getAttribute(metalSel, 'title');
  assert.match(tip, /Ёмкость: 255\u00a0000/);
  assert.match(tip, /заполнится через (\d+д )?\d+:\d\d:\d\d/);
  // (255000-152347)/4128 h ≈ 24.87 h -> "1д 00:52:.." ; check the hour part from the formula
  assert.ok(tip.includes('заполнится через 1д 00:5'), tip);
  // fill: 60% -> ok
  assert.match(await page.getAttribute(metalSel, 'class'), /ogx-l-planetbar-ok/);
  // fill bar width ≈ 59.7%
  const w = await page.$eval(metalSel + ' .ogx-l-planetbar-fill', (e) => parseFloat(e.style.width));
  assert.ok(Math.abs(w - 59.7) < 0.3, 'width ' + w);

  // rate +4 128/ч
  const rates = await page.$$eval('#planet-1 .ogx-l-planetbar-planet .ogx-l-planetbar-rate', (els) => els.map((e) => e.textContent));
  assert.deepEqual(rates, ['+4\u00a0128/ч', '+2\u00a0187/ч', '+1\u00a0042/ч']);

  // energy: available 106 of 2,860, consumption 2,754 -> 96% used -> warn (<= 5% left)
  const eTxt = await page.textContent('#planet-1 .ogx-l-planetbar-planet .ogx-l-planetbar-energy .ogx-l-planetbar-val');
  assert.equal(eTxt, '+106');
  const eCls = await page.getAttribute('#planet-1 .ogx-l-planetbar-planet .ogx-l-planetbar-energy', 'class');
  assert.match(eCls, /ogx-l-planetbar-warn/);

  // Σ
  const sum = num(await page.textContent('#planet-1 .ogx-l-planetbar-planet .ogx-l-planetbar-sum'));
  assert.ok(sum >= 152347 + 98712 + 41230 && sum < 152347 + 98712 + 41230 + 60, 'sum ' + sum);

  // needed SC/LC without fleet data: owned unknown
  const needBefore = await page.$$eval('#planet-1 .ogx-l-planetbar-planet .ogx-l-planetbar-need', (els) => els.map((e) => e.textContent));
  assert.equal(needBefore.length, 2);
  assert.match(needBefore[1], /^БТ \?\/\d+$/);

  // planet 3 (Colony): no resource data yet, wrench in the list without queue -> stale build note
  assert.equal(await page.textContent('#planet-2 .ogx-l-planetbar-planet .ogx-l-planetbar-muted'), 'нет данных');
  assert.equal(await page.textContent('#planet-2 .ogx-l-planetbar-planet .ogx-l-planetbar-stale'), 'строится (данные устарели)');
  // no stationed-ships bar before /fleet
  assert.equal(await page.$$eval('#planetList .ogx-l-planetbar-ships', (e) => e.length), 0);

  // switcher exists in #countColonies
  assert.equal(await page.$$eval('#countColonies .ogx-l-planetbar-switch-btn', (e) => e.length), 2);

  // B 'render' events are journaled
  const rec = await env.evalOgx(page, () => OGX.diag.recent({ s: 'B', k: 'planetbar' }).map((e) => e.w));
  assert.ok(rec.includes('render'), JSON.stringify(rec));

  // visit /fleet: ships on planet 1 (LC 18, SC 25) -> owned/needed
  await env.open('/fleet');
  await env.waitFor(page, '#planetList ' + P + 'prod');
  await env.open('/overview');
  await env.waitFor(page, '#planet-1 .ogx-l-planetbar-need');
  await page.waitForTimeout(300);
  const exp = await env.evalOgx(page, async () => {
    const st = await OGX.state.shipStats();
    const b = await OGX.state.body('p1');
    const pr = OGX.state.projected(b, OGX.time.serverNow());
    const s = pr.res.metal.amount + pr.res.crystal.amount + pr.res.deuterium.amount;
    return { lc: Math.ceil(s / st[203].cargo), sc: Math.ceil(s / st[202].cargo), ships: b.ships };
  });
  const need = await page.$$eval('#planet-1 .ogx-l-planetbar-planet .ogx-l-planetbar-need', (els) => els.map((e) => ({ t: e.textContent, c: e.className })));
  assert.equal(need[0].t, 'МТ 25/' + exp.sc.toLocaleString('ru-RU').replace(/\s/g, '\u00a0'));
  assert.equal(need[1].t, 'БТ 18/' + exp.lc.toLocaleString('ru-RU').replace(/\s/g, '\u00a0'));
  assert.match(need[0].c, 25 < exp.sc ? /ogx-l-planetbar-bad/ : /ogx-l-planetbar-ok/);
  // stationed-ships bar on planet 1 (largest -> 100%, red)
  const bar = await page.$eval('#planet-1 a.planetlink .ogx-l-planetbar-ships', (e) => ({ n: e.dataset.ships, w: e.firstChild.style.width, c: e.firstChild.className }));
  const totalShips = Object.entries(exp.ships).filter(([id]) => id !== '212' && id !== '217').reduce((a, [, n]) => a + n, 0);
  assert.equal(+bar.n, totalShips);
  assert.equal(parseFloat(bar.w), 100);
  assert.match(bar.c, /ogx-l-planetbar-bad/);
  await mandatory(env);
});

T.test('planetbar: planets/moons switcher, moon part, auto moon view, persisted view', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  await env.waitFor(page, '#planetList ' + P + 'prod');
  assert.equal(await visible(page, '#planet-1 .ogx-l-planetbar-planet'), 1);
  assert.equal(await visible(page, '#planet-1 .ogx-l-planetbar-moon'), 0);

  await page.click('#countColonies [data-view="moons"]');
  await page.waitForTimeout(400);
  assert.equal(await page.$eval('#planetList', (e) => e.classList.contains('ogx-l-planetbar-moons')), true);
  assert.equal(await visible(page, '#planet-1 .ogx-l-planetbar-moon'), 1);
  assert.equal(await visible(page, '#planet-1 .ogx-l-planetbar-planet'), 0);
  assert.equal(await page.textContent('#planet-1 .ogx-l-planetbar-moon .ogx-l-planetbar-muted'), 'луна: нет данных');
  assert.equal(await page.textContent('#planet-2 .ogx-l-planetbar-moon'), 'нет луны');
  const st = await env.get('settings');
  assert.equal(st.planetbar.view, 'moons');
  // U click + B setView journaled
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => (e.s === 'U' && e.d && e.d.mod === 'live/planetbar') || (e.s === 'B' && e.k === 'planetbar' && e.w === 'setView')).map((e) => e.s + ':' + e.w));
  assert.ok(ev.includes('U:planetbar:view-moons'), JSON.stringify(ev));
  assert.ok(ev.includes('B:setView'), JSON.stringify(ev));

  // back to planets, then open the moon: auto moon view
  await page.click('#countColonies [data-view="planets"]');
  await page.waitForTimeout(400);
  assert.equal((await env.get('settings')).planetbar.view, 'planets');
  await env.open('/overview?cp=5');
  await env.waitFor(page, '#planetList ' + P + 'moon ' + P + 'stock');
  assert.equal(await page.$eval('#planetList', (e) => e.classList.contains('ogx-l-planetbar-moons')), true);
  // moon stock: metal 12,500 over 10,000 storage -> bad, 100% width; crystal 8,300 -> ok
  const mm = '#planet-1 .ogx-l-planetbar-moon .ogx-l-planetbar-r-metal.ogx-l-planetbar-stock';
  assert.equal(num(await page.textContent(mm + ' .ogx-l-planetbar-val')), 12500);
  assert.match(await page.getAttribute(mm, 'class'), /ogx-l-planetbar-bad/);
  assert.match(await page.getAttribute(mm, 'title'), /хранилище заполнено \(сверх ёмкости на 2\u00a0500\)/);
  assert.equal(await page.$eval(mm + ' .ogx-l-planetbar-fill', (e) => parseFloat(e.style.width)), 100);
  const mc = '#planet-1 .ogx-l-planetbar-moon .ogx-l-planetbar-r-crystal.ogx-l-planetbar-stock';
  assert.equal(num(await page.textContent(mc + ' .ogx-l-planetbar-val')), 8300);
  assert.match(await page.getAttribute(mc, 'class'), /ogx-l-planetbar-ok/);
  // moons show no rates
  assert.equal(await page.$$eval('#planet-1 .ogx-l-planetbar-moon .ogx-l-planetbar-rate', (e) => e.length), 0);
  await mandatory(env);
});

T.test('planetbar: compact layout (6 planets): one-line variant, row height unchanged', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'compact' });
  const page = await env.open('/overview');
  await env.waitFor(page, '#planetList ' + P + 'prod');
  const rows = await page.$$eval('#planetList > .smallplanet', (rs) => rs.map((r) => ({ n: r.querySelectorAll('.ogx-l-planetbar-prod').length, h: r.getBoundingClientRect().height })));
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r.n), [1, 1, 1, 1, 1, 1]);
  assert.equal(await page.$$eval('#planetList .ogx-l-planetbar-compact', (e) => e.length), 6);
  // one line per part: overlay at most ~2 lines high, never taller than the row
  const hs = await page.$$eval('#planetList .ogx-l-planetbar-prod', (els) => els.map((e) => e.getBoundingClientRect().height));
  rows.forEach((r, i) => assert.ok(hs[i] <= r.h, `overlay ${hs[i]} <= row ${r.h}`));
  // current planet 3 shows its stock in the single line (3 values)
  const vals = await page.$$eval('.smallplanet[data-planet-id="3"] .ogx-l-planetbar-planet .ogx-l-planetbar-oneline .ogx-l-planetbar-val', (e) => e.map((x) => x.textContent));
  assert.equal(vals.length, 3);
  assert.ok(vals.every((v) => /\d/.test(v)), vals.join('|'));
  await env.screenshot(page, 'live-planetbar-compact');
  // row heights do not depend on the overlay
  const before = rows.map((r) => r.h);
  await page.evaluate(() => document.querySelectorAll('.ogx-l-planetbar-prod').forEach((e) => e.remove()));
  const after = await page.$$eval('#planetList > .smallplanet', (rs) => rs.map((r) => r.getBoundingClientRect().height));
  before.forEach((h, i) => assert.ok(Math.abs(h - after[i]) <= 2, `row ${i}: ${h} vs ${after[i]}`));
  await mandatory(env);
});

T.test('planetbar: orion build timer, fusion warning, raider style, daily rates, rounding', async () => {
  // seeded fusion percent 60 (as if /resources/settings had been visited) on planet 4
  const env = await T.launch({
    ext: ext(), scenario: 'orion',
    settings: { 'planetbar.prodDisplay': 'day', 'planetbar.roundNumbers': true },
    storage: { '{host}|{pid}|bodies': { p4: { key: 'p4', id: 4, type: 'planet', percents: { 1: 100, 2: 60, 3: 30, 12: 60 }, percentsT: 1, levels: { 12: 8 }, levelsT: {} } } },
  });
  const page = await env.open('/overview');
  await env.waitFor(page, '#planetList ' + P + 'build');
  const build = await page.textContent('.smallplanet[data-planet-id="4"] .ogx-l-planetbar-planet .ogx-l-planetbar-build');
  assert.match(build, /^Рудник металла 23\d:\d\d:\d\d$/, build);   // name + target level + countdown (3:53:04)
  const cd = await page.textContent('.smallplanet[data-planet-id="4"] .ogx-l-planetbar-build .ogx-countdown');
  assert.match(cd, /^3:5\d:\d\d$/, cd);
  const fusion = await page.$eval('.smallplanet[data-planet-id="4"] .ogx-l-planetbar-fusion', (e) => ({ t: e.textContent, c: e.className }));
  assert.equal(fusion.t, 'термояд 60%');
  assert.match(fusion.c, /ogx-l-planetbar-warn/);
  const rates = await page.$$eval('.smallplanet[data-planet-id="4"] .ogx-l-planetbar-planet .ogx-l-planetbar-rate', (els) => els.map((e) => ({ t: e.textContent, c: e.className })));
  assert.equal(rates.length, 3);
  assert.ok(rates.every((r) => /\/сут$/.test(r.t)), JSON.stringify(rates));
  assert.match(rates[1].c, /ogx-l-planetbar-warn/, 'crystal mine 60%');
  assert.match(rates[2].c, /ogx-l-planetbar-bad/, 'deuterium synth 30%');
  const exp = await env.evalOgx(page, async () => { const b = await OGX.state.body('p4'); return b.res.metal.perHour * 24; });
  const shortExp = await env.evalOgx(page, (n) => '+' + OGX.fmt.short(n) + '/сут', exp);
  assert.equal(rates[0].t, shortExp);

  // raider: only stocks, planet and moon side by side
  await env.evalOgx(page, () => OGX.settings.set('planetbar.gameStyle', 'raider'));
  await page.waitForFunction(() => document.querySelectorAll('.ogx-l-planetbar-raider').length === 2);
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('#planetList .ogx-l-planetbar-rate, #planetList .ogx-l-planetbar-energy, #planetList .ogx-l-planetbar-sum, #planetList .ogx-l-planetbar-build', (e) => e.length), 0);
  assert.equal(await visible(page, '.smallplanet[data-planet-id="4"] .ogx-l-planetbar-moon'), 1);
  assert.equal(await visible(page, '.smallplanet[data-planet-id="4"] .ogx-l-planetbar-planet'), 1);
  assert.equal(await page.$$eval('#planetList > .smallplanet', (rs) => rs.map((r) => r.querySelectorAll('.ogx-l-planetbar-prod').length).join(',')), '1,1');
  await env.screenshot(page, 'live-planetbar-raider');
  await mandatory(env);
});

T.test('planetbar: disabled -> nothing injected', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'planetbar.enabled': false } });
  const page = await env.open('/overview');
  await page.waitForTimeout(500);
  assert.equal(await page.$$eval('[class*="ogx-l-planetbar"]', (e) => e.length), 0);
  assert.equal(await page.$$eval('#ogx-l-planetbar', (e) => e.length), 0);
  await mandatory(env);
});

T.test('planetbar: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  env.clearRequests();
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"], [id^="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.requests().map((r) => r.path), ['/not-ogame']);
  await mandatory(env);
});
