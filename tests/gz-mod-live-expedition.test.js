'use strict';
// Live expedition module (ogamex-live/modules/expedition) on the REAL saved GALAXYZ pages (ogamex.eu/Aeternum,
// fixtures/galaxyz/pages) through the suite extension: info box on page=fleetTable / fleetStep1 / fleetStep2, «Экспедиция»
// button (fleetTable hidden target + mission 15, fleetStep1 destination + speed), fleetStep2 mission 15 + stay time preselect.
// Every check compares with the page source, looks for console errors, proves the game layout does not move, and that nothing
// is sent without the user's click (the only POSTs are the test's own clicks on the game's «Continue»). Screenshots of every page
// the module touches: tests/out/gz-live-expedition-<page>.png.
//   node tests/gz-mod-live-expedition.test.js
//
// Expected numbers (rules [UPSTREAM] 2Moons MissionCaseExpedition): expedition points = sum (metal + crystal) x 5 / 1000 per ship,
// resource find = min(free BASE cargo, 200 x points = fleet metal + crystal cost). The saved fleetStep2 shows "Fleet points: 150"
// for the 1 colony ship of fleetStep1 (data.ships {208: 1}, data.fleetroom 7500): 150 x 200 = 30 000 = 10 000 + 20 000 [REAL].
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

const OUT = path.join(__dirname, 'out');
const PAGES = path.join(__dirname, '..', 'fixtures', 'galaxyz', 'pages');
const OTHERS = ['menu', 'planetbar', 'techcost', 'timeline', 'inflight', 'fleetinfo', 'panel', 'prefs', 'empire', 'todo', 'spy', 'stats', 'targets', 'stalk', 'fleethelp', 'flights', 'mail', 'missiles'];
const VIEW = { width: 1400, height: 900 };
const NB = ' ';
const SAVED_TOKEN = 'd583ed8b434e588148fe929b8f939eab';
const B = '#ogx-l-expedition-box-gz';

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const solo = (extra = {}) => Object.assign(Object.fromEntries(OTHERS.map((m) => [m + '.enabled', false])), extra);
const saved = (name) => fs.readFileSync(path.join(PAGES, name + '.html'), 'utf8');
const num = (s) => +String(s).replace(/[^\d]/g, '');
/** A stored top-1 score above 5 M (ship-find cap 6 000): no page=statistics request in the tests that do not test it. */
const TOP = (points = 6e6) => ({ '{host}|*|topScore': { points, playerId: null, t: Date.now() } });

function recordRequests(env) {
  env.pageRequests = [];
  env.context.on('request', (rq) => {
    const u = new URL(rq.url());
    if (!/\/game\.php$/.test(u.pathname)) return;
    env.pageRequests.push({ method: rq.method(), url: u.pathname + u.search, type: rq.resourceType(),
      route: 'page=' + (u.searchParams.get('page') || 'overview') + (u.searchParams.get('mode') ? '&mode=' + u.searchParams.get('mode') : '') });
  });
  return env;
}
const ownRequests = (env) => (env.pageRequests || []).filter((r) => r.type !== 'document');
async function launch(o) { return recordRequests(await G.launch(o)); }
const posts = (env) => env.server.requests.filter((r) => r.method === 'POST');

async function mandatory(env, what, { allowPosts = [] } = {}) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  assert.deepEqual(env.consoleErrors().filter((e) => /OGX|ogx-|expedition/i.test((e.text || '') + (e.stack || ''))).map((e) => e.text), [], what + ': no console errors from the add-on');
  assert.deepEqual(posts(env).map((r) => r.route), allowPosts, what + ': only the POSTs of the test\'s own «Continue» clicks');
}

/** Bounding boxes of the game chrome and of every row of the form's first table, with our elements shown and hidden. Only the
 * box itself (appended after the table / form) may push what follows it. */
