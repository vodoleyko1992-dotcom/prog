'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / stalk: galaxy eye button, targets:track + highscore home lookup, «Сканировать» through the core scanner
// (one POST per system, pacing >= 500 ms), activity samples (18 min -> lastSeen = scannedAt - 18 min), self-caused activity,
// «Слежка» tab (bodies, 24 h strip, 7-day summary), 403 vacation stop, espionage_detected messages, auto-scan scheduler
// (runs off /galaxy, paused on /galaxy), diagnostics, safety on non-OgameX pages.
//   node tests/legacy-ogamex/infinity-stalk.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');
const { rewrite } = require('../server');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_PANEL = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/stalk/stalk.js'), 'utf8');

let extCache = null;
function ext() {
  if (fs.existsSync(path.join(ROOT, 'ogamex-infinity/manifest.json')) && process.env.OGX_STALK_REAL_EXT) return 'infinity';
  if (!extCache) extCache = coreExt({ name: 'infinity', modules: { panel: SRC_PANEL, stalk: SRC } });
  return extCache;
}
const nb = (s) => String(s || '').replace(/[  \s]+/g, ' ').trim();
const MIN = 60000;
const P = 'ogx-i-stalk-';

/** Simulates the game: inserts the rendered #galaxyContent and relays the /ajax/galaxy response like page-hook.js does. */
async function renderGalaxy(env, page, g, s) {
  const json = T.fixture(`galaxy-ajax-${g}-${s}.json`);
  const html = T.fixture(`galaxy-rendered-${g}-${s}.html`).replace(/<!--[\s\S]*?-->/g, '').trim();
  await page.evaluate(({ html, json, origin, g, s }) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    document.getElementById('galaxyContent').replaceWith(tmp.querySelector('#galaxyContent'));
    document.getElementById('galaxy_input').value = String(g);
    document.getElementById('system_input').value = String(s);
    document.dispatchEvent(new CustomEvent('ogx:xhr', { detail: JSON.stringify({
      url: origin + '/ajax/galaxy', method: 'POST', status: 200, requestBody: `galaxy=${g}&system=${s}&_token=x`, responseText: json, t: Date.now(),
    }) }));
  }, { html, json, origin: env.origin, g, s });
}
async function openTab(page) {
  await page.waitForSelector('#menuTableTools #ogx-i-panel-entry', { state: 'attached', timeout: 10000 });
  const hidden = await page.$eval('#ogx-panel-infinity', (e) => e.hidden);
  if (hidden) await page.click('#ogx-i-panel-entry a.menubutton');
  await page.click('#ogx-panel-infinity .ogx-tab[data-tab="stalk"]');
  await page.waitForSelector('#ogx-panel-infinity .ogx-tab-pane[data-tab="stalk"]:not([hidden]) .ogx-i-stalk-tab', { timeout: 5000 });
}
async function waitStore(env, key, pred, ms = 8000) {
  const end = Date.now() + ms;
  let v = null;
  while (Date.now() < end) { v = await env.get(key); if (v && pred(v)) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`${key} condition not met: ${JSON.stringify(v).slice(0, 1500)}`);
}
const galaxyPosts = (env) => env.requests('POST', '/ajax/galaxy');
async function journal(env, page) {
  await env.evalOgx(page, () => OGX.diag.flush().then(() => true));
  return env.evalOgx(page, async () => {
    const st = await OGX.diag.store();
    const r = await st.query({ last: 3000 });
    return r.events.map((e) => e.s + ' ' + e.k + ' ' + e.w);
  });
}

