'use strict';
// Live fleet modules on the REAL saved GALAXYZ pages (ogamex.eu/Aeternum, fixtures/galaxyz/pages) through the suite extension:
//   timeline  (ogamex-live/modules/timeline)  flights list under the left menu, slots, rows = the page's event box
//   inflight  (ogamex-live/modules/inflight)  totals block under the planet list, incoming-fleet icons
//   fleetinfo (ogamex-live/modules/fleetinfo) page=fleetTable: speed pills after the ship names, selected-fleet table
// Every check compares with the page source, looks for console errors, proves the game layout does not move, and that
// nothing sends a request on its own (only the user's ⟳ click GETs page=fleetTable; never a POST). Screenshots of every
// page the modules touch go to tests/out/gz-live-fleet-<page>.png.
//   node tests/gz-mod-live-fleet.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

const OUT = path.join(__dirname, 'out');
const PAGES = path.join(__dirname, '..', 'fixtures', 'galaxyz', 'pages');
const MINE = ['timeline', 'inflight', 'fleetinfo'];
const OTHERS = ['menu', 'planetbar', 'techcost', 'expedition', 'panel', 'prefs', 'empire', 'todo', 'spy', 'stats', 'targets', 'stalk', 'fleethelp', 'flights', 'mail', 'missiles'];
const VIEW = { width: 1400, height: 900 };
const NB = ' ';

if (process.env.OGX_NO_SYNC !== '1') T.sync();

/** Only the three modules of this file (requests and layout are then theirs alone). */
const solo = (extra = {}) => Object.assign(Object.fromEntries(OTHERS.map((m) => [m + '.enabled', false])), extra);
const saved = (name) => fs.readFileSync(path.join(PAGES, name + '.html'), 'utf8');

/** Requests the page made by itself (fetch/XHR to game.php), i.e. not the navigations (documents) the test or a click did.
 * The mock sees no sec-fetch headers over plain http, so the browser side tells: resourceType 'document' = navigation. */
function recordRequests(env) {
  env.pageRequests = [];
  env.context.on('request', (rq) => {
    const u = new URL(rq.url());
    if (!/\/game\.php$/.test(u.pathname)) return;
    env.pageRequests.push({ method: rq.method(), url: u.pathname + u.search, type: rq.resourceType(), route: 'page=' + (u.searchParams.get('page') || 'overview') + (u.searchParams.get('mode') ? '&mode=' + u.searchParams.get('mode') : '') });
  });
  return env;
}
const ownRequests = (env) => (env.pageRequests || []).filter((r) => r.type !== 'document');
async function launch(o) { return recordRequests(await G.launch(o)); }
const posts = (env) => env.server.requests.filter((r) => r.method === 'POST');

async function mandatory(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  assert.deepEqual(env.consoleErrors().filter((e) => /OGX|ogx-|timeline|inflight|fleetinfo/i.test((e.text || '') + (e.stack || ''))).map((e) => e.text), [], what + ': no console errors from the add-on');
  assert.deepEqual(posts(env).map((r) => r.url), [], what + ': nothing POSTed');
}

