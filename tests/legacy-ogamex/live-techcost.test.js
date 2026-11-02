'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// live/techcost: cost badges on list icons and the cost overlay in the technology details (DESIGN §4.1.4, OL rows 12-13).
//   node tests/legacy-ogamex/live-techcost.test.js
// Uses ogamex-live (manifest) when it lists the module, otherwise a throw-away extension with the real shared core
// + this module (tests/core-ext.js), which has the same manifest shape.
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD = path.join(ROOT, 'ogamex-live', 'modules', 'techcost', 'techcost.js');

function ext() {
  const mf = path.join(ROOT, 'ogamex-live', 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if ((m.content_scripts || []).some((cs) => (cs.js || []).includes('modules/techcost/techcost.js'))) return 'live';
  } catch (e) { /* no manifest yet */ }
  return coreExt({ name: 'live', modules: { techcost: fs.readFileSync(MOD, 'utf8') } });
}

const P = '.ogx-l-techcost-';
const num = (s) => +String(s || '').replace(/[^\d]/g, '');
const details = (name) => T.fixtureJson(name).content.technologydetails;

/** What the game JS does in TechnologyDetails.show(): put the AJAX HTML into #technologydetails_content. */
async function openDetails(page, html) {
  await page.evaluate((h) => {
    const box = document.getElementById('technologydetails_content');
    const w = document.getElementById('technologydetails_wrapper');
    if (w) w.style.display = 'block';
    box.style.display = 'block';
    box.innerHTML = h;
  }, html);
}

async function mandatory(env) {
  assert.deepEqual(env.ogxErrors(), [], 'no [OGX errors');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), [], 'no unhandled requests');
}