T.test('stalk: galaxy eye tracks Rookie from the galaxy row, cached activity 37 min shown in the tab', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/galaxy');
  await renderGalaxy(env, page, 1, 42);
  await page.waitForSelector('#galaxyRow13 > .ogx-gx-slot[data-owner="stalk"] .ogx-i-stalk-eye', { timeout: 10000 });
  const rows = await page.$$eval('.ogx-gx-slot[data-owner="stalk"] .ogx-i-stalk-eye', (els) => els.map((e) => +e.closest('[id^="galaxyRow"]').id.replace('galaxyRow', '')));
  assert.deepEqual(rows.sort((a, b) => a - b), [4, 6, 11, 13], 'one eye per foreign occupied row, none on the own row 8');
  env.clearRequests();

  await page.click('#galaxyRow13 .ogx-i-stalk-eye');
  const players = await waitStore(env, 'stalk.players', (v) => v.items && v.items['204']);
  assert.equal(players.v, 1);
  assert.equal(players.items['204'].name, 'Rookie');
  assert.deepEqual(players.items['204'].systems, ['1:42']);
  const log = await waitStore(env, 'stalk.log', (v) => v.items && v.items['204'] && v.items['204'].length);
  const s = log.items['204'].find((x) => x.coords === '1:42:13' && x.body === 'p');
  assert.ok(s, 'sample for Little Rock');
  assert.equal(s.activity, 37);
  assert.equal(s.lastSeen, s.t - 37 * MIN);
  assert.equal(s.self, false);
  assert.equal(players.items['204'].scans['1:42'], s.t, 'cached system counts as a scan');
  await page.waitForSelector('#galaxyRow13 .ogx-i-stalk-eye.ogx-i-stalk-eye-on', { timeout: 5000 });
  assert.equal(env.requests().filter((r) => r.path !== '/favicon.ico').length, 0, 'tracking from the galaxy needs no request');

  // the tab
  await openTab(page);
  await page.waitForSelector(`.${P}card[data-player-id="204"]`, { timeout: 5000 });
  const card = nb(await page.textContent(`.${P}card[data-player-id="204"]`));
  assert.match(card, /Rookie/);
  assert.match(card, /\[1:42:13\]/);
  assert.match(card, /Little Rock/);
  assert.match(nb(await page.textContent(`.${P}card[data-player-id="204"] tr[data-coords="1:42:13"] .${P}act`)), /^37 мин$/);
  assert.match(nb(await page.textContent(`.${P}card[data-player-id="204"] .${P}seen`)), /^37 мин назад$/);
  assert.equal(await page.$$eval(`.${P}card[data-player-id="204"] .${P}strip .${P}cell`, (e) => e.length), 96);
  assert.equal(await page.$$eval(`.${P}card[data-player-id="204"] .${P}strip .${P}c-act`, (e) => e.length), 1);
  assert.equal(await page.$$eval(`.${P}card[data-player-id="204"] .${P}heat tbody tr`, (e) => e.length), 7);
  assert.match(nb(await page.textContent(`.${P}card[data-player-id="204"] .${P}week .${P}sub`)), /интервалов 1$/);

  // untrack via the eye again
  await page.$eval('#galaxyRow13 .ogx-i-stalk-eye', (b) => b.click());   // the open side panel covers the row
  await waitStore(env, 'stalk.players', (v) => v.items && !v.items['204']);
  await page.waitForSelector('#galaxyRow13 .ogx-i-stalk-eye:not(.ogx-i-stalk-eye-on)', { timeout: 5000 });

  const ev = await journal(env, page);
  assert.ok(ev.some((x) => /^B stalk track/.test(x)), 'B track');
  assert.ok(ev.some((x) => /^B stalk untrack/.test(x)), 'B untrack');
  assert.ok(ev.some((x) => /^U .*stalk:galaxy-eye/.test(x)), 'U eye click');
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();
});