/** Bounding boxes of the game chrome with our elements in place and with them hidden: equal = no layout shift. */
async function layoutShift(page, extraSel = []) {
  return page.evaluate((extra) => {
    const sels = ['#links', '#menuTable', '#inhalt', '#rechts', '#myWorlds', '#resTable', '#messages_collapsed', ...extra];
    const measure = () => {
      const o = {};
      for (const s of sels) {
        const e = document.querySelector(s);
        if (e) { const b = e.getBoundingClientRect(); o[s] = [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; }
      }
      document.querySelectorAll('#menuTable > li').forEach((li, i) => { const b = li.getBoundingClientRect(); o['li' + i] = [Math.round(b.left), Math.round(b.top)]; });
      document.querySelectorAll('#planetList > .smallplanet').forEach((r, i) => { const b = r.getBoundingClientRect(); o['planet' + i] = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
      o.scrollW = document.documentElement.scrollWidth;
      return o;
    };
    const ours = Array.from(document.querySelectorAll('#ogx-l-timeline, .ogx-l-inflight-totals, .ogx-l-inflight-in, #ogx-l-fleetinfo'));
    const withUs = measure();
    const saved = ours.map((e) => [e, e.style.display]);
    for (const [e] of saved) e.style.setProperty('display', 'none', 'important');
    const without = measure();
    for (const [e, d] of saved) e.style.display = d;
    const diff = Object.keys(without).filter((k) => JSON.stringify(withUs[k]) !== JSON.stringify(without[k])).map((k) => k + ' ' + JSON.stringify(withUs[k]) + ' vs ' + JSON.stringify(without[k]));
    return { diff, ours: ours.length };
  }, extraSel);
}

/** Event box of the saved page: [{ id, end (unix s), count, mission text }] (unique ids, the box repeats rows). */
function eventBox(name) {
  const html = saved(name);
  const out = new Map();
  const re = /<span id="(fleettime_(\d+))" class="fleets" data-fleet-end-time="(\d+)"/g;
  let m;
  while ((m = re.exec(html))) if (!out.has(m[1])) out.set(m[1], { id: m[1], end: +m[3] });
  return [...out.values()];
}

const shot = async (page, name) => { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, 'gz-live-fleet-' + name + '.png'); await page.screenshot({ path: f, fullPage: true }); return f; };

// ------------------------------------------------------------------ timeline
T.test('timeline (position «слева, под меню»): one row per event of the box (time, units, mission badge), slots from fleetTable / galaxy', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'timeline.position': 'left' }) });
  // fleetTable first: stores the slots "Fleet 1 / 13", "0 / 2 expedition"
  const ft = await env.game('fleetTable');
  await env.waitFor(ft, '#ogx-l-timeline .ogx-l-timeline-row');
  await ft.waitForFunction(() => /\/13/.test((document.querySelector('.ogx-l-timeline-slots-fleet') || {}).textContent || ''), null, { timeout: 8000 });
  const r = await ft.evaluate(() => {
    const tl = document.getElementById('ogx-l-timeline');
    const rows = [...tl.querySelectorAll('.ogx-l-timeline-row')].map((e) => ({ arrival: +e.dataset.arrival, ret: e.dataset.returnFlight, mt: e.dataset.missionType,
      time: e.querySelector('.ogx-l-timeline-time').textContent, units: e.querySelector('.ogx-l-timeline-units').textContent,
      icon: e.querySelector('.ogx-l-timeline-icon').textContent, from: e.querySelector('.ogx-l-timeline-from').textContent, to: e.querySelector('.ogx-l-timeline-to').textContent }));
    return { parent: tl.parentElement.id, prev: (tl.previousElementSibling || {}).id, rows, width: getComputedStyle(tl).width,
      slotF: document.querySelector('.ogx-l-timeline-slots-fleet').textContent, slotE: document.querySelector('.ogx-l-timeline-slots-exp').textContent,
      imgs: tl.querySelectorAll('img').length, styleOk: !!document.getElementById('ogx-l-timeline-css') };
  });
  assert.equal(r.parent, 'links', 'mounted in the left menu column');
  assert.equal(r.prev, 'menuTable', 'right after ul#menuTable');
  assert.equal(r.width, '165px', 'own stylesheet applied');
  assert.ok(r.styleOk);
  // the page's event box: 2 events of fleet 396900 (recycle 2:68:5 -> 2:87:8 and back), 8.290 recyclers
  const box = eventBox('fleetTable');
  assert.equal(box.length, 2);
  assert.deepEqual(r.rows.map((x) => x.arrival / 1000).sort(), box.map((b) => b.end).sort(), 'arrival = data-fleet-end-time of the box');
  assert.deepEqual(r.rows.map((x) => x.ret), ['0', '1']);
  assert.deepEqual(r.rows.map((x) => x.mt), ['8', '8']);
  assert.deepEqual(r.rows.map((x) => x.icon), ['Пер', 'Пер'], 'GALAXYZ mission text badge (no /img/fleet gifs on the fork)');
  assert.equal(r.imgs, 0);
  assert.deepEqual(r.rows.map((x) => x.units), ['8' + NB + '290', '8' + NB + '290'], 'units = 8.290 of the page');
  assert.deepEqual(r.rows.map((x) => x.time), ['10:20:29', '10:47:11'], 'times as the page prints them (30. Oct 2026, 10:20:29 / 10:47:11)');
  assert.match(r.rows[0].from, /\[2:68:5\]/); assert.match(r.rows[0].to, /\[2:87:8\]/);
  assert.equal(r.slotF, 'Ф' + NB + '1/13', 'fleet slots of the page header "Fleet 1 / 13"');
  assert.equal(r.slotE, 'Э' + NB + '0/2', '"0 / 2 expedition"');
  const ls = await layoutShift(ft, ['.fleetTablemain']);
  assert.deepEqual(ls.diff, [], 'fleetTable: game layout unchanged');

  // overview: same rows, slots remembered from fleetTable
  const ov = await env.game('overview');
  await env.waitFor(ov, '#ogx-l-timeline .ogx-l-timeline-row');
  const o = await ov.evaluate(() => ({ n: document.querySelectorAll('.ogx-l-timeline-row').length, f: document.querySelector('.ogx-l-timeline-slots-fleet').textContent }));
  assert.deepEqual(o, { n: 2, f: 'Ф' + NB + '1/13' });
  assert.deepEqual((await layoutShift(ov)).diff, [], 'overview: game layout unchanged');
  await shot(ov, 'overview');

  // galaxy: "1/13 Fleet Slots" of its own header
  await env.clearStorage();
  await env.setStorage(G.buildSeed(env, {}, solo({ 'timeline.position': 'left' })));
  const gx = await env.game('galaxy');
  await env.waitFor(gx, '#ogx-l-timeline');
  await gx.waitForFunction(() => /1\/13/.test((document.querySelector('.ogx-l-timeline-slots-fleet') || {}).textContent || ''), null, { timeout: 8000 });
  assert.match(await gx.evaluate(() => document.querySelector('.ogx-l-timeline-slots-fleet').title), /Галактика/);
  assert.deepEqual((await layoutShift(gx)).diff, [], 'galaxy: game layout unchanged');
  await shot(gx, 'galaxy');

  // fleetStep3 (no #rechts): 4 events (colonize 2:68:5 -> 2:68:9 out and back + the recycle), colonize carries 7382 metal
  const s3 = await env.game('fleetStep3');
  await env.waitFor(s3, '#ogx-l-timeline .ogx-l-timeline-row');
  const s = await s3.evaluate(() => [...document.querySelectorAll('.ogx-l-timeline-row')].map((e) => [e.dataset.missionType, e.querySelector('.ogx-l-timeline-icon').textContent, e.querySelector('.ogx-l-timeline-bar-metal').dataset.v]));
  assert.equal(s.length, eventBox('fleetStep3').length, 'one row per event of the fleetStep3 box');
  assert.deepEqual(s[0], ['7', 'Кол', '7382'], 'colonize: badge and the 7382 metal of "Ressources: 7382 Metal"');
  assert.deepEqual((await layoutShift(s3)).diff, [], 'fleetStep3: game layout unchanged');
  await shot(s3, 'fleetStep3');
  await mandatory(env, 'timeline');
  assert.deepEqual(ownRequests(env).map((x) => x.url), [], 'no background request from the timeline/inflight/fleetinfo');
});

