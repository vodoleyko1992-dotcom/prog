'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Live / menu: menu entry, settings modal (freshness, settings of all Live modules, diagnostics), refresh-all with
// the ?cp= notice, progress and cancel, galaxy footer clock, coexistence note, safety on non-OgameX pages.
//   node tests/legacy-ogamex/live-menu.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');
const { rewrite } = require('../server');

const ROOT = path.resolve(__dirname, '..', '..');
const MENU_SRC = fs.readFileSync(path.join(ROOT, 'ogamex-live/modules/menu/menu.js'), 'utf8');
// A second Live module with settings, so the modal must list more than the menu's own settings.
// Use the real planetbar when it exists, otherwise a stub with the same name and a setting.
const PB_FILE = path.join(ROOT, 'ogamex-live/modules/planetbar/planetbar.js');
const PB_STUB = `OGX.module({ name: 'planetbar', title: 'Производство на планетах', settings: { showSum: { type: 'bool', default: true, label: 'Сумма по телу' } }, init() {} });`;

let extCache = null;
function ext() {
  const manifest = path.join(ROOT, 'ogamex-live/manifest.json');
  if (fs.existsSync(manifest) && process.env.OGX_MENU_REAL_EXT) return 'live';
  if (!extCache) extCache = coreExt({ name: 'live', modules: { menu: MENU_SRC, planetbar: process.env.OGX_MENU_REAL_PB && fs.existsSync(PB_FILE) ? fs.readFileSync(PB_FILE, 'utf8') : PB_STUB } });
  return extCache;
}