T.test('stalk: targets:track Raider42, scan now posts 1:45 once, 18 min activity, self flag, pacing between systems', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  await env.evalOgx(page, () => { OGX.bus.emit('targets:track', { playerId: 233, playerName: 'Raider42' }); return true; });
  const pl = await waitStore(env, 'stalk.players', (v) => v.items && v.items['233']);
  assert.deepEqual(pl.items['233'].systems, ['1:45'], 'home system from the highscore around the player');
  const hs = env.requests('POST', '/ajax/highscore');
  assert.equal(hs.length, 1);
  assert.equal(+hs[0].form.searchRelId, 233);

  // own espionage probes landed on the moon 3 minutes ago -> its '*' is self-caused
  const T0 = await env.evalOgx(page, () => {
    const t = OGX.time.serverNow();
    OGX.bus.emit('flights:updated', { t, flights: [{ rowId: 9001, realMissionId: 9001, synthetic: null, isUnion: false, missionType: 6, returnFlight: false,
      arrival: t - 3 * 60000, from: '1:42:8', fromType: 1, to: '1:45:6', toType: 3, own: true, status: 'friendly', ships: { 210: 1 }, units: 1 }] });
    return t;
  });
  await waitStore(env, 'stalk.self', (v) => v.items && v.items.length === 1);

  env.clearRequests();
  await openTab(page);
  await page.waitForSelector(`.${P}card[data-player-id="233"] .${P}scan`, { timeout: 5000 });
  await page.click(`.${P}card[data-player-id="233"] .${P}scan`);
  const log = await waitStore(env, 'stalk.log', (v) => v.items && v.items['233'] && v.items['233'].length >= 2);
  const planet = log.items['233'].find((x) => x.coords === '1:45:6' && x.body === 'p');
  const moon = log.items['233'].find((x) => x.coords === '1:45:6' && x.body === 'm');
  assert.equal(planet.activity, 18);
  assert.equal(planet.lastSeen, planet.t - 18 * MIN, 'lastSeen = scannedAt - 18 min');
  assert.equal(planet.self, false);
  assert.equal(planet.src, 'scan');
  assert.ok(planet.t >= T0 && planet.t - T0 < 60000);
  assert.equal(moon.activity, '*');
  assert.equal(moon.lastSeen, moon.t);
  assert.equal(moon.self, true, 'own probes arrived 3 min before');
  const posts = galaxyPosts(env);
  assert.equal(posts.length, 1, 'one POST for one system');
  assert.equal(+posts[0].form.galaxy, 1);
  assert.equal(+posts[0].form.system, 45);
  assert.equal(posts[0].cp, null, 'scans never send cp');
  const pl2 = await waitStore(env, 'stalk.players', (v) => v.items['233'].lastScanAt === planet.t);
  assert.equal(pl2.items['233'].scans['1:45'], planet.t);
  assert.equal(pl2.items['233'].planets['1:45:6'].name, 'Farmville');

  // tab numbers
  await page.waitForSelector(`.${P}card[data-player-id="233"] tr[data-coords="1:45:6"][data-body="m"]`, { timeout: 5000 });
  const sel = `.${P}card[data-player-id="233"]`;
  const cells = await page.$$eval(`${sel} tr[data-coords="1:45:6"][data-body="p"] td`, (td) => td.map((x) => x.textContent.replace(/[\u00a0\s]+/g, ' ').trim()));
  assert.deepEqual(cells.slice(0, 4), ['[1:45:6]', 'Farmville', '18 мин', '18 мин назад']);
  assert.match(nb(await page.textContent(`${sel} tr[data-coords="1:45:6"][data-body="m"] .${P}act`)), /^\* \(свой\)$/);
  assert.match(nb(await page.textContent(`${sel} .${P}seen`)), /^18 мин назад$/, 'self-caused moon activity does not count');
  assert.equal(await page.$$eval(`${sel} .${P}strip .${P}c-act`, (e) => e.length), 1);
  assert.equal(await page.$$eval(`${sel} .${P}strip .${P}c-self`, (e) => e.length), 1);
  assert.match(nb(await page.textContent(`${sel} .${P}result, .${P}result`)), /Проверено 1 система/);

  // a second (manual) system: both are scanned, at least 500 ms apart, each once
  await page.fill(`${sel} .${P}sys-input`, '1:46');
  await page.click(`${sel} .${P}sys-add`);
  await waitStore(env, 'stalk.players', (v) => v.items['233'].systems.includes('1:46') && v.items['233'].manual.includes('1:46'));
  await page.waitForSelector(`${sel} .${P}chip-manual`, { timeout: 5000 });
  env.clearRequests();
  await page.click(`${sel} .${P}scan`);
  await waitStore(env, 'stalk.players', (v) => v.items['233'].scans['1:46'] > 0 && v.items['233'].scans['1:45'] > planet.t, 15000);
  const two = galaxyPosts(env);
  assert.deepEqual(two.map((r) => r.form.galaxy + ':' + r.form.system), ['1:46', '1:45'], 'never-scanned system first, each once');
  assert.ok(two[1].t - two[0].t >= 500, `gap ${two[1].t - two[0].t} ms`);
  const pl3 = await env.get('stalk.players');
  assert.ok(pl3.items['233'].systems.includes('1:46'), 'manual system kept although empty');

  const ev = await journal(env, page);
  assert.ok(ev.some((x) => /^B stalk scanNow/.test(x)), 'B scanNow');
  assert.ok(ev.some((x) => /^B stalk recordSystem/.test(x)), 'B recordSystem');
  assert.ok(ev.some((x) => /^U .*stalk:scan/.test(x)), 'U scan click');
  assert.ok(ev.some((x) => /^U .*stalk:add-system/.test(x)), 'U add-system click');
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();
});

