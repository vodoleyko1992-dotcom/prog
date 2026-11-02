'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// live/fleetinfo: selected-fleet table after #allornone, speed badges and ship stats tooltip (DESIGN §4.1.5, OL rows 14-15).
//   node tests/legacy-ogamex/live-fleetinfo.test.js
// Uses ogamex-live (manifest) when it lists the module, otherwise a throw-away extension with the real shared core
// + this module (tests/core-ext.js), which has the same manifest shape.
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD = path.join(ROOT, 'ogamex-live', 'modules', 'fleetinfo', 'fleetinfo.js');

function ext() {
  const mf = path.join(ROOT, 'ogamex-live', 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if ((m.content_scripts || []).some((cs) => (cs.js || []).includes('modules/fleetinfo/fleetinfo.js'))) return 'live';
  } catch (e) { /* no manifest yet */ }
  return coreExt({ name: 'live', modules: { fleetinfo: fs.readFileSync(MOD, 'utf8') } });
}

const BOX = '#ogx-l-fleetinfo';
const cell = (page, key) => page.textContent(`${BOX} .ogx-l-fleetinfo-row-${key} td`);
const rowHidden = (page, key) => page.$eval(`${BOX} .ogx-l-fleetinfo-row-${key}`, (tr) => tr.hidden);

async function mandatory(env) {
  assert.deepEqual(env.ogxErrors(), [], 'no [OGX errors');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), [], 'no unhandled requests');
}

/** Types into a ship input the way a player does (fill = input event, then keyup + focusout like the game listens to). */
async function typeShips(page, id, n) {
  const sel = `#fleet1 li[data-technology="${id}"] input[type=text]`;
  await page.fill(sel, String(n));
  await page.dispatchEvent(sel, 'keyup');
  await page.dispatchEvent(sel, 'focusout');
}

/** A check-target XHR from the page world (what the game's FleetDispatcher.fetchTargetPlayerData does). */
async function checkTargetXhr(page, form) {
  return page.evaluate((f) => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/ajax/fleet/dispatch/check-target');
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    x.setRequestHeader('X-CSRF-TOKEN', document.querySelector('meta[name="csrf-token"]').content);
    x.onload = () => resolve(x.status);
    x.onerror = () => resolve(0);
    x.send(new URLSearchParams(f).toString());
  }), form);
}

async function waitText(page, key, expected, timeout = 5000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await cell(page, key);
    if (last === expected) return last;
    await page.waitForTimeout(100);
  }
  assert.equal(last, expected, `cell ${key}`);
  return last;
}

