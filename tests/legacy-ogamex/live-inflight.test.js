'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// live/inflight: resources in flight, totals, grand totals, needed vs owned SC/LC, incoming-fleet icons (DESIGN §4.1.3).
//   node tests/legacy-ogamex/live-inflight.test.js
// Uses ogamex-live (manifest) when it lists the module, otherwise a throw-away extension with the real shared core
// + this module (tests/core-ext.js), which has the same manifest shape.
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD = path.join(ROOT, 'ogamex-live', 'modules', 'inflight', 'inflight.js');

function ext() {
  const mf = path.join(ROOT, 'ogamex-live', 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if ((m.content_scripts || []).some((cs) => (cs.js || []).includes('modules/inflight/inflight.js'))) return 'live';
  } catch (e) { /* no manifest yet */ }
  return coreExt({ name: 'live', modules: { inflight: fs.readFileSync(MOD, 'utf8') } });
}

const P = '.ogx-l-inflight-';
const cellV = (page, row, res) => page.getAttribute(`${P}totals [data-row="${row}"] [data-res="${res}"]`, 'data-v').then((v) => +v);
const cellT = (page, row, res) => page.textContent(`${P}totals [data-row="${row}"] [data-res="${res}"]`);

async function mandatory(env) {
  assert.deepEqual(env.ogxErrors(), [], 'no [OGX errors');
  assert.deepEqual(env.consoleErrors().filter((e) => /OGX|inflight/i.test(e.text + (e.stack || ''))), [], 'no console errors from the add-on');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), [], 'no unhandled requests');
}

