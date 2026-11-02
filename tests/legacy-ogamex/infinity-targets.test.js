'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / targets: galaxy row tools (colour dot, note, star), row tint, persistence across reload, highscore dots,
// «Поиск» tab (player search, player card, «В цели», «Следить»), «Цели» tab (spy report loot, activity, spy via
// send-mini-fleet, attack prefill, remove), targets:add, storage merger, diagnostics, safety on non-OgameX pages.
//   node tests/legacy-ogamex/infinity-targets.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_PANEL = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/targets/targets.js'), 'utf8');

let extCache = null;
function ext() {
  if (fs.existsSync(path.join(ROOT, 'ogamex-infinity/manifest.json')) && process.env.OGX_TARGETS_REAL_EXT) return 'infinity';
  if (!extCache) extCache = coreExt({ name: 'infinity', modules: { panel: SRC_PANEL, targets: SRC } });
  return extCache;
}
const nb = (s) => String(s || '').replace(/[  \s]+/g, ' ').trim();
const CSRF = 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e';

/** Simulates the game: inserts the rendered #galaxyContent and relays the /ajax/galaxy response like page-hook.js does. */
async function renderGalaxy(env, page, g, s) {
  const json = T.fixture(`galaxy-ajax-${g}-${s}.json`);
  const html = T.fixture(`galaxy-rendered-${g}-${s}.html`).replace(/<!--[\s\S]*?-->/g, '').trim();
  await page.evaluate(({ html, json, origin, g, s }) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const fresh = tmp.querySelector('#galaxyContent');
    document.getElementById('galaxyContent').replaceWith(fresh);
    document.getElementById('galaxy_input').value = String(g);
    document.getElementById('system_input').value = String(s);
    document.dispatchEvent(new CustomEvent('ogx:xhr', { detail: JSON.stringify({
      url: origin + '/ajax/galaxy', method: 'POST', status: 200, requestBody: `galaxy=${g}&system=${s}&_token=x`, responseText: json, t: Date.now(),
    }) }));
  }, { html, json, origin: env.origin, g, s });
}
async function openTab(page, tab) {
  await page.waitForSelector('#menuTableTools #ogx-i-panel-entry', { state: 'attached', timeout: 10000 });
  const hidden = await page.$eval('#ogx-panel-infinity', (e) => e.hidden);
  if (hidden) await page.click('#ogx-i-panel-entry a.menubutton');
  await page.click(`#ogx-panel-infinity .ogx-tab[data-tab="${tab}"]`);
  await page.waitForSelector(`#ogx-panel-infinity .ogx-tab-pane[data-tab="${tab}"]:not([hidden])`, { timeout: 5000 });
}
async function marks(env) { return (await env.get('targets.marks')) || null; }
async function waitMarks(env, pred, ms = 5000) {
  const end = Date.now() + ms;
  let m = null;
  while (Date.now() < end) { m = await marks(env); if (m && pred(m)) return m; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('marks condition not met: ' + JSON.stringify(m));
}

T.test('targets: galaxy row tools, colour mark tints the row and persists, note survives reload, highscore dot', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/galaxy');
  await renderGalaxy(env, page, 1, 42);
  await page.waitForSelector('#galaxyRow6 > .ogx-gx-slot[data-owner="targets"] .ogx-i-targets-dot', { timeout: 10000 });
  // occupied rows of 1:42: 4 Nova, 6 OldMiner, 8 own Homeworld, 11 Sleeper, 13 Rookie -> exactly one slot each
  const slots = await page.$$eval('.ogx-gx-slot[data-owner="targets"]', (els) => els.map((e) => +e.parentElement.id.replace('galaxyRow', '')));
  assert.deepEqual(slots.sort((a, b) => a - b), [4, 6, 8, 11, 13]);
  for (const p of [4, 6, 8, 11, 13]) assert.equal(await page.$$eval(`#galaxyRow${p} > .ogx-gx-slot[data-owner="targets"]`, (e) => e.length), 1);
  // own row: no star
  assert.equal(await page.$$eval('#galaxyRow8 .ogx-i-targets-star', (e) => e.length), 0);
  assert.equal(await page.$$eval('#galaxyRow6 .ogx-i-targets-star', (e) => e.length), 1);

  // mark position 6 (OldMiner, planet id 64?) red
  await page.click('#galaxyRow6 .ogx-i-targets-dot');
  await page.waitForSelector('.ogx-i-targets-menu', { timeout: 3000 });
  assert.match(nb(await page.textContent('.ogx-i-targets-menu')), /Планета \[1:42:6\]/);
  assert.match(nb(await page.textContent('.ogx-i-targets-menu')), /Игрок OldMiner/);
  await page.click('.ogx-i-targets-menu .ogx-i-targets-menu-sec:first-child button[data-color="red"]');
  const m1 = await waitMarks(env, (m) => m.planets && m.planets['1:42:6:1'] && m.planets['1:42:6:1'].color === 'red');
  assert.equal(m1.v, 1);
  assert.equal(m1.planets['1:42:6:1'].playerId, 201);
  assert.equal(m1.planets['1:42:6:1'].playerName, 'OldMiner');
  await page.waitForSelector('#galaxyRow6.ogx-i-targets-mark-red', { timeout: 3000 });
  const bg = await page.$eval('#galaxyRow6', (e) => getComputedStyle(e).backgroundColor);
  assert.match(bg, /rgba\(229, 57, 53, 0\.22\)/);
  assert.equal(await page.$$eval('.ogx-i-targets-mark-red', (e) => e.length), 1);

  // player colour for Nova (pos 4) -> green, and star pos 11 (Sleeper)
  await page.click('#galaxyRow4 .ogx-i-targets-dot');
  await page.click('.ogx-i-targets-menu .ogx-i-targets-menu-sec:last-child button[data-color="green"]');
  await waitMarks(env, (m) => m.players && m.players['150'] && m.players['150'].color === 'green');
  await page.waitForSelector('#galaxyRow4.ogx-i-targets-mark-green', { timeout: 3000 });
  await page.click('#galaxyRow11 .ogx-i-targets-star');
  await waitMarks(env, (m) => m.planets['1:42:11:1'] && m.planets['1:42:11:1'].isTarget === true);
  await page.waitForSelector('#galaxyRow11 .ogx-i-targets-star.ogx-i-targets-star-on', { timeout: 3000 });

  // note editor on pos 6
  await page.click('#galaxyRow6 .ogx-i-targets-note');
  await page.waitForSelector('.ogx-modal textarea.ogx-i-targets-note-body', { timeout: 3000 });
  await page.fill('.ogx-modal textarea.ogx-i-targets-note-body', 'Фермер: шахты 20+, флота нет');
  await page.fill('.ogx-modal textarea.ogx-i-targets-note-player', 'Не отвечает');
  await page.click('.ogx-modal .ogx-btn-primary');
  await waitMarks(env, (m) => m.planets['1:42:6:1'].note === 'Фермер: шахты 20+, флота нет' && m.players['201'] && m.players['201'].note === 'Не отвечает');

  // reload: the game renders again, marks and note come back from storage
  await env.evalOgx(page, () => OGX.diag.flush().then(() => true));
  await page.reload();
  await env.waitReady(page);
  await renderGalaxy(env, page, 1, 42);
  await page.waitForSelector('#galaxyRow6.ogx-i-targets-mark-red .ogx-i-targets-note.ogx-i-targets-has-note', { timeout: 10000 });
  const title = await page.getAttribute('#galaxyRow6 .ogx-i-targets-note', 'title');
  assert.match(title, /Планета: Фермер: шахты 20\+, флота нет/);
  assert.match(title, /Игрок: Не отвечает/);
  // re-render of another system removes tint and stale slots
  await renderGalaxy(env, page, 1, 45);
  await page.waitForFunction(() => !document.querySelector('#galaxyRow6.ogx-i-targets-mark-red') && document.querySelector('#galaxyRow6 > .ogx-gx-slot[data-owner="targets"]'), null, { timeout: 5000 });
  assert.equal(await page.$$eval('#galaxyRow13 > .ogx-gx-slot[data-owner="targets"]', (e) => e.length), 0);
  assert.equal(await page.$$eval('#galaxyRow3 > .ogx-gx-slot[data-owner="targets"]', (e) => e.length), 0, 'destroyed planet has no tools');

  // highscore page 1: Nova (green player mark) and OldMiner (red planet mark) get dots; Raider42 none
  await env.evalOgx(page, () => OGX.diag.flush().then(() => true));
  const hs = await env.open('/highscore');
  await env.waitFor(hs, '#position150 .ogx-i-targets-hsdot');
  assert.equal(await hs.getAttribute('#position150 .ogx-i-targets-hsdot', 'data-color'), 'green');
  assert.equal(await hs.getAttribute('#position201 .ogx-i-targets-hsdot', 'data-color'), 'red');
  assert.equal(await hs.$$eval('#ranks .ogx-i-targets-hsdot', (e) => e.length), 2);
  assert.equal(await hs.$$eval('#position233 .ogx-i-targets-hsdot', (e) => e.length), 0);
  assert.match(await hs.getAttribute('#position201 .ogx-i-targets-hsdot', 'title'), /Заметка: Не отвечает/);

  // diagnostics: B events for the wrapped actions and U clicks with data-ogx-act
  const ev = await env.evalOgx(hs, () => OGX.diag.recent().map((e) => e.s + ' ' + e.k + ' ' + e.w));
  assert.ok(ev.some((x) => /^B targets highscoreDots/.test(x)), 'B highscoreDots');
  const all = await env.evalOgx(hs, async () => {
    const st = await OGX.diag.store();
    const r = await st.query({ last: 3000 });
    return r.events.map((e) => e.s + ' ' + e.k + ' ' + e.w);
  });
  assert.ok(all.some((x) => /^B targets setBodyColor/.test(x)), 'B setBodyColor');
  assert.ok(all.some((x) => /^B targets saveNotes/.test(x)), 'B saveNotes');
  assert.ok(all.some((x) => /^U .*targets:galaxy-color/.test(x)), 'U galaxy-color click');

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();
});