T.test('timeline: tooltip, collapse persisted, row click opens page=fleetTable, ⟳ = one GET page=fleetTable only on the click', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'core.tickMs': 250 }) });
  const ov = await env.game('overview');
  await env.waitFor(ov, '#ogx-l-timeline .ogx-l-timeline-row');
  await ov.waitForTimeout(2500);   // ticks: nothing polls on GALAXYZ
  assert.deepEqual(ownRequests(env).map((x) => x.url), [], 'no request without a click');
  await ov.hover('.ogx-l-timeline-row');
  const tip = await ov.evaluate(() => { const t = [...document.querySelectorAll('.ogx-l-timeline-tip')].pop(); return t ? t.innerText : ''; });
  assert.match(tip, /Переработка/); assert.match(tip, /Утилизатор|Переработчик|Recycler|8\s290/);
  assert.match(tip, /блока событий/, 'tooltip names the source of the list');
  await shot(ov, 'timeline-tooltip');

  // ⟳: exactly one GET of page=fleetTable (user click), never a POST
  env.pageRequests.length = 0;
  await ov.click('.ogx-l-timeline-reload');
  await ov.waitForFunction(() => !document.querySelector('.ogx-l-timeline-spin'), null, { timeout: 8000 });
  await ov.waitForTimeout(500);
  const got = ownRequests(env).map((x) => x.method + ' ' + x.route);
  assert.deepEqual(got, ['GET page=fleetTable'], 'reload = one page=fleetTable GET');
  assert.equal(await ov.evaluate(() => document.querySelectorAll('.ogx-l-timeline-row').length), 2);

  // collapse persisted
  await ov.click('.ogx-l-timeline-toggle');
  for (let i = 0; i < 30 && !((await env.get('timeline.ui')) || {}).collapsed; i++) await ov.waitForTimeout(100);
  assert.equal(((await env.get('timeline.ui')) || {}).collapsed, true);
  const ov2 = await env.game('overview');
  await env.waitFor(ov2, '#ogx-l-timeline.ogx-l-timeline-collapsed');
  await ov2.click('.ogx-l-timeline-toggle');

  // row click -> the fleet page (movement list)
  await Promise.all([ov2.waitForURL(/page=fleetTable/, { timeout: 8000 }), ov2.click('.ogx-l-timeline-row')]);
  await mandatory(env, 'timeline actions');
});

