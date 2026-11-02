'use strict';
// Smoke test of the test harness itself (server.js + lib.js) with the dummy extension in tests/dummy-ext.
//   node tests/harness.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./lib');
const { assert } = T;

const DUMMY = { name: 'dummy', dir: path.join(__dirname, 'dummy-ext') };
const VEGA_TOKEN = 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e';

// A second copy of the dummy with another name, to run two extensions side by side.
function dummy2() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogx-dummy2-'));
  fs.cpSync(DUMMY.dir, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'loader.js'), "OGX.boot({ ext: 'dummy2', modules: ['probe'] });\n");
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  mf.name = 'OGX Dummy 2';
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf, null, 2));
  return { name: 'dummy2', dir };
}

// Shared checks for both modes.
async function commonChecks(env, t) {
  // first visit: ready, box, storage written, read-only AJAX recorded
  const page = await env.open('/overview');
  const box = await env.waitFor(page, '.ogx-dummy-box');
  assert.equal(await box.getAttribute('data-visits'), '1');
  assert.equal(await box.getAttribute('data-seed'), 'посеяно', 'seeded storage is visible to the extension');
  await env.waitFor(page, '.ogx-dummy-box[data-hostile]');
  assert.equal(await box.getAttribute('data-hostile'), '1');
  assert.equal((await box.textContent()).startsWith('Тестовое расширение работает'), true);

  // MAIN world hook ran, isolated globals are not visible from the page world, but evalOgx reaches them
  assert.equal(await page.evaluate(() => !!window.__ogxDummyHook), true, 'MAIN-world script ran');
  assert.equal(await page.evaluate(() => typeof window.OGX), 'undefined', 'isolated world is separate from the page');
  assert.equal(await env.evalOgx(page, () => OGX.storage.backend), 'chrome');
  assert.equal(await env.evalOgx(page, () => OGX.isOgx()), true);
  assert.deepEqual(await env.evalOgx(page, (x) => x * 2, 21), 42);

  // storage via the harness
  const st = await env.storage();
  assert.equal(st[env.key('dummy.visits')], 1);
  assert.equal(await env.get('dummy.visits'), 1);
  await env.setStorage({ [env.key('dummy.visits')]: 10 });

  // second visit with ?cp= switching to the moon; storage persisted across navigations
  const p2 = await env.open('/overview?cp=5');
  assert.equal(await p2.getAttribute('meta[name="ogame-planet-id"]', 'content'), '5');
  assert.equal(await p2.getAttribute('.ogx-dummy-box', 'data-visits'), '11');
  assert.equal(env.server.state.currentBodyId, 5);
  const p3 = await env.open('/overview');
  assert.equal(await p3.getAttribute('meta[name="ogame-planet-id"]', 'content'), '5', 'body stays switched without cp');

  // fixture links point at the mock origin
  const href = await p3.getAttribute('#planetList a[href*="cp=1"]', 'href');
  assert.ok(href.startsWith(env.origin + '/overview'), href);

  // POST recorded with parsed form and CSRF verdict
  env.clearRequests();
  await p3.click('.ogx-dummy-send');
  await env.waitFor(p3, '.ogx-dummy-box[data-sent]');
  assert.equal(await p3.getAttribute('.ogx-dummy-box', 'data-sent'), 'true');
  const sent = env.requests('POST', '/ajax/fleet/dispatch/send-fleet');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].form.am204, '5');
  assert.equal(sent[0].form._token, VEGA_TOKEN);
  assert.equal(sent[0].csrf, true);
  assert.equal(sent[0].fixture, 'fleet-send-fleet-success.json');

  // same log through the inspection endpoint
  const log = await (await fetch(env.server.origin + '/__ogx/requests')).json();
  assert.ok(log.some((r) => r.path === '/ajax/fleet/dispatch/send-fleet' && r.form.mission === '1'));

  // a failing module is reported by ogxErrors(); a clean run has none
  assert.deepEqual(env.ogxErrors(), []);
  await env.open('/overview#ogx-fail', { waitReady: false });
  await env.page().then((p) => p.reload());
  await env.waitReady(await env.page());
  assert.ok(env.ogxErrors().some((e) => /намеренная ошибка/.test(e.text)), 'module error captured');
  env.clearLogs();
  const pt = await env.open('/fleet#ogx-throw', { newPage: true });
  await pt.waitForTimeout(300);
  assert.ok(env.ogxErrors().some((e) => e.type === 'pageerror' && /uncaught/.test(e.text)), 'uncaught extension error captured: ' + JSON.stringify(env.logs));
  await pt.close();
  env.clearLogs();

  // safety: nothing happens on a non-OgameX page
  env.clearRequests();
  const np = await env.open('/not-ogame', { waitReady: false });
  await np.waitForTimeout(300);
  assert.equal(await np.$$eval('[class*="ogx-"]', (els) => els.length), 0);
  assert.equal(await np.evaluate(() => [...document.documentElement.attributes].filter((a) => a.name.startsWith('data-ogx')).length), 0);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
  for (const p of ['/login', '/gameforge-like']) {
    const pg = await env.open(p, { waitReady: false });
    await pg.waitForTimeout(200);
    assert.equal(await pg.$$eval('.ogx-dummy-box', (e) => e.length), 0, p);
  }
  // excluded host (manifest exclude_matches) serving a real OgameX page: extension stays off
  const gf = await env.open(env.urlOn('s1-en.ogame.gameforge.com', '/overview'), { waitReady: false });
  await gf.waitForTimeout(300);
  assert.equal(await gf.$$eval('.ogx-dummy-box', (e) => e.length), 0, 'gameforge host excluded');
  assert.equal(await gf.evaluate(() => !!window.__ogxDummyHook), false, 'MAIN hook excluded too');
  // any other domain works
  const od = await env.open(env.urlOn('ogame.example.org', '/overview'));
  assert.equal(await od.$$eval('.ogx-dummy-box', (e) => e.length), 1);

  assert.deepEqual(env.server.unhandled, []);
  assert.deepEqual(env.ogxErrors(), []);
  t.log(`mode=${env.mode}`);
}