T.test('fleetinfo: badges on every ship, selection table, tooltip, check-target refresh, collapse', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/fleet?cp=1');
  await env.waitFor(page, BOX);
  await env.waitFor(page, '#fleet1 .ogx-l-fleetinfo-speed');

  // table right after #allornone
  assert.equal(await page.$eval(BOX, (el) => el.previousElementSibling && el.previousElementSibling.id), 'allornone');

  // one badge per ship li, with the speed from state.shipStats
  const perItem = await page.$$eval('#fleet1 #technologies li.technology[data-technology]', (lis) => lis.map((li) => li.querySelectorAll('.icon .ogx-l-fleetinfo-speed').length));
  assert.ok(perItem.length >= 10, 'ships listed: ' + perItem.length);
  assert.deepEqual(perItem, perItem.map(() => 1));
  const stats = await env.evalOgx(page, () => OGX.state.shipStats());
  assert.ok(stats[203] && stats[203].cargo > 0 && stats[203].speed > 0, JSON.stringify(stats[203]));
  const num = (n) => n.toLocaleString('ru-RU').replace(/\s/g, '\u00a0');
  assert.equal(await page.getAttribute('li[data-technology="203"] .ogx-l-fleetinfo-speed', 'title'), 'Скорость: ' + num(stats[203].speed));

  // nothing selected yet
  assert.equal(await cell(page, 'count'), '—');
  assert.equal(await rowHidden(page, 'target'), true);
  assert.ok((await cell(page, 'hint')).startsWith('Выберите корабли'));

  // 10 large cargo -> cargo total = 10 × shipStats[203].cargo
  await typeShips(page, 203, 10);
  await waitText(page, 'cargo', num(10 * stats[203].cargo));
  assert.equal(await cell(page, 'count'), '10 (1 тип)');
  assert.equal(await cell(page, 'speed'), `${num(stats[203].speed)} (Большой транспорт)`);
  assert.ok((await cell(page, 'hint')).startsWith('Цель не задана'));

  // + 5 light fighters: sum of cargo, slowest speed
  await typeShips(page, 204, 5);
  const cargo2 = Math.floor(10 * stats[203].cargo + 5 * stats[204].cargo);
  await waitText(page, 'cargo', num(cargo2));
  assert.equal(await cell(page, 'count'), '15 (2 типа)');
  const slow = stats[204].speed < stats[203].speed ? [204, 'Лёгкий истребитель'] : [203, 'Большой транспорт'];
  const slowName = await env.evalOgx(page, (id) => OGX.catalog.name(id), slow[0]);
  assert.equal(await cell(page, 'speed'), `${num(stats[slow[0]].speed)} (${slowName})`);

  // more than on the planet (18 LC): clamped
  await typeShips(page, 203, 999);
  await waitText(page, 'cargo', num(Math.floor(18 * stats[203].cargo + 5 * stats[204].cargo)));
  await typeShips(page, 204, 0);
  await waitText(page, 'cargo', num(18 * stats[203].cargo));

  // tooltip on the icon: speed, cargo, fuel, structure, shield, attack
  await page.hover('li[data-technology="203"] span.icon');
  await env.waitFor(page, '.ogx-tooltip .ogx-l-fleetinfo-tip');
  const tip = await page.textContent('.ogx-tooltip');
  const lc = await env.evalOgx(page, () => OGX.catalog.get(203).props);
  for (const s of ['Большой транспорт', 'Скорость' + num(stats[203].speed), 'Грузоподъёмность' + num(stats[203].cargo),
    'Расход топлива' + num(stats[203].fuelConsumption), 'Структура' + num(lc.structural), 'Щиты' + num(lc.shield), 'Атака' + num(lc.attack)]) {
    assert.ok(tip.includes(s), `tooltip has "${s}": ${tip}`);
  }
  await page.mouse.move(0, 0);

  // a check-target seen in the page refreshes shipStats (core) and our badges/table (fleet-check-target-player.json)
  const ct = T.fixtureJson('fleet-check-target-player.json').shipsData;
  assert.equal(await checkTargetXhr(page, { galaxy: 1, system: 45, position: 6, type: 1, am203: 10, union: 0 }), 200);
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    if ((await page.getAttribute('li[data-technology="203"] .ogx-l-fleetinfo-speed', 'title')) === 'Скорость: ' + num(ct[203].speed)) break;
    await page.waitForTimeout(100);
  }
  assert.equal(await page.getAttribute('li[data-technology="203"] .ogx-l-fleetinfo-speed', 'title'), 'Скорость: ' + num(ct[203].speed));
  assert.equal(await page.textContent('li[data-technology="203"] .ogx-l-fleetinfo-speed'), '19,5к');
  assert.equal(await page.textContent('li[data-technology="210"] .ogx-l-fleetinfo-speed'), '160М');
  await waitText(page, 'cargo', num(18 * ct[203].baseCargoCapacity));
  // the check-target target becomes the table target (distance with inactiveSystems = 1: 2700 + 95 × (3 − 1))
  assert.equal(await rowHidden(page, 'target'), false);
  await waitText(page, 'distance', num(2890));
  assert.ok((await cell(page, 'target')).includes('[1:45:6] Farmville'), await cell(page, 'target'));

  // collapse: user click (U), persisted in fleetinfo.ui, B events in the journal
  await page.click(`${BOX} button[data-ogx-act="fleetinfo:toggle"]`);
  assert.equal(await page.$eval(BOX, (el) => el.classList.contains('ogx-l-fleetinfo-collapsed')), true);
  await page.waitForTimeout(300);
  assert.deepEqual(await env.get('fleetinfo.ui'), { v: 1, collapsed: true });
  const journal = await env.evalOgx(page, () => OGX.diag.recent().map((e) => `${e.s} ${e.k} ${e.w}`));
  assert.ok(journal.some((s) => /^U click .*fleetinfo:toggle/.test(s)), 'U click recorded');
  for (const w of ['renderBadges', 'renderTable', 'toggleCollapsed', 'checkTargetSeen', 'selection', 'target']) {
    assert.ok(journal.some((s) => s.startsWith('B fleetinfo ' + w)), 'B ' + w + ' recorded: ' + journal.filter((s) => s.startsWith('B')).join(' | '));
  }
  // no learning alert caused by our values
  assert.equal(journal.filter((s) => /^L implausible .*fleetinfo/.test(s)).length, 0);

  // reload keeps the collapsed state
  await page.reload();
  await env.waitReady(page);
  await env.waitFor(page, BOX);
  assert.equal(await page.$eval(BOX, (el) => el.classList.contains('ogx-l-fleetinfo-collapsed')), true);

  // only the check-target the test sent: the module itself makes no requests
  assert.deepEqual(env.requests().filter((r) => r.method !== 'GET').map((r) => r.path), ['/ajax/fleet/dispatch/check-target']);
  await mandatory(env);
});