T.test('timeline: default «автоматически» = right after the last #planetList on GALAXYZ, fallback left without #rechts, off', async () => {
  const env = await launch({ viewport: VIEW, settings: solo() });
  const ov = await env.game('overview');
  await env.waitFor(ov, '#ogx-l-timeline .ogx-l-timeline-row');
  const r = await ov.evaluate(() => {
    const tl = document.getElementById('ogx-l-timeline');
    const lists = document.querySelectorAll('#planetList');
    return { inRight: !!tl.closest('#rechts'), afterLast: lists[lists.length - 1].nextElementSibling === tl, w: getComputedStyle(tl).width,
      right: Math.round(tl.getBoundingClientRect().right), vw: document.documentElement.clientWidth };
  });
  assert.ok(r.inRight && r.afterLast, 'auto: in #rechts right after the last #planetList ' + JSON.stringify(r));
  assert.equal(r.w, '165px');
  assert.ok(r.right <= r.vw, 'inside the window');
  assert.deepEqual((await layoutShift(ov)).diff, [], 'right: no layout shift of the game');
  await shot(ov, 'timeline-right');
  // transport (no #rechts): falls back to the left column
  const tr = await env.game('transport');
  await env.waitFor(tr, '#ogx-l-timeline');
  assert.equal(await tr.evaluate(() => document.getElementById('ogx-l-timeline').parentElement.id), 'links');
  await shot(tr, 'transport');
  await env.evalOgx(tr, () => OGX.settings.set('timeline.position', 'off'));
  await tr.waitForFunction(() => !document.getElementById('ogx-l-timeline'), null, { timeout: 5000 });
  await mandatory(env, 'timeline position');
});

