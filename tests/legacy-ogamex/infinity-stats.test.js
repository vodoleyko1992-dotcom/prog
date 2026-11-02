'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / stats: explicit scan (mark-as-read warning, subtab pagination, stop at known pages), stored records,
// «Статистика» tab numbers (period «Всё время»), daily SVG chart, bridge capture of a full combat report, passive collection
// on /messages with full combat reports, analysis badges and per-page summaries, journal events, non-OgameX safety.
//   node tests/legacy-ogamex/infinity-stats.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');
const { rewrite } = require('../server');

const ROOT = path.resolve(__dirname, '..', '..');
const STATS_SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/stats/stats.js'), 'utf8');
const PANEL_FILE = path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js');
const PANEL_SRC = fs.existsSync(PANEL_FILE) ? fs.readFileSync(PANEL_FILE, 'utf8') : null;

let extCache = null;
function ext() {
  if (!extCache) {
    const modules = {};
    if (PANEL_SRC) modules.panel = PANEL_SRC;
    modules.stats = STATS_SRC;
    extCache = coreExt({ name: 'infinity', modules });
  }
  return extCache;
}

const P = 'ogx-i-stats-';
const nbsp = (s) => String(s).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const PANE = '.ogx-tab-pane[data-tab="stats"]';

// /messages after the game JS loaded the fleets tab and the combat, expeditions and other subtabs (real AJAX bodies).
function installMessagesRoute(env) {
  env.server.route('GET', '/messages', (req, res, ctx) => {
    ctx.rec.fixture = 'messages-page-loaded-espionage.html + combat/expeditions/other subtabs';
    let html = T.fixture('messages-page-loaded-espionage.html');
    const fill = (id, name) => {
      const re = new RegExp(`(<div id="${id}"[^>]*>)\\s*</div>`);
      assert.ok(re.test(html), 'panel ' + id + ' in fixture');
      html = html.replace(re, (m, open) => open + T.fixture(name) + '</div>');
    };
    fill('ui-id-16', 'messages-ajax-fleets-combat_reports.html');
    fill('ui-id-18', 'messages-ajax-fleets-expeditions.html');
    fill('ui-id-22', 'messages-ajax-fleets-other.html');
    return ctx.send(200, rewrite(html, ctx.origin), 'text/html; charset=utf-8');
  });
}

