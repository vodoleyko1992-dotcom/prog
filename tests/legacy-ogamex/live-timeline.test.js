'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// live/timeline: flights timeline (DESIGN §4.1.7, OL row 18).
//   node tests/legacy-ogamex/live-timeline.test.js
// Uses ogamex-live (manifest) when it lists the module, otherwise a throw-away extension with the real shared core
// + this module (tests/core-ext.js), which has the same manifest shape.
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD = path.join(ROOT, 'ogamex-live', 'modules', 'timeline', 'timeline.js');

function ext() {
  const mf = path.join(ROOT, 'ogamex-live', 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if ((m.content_scripts || []).some((cs) => (cs.js || []).includes('modules/timeline/timeline.js'))) return 'live';
  } catch (e) { /* no manifest yet */ }
  return coreExt({ name: 'live', modules: { timeline: fs.readFileSync(MOD, 'utf8') } });
}

const ID = '#ogx-l-timeline';
const P = '.ogx-l-timeline-';
const rowIds = (page) => page.$$eval(`${ID} ${P}row`, (els) => els.map((e) => e.dataset.row));

async function mandatory(env) {
  assert.deepEqual(env.ogxErrors(), [], 'no [OGX errors');
  assert.deepEqual(env.consoleErrors().filter((e) => /OGX|timeline/i.test(e.text + (e.stack || ''))), [], 'no console errors from the add-on');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), [], 'no unhandled requests');
}

// Event list fixture (fleet.md §9.3): 1210 hostile espionage, 1199 harvest return, 1201 attack, 890090 = hold end of
// expedition 1202, 1211 foreign transport, 1001201 / 1001200 / 1001202 synthetic returns, 1203 transport.
const DEFAULT_ORDER = ['1210', '1199', '1201', '1211', '1001201', '1001200', '1203', '1001202'];