// ------------------------------------------------------------------ inflight
T.test('inflight: incoming icon on the home planet (return of the recycle), tooltip, totals vs page header, no polling', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'core.tickMs': 250 }) });
  const ov = await env.game('overview');
  await env.waitFor(ov, '.ogx-l-inflight-totals');
  await env.waitFor(ov, '.ogx-l-inflight-in');
  const r = await ov.evaluate(() => {
    const icons = [...document.querySelectorAll('.ogx-l-inflight-in')].map((e) => ({ key: e.dataset.key, n: e.dataset.n, hostile: e.dataset.hostile,
      row: (e.closest('.smallplanet').querySelector('a.planetlink') || {}).getAttribute('href') }));
    const v = (row, res) => +document.querySelector('.ogx-l-inflight-l-' + row + ' .ogx-l-inflight-r-' + res).dataset.v;
    const real = (res) => +document.getElementById('current_' + res).getAttribute('data-real');
    return { icons, inF: ['metal', 'crystal', 'deuterium'].map((x) => v('inflight', x)), stock: ['metal', 'crystal', 'deuterium'].map((x) => v('bodies', x)),
      real: ['metal', 'crystal', 'deuterium'].map(real), grand: v('grand', 'sum'), note: document.querySelector('.ogx-l-inflight-note').textContent,
      need: [...document.querySelectorAll('.ogx-l-inflight-need')].map((e) => e.textContent) };
  });
  assert.equal(r.icons.length, 1, 'one incoming icon');
  assert.equal(r.icons[0].key, 'p254102', 'on Главная планета (cp=254102): the recycle returns there');
  assert.match(r.icons[0].row, /cp=254102/);
  assert.equal(r.icons[0].n, '1'); assert.equal(r.icons[0].hostile, '0');
  assert.deepEqual(r.inF, [0, 0, 0], 'the recycle carries nothing (Ressources: 0; 0; 0)');
  // only the current body has resources (ticker); projected stock within one minute of production of the header value
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(r.stock[i] - r.real[i]) <= Math.max(1, r.real[i] * 0.001), `stock ${i}: ${r.stock[i]} ~ data-real ${r.real[i]}`);
  assert.match(r.note, /Нет данных о ресурсах: 3 тела/);
  assert.ok(r.need.every((t) => !/NaN|undefined|x0/.test(t)), 'no NaN / x0: ' + r.need.join(' | '));
  await ov.hover('.ogx-l-inflight-in');
  const tip = await ov.evaluate(() => { const t = [...document.querySelectorAll('.ogx-l-inflight-tip')].pop(); return t ? t.innerText : ''; });
  assert.match(tip, /Прибывают на Главная планета \[2:68:5\]/);
  assert.match(tip, /Переработка \(возврат\)/);
  assert.match(tip, /8\s290/);
  await shot(ov, 'inflight-tooltip');
  await ov.waitForTimeout(2000);
  assert.deepEqual(ownRequests(env).map((x) => x.url), [], 'no poll, no background request');
  // ⟳ = one GET page=fleetTable on the click
  await ov.click('.ogx-l-inflight-totals .ogx-l-inflight-btn[data-ogx-act="inflight:refresh"]');
  await ov.waitForTimeout(1200);
  assert.deepEqual(ownRequests(env).map((x) => x.method + ' ' + x.route), ['GET page=fleetTable']);
  // after fleetTable: 217 owned are known (0 on this planet), the need number is shown
  const ft = await env.game('fleetTable');
  await env.waitFor(ft, '.ogx-l-inflight-totals');
  await ft.waitForFunction(() => [...document.querySelectorAll('.ogx-l-inflight-need')].every((e) => e.dataset.have === '0'), null, { timeout: 8000 });
  // a single Battle Transporter (217) count: «Ул. трансп. есть/нужно», need = ceil(grand total / 217 cargo incl. Storage expert)
  const nd = await env.evalOgx(ft, async () => {
    const els = [...document.querySelectorAll('.ogx-l-inflight-need')];
    const st = await OGX.state.shipStats();
    return { ships: els.map((e) => e.dataset.ship), text: els.map((e) => e.textContent), need: els.map((e) => e.dataset.need), label: OGX.catalog.shortName(217),
      cap: st && st[217] ? +st[217].cargo : 0, grand: +document.querySelector('.ogx-l-inflight-l-grand .ogx-l-inflight-r-sum').dataset.v };
  });
  assert.deepEqual(nd.ships, ['217'], 'only the Battle Transporter is counted (no 202/203)');
  assert.ok(nd.cap >= 40000000, '217 cargo from shipStats (40 000 000 base): ' + nd.cap);
  assert.equal(nd.text[0], nd.label + ' 0/' + nd.need[0], 'label + owned/needed: ' + nd.text[0]);
  assert.equal(nd.need[0], String(Math.ceil(nd.grand / nd.cap)));
  assert.deepEqual((await layoutShift(ft, ['.fleetTablemain'])).diff, [], 'fleetTable: no layout shift');
  assert.deepEqual((await layoutShift(ov)).diff, [], 'overview: no layout shift');
  await mandatory(env, 'inflight');
});