T.test('inflight: totals (in flight once per mission, synthetic/foreign ignored), grand totals, SC/LC, incoming icons', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.flightsPollSec': 1, 'core.tickMs': 250 } });
  const page = await env.open('/overview');
  await env.waitFor(page, P + 'totals');
  // flights arrive through the core poller (first poll fetches the event list)
  await page.waitForFunction(() => +(document.querySelector('.ogx-l-inflight-totals [data-row="inflight"] [data-res="metal"]') || {}).dataset?.v > 0, null, { timeout: 10000 });
  assert.ok(env.requests('GET', '/ajax/fleet/eventbox/fetch').length >= 1, 'eventbox polled');
  assert.ok(env.requests('GET', '/ajax/fleet/eventlist/fetch').length >= 1, 'event list fetched');

  // In flight: 1199 return (31,200 M / 18,900 C / 106 D), 1201 attack (0/0/60), 1202 expedition hold end (0/0/...), 1203 transport
  // (50,000 / 30,000 / 10,790); synthetic returns 1001200-1001202 and the foreign transport 1211 (20,000 M) are not counted.
  const inMetal = await cellV(page, 'inflight', 'metal');
  const inCrystal = await cellV(page, 'inflight', 'crystal');
  const inDeut = await cellV(page, 'inflight', 'deuterium');
  assert.equal(inMetal, 31200 + 50000);
  assert.equal(inCrystal, 18900 + 30000);
  // same numbers as the core rule, computed in the isolated world from the same stored list
  const core = await env.evalOgx(page, async () => {
    const st = await OGX.storage.get('flights');
    const t = OGX.time.serverNow();
    const r = OGX.flights.inFlight(st.flights.filter((f) => f.arrival > t));
    return { m: r.metal, c: r.crystal, d: r.deuterium };
  });
  assert.equal(inDeut, Math.round(core.d));
  assert.equal(inDeut, 106 + 60 + 10790, 'outbound deuterium kept (fuel could not be recomputed)');
  assert.match(await cellT(page, 'inflight', 'deuterium'), /^≈10 956$/, 'approximate deuterium marked with ≈');
  assert.equal(await cellT(page, 'inflight', 'metal'), '81 200');
  assert.equal(await cellV(page, 'inflight', 'sum'), 81200 + 48900 + 10956);

  // bodies: only planet 1 has resources after /overview (inline reloadResources: 152,347 / 98,712 / 41,230), growing
  const bM = await cellV(page, 'bodies', 'metal');
  assert.ok(bM >= 152347 && bM < 152347 + 60, 'bodies metal ' + bM);
  assert.equal(await cellT(page, 'prod', 'metal'), '+4 128');
  assert.equal(await cellV(page, 'prod', 'crystal'), 2187);
  assert.match(await page.textContent(P + 'totals ' + P + 'note'), /Нет данных о ресурсах: 2 тела/);

  // grand = bodies + in flight (all read in one go)
  const g = await page.$$eval(P + 'totals [data-row] [data-res]', (els) => {
    const o = {};
    for (const e of els) o[e.closest('[data-row]').dataset.row + '.' + e.dataset.res] = +e.dataset.v;
    return o;
  });
  for (const r of ['metal', 'crystal', 'deuterium']) assert.ok(Math.abs(g['grand.' + r] - (g['bodies.' + r] + g['inflight.' + r])) <= 1, r);
  assert.match(await cellT(page, 'grand', 'deuterium'), /^≈/);
  assert.doesNotMatch(await cellT(page, 'grand', 'metal'), /≈/);

  // needed SC/LC for the grand total; owned unknown before /fleet
  const cap = await env.evalOgx(page, async () => { const s = await OGX.state.shipStats(); return { sc: s[202].cargo, lc: s[203].cargo }; });
  const needSC = await page.getAttribute(P + 'need[data-ship="202"]', 'data-need');
  const needLC = await page.getAttribute(P + 'need[data-ship="203"]', 'data-need');
  assert.ok(Math.abs(+needSC - Math.ceil(g['grand.sum'] / cap.sc)) <= 1, `SC ${needSC} vs ${g['grand.sum']}/${cap.sc}`);
  assert.ok(Math.abs(+needLC - Math.ceil(g['grand.sum'] / cap.lc)) <= 1, `LC ${needLC}`);
  assert.match(await page.textContent(P + 'need[data-ship="203"]'), /^\S+ \?\/\d/);

  // incoming icons: planet 1 (Homeworld, row planet-1) has 1210 hostile espionage, 1199, 1203 and returns; planet 3 (row planet-2) 1211 + 1001202
  assert.equal(await page.$$eval('#planet-1 > ' + P + 'in-planet', (e) => e.length), 1);
  assert.equal(await page.getAttribute('#planet-1 > ' + P + 'in-planet', 'data-n'), '5');
  assert.equal(await page.getAttribute('#planet-1 > ' + P + 'in-planet', 'data-hostile'), '1');
  assert.match(await page.getAttribute('#planet-1', 'class'), /ogx-l-inflight-hostile/);
  assert.equal(await page.getAttribute('#planet-2 > ' + P + 'in-planet', 'data-n'), '2');
  assert.equal(await page.getAttribute('#planet-2 > ' + P + 'in-planet', 'data-hostile'), '0');
  assert.doesNotMatch(await page.getAttribute('#planet-2', 'class'), /ogx-l-inflight-hostile/);
  assert.equal(await page.$$eval(P + 'in-moon', (e) => e.length), 0, 'no flights to the moon');

  await page.hover('#planet-1 > ' + P + 'in-planet');
  await page.waitForSelector('.ogx-tooltip:not([hidden]) ' + P + 'tip', { timeout: 5000 });
  const tip = await page.$$eval('.ogx-tooltip ' + P + 'tip-row', (rows) => rows.map((r) => ({ id: r.dataset.row, hostile: r.classList.contains('ogx-l-inflight-hostile-row'), text: r.textContent + ' ' + (r.nextElementSibling ? r.nextElementSibling.textContent : '') })));
  assert.equal(tip.length, 5);
  const spy = tip.find((r) => r.id === '1210');
  assert.ok(spy && spy.hostile, 'hostile espionage row');
  assert.match(spy.text, /Шпионаж/);
  assert.match(spy.text, /враг/);
  const tr = tip.find((r) => r.id === '1203');
  assert.ok(tr && !tr.hostile);
  assert.match(tr.text, /Транспорт/);
  assert.match(tr.text, /М 50 000/);
  assert.match(tip.find((r) => r.id === '1001200').text, /возврат/);
  assert.match(await page.textContent('.ogx-tooltip ' + P + 'tip-h'), /Прибывают на .*\[1:42:8\]/);
  await page.mouse.move(5, 5);

  // poller: steady state -> eventbox only; counts change (empty eventbox) -> list re-fetched
  await page.waitForTimeout(1500);
  env.clearRequests();
  await page.waitForTimeout(2200);
  assert.ok(env.requests('GET', '/ajax/fleet/eventbox/fetch').length >= 1, 'eventbox polled');
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 0, 'no list re-fetch while counts are stable');
  env.setState({ eventbox: 'empty' });
  await page.waitForTimeout(2000);
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 1, 're-fetched after the counts changed');

  // diagnostics: B events for render and the poller start
  const b = await env.evalOgx(page, () => OGX.diag.recent({ s: 'B' }).filter((e) => e.k === 'inflight').map((e) => e.w));
  assert.ok(b.includes('render'), 'render journaled: ' + b.join(','));
  assert.ok(b.includes('poller:start'));
  await mandatory(env);
});