T.test('timeline: rows from the event list, hostile row, icons, coords, cargo bars, slots 4/6 + 1/2', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.flightsPollSec': 0, 'core.tickMs': 250 } });
  // /fleet stores the slots (4/6, 1/2) and the effective ship stats
  const fleet = await env.open('/fleet');
  await env.waitFor(fleet, ID);
  // state.merge writes 'slots' asynchronously (coalesced): wait until it is stored before leaving the page
  for (let i = 0; i < 50 && !((await env.get('slots')) || {}).fleet; i++) await fleet.waitForTimeout(100);
  assert.deepEqual((await env.get('slots')).fleet, { used: 4, max: 6 });
  const page = await env.open('/overview');
  await env.waitFor(page, ID);
  await page.waitForFunction(() => document.querySelectorAll('#ogx-l-timeline .ogx-l-timeline-row').length >= 8, null, { timeout: 10000 });

  // placement: #left, right after the menu (#toolbarcomponent)
  assert.equal(await page.evaluate(() => { const e = document.querySelector('div#ogx-l-timeline'); return e.parentElement.id + '|' + (e.previousElementSibling || {}).id; }), 'left|toolbarcomponent');
  // own stylesheet applied (it must not share the div's id, see the module comment)
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('div#ogx-l-timeline')).width), '165px');
  assert.equal(await page.$$eval('#ogx-l-timeline', (e) => e.length), 1, 'one element with the id');

  // one row per mission and direction, sorted by arrival, outbound expedition (hold end 890090) hidden
  assert.deepEqual(await rowIds(page), DEFAULT_ORDER);
  const arr = await page.$$eval(`${ID} ${P}row`, (els) => els.map((e) => +e.dataset.arrival));
  assert.deepEqual(arr, [...arr].sort((a, b) => a - b), 'sorted by arrival');
  assert.equal(arr[0], 1793322257 * 1000);
  assert.match(await page.textContent(`${ID} ${P}foot`), /скрыто экспедиций туда: 1/);

  // slots
  assert.equal(await page.textContent(`${ID} [data-slots="fleet"]`), 'Ф\u00a04/6');
  assert.equal(await page.textContent(`${ID} [data-slots="expedition"]`), 'Э\u00a01/2');
  assert.doesNotMatch(await page.getAttribute(`${ID} [data-slots="fleet"]`, 'class'), /overmark/);

  // hostile highlighting: only the foreign espionage 1210
  assert.deepEqual(await page.$$eval(`${ID} ${P}row${P}hostile`, (els) => els.map((e) => e.dataset.row)), ['1210']);
  const spy = `${ID} ${P}row[data-row="1210"]`;
  assert.equal(await page.getAttribute(`${spy} img${P}icon`, 'src'), '/img/fleet/6.gif');
  assert.equal(await page.textContent(`${spy} ${P}from`), '[1:40:11]');
  assert.equal(await page.textContent(`${spy} ${P}to`), '[1:42:8]');
  assert.equal(await page.textContent(`${spy} ${P}units`), '3');
  // arrival time (server clock) and a running countdown
  const tm = await page.textContent(`${spy} ${P}time`);
  assert.match(tm, /^\d\d:\d\d:\d\d$/);
  const expTime = await env.evalOgx(page, () => OGX.fmt.time(1793322257000));
  assert.equal(tm, expTime);
  assert.match(await page.textContent(`${spy} ${P}cd .ogx-countdown`), /^\d+:\d\d$|^\d+с$/);

  // return direction: 1199 harvest return from [1:42:9] (debris) back home
  const ret = `${ID} ${P}row[data-row="1199"]`;
  assert.equal(await page.getAttribute(ret, 'data-return-flight'), '1');
  assert.equal(await page.textContent(`${ret} ${P}dir`), '↩');

  // cargo bars of the own transport 1203: 50,000 / 30,000 / deuterium vs fleetCargo(ships)
  const tr = `${ID} ${P}row[data-row="1203"]`;
  const exp = await env.evalOgx(page, async () => {
    const st = await OGX.storage.get('flights');
    const f = st.flights.find((x) => x.rowId === 1203);
    const stats = await OGX.state.shipStats();
    return { cap: OGX.calc.fleetCargo(f.ships, stats), cargo: f.cargo };
  });
  assert.ok(exp.cap > 0, 'capacity known');
  assert.equal(+(await page.getAttribute(`${tr} ${P}bars`, 'data-cap')), exp.cap);
  assert.equal(await page.getAttribute(`${tr} ${P}bar-metal`, 'data-v'), '50000');
  assert.equal(await page.getAttribute(`${tr} ${P}bar-crystal`, 'data-v'), '30000');
  assert.equal(+(await page.getAttribute(`${tr} ${P}bar-metal`, 'data-pct')), +(Math.min(1, 50000 / exp.cap) * 100).toFixed(1));
  assert.equal(+(await page.getAttribute(`${tr} ${P}bar-deuterium`, 'data-v')), Math.round(exp.cargo.deuterium));
  // synthetic return: cargo unknown
  assert.match(await page.getAttribute(`${ID} ${P}row[data-row="1001202"] ${P}bars`, 'class'), /bars-unknown/);

  // tooltip in Russian with numbers formatted ru-RU
  await page.hover(tr);
  await page.waitForSelector('.ogx-tooltip:not([hidden]) .ogx-l-timeline-tip', { timeout: 5000 });
  const tip = await page.textContent('.ogx-tooltip .ogx-l-timeline-tip');
  assert.match(tip, /Транспорт/);
  assert.match(tip, /Металл50\u00a0000/);
  assert.match(tip, /свой флот/);
  await page.mouse.move(700, 5);
  await page.hover(spy);
  await page.waitForFunction(() => /враждебный флот/.test((document.querySelector('.ogx-tooltip .ogx-l-timeline-tip') || {}).textContent || ''), null, { timeout: 5000 });
  assert.match(await page.textContent('.ogx-tooltip .ogx-l-timeline-tip'), /Шпионаж/);
  await page.mouse.move(700, 5);

  // diagnostics: render journaled as B
  const b = await env.evalOgx(page, () => OGX.diag.recent({ s: 'B' }).filter((e) => e.k === 'timeline').map((e) => e.w));
  assert.ok(b.includes('render'), 'render journaled: ' + b.join(','));
  await mandatory(env);
});