T.test('fleetinfo: prefilled target 1:45:6 shows distance, duration, fuel, arrival and return', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/fleet?cp=1&galaxy=1&system=45&position=6&type=1&mission=1');
  await env.waitFor(page, BOX);
  assert.equal(await rowHidden(page, 'target'), false);
  assert.equal(await cell(page, 'target'), '[1:45:6] · Атака · 100%');
  assert.equal(await cell(page, 'duration'), '—');   // no ships yet

  await typeShips(page, 203, 10);
  const exp = await env.evalOgx(page, async () => {
    const stats = await OGX.state.shipStats();
    const server = await OGX.state.server();
    const ships = { 203: 10 };
    const distance = OGX.calc.distance('1:42:8', '1:45:6', {});
    const speedFactor = OGX.calc.missionSpeedFactor(1, server);
    const duration = OGX.calc.flightDuration({ distance, maxSpeed: stats[203].speed, speedPct: 10, speedFactor });
    const fuel = OGX.calc.fuel({ ships, stats, distance, duration, speedFactor, variant: 'client' });
    return { distance, duration, fuel, fd: OGX.fmt.duration(duration), fn: OGX.fmt.num(fuel), dn: OGX.fmt.num(distance) };
  });
  assert.equal(exp.distance, 2985);
  assert.ok(exp.duration > 0 && exp.fuel > 0, JSON.stringify(exp));
  await waitText(page, 'duration', exp.fd);
  assert.equal(await cell(page, 'distance'), exp.dn);
  assert.equal(await cell(page, 'fuel'), exp.fn);
  assert.match(await cell(page, 'arrival'), /^\d\d:\d\d:\d\d$|^\d\d\.\d\d/);
  assert.match(await cell(page, 'back'), /^\d\d:\d\d:\d\d$|^\d\d\.\d\d/);
  assert.equal(await rowHidden(page, 'hint'), true);

  // setting off -> table removed, badges stay; on again -> back
  await env.evalOgx(page, () => OGX.settings.set('fleetinfo.showTable', false));
  await page.waitForTimeout(200);
  assert.equal(await page.$$eval(BOX, (e) => e.length), 0);
  assert.ok(await page.$$eval('.ogx-l-fleetinfo-speed', (e) => e.length) > 0);
  await env.evalOgx(page, () => OGX.settings.set('fleetinfo.showSpeedBadges', false));
  await page.waitForTimeout(200);
  assert.equal(await page.$$eval('.ogx-l-fleetinfo-speed', (e) => e.length), 0);
  await env.evalOgx(page, () => OGX.settings.set('fleetinfo.showTable', true));
  await env.waitFor(page, BOX);
  await waitText(page, 'duration', exp.fd);
  assert.deepEqual(env.requests().filter((r) => r.method !== 'GET').map((r) => r.path), []);
  await mandatory(env);
});