T.test('techcost: badges on /resources, overlay for solar plant (insufficient metal) and metal mine', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion' });
  const page = await env.open('/resources');
  await env.waitFor(page, '#technologies ' + P + 'badge');
  env.clearRequests();

  // one badge per list item
  const perItem = await page.$$eval('#technologies li.technology[data-technology]', (lis) => lis.map((li) => li.querySelectorAll('.ogx-l-techcost-badge').length));
  assert.ok(perItem.length >= 9, 'items ' + perItem.length);
  assert.deepEqual(perItem, perItem.map(() => 1));

  // metal mine (level 22): calc.cost(1, 23) = 448 909 / 112 227
  const exp = await env.evalOgx(page, () => OGX.calc.cost(1, 23));
  assert.deepEqual([exp.metal, exp.crystal], [448909, 112227]);
  const mm = 'li[data-technology="1"] .ogx-l-techcost-badge';
  assert.deepEqual(await page.$$eval(mm + ' .ogx-l-techcost-bl', (e) => e.map((x) => x.textContent)), ['М 449к', 'К 112к']);
  const mmTitle = await page.getAttribute(mm, 'title');
  assert.ok(mmTitle.includes('Следующий уровень 23'), mmTitle);
  assert.ok(mmTitle.includes('Металл 448\u00a0909') && mmTitle.includes('Кристалл 112\u00a0227'), mmTitle);
  assert.ok(mmTitle.includes('Ресурсов достаточно'), mmTitle);
  assert.equal(await page.$$eval(mm + ' .ogx-l-techcost-bad', (e) => e.length), 0);

  // solar plant (level 24): cost(4, 25) metal 1 262 558 > stock 1 234 567 -> red metal line
  const sp = 'li[data-technology="4"] .ogx-l-techcost-badge';
  assert.deepEqual(await page.$$eval(sp + ' .ogx-l-techcost-bl', (e) => e.map((x) => x.textContent)), ['М 1,26М', 'К 505к']);
  assert.match(await page.getAttribute(sp + ' .ogx-l-techcost-bl-metal', 'class'), /ogx-l-techcost-bad/);
  assert.doesNotMatch(await page.getAttribute(sp + ' .ogx-l-techcost-bl-crystal', 'class'), /ogx-l-techcost-bad/);
  assert.ok((await page.getAttribute(sp, 'title')).includes('Не хватает: металла'));

  // units on the resources page (crawler 217): per piece
  const cr = await env.evalOgx(page, () => OGX.calc.cost(217));
  const crTitle = await page.getAttribute('li[data-technology="217"] .ogx-l-techcost-badge', 'title');
  assert.ok(crTitle.startsWith('Цена за 1 шт.'), crTitle);
  assert.ok(crTitle.includes('Металл ' + cr.metal.toLocaleString('ru-RU').replace(/\s/g, '\u00a0')), crTitle);

  // --- details: solar plant (buildings-ajax-resources-4.json)
  await openDetails(page, details('buildings-ajax-resources-4.json'));
  await env.waitFor(page, '#technologydetails ' + P + 'ov');
  assert.equal(await page.getAttribute('#technologydetails ' + P + 'ov', 'data-id'), '4', 'id from button.upgrade, not data-technology-id=3');
  assert.equal(await page.textContent(P + 'title'), 'Стоимость ур. 25');
  const st = await env.evalOgx(page, async () => {
    const b = OGX.state.projected(await OGX.state.body('p4'));
    const s = await OGX.state.shipStats();
    return { metal: b.res.metal.amount, perHour: b.res.metal.perHour, sc: s[202].cargo, lc: s[203].cargo };
  });
  const missMetal = num(await page.textContent(P + 'row-metal ' + P + 'diff'));
  const expMiss = 1262558 - st.metal;
  assert.ok(Math.abs(missMetal - expMiss) < 60, `metal missing ${missMetal} vs ${expMiss}`);
  assert.ok((await page.textContent(P + 'row-metal ' + P + 'diff')).startsWith('−'));
  assert.match(await page.getAttribute(P + 'row-metal', 'class'), /ogx-l-techcost-bad/);
  assert.match(await page.getAttribute(P + 'row-crystal', 'class'), /ogx-l-techcost-ok/);
  const ships = await page.textContent(P + 'row-metal ' + P + 'ships');
  const m = ships.match(/^([\d\u00a0]+) МТ · ([\d\u00a0]+) БТ$/);
  assert.ok(m, ships);
  assert.ok(Math.abs(num(m[1]) - Math.ceil(expMiss / st.sc)) <= 1, `SC ${ships}`);
  assert.ok(Math.abs(num(m[2]) - Math.ceil(expMiss / st.lc)) <= 1, `LC ${ships}`);
  // total row = missing total (only metal short)
  assert.ok(Math.abs(num(await page.textContent(P + 'row-total ' + P + 'diff')) - expMiss) < 60);
  assert.equal(await page.textContent(P + 'need'), 'Всего 1\u00a0767\u00a0581');
  // total li next to the game's cost icons
  assert.equal(await page.$$eval('#technologydetails .costs ul li.ogx-l-techcost-total', (e) => e.length), 1);
  assert.equal(await page.getAttribute('#technologydetails .costs ul li.ogx-l-techcost-total', 'title'), 'Всего: 1\u00a0767\u00a0581');
  // time until affordable: finite, ≈ missing / (perHour/3600)
  const eta = await page.textContent(P + 'eta');
  const em = eta.match(/^Будет доступно через (\d+):(\d\d):(\d\d) \(в \d\d:\d\d:\d\d\)$/);
  assert.ok(em, eta);
  const etaS = (+em[1]) * 3600 + (+em[2]) * 60 + (+em[3]);
  const expS = expMiss / (st.perHour / 3600);
  assert.ok(Math.abs(etaS - expS) < 30, `eta ${etaS} vs ${expS}`);
  // values follow the projection: after 2 s the missing metal shrinks
  await page.waitForTimeout(2200);
  const miss2 = num(await page.textContent(P + 'row-metal ' + P + 'diff'));
  assert.ok(miss2 < missMetal, `missing shrinks ${missMetal} -> ${miss2}`);

  // --- details replaced: metal mine (enough resources)
  await openDetails(page, details('buildings-ajax-resources-1.json'));
  await page.waitForFunction(() => { const o = document.querySelector('#technologydetails .ogx-l-techcost-ov'); return o && o.dataset.id === '1'; });
  assert.equal(await page.$$eval('#technologydetails .ogx-l-techcost-ov', (e) => e.length), 1);
  assert.equal(await page.textContent(P + 'eta'), 'Ресурсов достаточно');
  assert.equal(await page.textContent(P + 'row-total ' + P + 'diff'), '561\u00a0136');
  assert.equal(await page.textContent(P + 'row-metal ' + P + 'ships'), '');

  // collapse toggle: user action, persisted
  await page.click(P + 'toggle');
  assert.match(await page.getAttribute(P + 'ov', 'class'), /ogx-l-techcost-collapsed/);
  await page.waitForTimeout(300);
  assert.deepEqual(await env.get('techcost.ui'), { v: 1, collapsed: true });

  // journal: B events for our actions, U click on the toggle
  await page.waitForTimeout(200);
  const ev = await env.evalOgx(page, () => OGX.diag.recent().filter((e) => (e.s === 'B' && e.k === 'techcost') || e.s === 'U').map((e) => e.s + ':' + e.k + ':' + e.w));
  assert.ok(ev.includes('B:techcost:renderBadges'), JSON.stringify(ev));
  assert.ok(ev.includes('B:techcost:attachOverlay'), JSON.stringify(ev));
  assert.ok(ev.includes('B:techcost:toggleCollapsed'), JSON.stringify(ev));
  assert.ok(ev.some((x) => x.startsWith('U:click') && x.includes('toggle')), JSON.stringify(ev));

  // no request was made by the module
  assert.deepEqual(env.requests().map((r) => r.method + ' ' + r.path), []);
  await env.screenshot(page, 'live-techcost-resources');
  await mandatory(env);
});