T.test('timeline: outbound expeditions shown when the setting is off; reload fetches the list; collapse persisted', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.flightsPollSec': 0, 'timeline.skipOutboundExpeditions': false } });
  const page = await env.open('/overview');
  await env.waitFor(page, ID);
  await page.waitForFunction(() => document.querySelectorAll('#ogx-l-timeline .ogx-l-timeline-row').length >= 9, null, { timeout: 10000 });
  assert.deepEqual(await rowIds(page), ['1210', '1199', '1201', '890090', '1211', '1001201', '1001200', '1203', '1001202']);
  assert.equal(await page.getAttribute(`${ID} ${P}row[data-row="890090"]`, 'data-mission'), '1202');
  assert.equal(await page.getAttribute(`${ID} ${P}row[data-row="890090"] img`, 'src'), '/img/fleet/15.gif');
  assert.equal(await page.textContent(`${ID} ${P}row[data-row="890090"] ${P}to`), '[1:42:16]\u00a0к', 'deep space marked');
  assert.equal(await page.$$eval(`${ID} ${P}foot`, (e) => e[0].hidden), true);
  // without /fleet: used slots counted from the flights (own missions 1199, 1201, 1202, 1203; expedition 1202)
  assert.equal(await page.getAttribute(`${ID} [data-slots="fleet"]`, 'data-used'), '4');
  assert.equal(await page.getAttribute(`${ID} [data-slots="expedition"]`, 'data-used'), '1');

  // reload icon -> new GET /ajax/fleet/eventlist/fetch (forced), no POST; U + B events
  env.clearRequests();
  await page.click(`${ID} [data-ogx-act="timeline:reload"]`);
  await page.waitForTimeout(800);
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 1, 'list re-fetched');
  assert.equal(env.requests('POST').length, 0, 'read-only module');
  assert.equal((await rowIds(page)).length, 9);
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => (e.s === 'U' && /timeline:reload/.test(e.w)) || (e.s === 'B' && e.k === 'timeline' && e.w === 'reload')).map((e) => e.s));
  assert.ok(ev.includes('U') && ev.includes('B'), 'U and B events: ' + ev.join(','));

  // the setting toggled live -> expedition hidden again
  await env.evalOgx(page, () => OGX.settings.set('timeline.skipOutboundExpeditions', true));
  await page.waitForFunction(() => !document.querySelector('#ogx-l-timeline [data-row="890090"]'), null, { timeout: 3000 });
  assert.deepEqual(await rowIds(page), DEFAULT_ORDER);

  // collapse persisted
  await page.click(`${ID} [data-ogx-act="timeline:toggle"]`);
  await page.waitForTimeout(300);
  await env.evalOgx(page, () => OGX.storage.flush());
  assert.deepEqual(await env.get('timeline.ui'), { v: 1, collapsed: true });
  await page.reload();
  await env.waitFor(page, `${ID}${P}collapsed`);

  // list failure -> status line, rows kept, no errors
  await page.click(`${ID} [data-ogx-act="timeline:toggle"]`);
  env.server.route('GET', '/ajax/fleet/eventlist/fetch', (req, res, ctx) => ctx.send(500, 'oops'));
  await page.click(`${ID} [data-ogx-act="timeline:reload"]`);
  await page.waitForFunction(() => /Не удалось/.test((document.querySelector('.ogx-l-timeline-status') || {}).textContent || ''), null, { timeout: 5000 });
  assert.equal((await rowIds(page)).length, 8);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('timeline: position right / off, full slots overmark, maxRows', async () => {
  const env = await T.launch({
    ext: ext(), scenario: 'vega',
    settings: { 'core.flightsPollSec': 0, 'timeline.position': 'right', 'timeline.maxRows': 5 },
    storage: { '{host}|{pid}|slots': { fleet: { used: 6, max: 6 }, expedition: { used: 2, max: 2 }, t: 9e12 } },
  });
  const page = await env.open('/overview');
  await env.waitFor(page, ID);
  await page.waitForFunction(() => document.querySelectorAll('#ogx-l-timeline .ogx-l-timeline-row').length >= 5, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => (document.querySelector('div#ogx-l-timeline').previousElementSibling || {}).id), 'planetList');
  assert.equal(await page.evaluate(() => !!document.querySelector('#left #ogx-l-timeline')), false);
  assert.deepEqual(await rowIds(page), DEFAULT_ORDER.slice(0, 5));
  assert.match(await page.textContent(`${ID} ${P}foot`), /ещё 3 полёта/);
  assert.equal(await page.textContent(`${ID} [data-slots="fleet"]`), 'Ф\u00a06/6');
  assert.match(await page.getAttribute(`${ID} [data-slots="fleet"]`, 'class'), /overmark/);
  assert.match(await page.getAttribute(`${ID} [data-slots="expedition"]`, 'class'), /overmark/);

  await env.evalOgx(page, () => OGX.settings.set('timeline.position', 'off'));
  await page.waitForFunction(() => !document.querySelector('div#ogx-l-timeline'), null, { timeout: 3000 });
  await env.evalOgx(page, () => OGX.settings.set('timeline.position', 'left'));
  await page.waitForSelector('#left > #ogx-l-timeline', { timeout: 3000 });
  await mandatory(env);
});