async function layoutShift(page) {
  return page.evaluate(() => {
    const form = document.querySelector('form[action*="page=fleetStep1"], form[action*="page=fleetStep2"], form[action*="page=fleetStep3"]');
    const table = form && form.querySelector('table');
    const measure = () => {
      const o = {};
      for (const s of ['#links', '#menuTable', '#inhalt', '#rechts', '#myWorlds', '#resTable', '#messages_collapsed']) {
        const e = document.querySelector(s);
        if (e) { const b = e.getBoundingClientRect(); o[s] = [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; }
      }
      if (table) table.querySelectorAll('tr').forEach((tr, i) => { const b = tr.getBoundingClientRect(); o['tr' + i] = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
      table && Array.from(table.querySelectorAll('th, input, select')).filter((e) => !e.closest('.ogx-l-expedition-hanchor')).forEach((e, i) => { const b = e.getBoundingClientRect(); o['f' + i] = [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; });
      o.scrollW = document.documentElement.scrollWidth;
      return o;
    };
    const ours = Array.from(document.querySelectorAll('#ogx-l-expedition-box-gz, .ogx-l-expedition-hanchor'));
    const withUs = measure();
    const keep = ours.map((e) => [e, e.style.display]);
    for (const [e] of keep) e.style.setProperty('display', 'none', 'important');
    const without = measure();
    for (const [e, d] of keep) e.style.display = d;
    const diff = Object.keys(without).filter((k) => JSON.stringify(withUs[k]) !== JSON.stringify(without[k])).map((k) => k + ' ' + JSON.stringify(withUs[k]) + ' vs ' + JSON.stringify(without[k]));
    return { diff, ours: ours.length };
  });
}

const shot = async (page, name) => { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, 'gz-live-expedition-' + name + '.png'); await page.screenshot({ path: f, fullPage: true }); return f; };

/** The box as text pieces. */
const readBox = (page) => page.evaluate((sel) => {
  const b = document.querySelector(sel);
  if (!b) return null;
  const t = (s) => { const e = b.querySelector(s); return e ? e.textContent.trim() : null; };
  return { text: b.innerText, slots: t('.ogx-l-expedition-slots b'), slotsClass: (b.querySelector('.ogx-l-expedition-slots') || {}).className || '',
    slotsTitle: (b.querySelector('.ogx-l-expedition-slots') || {}).title || '',
    count: t('.ogx-l-expedition-count'), cost: t('.ogx-l-expedition-cost'), points: t('.ogx-l-expedition-points'), free: t('.ogx-l-expedition-free'),
    freeTitle: (b.querySelector('.ogx-l-expedition-free') || { parentElement: {} }).parentElement.title || '',
    find: t('.ogx-l-expedition-find'), res: t('.ogx-l-expedition-res'), resClass: (b.querySelector('.ogx-l-expedition-res') || {}).className || '',
    shipfind: t('.ogx-l-expedition-shipfind'), ships: ['normal', 'rare', 'exceptional'].map((k) => t('.ogx-l-expedition-ship-' + k)),
    topinfo: t('.ogx-l-expedition-topinfo'), times: t('.ogx-l-expedition-times'), prefilled: t('.ogx-l-expedition-prefilled'), btninfo: t('.ogx-l-expedition-btninfo') };
}, B);

/** fleetStep2 the way 2Moons renders it for a position-16 target: only mission 15, and the stay time select
 * (page.fleetStep2.default.tpl:57-65 [UPSTREAM]: {html_options name=staytime options=$StaySelector}; never saved live). */
function routeExpeditionStep2(env, { astro = 3 } = {}) {
  env.server.route('POST', 'fleetStep2', (req, res, ctx) => {
    const st = ctx.state;
    if (!st.token || ctx.form.token !== st.token) return ctx.redirect('page=fleetTable');
    st.fleet.speed = +ctx.form.speed || 10;
    st.fleet.target = { galaxy: +ctx.form.galaxy, system: +ctx.form.system, planet: +ctx.form.planet, type: +ctx.form.type || 1 };
    const opts = Array.from({ length: astro }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    return ctx.sendPage('fleetStep2', (html) => html.split(SAVED_TOKEN).join(st.token)
      .replace(/<input id="radio_7"[^]*?<br>/, '<input id="radio_15" type="radio" name="mission" value="15"><label for="radio_15"><span></span>Expedition</label><br>')
      .replace(/(<tr style="height:20px;">\s*<td class="transparent" colspan="3">Fleet points:)/,
        `<tr style="height:20px;"><th>Hold time</th></tr><tr style="height:20px;"><td><select name="staytime">${opts}</select> hours</td></tr>$1`));
  });
}

// ------------------------------------------------------------------ fleetTable
T.test('fleetTable: box follows the selection (cost, base cargo, find, cargo suggestions, ship finds), slots from the page header', async () => {
  const env = await launch({ viewport: VIEW, settings: solo(), storage: TOP() });
  const ft = await env.game('fleetTable');
  await env.waitFor(ft, B + ' .ogx-l-expedition-slots');
  const html = saved('fleetTable');
  assert.match(html, /0 \/ 2\s+expedition/, "page header");
  let b = await readBox(ft);
  assert.equal(b.slots, '0/2', 'expedition slots = "0 / 2 expedition" of this page');
  assert.match(b.slotsClass, /ogx-ok/);
  assert.match(b.slotsTitle, /заголовка этой страницы/);
  assert.equal(b.cost, null, 'no fleet numbers before a selection');
  assert.match(b.text, /Выберите корабли/);
  assert.ok(!/NaN|undefined|x0\b/.test(b.text), b.text);

  const cat = await env.evalOgx(ft, () => Object.fromEntries([202, 203, 208, 210, 217].map((id) => { const o = OGX.catalog.get(id); return [id, { mc: o.price.metal + o.price.crystal, cargo: o.props.cargo, short: OGX.catalog.name(id) }]; })));
  assert.equal(cat[208].mc, 30000, 'colony ship metal + crystal (matches "Fleet points: 150" of fleetStep2)');

  // two colony ships: cost 60 000, base cargo 15 000 -> the cargo limits the find
  await ft.fill('#ship208_input', '2');
  await ft.waitForFunction((sel) => /60/.test((document.querySelector(sel + ' .ogx-l-expedition-cost') || {}).textContent || ''), B, { timeout: 5000 });
  b = await readBox(ft);
  assert.equal(b.count, '2');
  assert.equal(num(b.cost), 2 * cat[208].mc);
  assert.equal(b.points, '300', '2 x 30 000 x 5 / 1000');
  assert.equal(num(b.free), 2 * cat[208].cargo);
  assert.equal(num(b.find), Math.min(2 * cat[208].cargo, 2 * cat[208].mc), 'min(free cargo, fleet cost)');
  assert.match(b.resClass, /ogx-warn/);
  const deficit = 2 * cat[208].mc - 2 * cat[208].cargo;
  assert.match(b.res, new RegExp('не хватает ' + deficit.toLocaleString('ru-RU').replace(/\s/g, '\\s')));
  // no cargo ships on this planet (2 colony ships, 102 probes, 797 satellites): only Battle Transporters (217) are suggested, «есть 0»
  const n217 = Math.ceil(deficit / (cat[217].cargo - cat[217].mc));
  assert.ok(b.res.includes(`${n217.toLocaleString('ru-RU').replace(/\s/g, NB)} × ${cat[217].short} (есть 0)`), `suggests ${n217} ${cat[217].short}: ${b.res}`);
  for (const id of [203, 202]) assert.ok(!b.res.includes(cat[id].short), `no ${cat[id].short} suggestion: ${b.res}`);
  assert.match(b.shipfind, /не найдутся/, 'colony ships alone find no ships (2Moons skips 208, 209, 214)');

  // + 10 probes: cost +10 000, cargo +50, ship finds with the stored top-1 (6 M -> cap 6 000 points)
  await ft.fill('#ship210_input', '10');
  await ft.waitForFunction((sel) => /70/.test((document.querySelector(sel + ' .ogx-l-expedition-cost') || {}).textContent || ''), B, { timeout: 5000 });
  b = await readBox(ft);
  const cost = 2 * cat[208].mc + 10 * cat[210].mc, free = 2 * cat[208].cargo + 10 * cat[210].cargo, pts = cost * 5 / 1000;
  assert.equal(num(b.cost), cost);
  assert.equal(num(b.free), free);
  assert.equal(num(b.find), Math.min(free, cost));
  assert.deepEqual(b.ships.map(num), [50, 100, 200].map((size) => Math.max(Math.round(size * Math.min(pts, 6000)), 10000)), 'ship finds: max(size x min(points, 6000), 10000)');
  assert.match(b.topinfo, /6\s000/);
  assert.match(b.topinfo, /топ-1: 6\s000\s000/);
  // more than available is clamped to the page count (2 colony ships)
  await ft.fill('#ship208_input', '50');
  await ft.waitForTimeout(400);
  assert.equal(num((await readBox(ft)).cost), cost, 'clamped to the 2 colony ships of the page');
  await shot(ft, 'fleetTable');
  assert.deepEqual((await layoutShift(ft)).diff, [], 'fleetTable: game layout unchanged (header row keeps its height)');
  const al = await ft.evaluate((sel) => { const box = document.querySelector(sel).getBoundingClientRect(); const t = document.querySelector('form[action*="page=fleetStep1"] table').getBoundingClientRect(); return [Math.round(box.left - t.left), Math.round(box.width - t.width), Math.round(box.top - t.bottom)]; }, B);
  assert.ok(Math.abs(al[0]) <= 1 && Math.abs(al[1]) <= 1 && al[2] >= 0 && al[2] < 12, 'box aligned under the ship table ' + JSON.stringify(al));
  await mandatory(env, 'fleetTable box');
  assert.deepEqual(ownRequests(env).map((x) => x.route), [], 'no request (top-1 stored)');
});

T.test('fleetTable: «Экспедиция» fills the hidden target [g:s±N:16] + mission 15 only; the user\'s «Continue» carries it to fleetStep1', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'expedition.rememberedDuration': 1 }), storage: TOP() });
  const ft = await env.game('fleetTable');
  await env.waitFor(ft, 'a.ogx-l-expedition-btn');
  const hidden = () => ft.evaluate(() => Object.fromEntries(['galaxy', 'system', 'planet', 'type', 'target_mission'].map((n) => [n, document.querySelector('form[action*="page=fleetStep1"] input[name="' + n + '"]').value])));
  assert.deepEqual(await hidden(), { galaxy: '2', system: '68', planet: '5', type: '1', target_mission: '0' }, 'saved hidden fields');
  const pos = await ft.evaluate(() => { const a = document.querySelector('a.ogx-l-expedition-btn'); const th = a.closest('th'); return { inTh: !!th, th: th.textContent.replace(/\s+/g, ' ').trim(), title: a.title }; });
  assert.ok(pos.inTh, 'button in the form header cell');
  assert.match(pos.th, /New mission: Select fleet/);
  assert.match(pos.title, /\[2:68:16\]/);
  assert.match(pos.title, /ничего не отправляет/);
  await ft.click('a.ogx-l-expedition-btn');
  assert.deepEqual(await hidden(), { galaxy: '2', system: '68', planet: '16', type: '1', target_mission: '15' });
  // ± 4: always the same galaxy, position 16, system within 64..72
  await ft.fill('input.ogx-l-expedition-rand', '4');
  const systems = [];
  for (let i = 0; i < 6; i++) { await ft.click('a.ogx-l-expedition-btn'); const h = await hidden(); assert.equal(h.planet, '16'); assert.equal(h.galaxy, '2'); systems.push(+h.system); }
  assert.ok(systems.every((s) => s >= 64 && s <= 72), 'systems ' + systems);
  for (let i = 0; i < 30 && (await env.get('settings') || {}).expedition?.randomSystems !== 4; i++) await ft.waitForTimeout(100);
  assert.equal(((await env.get('settings')) || {}).expedition.randomSystems, 4, '± remembered');
  assert.deepEqual(ownRequests(env).map((x) => x.route), [], 'the button sends nothing');
  assert.deepEqual(posts(env), [], 'nothing posted by the button');
  await shot(ft, 'fleetTable-button');

  // the user selects a colony ship and presses the game's «Continue» -> fleetStep1 with the target at position 16
  await ft.fill('input.ogx-l-expedition-rand', '0');
  await ft.click('a.ogx-l-expedition-btn');
  await ft.fill('#ship208_input', '1');
  await Promise.all([ft.waitForURL(/page=fleetStep1/, { timeout: 10000 }), ft.click('form[action*="page=fleetStep1"] input[type=submit]')]);
  await env.waitFor(ft, B + ' .ogx-l-expedition-times');
  const s1 = await ft.evaluate(() => ['galaxy', 'system', 'planet'].map((id) => document.getElementById(id).value));
  assert.deepEqual(s1, ['2', '68', '16']);
  const p = env.server.requests.find((r) => r.method === 'POST' && r.route === 'page=fleetStep1');
  assert.equal(p.form.planet, '16'); assert.equal(p.form.target_mission, '15'); assert.equal(p.form.ship208, '1');
  await mandatory(env, 'fleetTable button', { allowPosts: ['page=fleetStep1'] });
});