T.test('server: fixtures, ?cp=, CSRF, AJAX mocks, request log', async () => {
  const srv = await T.startServer({ scenario: 'vega' });
  try {
    const o = srv.origin;
    let r = await fetch(o + '/overview?cp=3');
    let html = await r.text();
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(html, /ogame-planet-id" content="3"/);
    assert.ok(!/http:\/\/localhost\//.test(html.replace(new RegExp(o, 'g'), '')), 'all localhost URLs rewritten');
    r = await fetch(o + '/ajax/galaxy', { method: 'POST', body: new URLSearchParams({ galaxy: '1', system: '42' }) });
    assert.equal(r.status, 419);
    r = await fetch(o + '/ajax/galaxy', { method: 'POST', body: new URLSearchParams({ galaxy: '7', system: '300', _token: VEGA_TOKEN }) });
    const g = await r.json();
    assert.equal(g.system.galaxy, 7);
    assert.equal(g.system.system, 300);
    r = await fetch(o + '/ajax/fleet/eventlist/checkevents', { method: 'POST', headers: { 'X-CSRF-TOKEN': VEGA_TOKEN } });
    assert.match(r.headers.get('content-type'), /text\/plain/);
    r = await fetch(o + '/ajax/fleet/dispatch/recall-fleet', { method: 'POST', body: new URLSearchParams({ fleet_mission_id: '1201', _token: VEGA_TOKEN }) });
    assert.equal((await r.json()).success, true);
    r = await fetch(o + '/ajax/fleet/dispatch/recall-fleet', { method: 'POST', body: new URLSearchParams({ fleet_mission_id: '5', _token: VEGA_TOKEN }) });
    assert.equal(r.status, 500);
    r = await fetch(o + '/ajax/fleet/dispatch/check-target', { method: 'POST', body: new URLSearchParams({ galaxy: '1', system: '42', position: '16', type: '1', _token: VEGA_TOKEN }) });
    assert.ok((await r.json()).shipsData);
    r = await fetch(o + '/resources/add-buildrequest', { method: 'POST', headers: { 'X-CSRF-TOKEN': VEGA_TOKEN }, body: new URLSearchParams({ technologyId: '1' }) });
    assert.equal((await r.json()).message, 'Invalid token.');
    r = await fetch(o + '/ajax/highscore?category=1&type=0&page=1', { method: 'POST', headers: { 'X-CSRF-TOKEN': VEGA_TOKEN } });
    html = await r.text();
    assert.match(html, /id="ranks"/);
    assert.ok(!/<html/i.test(html));
    r = await fetch(o + '/ajax/messages/2051?tab=fleets&subtab=espionage');
    assert.equal(r.status, 200);
    r = await fetch(o + '/ajax/messages/1');
    assert.equal(r.status, 500);
    srv.route('GET', '/custom', (req, res, ctx) => ctx.jsonBody({ hi: 1 }));
    assert.deepEqual(await (await fetch(o + '/custom')).json(), { hi: 1 });
    await fetch(o + '/no/such/route');
    assert.deepEqual(srv.unhandled.map((x) => x.path), ['/no/such/route']);
    const log = await (await fetch(o + '/__ogx/requests')).json();
    assert.ok(log.find((x) => x.path === '/ajax/galaxy' && x.form.galaxy === '7'));
    srv.setScenario('orion');
    html = await (await fetch(o + '/resources?cp=7')).text();
    assert.match(html, /ogame-planet-id" content="7"/);
    html = await (await fetch(o + '/fleet')).text();
    assert.match(html, /ogame-player-id" content="108"/, 'fallback to the other account');
  } finally {
    await srv.close();
  }
});

T.test('extension mode: real unpacked extension in headless Chromium', async (t) => {
  const env = await T.launch({ ext: DUMMY, mode: 'extension', fallback: false, storage: { '{host}|{pid}|dummy.seed': 'посеяно' } });
  assert.equal(env.mode, 'extension');
  assert.ok(env.worker('dummy'), 'service worker running');
  await commonChecks(env, t);
  await env.close();
});

T.test('inject mode: manifest content scripts + chrome.storage shim', async (t) => {
  const env = await T.launch({ ext: DUMMY, mode: 'inject', storage: { '{host}|{pid}|dummy.seed': 'посеяно' } });
  assert.equal(env.mode, 'inject');
  await commonChecks(env, t);
  // chrome.storage.onChanged reaches other tabs; runtime ping answers
  const a = await env.open('/overview');
  const b = await env.open('/fleet', { newPage: true });
  await env.evalOgx(b, () => { window.__seen = []; chrome.storage.onChanged.addListener((c) => window.__seen.push(Object.keys(c))); });
  await env.evalOgx(a, () => chrome.storage.local.set({ 'x.y': 1 }));
  await b.waitForTimeout(200);
  assert.deepEqual(await env.evalOgx(b, () => window.__seen), [['x.y']]);
  assert.deepEqual(await env.evalOgx(a, () => chrome.runtime.sendMessage({ type: 'ogx:ping' })), { ok: true, ext: 'dummy', shim: true });
  assert.deepEqual(await env.evalOgx(a, () => chrome.storage.local.get({ 'x.y': 0, 'nope': 5 })), { 'x.y': 1, nope: 5 });
  await env.close();
});

T.test('two extensions side by side (both modes), game JS + XHR hook + page stub', async () => {
  const d2 = dummy2();
  try {
    for (const mode of ['extension', 'inject']) {
      const env = await T.launch({ ext: [DUMMY, d2], mode, fallback: false, gameJs: true });
      const page = await env.open('/galaxy');
      assert.equal(await page.$$eval('.ogx-dummy-box-dummy', (e) => e.length), 1);
      assert.equal(await page.$$eval('.ogx-dummy-box-dummy2', (e) => e.length), 1);
      // storage is separate per extension
      const st = await env.storage();
      assert.equal(st.dummy[env.key('dummy.visits')], 1);
      assert.equal(st.dummy2[env.key('dummy.visits')], 1);
      // the game's own JS posts /ajax/galaxy (initial load may happen before init; trigger one more after ready);
      // the first MAIN hook relays it to both isolated worlds
      await page.evaluate(() => window.loadContentNew(1, 45));
      await env.waitFor(page, '.ogx-dummy-box-dummy[data-xhr]');
      await env.waitFor(page, '.ogx-dummy-box-dummy2[data-xhr]');
      assert.ok(env.requests('POST', '/ajax/galaxy').length >= 1);
      assert.equal(await page.getAttribute('.ogx-dummy-box-dummy2', 'data-xhr-last'), '/ajax/galaxy');
      // page stub for fleetDispatcher
      await env.pageStub(page, 'fleetDispatcher');
      await page.evaluate(() => { window.fleetDispatcher.selectShips({ 204: 3 }); window.fleetDispatcher.refresh(); });
      assert.deepEqual((await env.stubCalls(page)).map((c) => c.method), ['selectShips', 'refresh']);
      assert.deepEqual(env.ogxErrors(), [], mode);
      await env.close();
    }
  } finally {
    fs.rmSync(d2.dir, { recursive: true, force: true });
  }
});

T.test('fallback: extension mode that never gets ready switches to inject mode', async () => {
  // probing a non-OgameX page can never reach "ready", which simulates a broken extension load
  const env = await T.launch({ ext: DUMMY, mode: 'extension', probePath: '/not-ogame', extTimeout: 2000 });
  assert.equal(env.mode, 'inject');
  const page = await env.open('/overview');
  assert.equal(await page.getAttribute('.ogx-dummy-box', 'data-visits'), '1');
  assert.deepEqual(env.server.unhandled, []);
  await env.close();
});