T.test('inflight: owned SC/LC after /fleet, collapse persisted, refresh button POSTs nothing and re-fetches', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.flightsPollSec': 0 } });
  // poll off -> the module uses flights.get() (cached 60 s)
  const fleet = await env.open('/fleet');
  await env.waitFor(fleet, P + 'totals');
  await fleet.waitForTimeout(300);
  const page = await env.open('/overview');
  await env.waitFor(page, P + 'totals');
  await page.waitForFunction(() => +(document.querySelector('.ogx-l-inflight-need[data-ship="203"]') || {}).dataset?.have > 0, null, { timeout: 8000 });
  assert.equal(await page.getAttribute(P + 'need[data-ship="203"]', 'data-have'), '18');
  assert.equal(await page.getAttribute(P + 'need[data-ship="202"]', 'data-have'), '25');
  const lc = await page.textContent(P + 'need[data-ship="203"]');
  assert.match(lc, /^\S+ 18\/\d+$/);
  // 18 LC < needed -> red
  const needLC = +(await page.getAttribute(P + 'need[data-ship="203"]', 'data-need'));
  assert.match(await page.getAttribute(P + 'need[data-ship="203"]', 'class'), needLC > 18 ? /ogx-l-inflight-bad/ : /ogx-l-inflight-ok/);
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 1, 'one list request for two pages (60 s cache)');
  assert.equal(env.requests('GET', '/ajax/fleet/eventbox/fetch').length, 0, 'poll disabled');

  // collapse: persisted in inflight.ui, survives reload, U + B events journaled
  await page.click(P + 'btn[data-ogx-act="inflight:toggle"]');
  await page.waitForTimeout(400);
  await env.evalOgx(page, () => OGX.storage.flush());
  assert.deepEqual(await env.get('inflight.ui'), { v: 1, collapsed: true });
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => (e.s === 'U' && /inflight:toggle/.test(e.w)) || (e.s === 'B' && e.k === 'inflight' && e.w === 'toggle')).map((e) => e.s));
  assert.ok(ev.includes('U') && ev.includes('B'), 'U and B events: ' + ev.join(','));
  await page.reload();
  await env.waitFor(page, P + 'totals' + P + 'collapsed');

  // refresh: forced re-fetch, no POST
  env.clearRequests();
  await page.click(P + 'btn[data-ogx-act="inflight:toggle"]');
  await page.click(P + 'btn[data-ogx-act="inflight:refresh"]');
  await page.waitForTimeout(600);
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 1);
  assert.equal(env.requests('POST').length, 0, 'read-only module');
  // error path: the list fails -> status line, no thrown errors
  env.server.route('GET', '/ajax/fleet/eventlist/fetch', (req, res, ctx) => ctx.send(500, 'oops'));
  await page.click(P + 'btn[data-ogx-act="inflight:refresh"]');
  await page.waitForFunction(() => /Не удалось/.test((document.querySelector('.ogx-l-inflight-status') || {}).textContent || ''), null, { timeout: 5000 });
  assert.match(await page.textContent(P + 'status'), /Не удалось загрузить список флотов/);
  assert.equal(await cellV(page, 'inflight', 'metal'), 81200, 'previous data kept');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('inflight: settings switch parts off; moons excluded from totals', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.flightsPollSec': 0, 'inflight.showIncoming': false, 'inflight.includeMoonsInTotals': false } });
  const page = await env.open('/overview');
  await env.waitFor(page, P + 'totals');
  await page.waitForFunction(() => +(document.querySelector('.ogx-l-inflight-totals [data-row="inflight"] [data-res="metal"]') || {}).dataset?.v > 0, null, { timeout: 8000 });
  assert.equal(await page.$$eval(P + 'in', (e) => e.length), 0, 'no incoming icons');
  assert.match(await page.textContent(P + 'note'), /Луны не учитываются/);
  assert.match(await page.textContent(P + 'note'), /Нет данных о ресурсах: 1 тело/);
  await env.evalOgx(page, () => OGX.settings.set('inflight.showTotals', false));
  await page.waitForFunction(() => !document.querySelector('.ogx-l-inflight-totals'), null, { timeout: 3000 });
  await env.evalOgx(page, () => OGX.settings.set('inflight.showIncoming', true));
  await page.waitForSelector('#planet-1 > .ogx-l-inflight-in', { timeout: 3000 });
  await mandatory(env);
});

T.test('inflight: nothing on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
  assert.deepEqual(env.ogxErrors(), []);
});