// ------------------------------------------------------------------ fleetStep1
T.test('fleetStep1 (saved page): values = data.ships / data.fleetroom; «Экспедиция» fills destination + remembered speed, the game recomputes', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'expedition.rememberedSpeed': 7, 'expedition.rememberedDuration': 2 }), storage: TOP() });
  const s1 = await env.game('fleetStep1');
  await env.waitFor(s1, B + ' .ogx-l-expedition-find');
  const html = saved('fleetStep1');
  const data = JSON.parse(/^\s*data\s*=\s*(\{.*\});\s*$/m.exec(html)[1]);
  assert.deepEqual(Object.keys(data.ships), ['208']);
  let b = await readBox(s1);
  assert.equal(b.count, data.ships[208].amount);
  assert.equal(num(b.cost), 30000, '1 colony ship = 10 000 + 20 000');
  assert.equal(b.points, '150', 'the "Fleet points: 150" fleetStep2 shows for this fleet');
  assert.match(saved('fleetStep2'), /id="fleetPoints" class="fleetPoints">150</);
  assert.equal(num(b.free), +data.fleetroom, 'base cargo = data.fleetroom (no Storage expert here)');
  assert.equal(num(b.find), 7500);
  assert.equal(b.slots, null, 'no slots known in a fresh profile (only page=fleetTable shows them)');
  assert.equal(b.times, null, 'target is not position 16 yet');
  assert.match(b.btninfo, /\[2:68:16\], 70%, 2 ч/);

  const before = await layoutShift(s1);
  assert.deepEqual(before.diff, [], 'fleetStep1: Destination and header rows keep their height, nothing moves');
  const geo = await s1.evaluate(() => { const a = document.querySelector('a.ogx-l-expedition-btn').getBoundingClientRect(); const th = document.querySelector('form#form th').getBoundingClientRect(); return { inside: a.top >= th.top && a.bottom <= th.bottom && a.right <= th.right + 1, th: th.height }; });
  assert.ok(geo.inside, 'button inside the header cell ' + JSON.stringify(geo));

  await s1.click('a.ogx-l-expedition-btn');
  const f = await s1.evaluate(() => ({ g: galaxy.value, s: document.getElementById('system').value, p: document.getElementById('planet').value, type: document.getElementById('type').value,
    speed: document.getElementById('speed').value, dist: document.getElementById('distance').textContent.trim(), dur: document.getElementById('duration').textContent.trim() }));
  assert.deepEqual([f.g, f.s, f.p, f.type, f.speed], ['2', '68', '16', '1', '7']);
  assert.equal(num(f.dist), 1055, 'the game\'s updateVars(): 1000 + 5 x |16 - 5|');
  await s1.waitForFunction((sel) => !!document.querySelector(sel + ' .ogx-l-expedition-times'), B, { timeout: 5000 });
  b = await readBox(s1);
  const m = /(\d+):(\d\d):(\d\d)/.exec(f.dur);
  const durSec = +m[1] * 3600 + +m[2] * 60 + +m[3];
  const want = await env.evalOgx(s1, (sec) => [OGX.fmt.duration(sec), OGX.fmt.duration(2 * sec + 2 * 3600)], durSec);
  assert.ok(b.times.includes(want[0]) && b.times.includes(want[1]), `times «${b.times}» = 2 x game duration ${f.dur} + 2 h`);
  assert.match(b.times, /удержание 2 ч/);
  await shot(s1, 'fleetStep1');
  assert.deepEqual((await layoutShift(s1)).diff, [], 'still no layout shift after the click');
  await mandatory(env, 'fleetStep1');
  assert.deepEqual(ownRequests(env).map((x) => x.route), [], 'no request (the check-target runs only on the game\'s submit)');
});