// ------------------------------------------------------------------ fleetinfo
T.test('fleetinfo: speed pills after the ship names (page speeds, «скор. 6 000», «скор. 220 млн»), styled, tooltip with the page bonus', async () => {
  const env = await launch({ viewport: VIEW, settings: solo() });
  const ft = await env.game('fleetTable');
  await env.waitFor(ft, '.ogx-l-fleetinfo-speed');
  const r = await ft.evaluate(() => [...document.querySelectorAll('.ogx-l-fleetinfo-speed')].map((b) => {
    const cs = getComputedStyle(b);
    const prev = b.parentElement.previousElementSibling;
    return { ship: b.dataset.ship, v: b.dataset.v, text: b.textContent, prevTip: prev && prev.getAttribute('data-tooltip-content'),
      border: cs.borderTopStyle, pos: cs.position, bg: cs.backgroundColor, left: cs.left, anchorW: b.parentElement.getBoundingClientRect().width };
  }));
  assert.deepEqual(r.map((x) => x.ship), ['208', '210'], 'one pill per flyable ship (no Solar Satellite)');
  assert.deepEqual(r.map((x) => x.v), ['6000', '220000000'], 'the speeds of the page tooltips "Speed:  6000" / "Speed:  220000000"');
  assert.deepEqual(r.map((x) => x.text), ['скор. 6' + NB + '000', 'скор. 220' + NB + 'млн'], 'same number format as the rest of the suite');
  assert.ok(r.every((x) => !/\dМ$/.test(x.text)), 'no Cyrillic «М» suffix');
  assert.deepEqual(r.map((x) => x.prevTip), ['Speed:  6000', 'Speed:  220000000'], 'right after the game name span');
  assert.ok(r.every((x) => x.border === 'solid' && x.pos === 'absolute' && x.left !== '0px' && x.anchorW === 0 && x.bg !== 'rgba(0, 0, 0, 0)'), 'pill styled (separator, border, background), hung from a zero-width anchor ' + JSON.stringify(r));
  // rows keep their height (pill fits the 35 px rows)
  const heights = await ft.evaluate(() => {
    const rows = [...document.querySelectorAll('input[id^="ship"][id$="_input"]')].map((i) => i.closest('tr'));
    const now = rows.map((tr) => tr.getBoundingClientRect().height);
    const cells = [...document.querySelectorAll('[id^="ship"][id$="_value"], input[id^="ship"][id$="_input"]')];
    const box = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    const cellsNow = cells.map(box);
    const pills = [...document.querySelectorAll('.ogx-l-fleetinfo-speed-anchor')];
    pills.forEach((p) => { p.style.display = 'none'; });
    const before = rows.map((tr) => tr.getBoundingClientRect().height);
    const cellsBefore = cells.map(box);
    pills.forEach((p) => { p.style.display = ''; });
    return { now, before, cellsNow, cellsBefore };
  });
  assert.deepEqual(heights.now, heights.before, 'ship rows keep their height');
  assert.deepEqual(heights.cellsNow, heights.cellsBefore, 'game ship table unchanged (#ship<ID>_value / _input boxes as without the pills)');
  // the pill stays inside the name column (does not cover the count)
  const fit = await ft.evaluate(() => [...document.querySelectorAll('.ogx-l-fleetinfo-speed')].map((b) => {
    const v = document.getElementById('ship' + b.dataset.ship + '_value'); const t = v.firstChild; const rg = document.createRange(); rg.selectNodeContents(v);
    return Math.round(b.getBoundingClientRect().right) <= Math.round(rg.getBoundingClientRect().left) && !!t;
  }));
  assert.deepEqual(fit, [true, true], 'pill does not reach the ship count');
  // tooltip: page bonus Defense +85 % (tech 110 -> shields), Shield +60 % (tech 111 -> structure), Weapons +35 % on the
  // colony ship (30000 / 100 / 50) [UPSTREAM ShowFleetTablePage:281-283, calculateAttack.php:90-92]
  await ft.hover('.ogx-l-fleetinfo-speed[data-ship="208"]');
  const tip = await ft.evaluate(() => { const t = [...document.querySelectorAll('.ogx-l-fleetinfo-tip')].pop(); return t ? t.innerText : ''; });
  assert.match(tip, /Колонизатор|Colony/);
  assert.match(tip, /Скорость\s+6\s000/);
  assert.match(tip, /Структура\s+48\s000/, '30000 x 1,60 (Shield +60 % = Armour Technology 111)');
  assert.match(tip, /Щиты\s+185/, '100 x 1,85 (Defense +85 % = Shield Technology 110)');
  assert.match(tip, /Атака\s+67/, '50 x 1,35');
  assert.ok(!/NaN|undefined/.test(tip), tip);
  await ft.hover('.ogx-l-fleetinfo-speed[data-ship="210"]');
  const tip2 = await ft.evaluate(() => { const t = [...document.querySelectorAll('.ogx-l-fleetinfo-tip')].pop(); return t ? t.innerText : ''; });
  assert.match(tip2, /Структура\s+1\s600/, 'spy probe 1000 x 1,60');
  await ft.hover('.ogx-l-fleetinfo-speed[data-ship="208"]');
  await shot(ft, 'fleetTable-tooltip');
  await mandatory(env, 'fleetinfo badges');
});