T.test('stalk: a 403 vacation answer stops the scan with a message', async () => {
  const env = await T.launch({
    ext: ext(), scenario: 'vacation',
    storage: { '{host}|{pid}|stalk.players': { v: 1, items: { 233: { name: 'Raider42', addedAt: 1, systems: ['1:45', '1:46'], scans: {}, planets: {} } } } },
  });
  const page = await env.open('/overview');
  env.clearRequests();
  await openTab(page);
  await page.click(`.${P}scan-all`);
  await page.waitForSelector(`.${P}result.${P}result-error`, { timeout: 10000 });
  assert.match(nb(await page.textContent(`.${P}result`)), /Сканирование остановлено: включён режим отпуска/);
  assert.match(nb(await page.textContent('#ogx-toasts')), /режим отпуска/);
  await page.waitForTimeout(1200);
  assert.equal(galaxyPosts(env).length, 1, 'stops after the first 403');
  const sched = await waitStore(env, 'stalk.sched', (v) => v.runs && v.runs.length);
  assert.equal(sched.runs[0].stoppedBy, 'vacation');
  assert.ok(sched.pausedUntil > 0);
  assert.equal((await env.get('stalk.log')) ?? null, null, 'nothing recorded');
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();
});

T.test('stalk: espionage_detected message records the tracked spy planet as active', async () => {
  const env = await T.launch({
    ext: ext(), scenario: 'vega',
    storage: { '{host}|{pid}|stalk.players': { v: 1, items: { 300: { name: 'Admiral Rigel', addedAt: 1, systems: [], scans: {}, planets: {} } } } },
  });
  env.server.route('GET', '/messages', (req, res, ctx) => {
    ctx.rec.fixture = 'messages-page-loaded-espionage.html';
    return ctx.send(200, rewrite(T.fixture('messages-page-loaded-espionage.html'), ctx.origin), 'text/html; charset=utf-8');
  });
  const page = await env.open('/messages');
  const log = await waitStore(env, 'stalk.log', (v) => v.items && v.items['300'] && v.items['300'].length);
  assert.equal(log.items['300'].length, 1, 'only the espionage_detected message (2049)');
  const s = log.items['300'][0];
  const ts = await env.evalOgx(page, () => OGX.time.parseServerWall('30.10.2026 00:33:51'));
  assert.deepEqual({ coords: s.coords, body: s.body, activity: s.activity, src: s.src, msg: s.msg }, { coords: '1:42:11', body: 'p', activity: '*', src: 'spy', msg: 2049 });
  assert.equal(s.t, ts);
  assert.equal(s.lastSeen, ts);
  // a reload does not record it twice
  await page.reload();
  await env.waitReady(page);
  await page.waitForTimeout(800);
  assert.equal((await env.get('stalk.log')).items['300'].length, 1);
  const ev = await journal(env, page);
  assert.ok(ev.some((x) => /^B stalk recordSpy/.test(x)), 'B recordSpy');
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();
});

T.test('stalk: auto-scan scheduler re-scans due systems off /galaxy and pauses on /galaxy', async () => {
  const seed = { v: 1, items: { 233: { name: 'Raider42', addedAt: 1, systems: ['1:45'], scans: { '1:45': 1 }, planets: {} } } };
  const env = await T.launch({
    ext: ext(), scenario: 'vega', settings: { 'stalk.autoScan': true, 'stalk.intervalMin': 5 },
    storage: { '{host}|{pid}|stalk.players': seed },
  });
  const page = await env.open('/overview');
  const end = Date.now() + 10000;
  while (Date.now() < end && !galaxyPosts(env).length) await page.waitForTimeout(200);
  const posts = galaxyPosts(env);
  assert.equal(posts.length, 1, 'scheduler scanned the due system');
  assert.equal(posts[0].form.galaxy + ':' + posts[0].form.system, '1:45');
  const sched = await waitStore(env, 'stalk.sched', (v) => v.runs && v.runs.length);
  assert.equal(sched.runs[0].manual, false);
  assert.equal(sched.runs[0].n, 1);
  await waitStore(env, 'stalk.log', (v) => v.items && v.items['233'] && v.items['233'].some((x) => x.activity === 18));
  const ev = await journal(env, page);
  assert.ok(ev.some((x) => /^B stalk autoScan/.test(x)), 'B autoScan');

  // on /galaxy the scheduler pauses even when the system is due again
  await env.setStorage({ [env.key('stalk.players')]: seed });
  env.clearRequests();
  const g = await env.open('/galaxy');
  await g.waitForTimeout(4000);
  assert.equal(galaxyPosts(env).length, 0, 'no background scan on /galaxy');
  await openTab(g);
  assert.match(nb(await g.textContent(`.${P}status`)), /на паузе: вы на странице галактики/);
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();
});

T.test('stalk: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(500);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
  await env.close();
});