// ------------------------------------------------------------------ full flow to fleetStep2
T.test('flow fleetTable -> step 1 -> step 2 (mission 15 + staytime): preselect, cargo lowers the find, remembered on the user\'s submit', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'expedition.rememberedSpeed': 8, 'expedition.rememberedDuration': 2 }), storage: TOP() });
  routeExpeditionStep2(env, { astro: 3 });
  const p = await env.game('fleetTable');
  await env.waitFor(p, 'a.ogx-l-expedition-btn');
  await p.click('a.ogx-l-expedition-btn');
  await p.fill('#ship208_input', '1');
  await Promise.all([p.waitForURL(/page=fleetStep1/, { timeout: 10000 }), p.click('form[action*="page=fleetStep1"] input[type=submit]')]);
  await env.waitFor(p, 'a.ogx-l-expedition-btn');
  await p.click('a.ogx-l-expedition-btn');                      // speed 80 %
  assert.equal(await p.evaluate(() => document.getElementById('speed').value), '8');
  await Promise.all([p.waitForURL(/page=fleetStep2/, { timeout: 10000 }), p.click('form#form input[type=submit]')]);
  await env.waitFor(p, B + ' .ogx-l-expedition-prefilled');
  const s2 = await p.evaluate(() => ({ checked: (document.querySelector('input[name=mission]:checked') || {}).value, stay: document.querySelector('select[name=staytime]').value }));
  assert.deepEqual(s2, { checked: '15', stay: '2' }, 'mission 15 and the remembered stay option preselected');
  let b = await readBox(p);
  assert.match(b.prefilled, /«Экспедиция» и удержание 2 ч/);
  assert.equal(b.count, '1', 'fleet of step 1 known by the shared token');
  assert.equal(b.points, '150', '"Fleet points" of the page');
  assert.equal(num(b.cost), 30000);
  assert.equal(num(b.free), 7500);
  assert.equal(num(b.find), 7500);
  await shot(p, 'fleetStep2-expedition');
  assert.deepEqual((await layoutShift(p)).diff, [], 'fleetStep2: game layout unchanged');
  // cargo on board lowers the free cargo of the find
  await p.fill('input[name=metal]', '1000');
  await p.dispatchEvent('input[name=metal]', 'change');
  await p.waitForFunction((sel) => /6\s500/.test((document.querySelector(sel + ' .ogx-l-expedition-free') || {}).textContent || ''), B, { timeout: 5000 });
  b = await readBox(p);
  assert.equal(num(b.find), 6500);
  assert.match(b.text, /груз 1\s000/);
  // the user picks 3 h and submits
  await p.selectOption('select[name=staytime]', '3');
  assert.deepEqual(posts(env).map((r) => r.route), ['page=fleetStep1', 'page=fleetStep2'], 'only the two «Continue» clicks so far');
  await Promise.all([p.waitForURL(/page=fleetStep3/, { timeout: 10000 }), p.click('form[action*="page=fleetStep3"] input[type=submit]')]);
  const sent = env.server.state.sent[0];
  assert.equal(sent.mission, 15); assert.equal(sent.staytime, 3); assert.equal(sent.cargo.metal, 1000);
  assert.equal(sent.target.planet, 16); assert.equal(sent.speed, 8);
  for (let i = 0; i < 30 && ((await env.get('settings')) || {}).expedition?.rememberedDuration !== 3; i++) await p.waitForTimeout(100);
  const set = ((await env.get('settings')) || {}).expedition;
  assert.equal(set.rememberedDuration, 3, 'stay time remembered from the user\'s submit');
  assert.equal(set.rememberedSpeed, 8);
  assert.deepEqual(await env.get('expedition.stayLabel'), { value: 3, hours: 3 });
  const gets = ownRequests(env).map((x) => x.method + ' ' + x.route);
  assert.deepEqual(gets.filter((x) => !/checktarget/i.test(x)), [], 'no add-on request (the game\'s own check-target only) ' + gets);
  await mandatory(env, 'flow', { allowPosts: ['page=fleetStep1', 'page=fleetStep2', 'page=fleetStep3'] });
});