T.test('targets: search tab finds Raider42, player card, «В цели», «Следить», then «Цели» tab: spy, attack, remove', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  // seed other modules' data relative to the SERVER clock (the fixture's server time, not the test machine's)
  await env.evalOgx(page, async () => {
    const now = OGX.time.serverNow();
    // spy module data: report on Farmville 1:45:6 (loot 50 % for the Collector)
    await OGX.storage.set('spy.reports', { v: 1, items: { 3001: { id: 3001, ts: now - 2 * 3600000, fetchedAt: now - 2 * 3600000, target: { coords: [1, 45, 6], type: 'planet', planetType: 1, name: 'Farmville' }, attackParams: { galaxy: 1, system: 45, position: 6, type: 1 }, player: 'Raider42', resources: { metal: 100000, crystal: 50000, deuterium: 20000, energy: 0 } } } });
    // stalk module data: Raider42 seen 30 min ago at 1:45:6
    await OGX.storage.set('stalk.log', { v: 1, items: { 233: [{ t: now - 12 * 60000, coords: '1:45:6', body: 'p', activity: 18, lastSeen: now - 30 * 60000, self: false }] } });
    await OGX.storage.flush();
    return true;
  });
  await env.evalOgx(page, () => { window.__trk = []; OGX.bus.on('targets:track', (p) => window.__trk.push(p)); return true; });
  await openTab(page, 'search');
  await page.fill('#ogx-panel-infinity .ogx-i-targets-q', 'Raider');
  await page.click('#ogx-panel-infinity .ogx-i-targets-go');
  await page.waitForSelector('#ogx-panel-infinity .ogx-i-targets-rplayer', { timeout: 5000 });
  const names = await page.$$eval('#ogx-panel-infinity .ogx-i-targets-rplayer .ogx-i-targets-rname', (e) => e.map((x) => x.textContent.trim()));
  assert.deepEqual(names, ['Raider42', 'Drake']);
  const s1 = env.requests('POST', '/ajax/search');
  assert.equal(s1.length, 1);
  assert.equal(s1[0].form.searchtext, 'Raider');
  assert.equal(s1[0].form.category, '2');

  // player card: highscore searchRelId + planet search (owner_id 233 -> [1:45:6])
  await page.click('#ogx-panel-infinity .ogx-i-targets-rplayer[data-id="233"] .ogx-i-targets-rname');
  await page.waitForSelector('#ogx-panel-infinity .ogx-i-targets-card[data-player-id="233"]', { timeout: 8000 });
  const card = nb(await page.textContent('#ogx-panel-infinity .ogx-i-targets-card'));
  assert.match(card, /Raider42/);
  assert.match(card, /\[RAID\]/);
  assert.match(card, /Место: 12/);
  assert.match(card, /Очки: 198 500/);
  assert.match(card, /Главная планета: \[1:45:6\]/);
  assert.equal(env.requests('POST', '/ajax/highscore')[0].form.searchRelId, '233');
  const s3 = env.requests('POST', '/ajax/search').filter((r) => r.form.category === '3');
  assert.equal(s3.length, 1);
  assert.equal(s3[0].form.searchtext, 'Raider42');
  const pc = await page.$$eval('#ogx-panel-infinity .ogx-i-targets-ptable tbody tr[data-coords]', (e) => e.map((x) => x.dataset.coords));
  assert.deepEqual(pc, ['1:45:6']);
  assert.match(nb(await page.textContent('.ogx-i-targets-ptable tbody tr[data-coords="1:45:6"]')), /поиск, рейтинг/);

  await page.click('#ogx-panel-infinity .ogx-i-targets-c-add');
  const m = await waitMarks(env, (x) => x.planets && x.planets['1:45:6:1'] && x.planets['1:45:6:1'].isTarget);
  assert.equal(m.planets['1:45:6:1'].playerId, 233);
  assert.equal(m.planets['1:45:6:1'].playerName, 'Raider42');
  await page.click('#ogx-panel-infinity .ogx-i-targets-c-track');
  const trk = await env.evalOgx(page, () => window.__trk);
  assert.deepEqual(trk, [{ playerId: 233, playerName: 'Raider42' }]);

  // empty term -> Russian message
  await page.fill('#ogx-panel-infinity .ogx-i-targets-q', '');
  await page.click('#ogx-panel-infinity .ogx-i-targets-go');
  await page.waitForSelector('#ogx-panel-infinity .ogx-i-targets-results .ogx-i-targets-error', { timeout: 5000 });
  assert.equal(nb(await page.textContent('#ogx-panel-infinity .ogx-i-targets-results')), 'Введите текст для поиска');
  // alliances
  await page.fill('#ogx-panel-infinity .ogx-i-targets-q', 'Nova');
  await page.selectOption('#ogx-panel-infinity .ogx-i-targets-cat', '4');
  await page.click('#ogx-panel-infinity .ogx-i-targets-go');
  await page.waitForSelector('#ogx-panel-infinity .ogx-i-targets-rally', { timeout: 5000 });
  assert.match(nb(await page.textContent('.ogx-i-targets-rally')), /\[NOVA\] Nova Collective · 8 участников · место 3 · 2 154 300 очк\. · набор открыт/);

  // targets:add from another module (spy)
  await env.evalOgx(page, () => { OGX.bus.emit('targets:add', { coords: [1, 45, 9], type: 1, playerName: 'Nova' }); return true; });
  await waitMarks(env, (x) => x.planets['1:45:9:1'] && x.planets['1:45:9:1'].isTarget && x.planets['1:45:9:1'].playerName === 'Nova');

  // «Цели» tab
  await openTab(page, 'targets');
  await page.waitForSelector('#ogx-panel-infinity .ogx-i-targets-table tr[data-key="1:45:6:1"]', { timeout: 5000 });
  assert.equal(await page.$$eval('#ogx-panel-infinity .ogx-i-targets-table tbody tr[data-key]', (e) => e.length), 2);
  const row = '#ogx-panel-infinity .ogx-i-targets-table tr[data-key="1:45:6:1"]';
  const rowText = nb(await page.textContent(row));
  assert.match(rowText, /\[1:45:6\]/);
  assert.match(rowText, /Raider42/);
  // loot 50 % (Collector) of 100 000 / 50 000 / 20 000 = 85 000, report 2 h old; activity from stalk 30 min ago
  assert.equal(await page.getAttribute(row + ' .ogx-i-targets-spy', 'data-loot'), '85000');
  assert.equal(nb(await page.textContent(row + ' .ogx-i-targets-loot')), '85 000');
  assert.match(nb(await page.textContent(row + ' .ogx-i-targets-age')), /2 ч назад/);
  assert.match(nb(await page.textContent(row + ' .ogx-i-targets-act')), /30 мин назад/);
  assert.equal(nb(await page.textContent('#ogx-panel-infinity .ogx-tab[data-tab="targets"] .ogx-badge')), '2');

  // filter by text
  await page.fill('#ogx-panel-infinity .ogx-i-targets-f-text', 'nova');
  await page.waitForFunction(() => document.querySelectorAll('#ogx-panel-infinity .ogx-i-targets-table tbody tr[data-key]').length === 1, null, { timeout: 3000 });
  await page.fill('#ogx-panel-infinity .ogx-i-targets-f-text', '');
  await page.waitForFunction(() => document.querySelectorAll('#ogx-panel-infinity .ogx-i-targets-table tbody tr[data-key]').length === 2, null, { timeout: 3000 });

  // spy -> send-mini-fleet
  env.clearRequests();
  await page.click(row + ' .ogx-i-targets-a-spy');
  await page.waitForSelector('.ogx-toast-ok:has-text("Зонды отправлены")', { timeout: 5000 });
  const mf = env.requests('POST', '/ajax/fleet/dispatch/send-mini-fleet');
  assert.equal(mf.length, 1);
  assert.equal(mf[0].form.mission, '6');
  assert.equal(mf[0].form.galaxy, '1');
  assert.equal(mf[0].form.system, '45');
  assert.equal(mf[0].form.position, '6');
  assert.equal(mf[0].form.type, '1');
  assert.ok(mf[0].form._token === CSRF || mf[0].headers['x-csrf-token'] === CSRF);
  assert.match(nb(await page.textContent('.ogx-toast-ok:has-text("Зонды отправлены")')), /Зонды отправлены на \[1:45:6\]: 3 шт\./);
  await waitMarks(env, (x) => x.planets['1:45:6:1'].spiedAt > 0);
  // error answer
  env.setState({ miniFleet: 'error' });
  await page.waitForSelector(row + ' .ogx-i-targets-a-spy:not([disabled])');
  await page.click(row + ' .ogx-i-targets-a-spy');
  await page.waitForSelector('.ogx-toast-error', { timeout: 5000 });
  assert.match(nb(await page.textContent('.ogx-toast-error')), /Шпионаж не отправлен: Error, no ships available/);

  // remove 1:45:9 (confirm)
  await page.click('#ogx-panel-infinity .ogx-i-targets-table tr[data-key="1:45:9:1"] .ogx-i-targets-a-remove');
  await page.click('.ogx-modal .ogx-btn-danger');
  await waitMarks(env, (x) => !x.planets['1:45:9:1']);

  // attack -> prefill (never sends): navigates to /fleet with mission 1 and the target
  env.clearRequests();
  await page.click(row + ' .ogx-i-targets-a-attack');
  await page.waitForURL(/\/fleet\?/, { timeout: 8000 });
  const u = new URL(page.url());
  assert.equal(u.searchParams.get('mission'), '1');
  assert.equal(u.searchParams.get('galaxy'), '1');
  assert.equal(u.searchParams.get('system'), '45');
  assert.equal(u.searchParams.get('position'), '6');
  assert.equal(u.searchParams.get('type'), '1');
  assert.equal(env.requests('POST', '/ajax/fleet/dispatch/send-fleet').length, 0);

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();
});

