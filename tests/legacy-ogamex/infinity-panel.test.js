'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / panel: menu entry + side panel, header (player, class, rank, DM, clock, attack), planets tab
// (rows, coords, fields, projected stock, totals, in-flight), ?cp= navigation, persisted open state, planet-list badges,
// coexistence with Live, diagnostics, safety on non-OgameX pages.
//   node tests/legacy-ogamex/infinity-panel.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js'), 'utf8');

let extCache = null;
function ext() {
  if (fs.existsSync(path.join(ROOT, 'ogamex-infinity/manifest.json')) && process.env.OGX_PANEL_REAL_EXT) return 'infinity';
  if (!extCache) extCache = coreExt({ name: 'infinity', modules: { panel: SRC } });
  return extCache;
}
const nb = (s) => String(s || '').replace(/[\u00a0\u202f\s]+/g, ' ').trim();
const digits = (s) => +String(s || '').replace(/[^\d-]/g, '');

async function openPanel(env, page) {
  await env.waitFor(page, '#menuTableTools #ogx-i-panel-entry');
  await page.click('#ogx-i-panel-entry a.menubutton');
  await page.waitForSelector('#ogx-panel-infinity:not([hidden]) .ogx-i-panel-row', { timeout: 10000 });
}

T.test('panel: menu entry toggles the panel, header, planets tab with numbers from the fixture', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  await env.waitFor(page, '#menuTableTools #ogx-i-panel-entry');
  assert.equal(await page.$$eval('#menuTableTools .ogx-menu-entry', (e) => e.length), 1);
  assert.match(await page.textContent('#ogx-i-panel-entry .textlabel'), /Infinity/);
  assert.equal(await page.$eval('#ogx-panel-infinity', (e) => e.hidden), true);

  await openPanel(env, page);
  // header
  const head = nb(await page.textContent('#ogx-i-panel-head'));
  assert.match(head, /Commander Vega/);
  assert.match(head, /Коллекционер/);
  assert.match(head, /место 37/);
  assert.match(head, /ТМ 8 000/);
  assert.match(nb(await page.textContent('.ogx-i-panel-clock')), /^\d\d:\d\d:\d\d$/);

  // rows: 2 planets + 1 moon
  const rows = await page.$$eval('.ogx-i-panel-row', (els) => els.map((e) => ({
    key: e.dataset.key, cls: e.className,
    name: e.querySelector('.ogx-i-panel-name').textContent.trim(),
    coords: e.querySelector('.ogx-i-panel-coords').textContent.trim(),
    fields: (e.querySelector('.ogx-i-panel-fields') || {}).textContent,
    temp: (e.querySelector('.ogx-i-panel-temp') || { textContent: '' }).textContent,
    metal: e.querySelector('[data-res="metal"]') ? +e.querySelector('[data-res="metal"]').dataset.amount : null,
    metalCls: e.querySelector('[data-res="metal"]') ? e.querySelector('[data-res="metal"]').className : '',
  })));
  assert.deepEqual(rows.map((r) => r.key), ['p1', 'm5', 'p3']);
  assert.equal(rows[0].name, 'Homeworld');
  assert.equal(nb(rows[0].coords), '[1:42:8]');
  assert.match(nb(rows[1].coords), /\[1:42:8\] Л/);
  assert.equal(nb(rows[2].coords), '[2:118:12]');
  assert.match(rows[0].fields, /95\/163/);
  assert.match(rows[1].fields, /4\/7/);
  assert.match(rows[2].fields, /52\/188/);
  assert.match(nb(rows[0].temp), /12…52 °C/);
  assert.match(nb(rows[2].temp), /-61…-21 °C/);
  assert.match(rows[0].cls, /ogx-i-panel-current/);
  // projected metal of the current planet: 152,347 at render time, growing
  assert.ok(rows[0].metal >= 152347 && rows[0].metal < 160000, 'metal ' + rows[0].metal);
  assert.match(rows[0].metalCls, /ogx-i-panel-ok/);
  const rate = nb(await page.textContent('.ogx-i-panel-row[data-key="p1"] [data-res="metal"] .ogx-i-panel-rate'));
  assert.equal(rate, '+4 128/ч');   // 1.14666/s × 3600
  // Colony has the wrench in the list but no queue known
  assert.match(nb(await page.textContent('.ogx-i-panel-row[data-key="p3"] .ogx-i-panel-r3')), /строится \(\?\)/);

  // totals and in-flight (eventlist fetched by the panel when the tab is shown)
  await page.waitForFunction(() => /\d/.test((document.querySelector('.ogx-i-panel-totals .ogx-i-panel-tline:nth-child(4) .ogx-i-panel-tsum') || {}).textContent || ''), null, { timeout: 10000 });
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 1);
  const tot = await page.$$eval('.ogx-i-panel-totals .ogx-i-panel-tline', (ls) => ls.map((l) => [...l.querySelectorAll('.ogx-i-panel-tval')].map((c) => c.dataset.value)));
  const expectFly = await env.evalOgx(page, async () => {
    const fl = await OGX.storage.get('flights');
    return OGX.flights.inFlight(fl.flights);
  });
  assert.equal(+tot[3][0], Math.floor(expectFly.metal));
  assert.equal(+tot[3][1], Math.floor(expectFly.crystal));
  assert.ok(expectFly.metal >= 31200, 'in flight metal ' + expectFly.metal);
  assert.equal(+tot[4][0], +tot[1][0] + +tot[3][0]);   // total = bodies + in flight (metal)
  assert.ok(+tot[1][0] >= 152347);
  // production/h: planets only
  assert.ok(+tot[2][0] >= 4128);

  // attack indicator: the fixture event list has a hostile espionage (1210)
  await page.waitForSelector('.ogx-i-panel-attack.ogx-i-panel-attack-on', { timeout: 5000 });
  assert.match(nb(await page.textContent('.ogx-i-panel-attack')), /Атака! 1/);

  // toggle closes
  await page.click('#ogx-i-panel-entry a.menubutton');
  assert.equal(await page.$eval('#ogx-panel-infinity', (e) => e.hidden), true);

  // diagnostics: U click on the entry, B toggle events
  await page.waitForTimeout(300);
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => e.k === 'panel' || (e.s === 'U' && /panel/.test(e.w))).map((e) => e.s + ' ' + e.k + ' ' + e.w));
  assert.ok(ev.some((e) => /^U click .*panel:toggle/.test(e)), ev.join('\n'));
  assert.ok(ev.some((e) => e === 'B panel toggle'), ev.join('\n'));
  assert.ok(ev.some((e) => e === 'B panel fetchFlights'), ev.join('\n'));

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('panel: clicking a row navigates to ?cp=3, open state survives reload', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  await openPanel(env, page);
  env.clearRequests();
  await Promise.all([
    page.waitForURL(/cp=3/, { timeout: 10000 }),
    page.click('.ogx-i-panel-row[data-key="p3"] .ogx-i-panel-r2'),
  ]);
  assert.match(page.url(), /\/overview\?cp=3$/);
  assert.ok(env.requests('GET', '/overview').some((r) => String(r.cp) === '3'));
  await env.waitReady(page);
  // persisted open state: the panel is open again on the new page; Colony is now current
  await page.waitForSelector('#ogx-panel-infinity:not([hidden]) .ogx-i-panel-row.ogx-i-panel-current', { timeout: 10000 });
  assert.equal(await page.$eval('.ogx-i-panel-row.ogx-i-panel-current', (e) => e.dataset.key), 'p3');
  await page.reload();
  await env.waitReady(page);
  await page.waitForSelector('#ogx-panel-infinity:not([hidden]) .ogx-i-panel-row', { timeout: 10000 });
  const st = await env.get('settings');
  assert.equal(st.core['panel.infinity.open'], true);
  // B navigate event
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('panel: navigation journal + small links carry cp', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  await openPanel(env, page);
  const href = await page.getAttribute('.ogx-i-panel-row[data-key="m5"] .ogx-i-panel-link[data-ogx-act="panel:link-fleet"]', 'href');
  assert.match(href, /\/fleet\?cp=5$/);
  // navigate call is journaled before the page leaves
  await env.evalOgx(page, () => { OGX.diag.recent(); return true; });
  const recPromise = page.waitForURL(/cp=5/, { timeout: 10000 });
  await page.click('.ogx-i-panel-row[data-key="m5"] .ogx-i-panel-r2');
  await recPromise;
  await env.waitReady(page);
  await page.waitForTimeout(1200);
  const evs = await env.evalOgx(page, async () => {
    await OGX.diag.flush();
    const st = await OGX.diag.store();
    const r = await st.query({ last: 400 });
    return r.events.filter((e) => e.s === 'B' && e.k === 'panel').map((e) => e.w + ' ' + JSON.stringify(e.d && e.d.args));
  });
  assert.ok(evs.some((e) => /^navigate .*5/.test(e)), evs.join('\n'));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('panel: moon fixture marks the moon current and overfull stock as bad', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview?cp=5');
  await openPanel(env, page);
  assert.equal(await page.$eval('.ogx-i-panel-row.ogx-i-panel-current', (e) => e.dataset.key), 'm5');
  assert.match(await page.$eval('.ogx-i-panel-row[data-key="m5"] [data-res="metal"]', (e) => e.className), /ogx-i-panel-bad/);
  assert.equal(await page.$eval('.ogx-i-panel-row[data-key="m5"] [data-res="metal"]', (e) => +e.dataset.amount), 12500);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('panel: compact layout lists 6 planets, fields badges in #planetList', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'compact' });
  const page = await env.open('/overview');
  await openPanel(env, page);
  const keys = await page.$$eval('.ogx-i-panel-row.ogx-i-panel-planet', (els) => els.map((e) => e.dataset.key));
  assert.deepEqual(keys, ['p1', 'p3', 'p4', 'p6', 'p7', 'p8']);
  assert.match(await page.textContent('.ogx-i-panel-row[data-key="p8"] .ogx-i-panel-fields'), /7\/233/);
  assert.equal(nb(await page.textContent('.ogx-i-panel-row[data-key="p6"] .ogx-i-panel-coords')), '[3:201:9]');
  // badges: one per .smallplanet
  const badges = await page.$$eval('#planetList .smallplanet', (rows) => rows.map((r) => r.querySelectorAll('.ogx-i-panel-fields-badge').length));
  assert.deepEqual(badges, [1, 1, 1, 1, 1, 1]);
  assert.equal(nb(await page.textContent('#planetList .smallplanet[data-planet-id="7"] .ogx-i-panel-fields-badge')), '18/96');
  // row height unchanged by the badge (absolute positioning)
  const hgt = await page.$$eval('#planetList .smallplanet', (rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
  assert.ok(hgt.every((x) => x === hgt[0]), hgt.join(','));
  // setting off removes them
  await env.evalOgx(page, () => OGX.settings.set('panel.planetbarFields', false));
  await page.waitForFunction(() => !document.querySelector('.ogx-i-panel-fields-badge'), null, { timeout: 5000 });
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('panel: no badges when OgameX Live runs too; showMoons=false hides moons', async () => {
  const live = coreExt({ name: 'live', modules: {} });
  const env = await T.launch({ ext: [ext(), live], scenario: 'vega', settings: { 'panel.showMoons': false } });
  const page = await env.open('/overview');
  await openPanel(env, page);
  await page.waitForTimeout(1500);
  assert.equal(await page.$$eval('.ogx-i-panel-fields-badge', (e) => e.length), 0);
  assert.deepEqual(await page.$$eval('.ogx-i-panel-row', (els) => els.map((e) => e.dataset.key)), ['p1', 'p3']);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('panel: openOnLoad opens the panel; disabled module injects nothing', async () => {
  let env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'panel.openOnLoad': true } });
  let page = await env.open('/overview');
  await page.waitForSelector('#ogx-panel-infinity:not([hidden]) .ogx-i-panel-row', { timeout: 10000 });
  await env.close();
  env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'panel.enabled': false } });
  page = await env.open('/overview');
  await page.waitForTimeout(500);
  assert.equal(await page.$$eval('#ogx-i-panel-entry, .ogx-i-panel-fields-badge, #ogx-i-panel-head', (e) => e.length), 0);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('panel: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  for (const p of ['/not-ogame', '/login', '/gameforge-like']) {
    const page = await env.open(p, { waitReady: false });
    await page.waitForTimeout(300);
    assert.equal(await page.$$eval('[class*="ogx-"], [id^="ogx-"]', (e) => e.length), 0, p);
  }
  assert.deepEqual(env.ogxErrors(), []);
});