T.test('fleetinfo: selected-fleet table after the ship table (own style), values follow the inputs, collapse persisted', async () => {
  const env = await launch({ viewport: VIEW, settings: solo() });
  const ft = await env.game('fleetTable');
  await env.waitFor(ft, '#ogx-l-fleetinfo');
  const r0 = await ft.evaluate(() => {
    const box = document.getElementById('ogx-l-fleetinfo');
    const shipTable = document.querySelector('form[action*="page=fleetStep1"] table');
    const cs = getComputedStyle(box);
    return { div: box.tagName, prevIsShipTable: box.previousElementSibling === shipTable || shipTable.compareDocumentPosition(box) === 4,
      style: !!document.getElementById('ogx-l-fleetinfo-css'), styleTags: document.querySelectorAll('style#ogx-l-fleetinfo').length,
      bg: cs.backgroundColor, w: Math.round(box.getBoundingClientRect().width), tw: Math.round(shipTable.getBoundingClientRect().width),
      l: Math.round(box.getBoundingClientRect().left), tl: Math.round(shipTable.getBoundingClientRect().left),
      inForm: !!box.closest('form'), hint: box.querySelector('.ogx-l-fleetinfo-row-hint').innerText.trim(), count: box.querySelector('.ogx-l-fleetinfo-row-count td').textContent };
  });
  assert.equal(r0.div, 'DIV');
  assert.ok(r0.prevIsShipTable);
  assert.ok(r0.style, 'own <style id="ogx-l-fleetinfo-css">');
  assert.equal(r0.styleTags, 0, 'no <style> sharing the id of the box');
  assert.notEqual(r0.bg, 'rgba(0, 0, 0, 0)', 'box styled');
  assert.equal(r0.w, r0.tw, 'same width as the ship table');
  assert.ok(Math.abs(r0.l - r0.tl) <= 1, 'aligned with the ship table');
  assert.equal(r0.count, '—');
  assert.match(r0.hint, /Выберите корабли/);

  // select 2 colony ships + 10 probes (as the user types)
  await ft.fill('#ship208_input', '2');
  await ft.fill('#ship210_input', '10');
  await ft.waitForFunction(() => /12/.test(document.querySelector('.ogx-l-fleetinfo-row-count td').textContent), null, { timeout: 5000 });
  const stats = await env.evalOgx(ft, async () => { const s = await OGX.state.shipStats(); return { c208: s[208].cargo, c210: s[210].cargo, n208: OGX.catalog.name(208) }; });
  const r = await ft.evaluate(() => Object.fromEntries(['count', 'cargo', 'speed', 'hint'].map((k) => [k, document.querySelector('.ogx-l-fleetinfo-row-' + k + ' td').textContent])));
  assert.equal(r.count, '12 (2 типа)');
  assert.equal(r.cargo.replace(/\s/g, ''), String(2 * stats.c208 + 10 * stats.c210), 'cargo = sum of the shipStats cargo');
  assert.equal(r.speed, '6' + NB + '000 (' + stats.n208 + ')', 'slowest = page speed of the colony ship');
  assert.match(r.hint, /следующем шаге/);
  // more than available is clamped to the page count (2 colony ships)
  await ft.fill('#ship208_input', '50');
  await ft.waitForFunction(() => /^12/.test(document.querySelector('.ogx-l-fleetinfo-row-count td').textContent), null, { timeout: 5000 });
  await shot(ft, 'fleetTable');
  assert.deepEqual((await layoutShift(ft, ['form[action*="page=fleetStep1"] table'])).diff, [], 'fleetTable: no layout shift of the game');

  await ft.click('#ogx-l-fleetinfo .ogx-l-fleetinfo-toggle');
  for (let i = 0; i < 30 && !((await env.get('fleetinfo.ui')) || {}).collapsed; i++) await ft.waitForTimeout(100);
  assert.equal(((await env.get('fleetinfo.ui')) || {}).collapsed, true);
  const ft2 = await env.game('fleetTable');
  await env.waitFor(ft2, '#ogx-l-fleetinfo.ogx-l-fleetinfo-collapsed');
  await mandatory(env, 'fleetinfo table');
  assert.deepEqual(ownRequests(env).map((x) => x.url), [], 'fleetinfo makes no request');
});