// ------------------------------------------------------------------ saved fleetStep2 (colonize)
T.test('fleetStep2 (saved, Colonize only): mission 15 not offered -> no expedition box, nothing preselected, no request', async () => {
  const slots = { '{ns}|slots': { fleet: { used: 1, max: 13 }, expedition: { used: 2, max: 2 }, t: Date.now() } };
  const env = await launch({ viewport: VIEW, settings: solo(), storage: Object.assign(TOP(), slots) });
  const s2 = await env.game('fleetStep2');
  const missions = await env.evalOgx(s2, () => OGX.fleet.gz.state().missions.map((m) => m.id));
  assert.deepEqual(missions, [7], 'the saved page offers Colonize only');
  await s2.waitForTimeout(1500);
  assert.equal(await s2.evaluate(() => document.querySelectorAll('[class*="ogx-l-expedition"]').length), 0, 'no expedition box or button on this step');
  assert.equal(await s2.evaluate(() => document.querySelectorAll('input[name=mission]:checked').length), 0, 'Colonize stays unchecked');
  await shot(s2, 'fleetStep2');
  assert.deepEqual((await layoutShift(s2)).diff, [], 'fleetStep2: game layout unchanged');
  await mandatory(env, 'fleetStep2');
  assert.deepEqual(ownRequests(env).map((x) => x.route), []);
});