T.test('targets: storage merger merges by updatedAt; old schema migrates; bad colour setting falls back', async () => {
  const env = await T.launch({
    ext: ext(), scenario: 'vega',
    storage: { '{host}|{pid}|targets.marks': { '1:42:4': { color: 'blue', note: 'старый формат', updatedAt: 5 } } },
    settings: { 'targets.markColors': 'not-a-list' },
  });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    await OGX.storage.set('targets.marks', { v: 1, planets: { '1:1:1:1': { color: 'red', note: 'a', updatedAt: 10, isTarget: true }, '1:1:2:1': { color: 'blue', note: '', updatedAt: 10 } }, players: { 7: { color: 'green', note: '', updatedAt: 10 } } });
    await OGX.storage.flush();
    const res = await OGX.storage.importAll({ format: 'ogx-export', data: { player: { 'targets.marks': { v: 1,
      planets: { '1:1:1:1': { color: 'yellow', note: 'b', updatedAt: 20, isTarget: true }, '1:1:2:1': { color: 'purple', note: '', updatedAt: 5 }, '2:2:2:3': { color: null, note: 'луна', updatedAt: 1 } },
      players: { 7: { color: 'red', note: '', updatedAt: 1 }, 8: { color: 'orange', note: '', updatedAt: 1 } } } } } }, { mode: 'merge' });
    const m = await OGX.storage.get('targets.marks');
    const old = OGX.targetsLib.normalize({ '1:42:4': { color: 'blue', note: 'старый формат', updatedAt: 5 } });
    return { res, m, old };
  });
  assert.equal(r.res.written, 1);
  assert.equal(r.m.planets['1:1:1:1'].color, 'yellow');
  assert.equal(r.m.planets['1:1:1:1'].note, 'b');
  assert.equal(r.m.planets['1:1:2:1'].color, 'blue');
  assert.equal(r.m.planets['2:2:2:3'].note, 'луна');
  assert.equal(r.m.players['7'].color, 'green');
  assert.equal(r.m.players['8'].color, 'orange');
  assert.deepEqual(Object.keys(r.old.planets), ['1:42:4:1']);
  assert.equal(r.old.planets['1:42:4:1'].note, 'старый формат');
  // galaxy with invalid colour setting: defaults are used, no errors
  const g = await env.open('/galaxy');
  await renderGalaxy(env, g, 1, 42);
  await g.waitForSelector('#galaxyRow4 > .ogx-gx-slot[data-owner="targets"]', { timeout: 10000 });
  await g.click('#galaxyRow4 .ogx-i-targets-dot');
  assert.equal(await g.$$eval('.ogx-i-targets-menu-sec:first-child .ogx-i-targets-sw[data-color]:not([data-color=""])', (e) => e.length), 6);
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((x) => x.method + ' ' + x.path), []);
  await env.close();
});

T.test('targets: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
  await env.close();
});