T.test('fleetinfo: stays out of fleetStep1/2/3 and other pages (the game shows distance, time, consumption there)', async () => {
  const env = await launch({ viewport: VIEW, settings: solo() });
  for (const name of ['fleetStep1', 'fleetStep2', 'fleetStep3', 'overview', 'shipyard-fleet']) {
    const p = name === 'shipyard-fleet' ? await env.game('shipyard', { mode: 'fleet' }) : await env.game(name);
    await p.waitForTimeout(400);
    const n = await p.evaluate(() => document.querySelectorAll('#ogx-l-fleetinfo, .ogx-l-fleetinfo-speed').length);
    assert.equal(n, 0, name + ': nothing injected');
    if (/^fleetStep[12]$/.test(name)) { assert.deepEqual((await layoutShift(p)).diff, [], name + ': no layout shift'); await shot(p, name); }
  }
  await mandatory(env, 'fleetinfo other pages');
});

// ------------------------------------------------------------------ all modules together (what the user sees)
T.test('with every suite module on: no errors, nothing POSTed, screenshots', async () => {
  const env = await launch({ viewport: VIEW });
  for (const name of ['overview', 'fleetTable', 'fleetStep1', 'fleetStep3', 'galaxy']) {
    const p = await env.game(name);
    await p.waitForTimeout(800);
    const n = await p.evaluate(() => ({ tl: document.querySelectorAll('#ogx-l-timeline').length, tot: document.querySelectorAll('.ogx-l-inflight-totals').length }));
    assert.equal(n.tl, 1, name + ': one timeline');
    assert.ok(n.tot <= 1, name);
    await shot(p, 'all-' + name);
  }
  await mandatory(env, 'all modules');
});