// The vega mock serves /fleet?cp=3 with the planet-1 fixture and /resources from the other account. For a clean refresh,
// serve the vega fixtures with the metas of the requested body (what OgameX itself does: GlobalGame sets the body from cp).
const BODY_META = { 1: ['Homeworld', '1:42:8'], 3: ['Colony', '2:118:12'], 5: ['Moon', '1:42:8'] };
function bodyPage(name, id) {
  let html = T.fixture(name);
  html = html.replace(/(name="ogame-planet-id" content=")\d+/, '$1' + id);
  if (BODY_META[id]) html = html.replace(/(name="ogame-planet-coordinates" content=")[^"]*/, '$1' + BODY_META[id][1]);
  return html;
}
function installBodyRoutes(env) {
  env.server.route('GET', '/fleet', (req, res, ctx) => {
    const id = ctx.state.currentBodyId;
    ctx.rec.fixture = 'live-menu:fleet:' + id;
    return ctx.send(200, rewrite(bodyPage(id === 5 ? 'fleet-dispatch-noships.html' : 'fleet-dispatch-planet.html', id), ctx.origin), 'text/html; charset=utf-8');
  });
  env.server.route('GET', '/resources', (req, res, ctx) => {
    const id = ctx.state.currentBodyId;
    ctx.rec.fixture = 'live-menu:resources:' + id;
    return ctx.send(200, rewrite(bodyPage(id === 5 ? 'layout-overview-moon.html' : 'layout-overview-planet.html', id), ctx.origin), 'text/html; charset=utf-8');
  });
}
const pageReqs = (env) => env.requests('GET').filter((r) => /^\/(fleet|resources|overview)$/.test(r.path)).map((r) => r.path + (r.cp != null ? '?cp=' + r.cp : ''));

T.test('menu: entry once, modal with freshness, all Live settings, persisted toggle', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  await env.waitFor(page, '#menuTableTools #ogx-l-menu-entry');
  assert.equal(await page.$$eval('#menuTableTools .ogx-menu-entry', (e) => e.length), 1);
  assert.equal(await page.$$eval('#ogx-l-menu-entry', (e) => e.length), 1);
  assert.match(await page.textContent('#ogx-l-menu-entry .textlabel'), /OgameX Live/);

  await page.click('#ogx-l-menu-entry a.menubutton');
  await env.waitFor(page, '#ogx-l-menu-modal .ogx-l-menu-fresh tbody tr');
  // three bodies of the vega planet list: Homeworld [1:42:8], its moon, Colony [2:118:12]
  const rows = await page.$$eval('#ogx-l-menu-modal .ogx-l-menu-fresh tbody tr', (trs) => trs.map((tr) => tr.dataset.key + '|' + tr.textContent));
  assert.equal(rows.length, 3, rows.join('\n'));
  assert.deepEqual(rows.map((r) => r.split('|')[0]), ['p1', 'm5', 'p3']);
  assert.match(rows[0], /\[1:42:8\]/);
  assert.match(rows[1], /\[1:42:8\]\s*Л/);
  assert.match(rows[2], /\[2:118:12\]/);
  // the current body was seen "just now"; the colony was never visited
  assert.match(rows[0], /только что/);
  const p3Seen = await page.$eval('#ogx-l-menu-modal .ogx-l-menu-fresh tr[data-key="p3"] td:nth-child(2)', (td) => td.textContent);
  assert.equal(p3Seen, '—');

  // settings: core, menu, planetbar, diag fieldsets; hidden core.cpConfirmed not shown
  const ns = await page.$$eval('#ogx-l-menu-settings fieldset', (f) => f.map((x) => x.dataset.ns));
  for (const n of ['core', 'menu', 'planetbar', 'diag']) assert.ok(ns.includes(n), 'fieldset ' + n + ' in ' + ns);
  assert.equal(await page.$$eval('#ogx-l-menu-settings [data-key="core.cpConfirmed"]', (e) => e.length), 0);
  assert.equal(await page.$$eval('#ogx-l-menu-settings [data-key="menu.galaxyClock"] input[type=checkbox]', (e) => e.length), 1);
  assert.equal(await page.$$eval('#ogx-l-menu-coexist', (e) => e.length), 0);
  // server data section (from /overlay/server-settings)
  await page.waitForFunction(() => document.querySelector('#ogx-l-menu-modal .ogx-l-menu-server'));
  assert.match(await page.textContent('#ogx-l-menu-modal .ogx-l-menu-server'), /Экономика\s*x\d/);
  // diagnostics: the shared panel (or the fallback buttons)
  assert.ok(await page.$$eval('#ogx-l-menu-modal [data-sec="diag"] button', (e) => e.length) >= 1);

  // toggle planetbar.enabled -> persisted in nested settings
  await page.click('#ogx-set-planetbar-enabled');
  await page.waitForTimeout(400);
  const settings = await env.get('settings');
  assert.equal(settings.planetbar.enabled, false);
  assert.equal(await page.$eval('[data-ogx-act="menu:reload"]', (b) => b.hidden), false);

  // close + reopen: one modal only
  await page.keyboard.press('Escape');
  await page.click('#ogx-l-menu-entry a.menubutton');
  await page.$eval('#ogx-l-menu-entry a.menubutton', (a) => a.click()); // second click while open (overlay covers the menu)
  await page.waitForTimeout(200);
  assert.equal(await page.$$eval('#ogx-l-menu-modal', (e) => e.length), 1);

  // journal: user actions recorded
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => e.k === 'menu' || (e.s === 'U' && /menu/.test(e.w))).map((e) => e.s + ' ' + e.k + ' ' + e.w));
  assert.ok(ev.some((x) => /^U menu modal:open/.test(x)), ev.join('\n'));
  assert.ok(ev.some((x) => /^U menu setting/.test(x)), ev.join('\n'));

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('menu: refresh-all shows the ?cp= notice, fetches every body in order and restores the original body', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'menu.refreshIncludeSettings': false } });
  installBodyRoutes(env);
  const page = await env.open('/overview');
  await env.waitFor(page, '#ogx-l-menu-entry');
  await page.click('#ogx-l-menu-entry a.menubutton');
  await env.waitFor(page, '#ogx-l-menu-refresh');
  env.clearRequests();

  // the notice: cancel first -> nothing happens
  await page.click('#ogx-l-menu-refresh');
  await page.waitForSelector('.ogx-l-menu-notice');
  assert.match(await page.textContent('.ogx-l-menu-notice'), /\?cp=/);
  await page.click('.ogx-modal-buttons button[data-role="cancel"]');
  await page.waitForTimeout(300);
  assert.deepEqual(pageReqs(env), []);
  assert.notEqual((await env.get('settings') || {}).core && (await env.get('settings')).core.cpConfirmed, true);

  // confirm -> refresh
  await page.click('#ogx-l-menu-refresh');
  await page.waitForSelector('.ogx-l-menu-notice');
  await page.click('.ogx-modal-buttons button[data-role="ok"]');
  await page.waitForFunction(() => { const r = document.getElementById('ogx-l-menu-result'); return r && !r.hidden; }, null, { timeout: 30000 });
  const result = await page.textContent('#ogx-l-menu-result');
  assert.match(result, /Обновлено: 6 из 6 запросов\./, result);
  assert.doesNotMatch(result, /Ошибок/);

  assert.deepEqual(pageReqs(env), ['/fleet?cp=1', '/resources?cp=1', '/fleet?cp=5', '/resources?cp=5', '/fleet?cp=3', '/resources?cp=3', '/overview?cp=1']);
  // sequential: each request starts after the previous one was recorded (polite queue, httpGapMs apart)
  const ts = env.requests('GET').filter((r) => /^\/(fleet|resources)$/.test(r.path)).map((r) => r.t);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 250, 'gap ' + (ts[i] - ts[i - 1]));
  assert.equal((await env.get('settings')).core.cpConfirmed, true);

  // freshness now: ships known for every body, the table shows them as fresh
  await page.waitForFunction(() => [...document.querySelectorAll('#ogx-l-menu-modal .ogx-l-menu-fresh tbody tr td:nth-child(4)')].every((td) => /только что/.test(td.textContent)));
  const bodies = await env.get('bodies');
  for (const k of ['p1', 'm5', 'p3']) assert.ok(bodies[k] && bodies[k].shipsT > 0, 'shipsT of ' + k);
  // moon "Добыча %" column is n/a
  assert.equal(await page.$eval('#ogx-l-menu-modal .ogx-l-menu-fresh tr[data-key="m5"] td:nth-child(5)', (td) => td.textContent), '—');

  // B events recorded by OGX.log.wrap and rec
  const ev = await env.evalOgx(page, () => OGX.diag.recent({ s: 'B' }).filter((e) => e.k === 'menu').map((e) => ({ w: e.w, d: e.d })));
  const wrapped = ev.find((e) => e.w === 'refreshAll');
  assert.ok(wrapped && wrapped.d && wrapped.d.ok === true, JSON.stringify(ev));
  assert.ok(ev.some((e) => e.w === 'refresh:end' && e.d.done === 6 && e.d.restored === true), JSON.stringify(ev));

  // second run: no notice any more, settings page included when enabled
  await page.click('#ogx-set-menu-refreshIncludeSettings');
  await page.waitForTimeout(300);
  env.clearRequests();
  await page.click('#ogx-l-menu-refresh');
  await page.waitForFunction(() => /из 8 запросов/.test((document.getElementById('ogx-l-menu-result') || {}).textContent || ''), null, { timeout: 30000 });
  assert.equal(await page.$$eval('.ogx-l-menu-notice', (e) => e.length), 0);
  const settingsReqs = env.requests('GET', '/resources/settings').map((r) => r.cp);
  assert.deepEqual(settingsReqs, [1, 3]);

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('menu: refresh-all can be cancelled and still restores the original body', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.cpConfirmed': true } });
  installBodyRoutes(env);
  const page = await env.open('/overview');
  await env.waitFor(page, '#ogx-l-menu-entry');
  await page.click('#ogx-l-menu-entry a.menubutton');
  await env.waitFor(page, '#ogx-l-menu-refresh');
  env.clearRequests();
  env.setState({ latencyMs: 400 });
  await page.click('#ogx-l-menu-refresh');
  await page.waitForFunction(() => { const p = document.getElementById('ogx-l-menu-progress'); return p && !p.hidden; });
  assert.equal(await page.$eval('#ogx-l-menu-refresh', (b) => b.disabled), true);
  // the menu badge shows the progress
  await page.waitForFunction(() => /\d+\/\d+/.test(document.querySelector('#ogx-l-menu-entry .ogx-menu-badge').textContent));
  await page.waitForFunction(() => /Выполнено [1-9]/.test(document.querySelector('.ogx-l-menu-prog-text').textContent), null, { timeout: 15000 });
  await page.click('#ogx-l-menu-cancel');
  await page.waitForFunction(() => { const r = document.getElementById('ogx-l-menu-result'); return r && !r.hidden; }, null, { timeout: 20000 });
  assert.match(await page.textContent('#ogx-l-menu-result'), /отменено/i);
  const reqs = pageReqs(env);
  const fetches = reqs.filter((r) => !r.startsWith('/overview'));
  assert.ok(fetches.length >= 1 && fetches.length < 6, reqs.join(', '));
  assert.equal(reqs[reqs.length - 1], '/overview?cp=1');
  assert.equal(await page.$eval('#ogx-l-menu-refresh', (b) => b.disabled), false);
  assert.equal(await page.$eval('#ogx-l-menu-progress', (p) => p.hidden), true);
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => e.k === 'menu').map((e) => e.s + ' ' + e.w));
  assert.ok(ev.includes('U refresh:cancel'), ev.join(', '));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('menu: galaxy footer clock, setting off removes it; coexistence note', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/galaxy');
  await env.waitFor(page, '.ctGalaxyFooter #colonized + #ogx-l-menu-clock');
  await page.waitForFunction(() => /^\d\d:\d\d:\d\d$/.test(document.querySelector('#ogx-l-menu-clock .ogx-l-menu-clock-time').textContent));
  const t1 = await page.textContent('#ogx-l-menu-clock .ogx-l-menu-clock-time');
  const now = await env.evalOgx(page, () => OGX.fmt.time(OGX.time.serverNow()));
  const sec = (s) => s.split(':').reduce((a, b) => a * 60 + +b, 0);
  assert.ok(Math.abs(sec(now) - sec(t1)) <= 2 || Math.abs(sec(now) - sec(t1)) >= 86398, t1 + ' vs ' + now);
  await page.waitForTimeout(1300);
  assert.notEqual(await page.textContent('#ogx-l-menu-clock .ogx-l-menu-clock-time'), t1);
  assert.equal(await page.$$eval('#ogx-l-menu-clock', (e) => e.length), 1);

  // coexistence note when Infinity is present
  await page.evaluate(() => document.documentElement.setAttribute('data-ogx-infinity', 'ready'));
  await page.click('#ogx-l-menu-entry a.menubutton');
  await env.waitFor(page, '#ogx-l-menu-coexist');
  assert.match(await page.textContent('#ogx-l-menu-coexist'), /OgameX Infinity/);

  // turn the clock off in the modal
  await page.click('#ogx-set-menu-galaxyClock');
  await page.waitForFunction(() => !document.getElementById('ogx-l-menu-clock'));
  await page.waitForTimeout(400);
  assert.equal((await env.get('settings')).menu.galaxyClock, false);
  // not on other pages
  const p2 = await env.open('/overview');
  await env.waitFor(p2, '#ogx-l-menu-entry');
  assert.equal(await p2.$$eval('#ogx-l-menu-clock', (e) => e.length), 0);
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('menu: nothing on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"],[id^="ogx-"]', (e) => e.length), 0);
  const p2 = await env.open('/gameforge-like', { waitReady: false });
  await p2.waitForTimeout(300);
  assert.equal(await p2.$$eval('[id^="ogx-"]', (e) => e.length), 0);
  assert.deepEqual(env.requests().map((r) => r.path), ['/not-ogame', '/gameforge-like']);
  assert.deepEqual(env.ogxErrors(), []);
});