T.test('timeline: pure row builder (hold end merged into the outbound expedition row, past rows dropped)', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.flightsPollSec': 0 } });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, () => {
    const mk = (o) => Object.assign({ own: true, synthetic: null, returnFlight: false, missionType: 15, cargo: { metal: 0, crystal: 0, deuterium: 0 } }, o);
    const list = [
      mk({ rowId: 500, realMissionId: 500, arrival: 2000 }),                                   // outbound expedition, arrives
      mk({ rowId: 888888 + 500, realMissionId: 500, synthetic: 'holdEnd', arrival: 5000 }),     // its hold end
      mk({ rowId: 999999 + 500, realMissionId: 500, synthetic: 'return', returnFlight: true, arrival: 9000 }),
      mk({ rowId: 7, realMissionId: 7, missionType: 3, arrival: 500 }),                          // already arrived
      mk({ rowId: 8, realMissionId: 8, missionType: 10, arrival: 3000 }),                        // missile: no slot
    ];
    const a = OGX.timeline.rows(list, 1000, { skipOutboundExpeditions: false });
    const b = OGX.timeline.rows(list, 2500, { skipOutboundExpeditions: false });
    const c = OGX.timeline.rows(list, 1000, { skipOutboundExpeditions: true });
    return {
      a: a.rows.map((x) => [x.f.rowId, x.holdEnd]), b: b.rows.map((x) => x.f.rowId), c: c.rows.map((x) => x.f.rowId), cSkipped: c.skipped,
      slots: OGX.timeline.slotsFromFlights(list, 1000),
    };
  });
  assert.deepEqual(r.a, [[500, 5000], [8, null], [1000499, null]]);
  assert.deepEqual(r.b, [8, 889388, 1000499]);
  assert.deepEqual(r.c, [8, 1000499]);
  assert.equal(r.cSkipped, 2);
  assert.deepEqual(r.slots, { fleet: 1, expedition: 1 });
  await mandatory(env);
});

T.test('timeline: nothing on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"], #ogx-l-timeline', (e) => e.length), 0);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
  assert.deepEqual(env.ogxErrors(), []);
});