async function waitStore(env, key, pred, timeout = 20000) {
  const t0 = Date.now();
  let v = null;
  while (Date.now() - t0 < timeout) {
    v = await env.get(key);
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timeout waiting for ' + key + ': ' + JSON.stringify(v).slice(0, 600));
}
const count = (v) => (v && v.items ? Object.keys(v.items).length : 0);
const battles = (v) => (v && v.items ? Object.values(v.items).filter((r) => r.kind === 'battle') : []);

async function openTab(env, page) {
  await env.evalOgx(page, () => { const p = OGX.dom.sidePanel('infinity'); p.open(); p.selectTab('stats'); return true; }, null, 'infinity');
  await env.waitFor(page, `${PANE} .${P}root`);
}
async function clickOk(page) {
  await page.waitForSelector('.ogx-modal .ogx-modal-buttons .ogx-btn:last-child', { state: 'visible', timeout: 5000 });
  await page.click('.ogx-modal .ogx-modal-buttons .ogx-btn:last-child');
}
async function waitToast(page, re) {
  await page.waitForFunction((src) => [...document.querySelectorAll('.ogx-toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 15000 });
}
const kvText = (page, k) => page.textContent(`${PANE} .${P}kv[data-k="${k}"] .${P}v`).then(nbsp);

T.test('stats: scan with warning, stored records, statistics tab numbers, chart, stop at known pages, bridge capture', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.httpGapMs': 100 } });
  const page = await env.open('/overview');
  await openTab(env, page);
  env.clearRequests();

  // --- explicit scan: confirmation with the mark-as-read warning, then the subtabs page by page
  await page.click(`${PANE} button[data-ogx-act="stats:scan"]`);
  await page.waitForSelector('.ogx-modal', { state: 'visible' });
  assert.match(nbsp(await page.textContent('.ogx-modal')), /пометит все загруженные сообщения прочитанными/);
  await clickOk(page);
  await waitToast(page, /Сканирование завершено/);

  const combat = await waitStore(env, 'stats.combat', (v) => battles(v).length === 3);
  const exps = await waitStore(env, 'stats.expeditions', (v) => count(v) === 11);
  const fleet = await waitStore(env, 'stats.fleet', (v) => count(v) === 12);
  assert.equal(combat.v, 1); assert.equal(exps.v, 1); assert.equal(fleet.v, 1);
  assert.deepEqual(Object.keys(combat.items).sort(), ['2034', '2039', '2040', '2043', '2050', '2053']);
  const b = combat.items;
  assert.deepEqual([b[2053].role, b[2053].result, b[2053].loot.total, b[2053].lossesOwn, b[2053].lossesEnemy, b[2053].coords], ['attack', 'win', 107000, 12000, 28000, '1:39:4']);
  assert.deepEqual([b[2050].role, b[2050].result, b[2050].loot.total, b[2050].lossesOwn, b[2050].moonChance], ['defense', 'loss', 146000, 320000, null]);
  assert.deepEqual([b[2034].role, b[2034].result, b[2034].opponent], ['expedition', 'win', 'Pirates']);
  assert.equal(b[2043].kind, 'lost_contact');
  assert.deepEqual([b[2040].kind, b[2040].missiles, b[2040].intercepted, b[2040].destroyed], ['missile_attack', 10, 6, { 401: 40 }]);
  assert.deepEqual([b[2039].kind, b[2039].destroyed, b[2039].opponent], ['missile_defense', { 401: 30, 402: 5 }, 'Admiral Rigel']);
  // one of each expedition outcome
  const outcomes = Object.values(exps.items).map((r) => r.outcome).sort();
  assert.deepEqual(outcomes, ['aliens', 'dark_matter', 'delay', 'fleet_lost', 'item', 'merchant', 'nothing', 'pirates', 'resources', 'ships', 'speedup']);
  assert.deepEqual(exps.items[2054].resources, { metal: 412500, crystal: 0, deuterium: 0 });
  assert.equal(exps.items[2048].darkMatter, 1850);
  assert.deepEqual(exps.items[2052].ships, { 202: 5, 204: 12, 210: 3 });
  const keys = Object.values(fleet.items).map((r) => r.key).sort();
  assert.deepEqual(keys, ['acs_defend_arrival_sender', 'colony_establish_fail_astrophysics', 'colony_established', 'debris_field_harvest', 'fleet_deployment',
    'fleet_deployment_with_resources', 'fleet_union_invite', 'return_of_fleet', 'return_of_fleet_with_resources', 'transport_arrived', 'transport_received', 'wreck_field_repair_completed']);
  assert.deepEqual(fleet.items[2028].harvest.harvested, { metal: 2700, crystal: 900, deuterium: 0 });
  assert.equal(fleet.items[2023].shipsRepaired, 18);

  // requests: every subtab, expeditions page 2, economy with subtab=economy; nothing else
  const lists = env.requests('GET', '/ajax/messages').map((r) => `${r.query.tab}/${r.query.subtab}/${r.query.pagination}`);
  assert.deepEqual(lists, ['fleets/combat_reports/1', 'fleets/expeditions/1', 'fleets/expeditions/2', 'fleets/transport/1', 'fleets/other/1', 'economy/economy/1']);
  assert.equal(env.requests('GET', /^\/ajax\/messages\/\d+$/).length, 0, 'fetchFullCombat is off');

  // --- statistics tab, period «Всё время»
  await page.selectOption(`${PANE} select.${P}period`, 'all');
  await page.waitForFunction((sel) => { const e = document.querySelector(sel); return e && e.value === 'all'; }, `${PANE} select.${P}period`);
  await page.waitForFunction((sel) => /11/.test((document.querySelector(sel) || {}).textContent || ''), `${PANE} .${P}kv[data-k="exp-count"] .${P}v`);
  assert.equal(await kvText(page, 'exp-count'), '11');
  for (const o of ['resources', 'dark_matter', 'ships', 'item', 'merchant', 'nothing', 'delay', 'speedup', 'pirates', 'aliens', 'fleet_lost']) {
    assert.equal(nbsp(await page.textContent(`${PANE} .${P}orow[data-outcome="${o}"] .${P}ocount`)), '1', o);
  }
  assert.equal(nbsp(await page.textContent(`${PANE} .${P}orow[data-outcome="resources"] .${P}olabel`)), 'Ресурсы');
  assert.equal(nbsp(await page.textContent(`${PANE} .${P}orow[data-outcome="fleet_lost"] .${P}olabel`)), 'Чёрная дыра');
  assert.equal(await kvText(page, 'exp-resources'), 'М 412 500 · К 0 · Д 0');
  assert.equal(await kvText(page, 'exp-dm'), '1 850');
  const ships = await kvText(page, 'exp-ships');
  for (const s of ['Малый транспорт: 5', 'Лёгкий истребитель: 12', 'Шпионский зонд: 3']) assert.ok(ships.includes(s), ships);
  assert.equal(await kvText(page, 'exp-blackholes'), '1');
  assert.match(await kvText(page, 'exp-avg'), /^37 500 ЕМ ресурсов · 168 ТМ/);
  // battles: 3, by role; 2050 is a defence loss
  assert.match(await kvText(page, 'combat-count'), /^3 /);
  const roleCells = async (role) => (await page.$$eval(`${PANE} .${P}roles tr[data-role="${role}"] td`, (e) => e.map((x) => x.textContent.trim())));
  assert.deepEqual(await roleCells('attack'), ['Атака', '1', '0', '0', '1']);
  assert.deepEqual(await roleCells('defense'), ['Защита', '0', '1', '0', '1']);
  assert.deepEqual(await roleCells('expedition'), ['Экспедиция', '1', '0', '0', '1']);
  assert.match(await kvText(page, 'combat-loot'), /^≈107 000/);
  assert.equal(await kvText(page, 'combat-losses-own'), String(12000 + 320000 + 8000).replace(/\B(?=(\d{3})+$)/g, ' '));
  // net = (107 000 − 12 000) + (−146 000 − 320 000) + (−8 000) in metal units (loot split unknown → ≈)
  assert.equal(await kvText(page, 'combat-net'), '≈-379 000');
  assert.match(nbsp(await page.textContent(`${PANE} .${P}sec[data-sec="combat"] .${P}note`)), /потеря связи: 1 · ракетные удары: 1 .*ракетные атаки на нас: 1/);
  // harvest and transport
  assert.equal(await kvText(page, 'harvest-count'), '1');
  assert.match(await kvText(page, 'harvest-total'), /^3 600 М 2 700 · К 900 · Д 0/);
  assert.equal(await kvText(page, 'tr-received'), 'М 15 000 · К 0 · Д 2 000');
  assert.equal(await kvText(page, 'tr-delivered'), 'М 75 000 · К 40 000 · Д 12 500');
  assert.equal(await kvText(page, 'tr-returns'), 'М 60 172 · К 32 105 · Д 15 064');
  assert.match(nbsp(await page.textContent(`${PANE} .${P}sec[data-sec="transport"] .${P}note`)), /колоний основано: 1 · неудачных колонизаций: 1 · восстановлено из обломков флота: 18 кор\./);

  // chart: expeditions by default (412 500 metal on 30.10 → one positive bar), switch to battles (negative bar on 30.10)
  assert.equal(await page.getAttribute(`${PANE} .${P}chartbox`, 'data-chart'), 'expeditions');
  const bars = await page.$$eval(`${PANE} svg.${P}chart rect.${P}bar`, (e) => e.map((x) => [x.getAttribute('data-day'), +x.getAttribute('data-v')]));
  assert.ok(bars.length >= 2, JSON.stringify(bars));
  assert.deepEqual(bars.filter((x) => x[0] === '2026-10-30').map((x) => x[1]), [412500]);
  await page.click(`${PANE} button[data-ogx-act="stats:chart-combat"]`);
  await page.waitForSelector(`${PANE} .${P}chartbox[data-chart="combat"]`);
  const cbars = await page.$$eval(`${PANE} svg.${P}chart rect.${P}bar-neg`, (e) => e.map((x) => [x.getAttribute('data-day'), +x.getAttribute('data-v')]));
  assert.deepEqual(cbars, [['2026-10-29', -8000], ['2026-10-30', -371000]]);

  // --- second scan: every first page is known → no page 2
  env.clearRequests();
  await page.click(`${PANE} button[data-ogx-act="stats:scan"]`);
  await clickOk(page);
  await waitToast(page, /новых боёв 0, экспедиций 0, других сообщений 0/);
  assert.deepEqual(env.requests('GET', '/ajax/messages').map((r) => `${r.query.subtab}/${r.query.pagination}`),
    ['combat_reports/1', 'expeditions/1', 'transport/1', 'other/1', 'economy/1']);

  // --- the game opens the full report 2053 in its overlay → captured from the page XHR (exact loot split)
  await page.evaluate(() => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('GET', '/ajax/messages/2053?tab=fleets&subtab=combat_reports');
    x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    x.onload = () => resolve(x.status);
    x.send();
  }));
  const after = await waitStore(env, 'stats.combat', (v) => v && v.items['2053'] && v.items['2053'].full === true);
  const r53 = after.items['2053'];
  assert.deepEqual([r53.loot.metal, r53.loot.crystal, r53.loot.deuterium, r53.loot.total, r53.lootSplit], [60172, 32105, 15064, 107341, true]);
  assert.deepEqual(r53.lostUnitsOwn, { 204: 3 });
  assert.deepEqual(r53.debris, { metal: 2700, crystal: 900, deuterium: 0, total: 3600 });
  assert.equal(r53.moonCreated, false);
  assert.equal(r53.role, 'attack');

  // journal: user clicks (U) and add-on actions (B)
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => e.k === 'stats' || (e.s === 'U' && /stats:/.test(e.w))).map((e) => e.s + ' ' + e.k + ' ' + e.w), null, 'infinity');
  for (const want of ['U click stats:scan', 'U stats scan:confirm', 'B stats scan', 'B stats scan:list', 'U change stats:period', 'U stats period', 'U click stats:chart-combat', 'B stats combat:captured', 'B stats combat:full', 'B stats collect']) {
    assert.ok(ev.includes(want), 'journal has ' + want + ' in ' + JSON.stringify(ev.slice(0, 60)));
  }
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('stats: passive collection on /messages with full combat reports, badges and per-page summaries', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega', settings: { 'core.httpGapMs': 100, 'stats.fetchFullCombat': true } });
  installMessagesRoute(env);
  const page = await env.open('/messages');

  const exps = await waitStore(env, 'stats.expeditions', (v) => count(v) === 10); // page 1 of the expeditions subtab
  assert.ok(!exps.items['2030'], 'page 2 not loaded passively');
  const combat = await waitStore(env, 'stats.combat', (v) => battles(v).length === 3 && battles(v).every((r) => r.full));
  const detail = env.requests('GET', /^\/ajax\/messages\/\d+$/);
  assert.deepEqual(detail.map((r) => r.path).sort(), ['/ajax/messages/2034', '/ajax/messages/2050', '/ajax/messages/2053']);
  for (const r of detail) assert.equal(r.query.subtab, 'combat_reports');
  const r50 = combat.items['2050'];
  assert.deepEqual([r50.role, r50.result, r50.full], ['defense', 'loss', true]);
  assert.deepEqual(r50.lostUnitsOwn, { 202: 5, 204: 40, 401: 60, 402: 10 });
  assert.deepEqual(r50.loot, { metal: 76173, crystal: 49356, deuterium: 20615, total: 146144 });
  await waitStore(env, 'stats.fleet', (v) => count(v) === 7);

  // badges: expedition outcome + amounts, combat summary, harvest summary
  await page.waitForFunction(() => document.querySelectorAll('#ui-id-18 li.msg .ogx-i-stats-badge').length === 10);
  const b54 = nbsp(await page.textContent('li.msg[data-msg-id="2054"] .ogx-i-stats-badge'));
  assert.match(b54, /^Ресурсы М 412 500 · К 0 · Д 0/);
  assert.match(nbsp(await page.textContent('li.msg[data-msg-id="2052"] .ogx-i-stats-badge')), /Корабли .*5/);
  assert.match(nbsp(await page.textContent('li.msg[data-msg-id="2048"] .ogx-i-stats-badge')), /Тёмная материя ТМ 1 850/);
  await page.waitForFunction(() => /Добыча\s107\s341/.test((document.querySelector('li.msg[data-msg-id="2053"] .ogx-i-stats-badge') || {}).textContent || ''));
  const b53 = nbsp(await page.textContent('li.msg[data-msg-id="2053"] .ogx-i-stats-badge'));
  assert.match(b53, /^Атака: Победа Добыча 107 341 Потери 12 000 \/ противник 28 000 Обломки 3 600/);
  assert.match(nbsp(await page.textContent('li.msg[data-msg-id="2050"] .ogx-i-stats-badge')), /^Защита: Поражение/);
  assert.match(nbsp(await page.textContent('li.msg[data-msg-id="2028"] .ogx-i-stats-badge')), /Переработка Собрано М 2 700 · К 900 · Д 0/);
  // the badge sits inside the li, before message-footer
  assert.equal(await page.$eval('li.msg[data-msg-id="2054"] .ogx-i-stats-badge', (e) => e.nextElementSibling && e.nextElementSibling.tagName.toLowerCase()), 'message-footer');

  // per-page summaries at the top of each list
  await page.waitForFunction(() => /10\sэкспедиций/.test((document.querySelector('#ui-id-18 .ogx-i-stats-summary') || {}).textContent || ''));
  const sumExp = nbsp(await page.textContent('#ui-id-18 .ogx-i-stats-summary'));
  assert.match(sumExp, /На странице: 10 экспедиций М 412 500 · К 0 · Д 0 ТМ 1 850 кораблей 20/);
  // all three full: exact loot, net in MSU 1:1.5:3 = 2053 (153 521.5 − 13 500) + 2050 (−212 052 − 347 500) + 2034 (−9 000)
  await page.waitForFunction(() => /итог\s-428\s530/.test((document.querySelector('#ui-id-16 .ogx-i-stats-summary') || {}).textContent || ''));
  assert.equal(nbsp(await page.textContent('#ui-id-16 .ogx-i-stats-summary')), 'На странице: 3 боя: побед 2, поражений 1 добыча 107 341 потери 340 000 итог -428 530 ЕМ');
  assert.match(nbsp(await page.textContent('#ui-id-22 .ogx-i-stats-summary')), /7 сообщений/);
  // the summary is the first li of ul.tab_inner of its panel
  assert.equal(await page.$eval('#ui-id-18 ul.tab_inner > li', (e) => e.className), `${P}summary ogx-root`);
  // no badges on espionage (spy's job) and on the communication demo messages
  assert.equal(await page.$$eval('#ui-id-14 .ogx-i-stats-badge', (e) => e.length), 0);

  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => e.k === 'stats').map((e) => e.s + ' ' + e.w), null, 'infinity');
  for (const want of ['B combat:fetch', 'B combat:full', 'B collect']) assert.ok(ev.includes(want), want + ' in ' + JSON.stringify(ev));
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('stats: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
});