T.test('techcost: /shipyard badges per piece, #build_amount multiplies the overlay; collapsed state remembered', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion', storage: { '{host}|{pid}|techcost.ui': { v: 1, collapsed: true } } });
  const page = await env.open('/shipyard');
  await env.waitFor(page, '#technologies ' + P + 'badge');
  const lc = 'li[data-technology="203"] .ogx-l-techcost-badge';
  assert.deepEqual(await page.$$eval(lc + ' .ogx-l-techcost-bl', (e) => e.map((x) => x.textContent)), ['М 6к', 'К 6к']);
  assert.ok((await page.getAttribute(lc, 'title')).startsWith('Цена за 1 шт.: Металл 6\u00a0000, Кристалл 6\u00a0000'));

  await openDetails(page, details('buildings-ajax-shipyard-203.json'));
  await env.waitFor(page, '#technologydetails ' + P + 'ov');
  assert.equal(await page.getAttribute(P + 'ov', 'data-id'), '203');
  assert.match(await page.getAttribute(P + 'ov', 'class'), /ogx-l-techcost-collapsed/, 'collapsed state restored');
  await page.click(P + 'toggle');
  assert.doesNotMatch(await page.getAttribute(P + 'ov', 'class'), /ogx-l-techcost-collapsed/);

  assert.equal(await page.textContent(P + 'mult'), '×1');
  assert.match(await page.getAttribute(P + 'row-metal', 'title'), /^Металл: нужно 6\u00a0000, есть /);
  assert.equal(await page.textContent(P + 'need'), 'Всего 12\u00a0000');
  const afford = await page.textContent(P + 'afford');
  assert.match(afford, /^Хватает сейчас на [\d\u00a0]+ шт\. \(макс\. 85\)$/);

  // the user types 10
  await page.fill('#build_amount', '10');
  await page.waitForFunction(() => document.querySelector('.ogx-l-techcost-mult').textContent === '×10');
  assert.match(await page.getAttribute(P + 'row-metal', 'title'), /^Металл: нужно 60\u00a0000, есть /);
  assert.equal(await page.textContent(P + 'need'), 'Всего 120\u00a0000');
  assert.equal(await page.getAttribute('#technologydetails .costs ul li.ogx-l-techcost-total', 'title'), 'Всего: 120\u00a0000 (за 10 шт.)');

  // the game's [max] button sets the value without events: picked up on the next tick
  await page.evaluate(() => { document.getElementById('build_amount').value = '85'; });
  await page.waitForFunction(() => document.querySelector('.ogx-l-techcost-mult').textContent === '×85', null, { timeout: 4000 });
  assert.equal(await page.textContent(P + 'need'), 'Всего 1\u00a0020\u00a0000');
  // 510 000 crystal > 512 345 stock? -> still enough; metal 510 000 < 1.23M -> enough
  assert.equal(await page.textContent(P + 'eta'), 'Ресурсов достаточно');
  await page.evaluate(() => { document.getElementById('build_amount').value = '200'; });
  await page.waitForFunction(() => document.querySelector('.ogx-l-techcost-mult').textContent === '×200', null, { timeout: 4000 });
  assert.match(await page.getAttribute(P + 'row-crystal', 'class'), /ogx-l-techcost-bad/);
  assert.match(await page.textContent(P + 'eta'), /^(Будет доступно через|Не накопится)/);

  await env.screenshot(page, 'live-techcost-shipyard');
  await mandatory(env);
});