// ------------------------------------------------------------------ top-1
T.test('top-1 for ship finds: no request on load; «узнать» = one free GET page=statistics on the click; manual override', async () => {
  const env = await launch({ viewport: VIEW, settings: solo() });
  const ft = await env.game('fleetTable');
  await env.waitFor(ft, B);
  await ft.fill('#ship210_input', '10');
  await ft.waitForFunction((sel) => /неизвестны/.test((document.querySelector(sel + ' .ogx-l-expedition-topinfo') || {}).textContent || ''), B, { timeout: 8000 });
  await ft.waitForTimeout(800);
  assert.deepEqual(ownRequests(env).map((x) => x.route), [], 'nothing requested without a click');
  let b = await readBox(ft);
  assert.match(b.topinfo, /4 500 очков флота .* или 6 000/);
  assert.equal(num(b.ships[0]), 10000, '10 probes: 50 points -> the 10 000 minimum');
  await ft.click('a.ogx-l-expedition-toplink');
  await ft.waitForFunction((sel) => /не прочитана/.test((document.querySelector(sel + ' .ogx-l-expedition-topinfo') || {}).textContent || ''), B, { timeout: 8000 });
  assert.deepEqual(ownRequests(env).map((x) => x.method + ' ' + x.route), ['GET page=statistics'], 'one GET of the statistics page on the click (the mock has none)');
  // manual override 1 M (< 5 M): cap 4 500, no request
  await env.evalOgx(ft, () => OGX.settings.set('expedition.topPointsOverride', 1000000));
  const ft2 = await env.game('fleetTable');
  await env.waitFor(ft2, B);
  await ft2.fill('#ship210_input', '100');
  await ft2.waitForFunction((sel) => /вручную/.test((document.querySelector(sel + ' .ogx-l-expedition-topinfo') || {}).textContent || ''), B, { timeout: 5000 });
  b = await readBox(ft2);
  assert.match(b.topinfo, /сверх 4\s500/);
  assert.deepEqual(b.ships.map(num), [50, 100, 200].map((s) => Math.max(s * 500, 10000)), '100 probes = 500 points');
  assert.equal(await ft2.evaluate(() => document.querySelectorAll('a.ogx-l-expedition-toplink').length), 0, 'no «узнать» when known');
  assert.equal(ownRequests(env).filter((x) => x.route === 'page=statistics').length, 1);
  await mandatory(env, 'top-1');
});

// ------------------------------------------------------------------ other pages, all modules
T.test('stays out of fleetStep3, overview, galaxy; with every suite module on: no errors, nothing POSTed, screenshots', async () => {
  const env = await launch({ viewport: VIEW, settings: solo(), storage: TOP() });
  for (const name of ['fleetStep3', 'overview', 'galaxy']) {
    const p = await env.game(name);
    await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => document.querySelectorAll('[class*="ogx-l-expedition"], #ogx-l-expedition-box-gz').length), 0, name + ': nothing injected');
  }
  await env.clearStorage();
  await env.setStorage(G.buildSeed(env, TOP(), {}));
  for (const name of ['fleetTable', 'fleetStep1', 'fleetStep2']) {
    const p = await env.game(name);
    if (name !== 'fleetStep2') await env.waitFor(p, B);
    await p.waitForTimeout(800);
    // the saved fleetStep2 offers Colonize only (no mission 15): no box there
    assert.equal(await p.evaluate((sel) => document.querySelectorAll(sel).length, B), name === 'fleetStep2' ? 0 : 1, name + (name === 'fleetStep2' ? ': no box' : ': one box'));
    await shot(p, 'all-' + name);
  }
  await mandatory(env, 'all modules');
});