T.test('fleetinfo: step 2 without the bridge reads mission from li > a.selected and speed from the bar steps', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/fleet?cp=1&galaxy=1&system=45&position=6&type=1&mission=1');
  await env.waitFor(page, BOX);
  await typeShips(page, 203, 10);
  // what the game JS leaves in the DOM on step 2: <a> selected inside li#button3 (the <li> only gets on/off),
  // PercentageBar steps with .step.selected[data-step=5]; the value="10" attribute stays static markup
  await page.evaluate(() => {
    document.querySelector('#fleet1').style.display = 'none';
    const f2 = document.querySelector('#fleet2');
    f2.style.display = 'block';
    f2.querySelector('#galaxy').value = '1'; f2.querySelector('#system').value = '45'; f2.querySelector('#position').value = '6';
    f2.querySelector('#missions > li#button3').className = 'on';
    f2.querySelector('#missions > li#button3 > a').classList.add('selected');
    const bar = document.querySelector('#speedPercentage');
    bar.setAttribute('value', '10');
    let html = '<div class="steps">';
    for (let i = 1; i <= 10; i++) html += `<div class="step step2${i === 5 ? ' selected' : ''}" data-step="${i}">${i * 10}</div>`;
    bar.innerHTML = '<div class="bar"></div>' + html + '</div>';
    f2.dispatchEvent(new Event('click', { bubbles: true }));
  });
  const exp = await env.evalOgx(page, async () => {
    const stats = await OGX.state.shipStats();
    const server = await OGX.state.server();
    const distance = OGX.calc.distance('1:42:8', '1:45:6', {});
    const speedFactor = OGX.calc.missionSpeedFactor(3, server);
    const duration = OGX.calc.flightDuration({ distance, maxSpeed: stats[203].speed, speedPct: 5, speedFactor });
    return { fd: OGX.fmt.duration(duration), mName: OGX.catalog.missionName(3) };
  });
  await waitText(page, 'target', `[1:45:6] · ${exp.mName} · 50%`);
  await waitText(page, 'duration', exp.fd);

  // bar rendered by the game JS but no step selected -> speed unknown, no guessed 100% numbers
  await page.evaluate(() => {
    document.querySelectorAll('#speedPercentage .step.selected').forEach((e) => e.classList.remove('selected'));
    document.querySelector('#fleet2').dispatchEvent(new Event('click', { bubbles: true }));
  });
  await waitText(page, 'target', `[1:45:6] · ${exp.mName} · скорость ?`);
  assert.equal(await cell(page, 'duration'), '—');
  assert.equal(await cell(page, 'fuel'), '—');
  await mandatory(env);
});

T.test('fleetinfo: moon without ships and other pages stay quiet', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/fleet?cp=5');            // fleet-dispatch-noships.html (#warning, no ship list)
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('.ogx-l-fleetinfo-speed', (e) => e.length), 0);
  await env.open('/overview?cp=1');
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('[id^="ogx-l-fleetinfo"], [class*="ogx-l-fleetinfo"]', (e) => e.length), 0);
  await mandatory(env);
});

T.test('fleetinfo: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  env.clearRequests();
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('[class*="ogx-"], [id^="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
});

T.test('fleetinfo: with the game JS (fleetDispatcher via the bridge)', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', gameJs: true });
  const page = await env.open('/fleet?cp=1');
  await env.waitFor(page, BOX);
  const hasFd = await page.evaluate(() => typeof window.fleetDispatcher === 'object' && !!window.fleetDispatcher);
  await typeShips(page, 203, 7);
  const stats = await env.evalOgx(page, () => OGX.state.shipStats());
  const num = (n) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');
  await waitText(page, 'cargo', num(7 * stats[203].cargo));
  assert.ok(hasFd, 'game JS created fleetDispatcher');
  if (hasFd) {
    // the game's own selection API: the bridge state wins over the inputs
    await page.evaluate(() => { window.fleetDispatcher.selectShip(202, 4); window.fleetDispatcher.refresh(); });
    await waitText(page, 'count', '11 (2 типа)', 6000);
  }
  await mandatory(env);
});
