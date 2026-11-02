'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / flights: «Полёты» tab (SVG chart, one group per real mission, hostile 1210, lanes, hover, zoom),
// hostile + all-flights lists, recall (confirm, POST fleet_mission_id, success + HTTP 500 failure toast, cancel),
// attack alert (tab badge + «⚠» title), compact chart on /fleet/movement (6 rows with return times), diagnostics,
// safety on non-OgameX pages.
//   node tests/legacy-ogamex/infinity-flights.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_PANEL = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/flights/flights.js'), 'utf8');

let extCache = null;
function ext() {
  if (!extCache) extCache = coreExt({ name: 'infinity', modules: { panel: SRC_PANEL, flights: SRC } });
  return extCache;
}
const nb = (s) => String(s || '').replace(/[  \s]+/g, ' ').trim();
const P = 'ogx-i-flights-';
const EXP = T.fixtureJson('fleet-expected-parse.json');

async function openTab(env, page) {
  await env.waitFor(page, '#menuTableTools #ogx-i-panel-entry');
  const hidden = await page.$eval('#ogx-panel-infinity', (e) => e.hidden);
  if (hidden) await page.click('#ogx-i-panel-entry a.menubutton');
  await page.click('#ogx-panel-infinity .ogx-tab[data-tab="flights"]');
  await page.waitForSelector(`#ogx-panel-infinity .ogx-tab-pane[data-tab="flights"]:not([hidden]) svg.${P}chart .${P}group`, { timeout: 10000 });
}
async function journal(env, page) {
  return env.evalOgx(page, () => OGX.diag.recent().map((e) => e.s + ' ' + e.k + ' ' + e.w + ' ' + JSON.stringify(e.d || {})));
}