T.test('techcost: /research badges and storage-limited overlay; /defense and /facilities badges', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion' });
  let page = await env.open('/research');
  await env.waitFor(page, '#technologies ' + P + 'badge');
  const n = await page.$$eval('#technologies li.technology[data-technology]', (l) => l.length);
  assert.equal(await page.$$eval('#technologies ' + P + 'badge', (l) => l.length), n);
  // astrophysics rounding comes from calc.cost
  const lvl124 = +(await page.getAttribute('li[data-technology="124"] span.level', 'data-value'));
  const c124 = await env.evalOgx(page, (l) => OGX.calc.cost(124, l + 1), lvl124);
  assert.ok((await page.getAttribute('li[data-technology="124"] ' + P + 'badge', 'title')).includes('Металл ' + c124.metal.toLocaleString('ru-RU').replace(/\s/g, '\u00a0')));

  await openDetails(page, details('buildings-ajax-research-124.json'));
  await env.waitFor(page, '#technologydetails ' + P + 'ov');
  assert.equal(await page.getAttribute(P + 'ov', 'data-id'), '124');
  // crystal 1 231 500 > crystal storage 865 000: can never be paid on this planet
  assert.match(await page.getAttribute(P + 'row-crystal', 'class'), /ogx-l-techcost-bad/);
  assert.match(await page.textContent(P + 'eta'), /^Не накопится: .*мало места в хранилище кристалла/);
  assert.match(await page.getAttribute(P + 'eta', 'class'), /ogx-l-techcost-bad/);

  page = await env.open('/defense');
  await env.waitFor(page, '#technologies ' + P + 'badge');
  const nd = await page.$$eval('#technologies li.technology[data-technology]', (l) => l.length);
  assert.equal(await page.$$eval('#technologies ' + P + 'badge', (l) => l.length), nd);
  assert.deepEqual(await page.$$eval('li[data-technology="401"] .ogx-l-techcost-bl', (e) => e.map((x) => x.textContent)), ['М 2к']);

  page = await env.open('/facilities');
  await env.waitFor(page, '#technologies ' + P + 'badge');
  const lv21 = +(await page.getAttribute('li[data-technology="21"] span.level', 'data-value'));
  const c21 = await env.evalOgx(page, (l) => OGX.calc.cost(21, l + 1), lv21);
  assert.ok((await page.getAttribute('li[data-technology="21"] ' + P + 'badge', 'title')).includes('Металл ' + c21.metal.toLocaleString('ru-RU').replace(/\s/g, '\u00a0')));
  await mandatory(env);
});

T.test('techcost: settings off, other pages untouched, non-OgameX page safe', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion', settings: { 'techcost.showBadges': false } });
  let page = await env.open('/resources');
  await openDetails(page, details('buildings-ajax-resources-1.json'));
  await env.waitFor(page, '#technologydetails ' + P + 'ov');
  assert.equal(await page.$$eval('#technologies ' + P + 'badge', (l) => l.length), 0);
  // turning badges on at runtime renders them, turning the overlay off removes it
  await env.evalOgx(page, () => OGX.settings.set('techcost.showBadges', true));
  await env.waitFor(page, '#technologies ' + P + 'badge');
  await env.evalOgx(page, () => OGX.settings.set('techcost.showOverlay', false));
  await page.waitForFunction(() => !document.querySelector('.ogx-l-techcost-ov'));

  page = await env.open('/overview');
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('[class*="ogx-l-techcost"]', (e) => e.length), 0);
  assert.equal(await page.$$eval('style#ogx-l-techcost', (e) => e.length), 0);
  await mandatory(env);

  env.clearRequests();
  page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.requests().map((r) => r.path), ['/not-ogame']);
});