T.test('flights: tab chart has one group per real mission, 1210 hostile, lanes, hover, lists, alert, zoom', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  // Attack alert from the core poller (eventbox + event list) without opening anything.
  await page.waitForFunction(() => document.title.startsWith('⚠ '), null, { timeout: 10000 });
  assert.equal(await page.title(), '⚠ OGameX');

  await openTab(env, page);
  const groups = await page.$$eval(`svg.${P}chart .${P}group`, (els) => els.map((e) => ({
    id: e.dataset.mission, type: +e.dataset.missionType, lane: e.dataset.lane, cls: e.getAttribute('class'),
    kinds: [...e.querySelectorAll('rect')].map((r) => r.dataset.kind),
  })));
  const realIds = [...new Set(EXP.eventlist.map((r) => String(r.realMissionId)))].sort();
  assert.equal(groups.length, 6);
  assert.deepEqual(groups.map((g) => g.id).sort(), realIds);
  const by = Object.fromEntries(groups.map((g) => [g.id, g]));
  assert.match(by['1210'].cls, /ogx-i-flights-hostile/);
  assert.match(by['1210'].cls, /ogx-i-flights-foreign/);
  assert.equal(groups.filter((g) => /hostile/.test(g.cls)).length, 1);
  assert.match(by['1201'].cls, /ogx-i-flights-own/);
  // segments: attack 1201 out + synthetic return; expedition 1202 in hold (hold end + return), deep-space lane;
  // 1199 a real return only; 1203 out + return; foreign 1211 outbound only.
  assert.deepEqual(by['1201'].kinds, ['out', 'ret']);
  assert.deepEqual(by['1202'].kinds, ['hold', 'ret']);
  assert.equal(by['1202'].lane, 'deep');
  assert.deepEqual(by['1199'].kinds, ['ret']);
  assert.deepEqual(by['1203'].kinds, ['out', 'ret']);
  assert.deepEqual(by['1211'].kinds, ['out']);
  assert.equal(by['1201'].lane, 'p1');
  assert.equal(by['1203'].lane, 'p3');      // from the colony [2:118:12]
  assert.equal(by['1211'].lane, 'p3');      // foreign transport to the colony
  assert.equal(by['1210'].lane, 'p1');      // foreign espionage on the homeworld

  // segment times come from the event list (unix s -> ms); 1201 departure = arrival - (return - arrival)
  const seg = await page.$$eval(`svg.${P}chart .${P}group[data-mission="1201"] rect`, (rs) => rs.map((r) => ({ k: r.dataset.kind, s: r.dataset.start, e: +r.dataset.end })));
  assert.equal(seg[0].e, 1793324177000);
  assert.equal(+seg[0].s, 1793324177000 - (1793328517000 - 1793324177000));
  assert.equal(seg[1].e, 1793328517000);

  // lanes: Homeworld, its moon, the colony, deep space
  const labels = await page.$$eval(`svg.${P}chart .${P}lanelabel`, (els) => els.map((e) => e.textContent));
  assert.equal(labels.length, 4);
  assert.match(labels[0], /^Homeworld \[1:42:8\]$/);
  assert.match(labels[1], /^☾ .*\[1:42:8\]$/);
  assert.match(labels[2], /\[2:118:12\]$/);
  assert.equal(labels[3], 'Дальний космос');
  // now line moves on tick
  const nowOf = () => page.$eval(`svg.${P}chart`, (svg) => ({ t: +svg.dataset.now, x: +svg.querySelector('.ogx-i-flights-now').getAttribute('x1') }));
  await page.waitForFunction(() => document.querySelector('svg.ogx-i-flights-chart').dataset.now, null, { timeout: 3000 });
  const n1 = await nowOf();
  await page.waitForTimeout(2200);
  const n2 = await nowOf();
  assert.ok(n2.t >= n1.t + 1000 && n2.x > n1.x, `now line moves on tick: ${JSON.stringify(n1)} -> ${JSON.stringify(n2)}`);

  // hover details
  await page.hover(`svg.${P}chart .${P}group[data-mission="1201"] rect`);
  await page.waitForSelector('.ogx-tooltip:not([hidden]) .ogx-i-flights-tip', { timeout: 3000 });
  const tip = nb(await page.$$eval('.ogx-tooltip tr', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent).join(' ')).join(' | ')));
  assert.match(tip, /Миссия Атака \|/);
  assert.match(tip, /Флот БТ 10, ЛИ 20/);
  assert.match(tip, /Вылет 30\.10 00:23:57/);   // arrival - (return - arrival)
  assert.match(tip, /\[1:42:8\] → \[1:45:6\]/);
  assert.match(tip, /Возвращение 30\.10 02:48:37/);
  assert.match(tip, /Прибытие 30\.10 01:36:17 \(через/);

  // lists: hostile first (1 row), then all 6 sorted by next event; recall buttons only on own recallable 1201, 1203
  assert.match(nb(await page.textContent(`.${P}h-hostile`)), /Враждебные флоты \(1\)/);
  const hrows = await page.$$eval(`.${P}list-hostile tbody tr`, (r) => r.map((x) => x.dataset.mission));
  assert.deepEqual(hrows, ['1210']);
  assert.match(nb(await page.textContent(`.${P}list-hostile tbody tr`)), /Шпионаж\s*\[1:40:11\] → \[1:42:8\]/);
  const all = await page.$$eval(`.${P}list:not(.${P}list-hostile) tbody tr`, (r) => r.map((x) => ({ id: x.dataset.mission, t: x.textContent.replace(/\s+/g, ' ') })));
  assert.deepEqual(all.map((r) => r.id), ['1210', '1199', '1201', '1202', '1211', '1203']);
  const recallIds = await page.$$eval(`.${P}list:not(.${P}list-hostile) .${P}recall`, (b) => b.map((x) => x.dataset.mission));
  assert.deepEqual(recallIds, ['1201', '1203']);
  const r1201 = all.find((r) => r.id === '1201').t;
  assert.match(r1201, /\[1:42:8\] → \[1:45:6\]/);
  assert.match(r1201, /01:36:17/);
  assert.match(r1201, /↩ 02:48:37/);
  assert.match(all.find((r) => r.id === '1211').t, /\[2:120:5\] → \[2:118:12\]/);   // foreign transport to the colony
  // badge + title
  assert.equal(nb(await page.textContent('#ogx-panel-infinity .ogx-tab[data-tab="flights"] .ogx-badge')), '1');

  // zoom «всё» writes the setting and redraws
  await page.click(`.${P}zoom[data-zoom="all"]`);
  await page.waitForSelector(`.${P}zoom[data-zoom="all"].ogx-btn-primary`, { timeout: 5000 });
  const st = await env.get('settings');
  assert.equal(st.flights.defaultZoom, 'all');
  assert.equal(await page.$$eval(`svg.${P}chart .${P}group`, (e) => e.length), 6);
  await page.click(`.${P}zoom[data-zoom="1h"]`);
  await page.waitForSelector(`.${P}zoom[data-zoom="1h"].ogx-btn-primary`, { timeout: 5000 });
  assert.equal(await page.$$eval(`svg.${P}chart .${P}group`, (e) => e.length), 6, 'missions outside the window keep an edge marker');

  const ev = await journal(env, page);
  assert.ok(ev.some((e) => e.startsWith('B flights zoom')), ev.join('\n'));
  assert.ok(ev.some((e) => /^U click .*flights:zoom:all/.test(e)), ev.join('\n'));
  assert.ok(ev.some((e) => e.startsWith('B flights alert')), 'alert action journaled');
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('flights: recall 1201 posts fleet_mission_id after confirm; cancel sends nothing; HTTP 500 -> error toast', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'flights.titleAlert': false } });
  const page = await env.open('/overview');
  await openTab(env, page);
  assert.equal(await page.title(), 'OGameX', 'no title alert when the setting is off');

  // cancel
  env.clearRequests();
  await page.click(`.${P}list:not(.${P}list-hostile) .${P}recall[data-mission="1201"]`);
  await page.waitForSelector('.ogx-modal [data-role="cancel"]', { timeout: 5000 });
  assert.match(nb(await page.textContent('.ogx-modal')), /Отозвать флот «Атака» \[1:42:8\] → \[1:45:6\]\?/);
  await page.click('.ogx-modal [data-role="cancel"]');
  await page.waitForTimeout(400);
  assert.equal(env.requests('POST', '/ajax/fleet/dispatch/recall-fleet').length, 0);

  // success
  await page.click(`.${P}list:not(.${P}list-hostile) .${P}recall[data-mission="1201"]`);
  await page.click('.ogx-modal [data-role="ok"]');
  await page.waitForSelector('.ogx-toast-ok', { timeout: 5000 });
  assert.match(nb(await page.textContent('.ogx-toast-ok')), /Флот отозван/);
  const posts = env.requests('POST', '/ajax/fleet/dispatch/recall-fleet');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].form.fleet_mission_id, '1201');
  assert.ok(posts[0].form._token, 'csrf token in the body');
  for (let i = 0; i < 40 && env.requests('GET', '/ajax/fleet/eventlist/fetch').length < 1; i++) await page.waitForTimeout(100);
  assert.ok(env.requests('GET', '/ajax/fleet/eventlist/fetch').length >= 1, 'event list re-fetched after the recall');

  // failure: the server answers the failure fixture with HTTP 500
  env.server.route('POST', '/ajax/fleet/dispatch/recall-fleet', (req, res, ctx) => ctx.json('fleet-recall-failure.json', 500));
  await page.waitForSelector(`.${P}list:not(.${P}list-hostile) .${P}recall[data-mission="1203"]`, { timeout: 5000 });
  await page.click(`.${P}list:not(.${P}list-hostile) .${P}recall[data-mission="1203"]`);
  await page.click('.ogx-modal [data-role="ok"]');
  await page.waitForSelector('.ogx-toast-error', { timeout: 5000 });
  assert.match(nb(await page.textContent('.ogx-toast-error')), /Не удалось отозвать флот \(HTTP 500\)/);
  const posts2 = env.requests('POST', '/ajax/fleet/dispatch/recall-fleet');
  assert.equal(posts2.length, 2);
  assert.equal(posts2[1].form.fleet_mission_id, '1203');

  await page.waitForTimeout(300);
  const ev = await journal(env, page);
  const recalls = ev.filter((e) => e.startsWith('B flights recall'));
  assert.equal(recalls.length, 3, recalls.join('\n'));          // cancel, success, failure
  assert.ok(recalls.some((e) => /"ok":false/.test(e)), 'failure journaled with ok=false');
  assert.ok(ev.some((e) => /^U click .*flights:recall/.test(e)), 'U click recorded');
  assert.ok(ev.some((e) => e.startsWith('B api recall')), 'core api recall journaled');
  // the failure is a logged warning, not an error
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('flights: /fleet/movement compact chart, 6 rows with return times', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'flights.titleAlert': false } });
  await env.open('/overview');          // bodies known (own coords)
  const page = await env.open('/fleet/movement');
  await env.waitFor(page, `#movementcomponent > #ogx-i-flights-movement svg .${P}mrow`);
  const rows = await page.$$eval(`#ogx-i-flights-movement .${P}mrow`, (els) => els.map((e) => ({
    id: e.dataset.mission, cls: e.getAttribute('class'), ret: (e.querySelector('.ogx-i-flights-rettext') || {}).textContent,
    kinds: [...e.querySelectorAll('rect')].map((r) => r.dataset.kind),
  })));
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r.id), EXP.movement.map((m) => String(m.id)));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by['1202'].ret, 'возврат 02:23');
  assert.equal(by['1210'].ret, 'возврат 01:14');
  assert.equal(by['1201'].ret, 'возврат 02:48');
  assert.equal(by['1211'].ret, 'возврат 02:52');
  assert.equal(by['1203'].ret, 'возврат 06:21');
  assert.equal(by['1199'].ret, 'прибытие 01:12');   // a real return: no further return time
  assert.equal(rows.filter((r) => r.ret.startsWith('возврат')).length, 5);
  assert.deepEqual(by['1202'].kinds, ['out', 'hold', 'ret']);
  assert.deepEqual(by['1199'].kinds, ['ret']);
  assert.match(by['1210'].cls, /ogx-i-flights-hostile/);
  assert.doesNotMatch(by['1201'].cls, /hostile/, 'own attack is not hostile (ownership, not mission class)');
  const labels = await page.$$eval(`#ogx-i-flights-movement .${P}lanelabel`, (els) => els.map((e) => e.textContent));
  assert.equal(labels[3], 'Атака [1:42:8→1:45:6]');
  assert.match(labels[2], /\(возвр\.\) \[1:42:9→1:42:8\]$/);
  assert.match(nb(await page.textContent('#ogx-i-flights-movement .ogx-i-flights-mhead')), /6 миссий/);

  // setting off -> no chart
  await env.evalOgx(page, () => OGX.settings.set('flights.showOnMovement', false));
  await page.waitForFunction(() => !document.getElementById('ogx-i-flights-movement'), null, { timeout: 5000 });
  const ev = await journal(env, page);
  assert.ok(ev.some((e) => e.startsWith('B flights movementChart') && /"built":true/.test(e)), ev.filter((e) => /flights/.test(e)).join('\n'));
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('flights: no hostile flights -> no alert; empty list message', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  env.server.route('GET', '/ajax/fleet/eventlist/fetch', (req, res, ctx) => ctx.send(200, '<div id="eventListWrap"><table id="eventContent"><tbody></tbody></table></div>', 'text/html'));
  env.setState({ eventbox: 'empty' });
  const page = await env.open('/overview');
  await openTabEmpty(env, page);
  assert.match(nb(await page.textContent(`.${P}empty`)), /Флотов в полёте нет/);
  assert.equal(await page.title(), 'OGameX');
  assert.equal(await page.$eval('#ogx-panel-infinity .ogx-tab[data-tab="flights"] .ogx-badge', (e) => e.hidden), true);
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});
async function openTabEmpty(env, page) {
  await env.waitFor(page, '#menuTableTools #ogx-i-panel-entry');
  await page.click('#ogx-i-panel-entry a.menubutton');
  await page.click('#ogx-panel-infinity .ogx-tab[data-tab="flights"]');
  await page.waitForFunction(() => /Флотов в полёте нет/.test((document.querySelector('.ogx-i-flights-empty') || {}).textContent || ''), null, { timeout: 10000 });
}

T.test('flights: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"], [id^="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
  assert.deepEqual(env.ogxErrors(), []);
});
