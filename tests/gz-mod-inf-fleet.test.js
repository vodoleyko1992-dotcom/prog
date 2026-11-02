'use strict';
// Infinity fleet modules on the REAL saved GALAXYZ pages (ogamex.eu/Aeternum, fixtures/galaxyz/pages) through the suite extension:
//   fleethelp (ogamex-infinity/modules/fleethelp)  keep rules, fleetTable ship buttons, fleetStep2 cargo button, tab «Сбор» + walk
//   flights   (ogamex-infinity/modules/flights)    tab «Полёты» (chart + list + recall), chart above the fleetTable movement table
// GALAXYZ dispatch = fleetTable (ships) -> fleetStep1 (target, speed) -> fleetStep2 (mission, cargo, stay time) -> fleetStep3.
// Every expected number comes from the saved page source (inputs, data-real stock, data={...}, event box ids / end times) or the
// 2Moons formulas (fleet.md §4), never from the module. Also: no console errors, the game chrome does not move, nothing is requested
// without a click, nothing is POSTed except by the user's own «Continue» / a confirmed recall. Screenshots: tests/out/gz-inf-fleet-*.png.
//   node tests/gz-mod-inf-fleet.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

const OUT = path.join(__dirname, 'out');
const PAGES = path.join(__dirname, '..', 'fixtures', 'galaxyz', 'pages');
const OTHERS = ['menu', 'planetbar', 'techcost', 'timeline', 'inflight', 'fleetinfo', 'expedition', 'panel', 'prefs', 'empire', 'todo', 'spy', 'stats', 'targets', 'stalk', 'mail', 'missiles'];
const VIEW = { width: 1400, height: 900 };
const NB = ' ';
const FH = 'ogx-i-fleethelp-';
const FL = 'ogx-i-flights-';

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const solo = (extra = {}) => Object.assign(Object.fromEntries(OTHERS.map((m) => [m + '.enabled', false])), extra);
const saved = (name) => fs.readFileSync(path.join(PAGES, name + '.html'), 'utf8');
const sp = (s) => String(s).replace(/[\s\u00a0\u202f]+/g, ' ');
const digits = (s) => +String(s).replace(/[^\d]/g, '');
const shot = async (page, name, full = true) => { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'gz-inf-fleet-' + name + '.png'), fullPage: full }); };

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
  assert.deepEqual(env.consoleErrors().filter((e) => /OGX|ogx-|fleethelp|flights/i.test((e.text || '') + (e.stack || ''))).map((e) => e.text), [], what + ': no console errors from the add-on');
}

/** Bounding boxes of the game chrome with our elements in place and with them hidden: equal = no layout shift. */
async function layoutShift(page, extraSel = []) {
  return page.evaluate((extra) => {
    const sels = ['#links', '#menuTable', '#inhalt', '#rechts', '#myWorlds', '#resTable', '#messages_collapsed', '#siteFooter', ...extra];
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
    const ours = Array.from(document.querySelectorAll('[id^="ogx-i-fleethelp-"], [id^="ogx-i-flights-"]')).filter((e) => !e.closest('#ogx-root, .ogx-sidepanel'));
    const withUs = measure();
    const keep = ours.map((e) => [e, e.style.display]);
    for (const [e] of keep) e.style.setProperty('display', 'none', 'important');
    const without = measure();
    for (const [e, d] of keep) e.style.display = d;
    const diff = Object.keys(without).filter((k) => JSON.stringify(withUs[k]) !== JSON.stringify(without[k])).map((k) => k + ' ' + JSON.stringify(withUs[k]) + ' vs ' + JSON.stringify(without[k]));
    return { diff, ours: ours.length };
  }, extraSel);
}

/** Ship counts of the saved fleetTable: { id: n } from td#ship<ID>_value (only rows with an input can fly). */
function fleetTableShips(html) {
  const out = {};
  const re = /<td id="ship(\d+)_value">([\d.]+)<\/td>\s*(?:<td>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>)?/g;
  let m;
  while ((m = re.exec(html))) out[m[1]] = { n: +m[2].replace(/\./g, ''), flies: /name="ship\d+"/.test(m[3] || '') };
  return out;
}
/** data = {...}; of a saved step page. */
function inlineData(html) { const m = /^\s*data\s*=\s*(\{.*\});\s*$/m.exec(html); return m ? JSON.parse(m[1]) : null; }
/** Header stock (#current_<res> data-real), floored like the game's maxResource. */
function stock(html) {
  const o = {};
  for (const k of ['metal', 'crystal', 'deuterium']) o[k] = Math.floor(parseFloat(new RegExp(`id="current_${k}"[^>]*data-real="([\\d.]+)"`).exec(html)[1]));
  return o;
}
/** Event box of the saved page: [{ id, end (unix s), fleetId }]. */
function eventBox(name) {
  const out = new Map();
  const re = /<span id="fleettime_((\d{10})(\d+))" class="fleets" data-fleet-end-time="(\d+)"/g;
  let m;
  while ((m = re.exec(saved(name)))) if (!out.has(m[1])) out.set(m[1], { id: m[1], end: +m[4], fleetId: +m[3] });
  return [...out.values()];
}

// 2Moons flight math (fleet.md §4; class.FleetFunctions.php): no wrap-around, gamespeed 7 (fleetStep1 data.gamespeed of the saved page)
const distance = (a, b) => (a[0] !== b[0] ? Math.abs(a[0] - b[0]) * 20000 : a[1] !== b[1] ? Math.abs(a[1] - b[1]) * 95 + 2700 : a[2] !== b[2] ? Math.abs(a[2] - b[2]) * 5 + 1000 : 5);
const duration = (dist, maxspeed, gamespeed, speed10 = 10) => Math.max(5, Math.round((3500 / (speed10 * 0.1) * Math.sqrt(dist * 10 / maxspeed) + 10) / gamespeed));

/** fleetTable with Small (202), Large Cargo (203) and Battle Transporter (217) rows added before the satellite row, and the GET
 * prefill (galaxy, system, planet, planettype, target_mission) copied into the hidden fields like upstream ShowFleetTablePage:206-210.
 * Transports count in 217 only (user decision 2026-10-31): 202/203 are there to prove they are not taken. */
const CARGO = { 202: 100, 203: 200, 217: 30 };
function withCargo(srv) {
  srv.route('GET', 'fleetTable', (req, res, ctx) => ctx.sendPage('fleetTable', (html) => {
    const row = (id, name, n) => `<tr><td><img src="./7_files/${id}.gif" alt="${name}" width="25" height="25" align="left"> <span class="tooltip" data-tooltip-content="Speed:  10000">${name}</span></td><td id="ship${id}_value">${n}</td><td><a class="button black small" href="javascript:maxShip('ship${id}');">max</a></td><td><input name="ship${id}" id="ship${id}_input" size="10" value="0"></td></tr>`;
    let out = html.replace(/(<tr>\s*<td><img src="\.\/7_files\/212\.gif")/, row(202, 'Small Cargo', CARGO[202]) + row(203, 'Large Cargo', CARGO[203]) + row(217, 'Battle Transporter', CARGO[217]) + '$1');
    const q = ctx.query;
    const put = (name, v) => { if (v !== undefined) out = out.replace(new RegExp(`(<input type="hidden" name="${name}" value=")\\d*`), '$1' + (+v || 0)); };
    put('galaxy', q.galaxy); put('system', q.system); put('planet', q.planet); put('type', q.planettype); put('target_mission', q.target_mission);
    return out;
  }));
}

async function openTab(env, page, tab) {
  await env.evalOgx(page, (t) => { const sp = OGX.dom.sidePanel('infinity'); sp.open(); sp.selectTab(t); }, tab);
}
const clickModal = (page, yes) => page.evaluate((y) => {
  const b = document.querySelector('.ogx-modal-overlay:last-of-type .ogx-modal-buttons button:' + (y ? 'last-child' : 'first-child'));
  b.click();
  return b.textContent;
}, yes);

// ------------------------------------------------------------------ fleethelp: fleetTable
T.test('fleethelp fleetTable (real page): row under the Continue row, «Всё, кроме резерва» fills ship<ID> = count - keep, no transports', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'core.tickMs': 250 }),
    storage: { '{ns}|fleethelp.keep': { v: 1, default: { ships: { 210: 2 }, resources: { metal: 0, crystal: 0, deuterium: 0 } }, bodies: {} } } });
  try {
    const page = await env.game('fleetTable');
    await env.waitFor(page, '#' + FH + 'bar1row');
    const place = await page.evaluate((P) => {
      const tr = document.getElementById(P + 'bar1row');
      const form = tr.closest('form');
      return { form: form && form.getAttribute('action').replace(/^.*\?/, ''), prev: tr.previousElementSibling.querySelector('input[type=submit]') ? 'continue' : null,
        prevPrevAlt: tr.previousElementSibling.previousElementSibling.classList.contains('alt'),
        cols: tr.cells[0].colSpan, buttons: [...tr.querySelectorAll('button')].map((b) => [b.textContent, b.disabled]), keep: tr.querySelector('.' + P + 'keeplink').textContent };
    }, FH);
    assert.deepEqual(place, { form: 'page=fleetStep1', prev: 'continue', prevPrevAlt: true, cols: 4,
      buttons: [['Всё, кроме резерва', false], ['Транспорт для ресурсов', false]], keep: 'резерв: по умолчанию' });
    assert.deepEqual((await layoutShift(page, ['.fleetTablemain', 'form[action*="fleetStep1"] input[type=submit]'])).diff, [], 'fleetTable: game chrome and Continue unchanged');

    // «Всё, кроме резерва»: every flying ship of the page minus the default keep (210: 2); the satellite (no input) stays untouched
    const ships = fleetTableShips(saved('fleetTable'));
    assert.deepEqual(ships, { 208: { n: 2, flies: true }, 210: { n: 102, flies: true }, 212: { n: 797, flies: false } }, 'saved page ships');
    await page.click('#' + FH + 'allbut');
    await page.waitForFunction((P) => /выбрано/.test(document.getElementById(P + 'status1').textContent), FH, { timeout: 5000 });
    const sel = await page.evaluate((P) => ({ s208: document.querySelector('input[name=ship208]').value, s210: document.querySelector('input[name=ship210]').value,
      sat: document.querySelector('input[name=ship212]'), status: document.getElementById(P + 'status1').textContent }), FH);
    assert.deepEqual([sel.s208, sel.s210, sel.sat], [String(ships[208].n), String(ships[210].n - 2), null]);
    assert.match(sp(sel.status), /выбрано: .* 2, .* 100$/);
    await shot(page, 'fleetTable-buttons');

    // «Транспорт для ресурсов»: the real body has no Battle Transporter (217): reported with the count needed, nothing selected
    await page.click('#' + FH + 'transport');
    await page.waitForFunction((P) => /нет на планете/.test(document.getElementById(P + 'status1').textContent), FH, { timeout: 5000 });
    const st1 = await page.evaluate((P) => document.getElementById(P + 'status1').textContent, FH);
    assert.match(sp(st1), /^Ул\. трансп\.: нет на планете, нужно \d+/);
    const ev1 = await env.evalOgx(page, () => OGX.diag.recent({ k: 'fleethelp' }).filter((e) => e.w === 'fleet:transport').map((e) => e.d));
    assert.equal(ev1.length, 1);
    assert.equal(ev1[0].have217, 0);
    assert.ok(ev1[0].need217 > 0, 'need217 reported');
    assert.deepEqual(ev1[0].ships, {});
    await page.waitForTimeout(1500);
    assert.deepEqual(ownRequests(env).map((r) => r.method + ' ' + r.route), [], 'no request from the buttons (form fill only)');
    assert.deepEqual(posts(env).map((r) => r.url), [], 'nothing POSTed');
    await mandatory(env, 'fleetTable');
  } finally { await env.close(); }
});

T.test('fleethelp fleetTable with cargo ships: «Транспорт для ресурсов» = Battle Transporters only, have / need / short from the header stock - keep', async () => {
  const env = await launch({ viewport: VIEW, settings: solo(),
    storage: { '{ns}|fleethelp.keep': { v: 1, default: { ships: { 217: 10 }, resources: { metal: 1000000, crystal: 0, deuterium: 0 } }, bodies: {} } } });
  try {
    withCargo(env.server);
    const page = await env.game('fleetTable');
    await env.waitFor(page, '#' + FH + 'bar1row');
    await page.click('#' + FH + 'transport');
    await page.waitForFunction((P) => /выбрано/.test(document.getElementById(P + 'status1').textContent), FH, { timeout: 5000 });
    const r = await page.evaluate((P) => ({ s202: document.querySelector('input[name=ship202]').value, s203: document.querySelector('input[name=ship203]').value,
      s217: document.querySelector('input[name=ship217]').value, s208: document.querySelector('input[name=ship208]').value, status: document.getElementById(P + 'status1').textContent }), FH);
    const c217 = await env.evalOgx(page, async () => (await OGX.state.shipStats())[217].cargo);
    assert.ok(c217 >= 40000000, 'Battle Transporter cargo 40 000 000 (+ Storage officer): ' + c217);
    // stock of the header (>= 1 431 408 111 metal) needs more than 20 BT: all of them (keep 10 BT stay), no LC / SC
    const st = stock(saved('fleetTable'));
    const total = st.metal - 1000000 + st.crystal + st.deuterium;
    const ev = (await env.evalOgx(page, () => OGX.diag.recent({ k: 'fleethelp' }).filter((e) => e.w === 'fleet:transport').map((e) => e.d)))[0];
    assert.equal(ev.have217, CARGO[217] - 10, 'have = fleetTable count - keep');
    assert.ok(ev.need217 >= Math.ceil(total / c217) && ev.need217 > ev.have217, 'need ' + ev.need217 + ' for ' + total);
    assert.equal(ev.use217, CARGO[217] - 10);
    assert.equal(ev.short217, ev.need217 - ev.use217);
    assert.equal(ev.cap, c217);
    assert.deepEqual(ev.ships, { 217: CARGO[217] - 10 }, 'only Battle Transporters');
    assert.deepEqual([r.s217, r.s203, r.s202, r.s208], [String(CARGO[217] - 10), '0', '0', '0']);
    assert.match(sp(r.status), new RegExp(`^Ул\\. трансп\\.: есть ${CARGO[217] - 10}, нужно ${sp(ev.need217.toLocaleString('ru-RU'))}, не хватает ${sp(ev.short217.toLocaleString('ru-RU'))} — выбрано ${CARGO[217] - 10} \\(вместимость `));
    await shot(page, 'fleetTable-transport');
    assert.deepEqual(posts(env).map((x) => x.url), []);
    await mandatory(env, 'fleetTable cargo');
  } finally { await env.close(); }
});

// ------------------------------------------------------------------ fleethelp: fleetStep2
T.test('fleethelp fleetStep2 (real page): «Все ресурсы, кроме резерва» = data.fleetroom - consumption, metal -> crystal -> deuterium', async () => {
  const env = await launch({ viewport: VIEW, settings: solo() });
  try {
    const html = saved('fleetStep2');
    const data = inlineData(html);
    assert.deepEqual(data, { fleetroom: '7500', consumption: '118' });
    const room = +data.fleetroom - +data.consumption;
    const page = await env.game('fleetStep2');
    await env.waitFor(page, '#' + FH + 'bar2row');
    const place = await page.evaluate((P) => { const tr = document.getElementById(P + 'bar2row'); return { prev: tr.previousElementSibling.querySelector('input[type=submit]') ? 'continue' : null, inForm: !!tr.closest('form[action*="fleetStep3"]') }; }, FH);
    assert.deepEqual(place, { prev: 'continue', inForm: true }, 'row right under the Continue row (the game\'s controls keep their places)');
    assert.deepEqual((await layoutShift(page, ['#consumption', '#fleetPoints', 'form[action*="fleetStep3"] input[type=submit]'])).diff, [], 'fleetStep2: game chrome, #consumption, #fleetPoints and Continue unchanged');
    await page.click('#' + FH + 'allres');
    await page.waitForFunction((P) => /груз/.test(document.getElementById(P + 'status2').textContent), FH, { timeout: 5000 });
    const a = await page.evaluate((P) => ({ m: document.querySelector('input[name=metal]').value, c: document.querySelector('input[name=crystal]').value, d: document.querySelector('input[name=deuterium]').value,
      left: document.getElementById('remainingresources').textContent.trim(), status: document.getElementById(P + 'status2').textContent }), FH);
    assert.deepEqual([a.m, a.c, a.d], [String(room), '0', '0'], 'metal first, like maxResources()');
    assert.equal(a.left, '0', 'the game recomputed its own «Capacity available»');
    assert.equal(sp(a.status), `груз ${sp(room.toLocaleString('ru-RU'))} из ${sp(room.toLocaleString('ru-RU'))}, топливо ${data.consumption}`);
    await shot(page, 'fleetStep2-cargo');

    // keep all metal: crystal is next
    await env.setStorage({ [env.key('fleethelp.keep')]: { v: 1, default: { ships: {}, resources: { metal: 1e13, crystal: 0, deuterium: 0 } }, bodies: {} } });
    const p2 = await env.game('fleetStep2');
    await env.waitFor(p2, '#' + FH + 'allres');
    await p2.click('#' + FH + 'allres');
    await p2.waitForFunction((P) => /груз/.test(document.getElementById(P + 'status2').textContent), FH, { timeout: 5000 });
    const b = await p2.evaluate(() => [document.querySelector('input[name=metal]').value, document.querySelector('input[name=crystal]').value, document.querySelector('input[name=deuterium]').value]);
    assert.deepEqual(b, ['0', String(room), '0']);
    assert.deepEqual(posts(env).map((x) => x.url), [], 'nothing submitted');
    assert.deepEqual(ownRequests(env).map((x) => x.url), []);
    await mandatory(env, 'fleetStep2');
  } finally { await env.close(); }
});

// ------------------------------------------------------------------ flights: fleetTable chart
T.test('flights fleetTable (no #movement): compact chart below the ship form (Continue does not move), out + return from the page, no request', async () => {
  const env = await launch({ viewport: VIEW, settings: solo() });
  try {
    const page = await env.game('fleetTable');
    await env.waitFor(page, '#' + FL + 'movement .' + FL + 'group');
    const box = eventBox('fleetTable');
    assert.equal(box.length, 2);
    const fleetId = box[0].fleetId;
    const [out, back] = box.map((b) => b.end * 1000).sort((x, y) => x - y);
    const html = saved('fleetTable');
    assert.equal(+/id="fleettime_1" class="fleets" data-fleet-end-time="(\d+)"/.exec(html)[1] * 1000, back, 'movement row return = later box event');
    const r = await page.evaluate((P) => {
      const el = document.getElementById(P + 'movement');
      const prev = el.previousElementSibling;
      const list = document.querySelector('.fleetTablemain > table.listOfOthers');
      const g = el.querySelector('.' + P + 'group');
      return { parent: el.parentElement.className, prevIsForm: prev.tagName === 'FORM' && /fleetStep1/.test(prev.getAttribute('action')), last: !el.nextElementSibling,
        mission: g.dataset.mission, mt: g.dataset.missionType, segs: [...g.querySelectorAll('.' + P + 'seg')].map((s) => [s.dataset.kind, s.dataset.start, s.dataset.end]),
        label: el.querySelector('.' + P + 'lanelabel').textContent, ret: el.querySelector('.' + P + 'rettext').textContent, head: el.querySelector('.' + P + 'mhead').textContent,
        w: Math.round(el.getBoundingClientRect().width), tw: Math.round(list.getBoundingClientRect().width) };
    }, FL);
    assert.equal(r.parent, 'mainRS fleetTablemain');
    assert.ok(r.prevIsForm && r.last, 'below the ship form, under the game\'s Continue button');
    assert.equal(r.mission, String(fleetId));
    assert.equal(r.mt, '8');
    assert.deepEqual(r.segs, [['out', String(out - (back - out)), String(out)], ['ret', String(out), String(back)]], 'departure = arrival - return leg; no hold');
    assert.equal(r.label, 'Переработка [2:68:5→2:87:8]');
    assert.equal(r.ret, 'возврат 10:47', 'return time as printed by the page (30. Oct 2026, 10:47:11)');
    assert.match(r.head, /1 миссия/);
    assert.equal(r.w, r.tw, 'as wide as the game table');
    assert.deepEqual((await layoutShift(page, ['.fleetTablemain', '.fleetTablemain > table.listOfOthers', '.fleetTablemain > form input[type=submit]'])).diff, [], 'fleetTable: game chrome, movement table and Continue unchanged');
    await page.hover('#' + FL + 'movement .' + FL + 'group');
    await page.waitForTimeout(300);
    await shot(page, 'fleetTable-movement');
    assert.deepEqual(ownRequests(env).map((x) => x.url), [], 'no request');
    await mandatory(env, 'movement chart');
  } finally { await env.close(); }
});

// ------------------------------------------------------------------ flights: tab + recall
T.test('flights tab «Полёты»: rows from the event box, no request on open / ticks, «Отозвать» = one confirmed POST sendfleetback', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'core.tickMs': 250 }) });
  try {
    const page = await env.game('overview');
    await openTab(env, page, 'flights');
    await env.waitFor(page, '.' + FL + 'list .' + FL + 'row');
    await page.waitForTimeout(2500);
    assert.deepEqual(ownRequests(env).map((x) => x.url), [], 'opening the tab and ticking: no request (gzPoll off)');
    const box = eventBox('overview');
    const fleetId = box[0].fleetId;
    const r = await page.evaluate((P) => {
      const rows = [...document.querySelectorAll('.' + P + 'list .' + P + 'row')];
      return rows.map((tr) => ({ mission: tr.dataset.mission, cells: [...tr.cells].map((c) => c.textContent.trim()), recall: !!tr.querySelector('.' + P + 'recall'),
        ret: (tr.querySelector('.' + P + 'ret') || {}).dataset }));
    }, FL);
    assert.equal(r.length, 1, 'one mission (outward + return of fleet ' + fleetId + ')');
    assert.equal(r[0].mission, String(fleetId));
    assert.match(r[0].cells[0], /Переработка/);
    assert.match(r[0].cells[1], /2:68:5.*→.*2:87:8/);
    assert.equal(sp(r[0].cells[2]), '8 290', 'units 8.290 of the box');
    assert.match(r[0].cells[4], /^10:20:29/);
    assert.equal(+r[0].ret.ret, Math.max(...box.map((b) => b.end)) * 1000);
    assert.ok(r[0].recall, 'own outward Recycle is recallable');
    const age = await page.evaluate((P) => document.querySelector('.' + P + 'age').title, FL);
    assert.match(age, /блок событий/);
    await shot(page, 'tab-flights', false);

    // cancel: nothing sent
    await page.click('.' + FL + 'recall');
    await page.waitForSelector('.ogx-modal-overlay .ogx-modal', { timeout: 5000 });
    const text = await page.evaluate(() => document.querySelector('.ogx-modal').textContent);
    assert.match(text, /Отозвать флот «Переработка»/);
    await shot(page, 'tab-flights-recall-confirm', false);
    await clickModal(page, false);
    await page.waitForTimeout(500);
    assert.deepEqual(posts(env).map((x) => x.url), [], 'cancelled: no POST');
    // confirm: POST page=fleetTable&action=sendfleetback fleetID; the core stores the list from the fleetTable page it answers (no second GET)
    await page.click('.' + FL + 'recall');
    await page.waitForSelector('.ogx-modal-overlay .ogx-modal', { timeout: 5000 });
    await clickModal(page, true);
    await page.waitForFunction((P) => !document.querySelector('.' + P + 'recall'), FL, { timeout: 8000 });
    const p = posts(env);
    assert.equal(p.length, 1);
    assert.equal(p[0].route, 'page=fleetTable');
    assert.equal(p[0].query.action, 'sendfleetback');
    assert.equal(p[0].form.fleetID, String(fleetId));
    assert.deepEqual(env.server.state.recalled, [fleetId]);
    assert.deepEqual(ownRequests(env).map((x) => x.method + ' ' + x.route), ['POST page=fleetTable'], 'recall only: the POST answer refreshes the list');
    await mandatory(env, 'flights tab');
  } finally { await env.close(); }
});

// ------------------------------------------------------------------ fleethelp: «Сбор» v2 (specs/COLLECT_V2.md §8)
const MAIN = { id: 254102, name: 'Главная планета', coords: '2:68:5' };
const C6 = { id: 254103, name: 'Colony', coords: '2:68:6' };
const C7 = { id: 254104, name: 'Colony', coords: '2:68:7' };
const T8 = { id: 254105, name: '1992', coords: '2:68:8' };
const C9 = { id: 254106, name: 'Colony', coords: '2:68:9' };
const P4 = { id: 254107, name: 'Планета', coords: '2:68:4' };
/** cargoMeasured record: factor f over the props cargo (Battle Transporter 40 000 000). */
const MEASURED = (f) => ({ factor: f, t: Date.UTC(2026, 9, 30, 8, 0, 0), ships: { 217: 1 }, fleetroom: 40000000 * f, src: 'test' });
const journal = (env, page, kind, what) => env.evalOgx(page, ([k, w]) => OGX.diag.recent({ k }).filter((e) => !w || e.w === w).map((e) => Object.assign({ s: e.s, w: e.w }, e.d || {})), [kind, what || null]);
const rowsOf = (page) => page.evaluate((P) => [...document.querySelectorAll('.' + P + 'table tbody tr[data-code]')].map((tr) => {
  const t = tr.querySelector('.' + P + 't217').dataset;
  const warn = document.querySelector('.' + P + 'table tr.' + P + 'warn[data-key="' + tr.dataset.key + '"]');
  return { key: tr.dataset.key, code: tr.dataset.code, status: tr.dataset.status, have: +t.have, need: +t.need, use: +t.use, short: +t.short,
    st: (tr.querySelector('.' + P + 'status .' + P + 'pst') || {}).textContent, bst: (tr.querySelector('.' + P + 'status .' + P + 'bst') || {}).textContent || null,
    warn: warn ? warn.textContent : null };
}), FH);
async function waitRows(page, keys, timeout = 15000) {
  await page.waitForFunction(([P, ks]) => ks.every((k) => { const tr = document.querySelector('.' + P + 'table tr[data-key="' + k + '"]'); return tr && !['nores', 'noships'].includes(tr.dataset.code); }), [FH, keys], { timeout })
    .catch(async (e) => { console.log(await page.evaluate((P) => (document.querySelector('.' + P + 'tab') || {}).innerText, FH)); throw e; });
}
async function dialog(page) {
  await page.waitForSelector('.ogx-modal-overlay .' + FH + 'dlg', { timeout: 20000 });
  return page.evaluate((P) => ({ title: document.querySelector('.ogx-modal-title').textContent,
    flights: [...document.querySelectorAll('.' + P + 'dlg-flight')].map((tr) => ({ key: tr.dataset.key, ships: JSON.parse(tr.dataset.ships), text: tr.textContent })),
    skips: [...document.querySelectorAll('.' + P + 'dlg-skip')].map((d) => [d.dataset.key, d.dataset.code]),
    ok: document.querySelector('.ogx-modal-overlay:last-of-type .ogx-modal-buttons button:last-child').textContent }), FH);
}
const stepPosts = (env) => env.server.requests.filter((r) => r.method === 'POST' && /^page=fleetStep[123]$/i.test(r.route));

T.test('fleethelp «Сбор» target + walk: target is a saved setting (select survives refresh), the walk keeps its target on every page, prefill hygiene', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'core.tickMs': 250, 'core.httpGapMs': 200 }) });
  try {
    const st = env.server.state;
    Object.assign(st, { planets: [MAIN, C6, C7, T8], missions: [3, 4],
      bodyShips: { 254102: { 217: 30, 202: 100, 203: 200 }, 254103: { 217: 5 }, 254104: { 210: 3 }, 254105: { 217: 2 } } });
    const page = await env.game('overview');
    await openTab(env, page, 'collect');
    await waitRows(page, ['p254103', 'p254104', 'p254105']);
    assert.deepEqual(ownRequests(env).map((x) => x.method + ' ' + x.route), ['GET page=imperium'], 'tab open: one imperium GET (no cp switch), nothing else');
    // default target persisted at once (first render, before any ship data: the first planet of the list); never re-derived later
    assert.equal(await env.evalOgx(page, () => OGX.settings.get('fleethelp.collectTarget')), 'p254102');
    assert.deepEqual((await journal(env, page, 'fleethelp', 'collect:target-default')).map((e) => [e.key, e.why]), [['p254102', 'main']]);
    assert.match(await page.evaluate(() => document.getElementById('ogx-toasts').textContent), /Цель сбора: .+ \(можно сменить\)/, 'the chosen default is named');

    // B3: a refresh while the select is in use keeps the same element
    const same = await env.evalOgx(page, async (P) => {
      const a = document.querySelector('.' + P + 'target');
      a.focus();
      OGX.bus.emit('state:updated', { keys: ['bodies'] });
      await OGX.util.sleep(700);
      return a === document.querySelector('.' + P + 'target') && a.isConnected;
    }, FH);
    assert.ok(same, 'the target select is not rebuilt by a refresh');
    assert.ok((await journal(env, page, 'fleethelp', 'collect:target-open')).length >= 1);
    await page.selectOption('.' + FH + 'target', 'p254105');
    await page.waitForFunction(() => true);
    await env.waitFor(page, '.' + FH + 'table tr[data-key="p254102"][data-code="ok"]');
    assert.equal(await env.evalOgx(page, () => OGX.settings.get('fleethelp.collectTarget')), 'p254105');
    assert.deepEqual((await journal(env, page, 'fleethelp', 'collect:target')).map((e) => [e.s, e.from, e.to]), [['U', 'p254102', 'p254105']]);
    const rows = await rowsOf(page);
    assert.deepEqual(rows.map((r) => [r.key, r.code]), [['p254102', 'ok'], ['p254103', 'ok'], ['p254104', 'no217']]);
    assert.match(rows[2].warn, /нет Ул\. трансп\.: нужно \d+/);
    await shot(page, 'tab-collect', false);

    // walk: first source -> native fleetTable prefill (cp + target 2:68:8 + mission 3), Battle Transporters only
    await page.evaluate((P) => { document.querySelector('.' + P + 'walkbox').open = true; }, FH);
    await Promise.all([page.waitForURL(/page=fleetTable/, { timeout: 10000 }), page.click('.' + FH + 'next')]);
    assert.match(page.url(), /page=fleetTable&cp=254102&galaxy=2&system=68&planet=8&planettype=1&target_mission=3$/);
    await env.waitReady(page);
    await env.waitFor(page, '#ogx-fleet-prefill');
    await env.waitFor(page, '#' + FH + 'walkbar');
    const ft = await page.evaluate((P) => ({ s202: document.querySelector('input[name=ship202]').value, s203: document.querySelector('input[name=ship203]').value,
      s217: document.querySelector('input[name=ship217]').value, walk: document.getElementById(P + 'walkbar').textContent, walkNext: document.getElementById(P + 'walkbar').nextElementSibling.className }), FH);
    assert.deepEqual([ft.s217, ft.s202, ft.s203], ['30', '0', '0']);
    assert.match(sp(ft.walk), /Сбор на 1992 \[2:68:8\]: источник 1 из 2\..*Подготовить следующий \(2\/2\).*Завершить сбор/);
    assert.equal(ft.walkNext, 'headerRS', 'walk bar right before the content');
    await shot(page, 'walk-fleetTable');

    // the user presses «Continue» twice: speed 100 %, then mission 3 + cargo on step 2
    await Promise.all([page.waitForURL(/page=fleetStep1/, { timeout: 10000 }), page.click('form[action*="page=fleetStep1"] input[type=submit]')]);
    await env.waitReady(page);
    await page.waitForFunction(() => /Цель и скорость/.test((document.getElementById('ogx-fleet-prefill') || {}).textContent || ''), null, { timeout: 8000 });
    assert.deepEqual(await page.evaluate(() => ({ planet: document.querySelector('#planet').value, speed: document.querySelector('select[name=speed]').value })), { planet: '8', speed: '10' });
    await Promise.all([page.waitForURL(/page=fleetStep2/, { timeout: 10000 }), page.click('form#form input[type=submit]')]);
    await env.waitReady(page);
    await page.waitForFunction(() => /Миссия и груз/.test((document.getElementById('ogx-fleet-prefill') || {}).textContent || ''), null, { timeout: 8000 });
    const room = +inlineData(saved('fleetStep2')).fleetroom - +inlineData(saved('fleetStep2')).consumption;
    const s2 = await page.evaluate(() => ({ m3: document.querySelector('input[name=mission][value="3"]').checked,
      sum: ['metal', 'crystal', 'deuterium'].reduce((a, k) => a + +document.querySelector('input[name=' + k + ']').value, 0) }));
    assert.deepEqual(s2, { m3: true, sum: room }, 'cargo clamped by the core to this page\'s free room');
    assert.deepEqual(posts(env).map((x) => x.route), ['page=fleetStep1', 'page=fleetStep2'], 'only the user\'s two «Continue» clicks');

    // B1/B2: the walk bar on another planet's page still prepares toward the saved target (planet=8), never toward the open planet
    await env.waitFor(page, '#' + FH + 'walkbar [data-ogx-act="fleethelp:walk-next"]');
    await Promise.all([page.waitForURL(/page=fleetTable/, { timeout: 10000 }), page.click('#' + FH + 'walkbar [data-ogx-act="fleethelp:walk-next"]')]);
    assert.match(page.url(), /page=fleetTable&cp=254103&galaxy=2&system=68&planet=8&planettype=1&target_mission=3$/);
    await env.waitReady(page);
    await env.waitFor(page, '#' + FH + 'walkbar');
    const walk = await env.evalOgx(page, () => OGX.storage.get('fleethelp.walk'));
    assert.equal(walk.target, 'p254105');
    assert.equal(walk.idx, 2);
    assert.deepEqual(walk.excluded.map((x) => x.key), ['p254104']);
    assert.match(sp(await page.evaluate((P) => document.getElementById(P + 'walkbar').textContent, FH)), /Сбор на 1992 \[2:68:8\]: источник 2 из 2\..*Это последний источник/);

    // «Завершить сбор» drops the walk AND the pending prefill
    await env.evalOgx(page, () => OGX.storage.set('prefill', { spec: { originId: 254103, target: { galaxy: 2, system: 68, position: 8, type: 1 }, mission: 3, ships: { 217: 5 } }, expires: Date.now() + 60000, stage: 1 }));
    await page.evaluate((P) => document.querySelector('#' + P + 'walkbar [data-ogx-act="fleethelp:walk-stop"]').click(), FH);   // the open side panel covers the bar
    await page.waitForFunction((P) => !document.getElementById(P + 'walkbar'), FH, { timeout: 5000 });
    assert.equal(await env.evalOgx(page, () => OGX.storage.get('prefill', null)), null, 'prefill cleared by «Завершить сбор»');
    assert.equal(await env.evalOgx(page, () => OGX.storage.get('fleethelp.walk', null)), null);

    // a fresh prefill for another origin: banner with a button to that planet (the record is kept)
    await env.evalOgx(page, () => OGX.storage.set('prefill', { spec: { originId: 254103, target: { galaxy: 2, system: 68, position: 8, type: 1 }, mission: 3, ships: { 217: 5 } }, expires: Date.now() + 60000 }));
    const p2 = await env.game('fleetTable', { cp: 254102, query: { galaxy: 2, system: 68, planet: 8, planettype: 1, target_mission: 3 } });
    await env.waitFor(p2, '#ogx-fleet-prefill [data-ogx-act="fleet:prefill-go"]');
    const ban = await p2.evaluate(() => ({ text: document.getElementById('ogx-fleet-prefill').textContent, btn: document.querySelector('#ogx-fleet-prefill [data-ogx-act="fleet:prefill-go"]').textContent,
      s217: document.querySelector('input[name=ship217]').value }));
    assert.match(sp(ban.text), /Флот подготовлен для «Colony \[2:68:6\]», а открыта «Главная планета \[2:68:5\]»/);
    assert.match(ban.btn, /^Перейти на Colony \[2:68:6\]/);
    assert.equal(ban.s217, '0', 'nothing filled on the wrong planet');
    assert.ok(await env.evalOgx(p2, () => OGX.storage.get('prefill', null)), 'record kept');

    // a target change in the tab drops a running walk and the prefill
    await env.evalOgx(p2, () => OGX.storage.set('fleethelp.walk', { v: 2, target: 'p254105', keys: ['p254102', 'p254103'], idx: 1, t: OGX.time.serverNow(), excluded: [] }));
    await openTab(env, p2, 'collect');
    await env.waitFor(p2, '.' + FH + 'table tr[data-key="p254102"]');
    await p2.selectOption('.' + FH + 'target', 'p254103');
    await p2.waitForFunction(() => true);
    await env.waitFor(p2, '.' + FH + 'table tr[data-key="p254105"]');
    assert.equal(await env.evalOgx(p2, () => OGX.storage.get('fleethelp.walk', null)), null, 'walk reset by the target change');
    assert.equal(await env.evalOgx(p2, () => OGX.storage.get('prefill', null)), null, 'prefill cleared by the target change');
    assert.deepEqual(stepPosts(env).map((x) => x.route), ['page=fleetStep1', 'page=fleetStep2'], 'never a step 3');
    await mandatory(env, 'collect walk');
  } finally { await env.close(); }
});

T.test('fleethelp «Собрать всё»: one confirm (cancel = no POST), then fleetStep1/2/3 per flight with the origin cp, 217 only, D → C → M, short / no-217 rows', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'core.httpGapMs': 200, 'fleethelp.collectTarget': 'p254105' }), storage: { '{ns}|cargoMeasured': MEASURED(1.5) } });
  try {
    const st = env.server.state;
    Object.assign(st, { planets: [MAIN, C6, C7, T8, C9], missions: [3, 4], cargoPerShip: { 217: 60e6, 202: 5000, 203: 25000, 219: 20e6 }, consumption: 1000, enforceRoom: true,
      bodyShips: { 254102: { 217: 200, 202: 50, 203: 50, 219: 5 }, 254103: { 217: 1 }, 254104: { 202: 100, 203: 40, 219: 3 }, 254105: { 217: 7 }, 254106: { 217: 20 } },
      bodyRes: { 254102: { metal: 3e9, crystal: 1.2e9, deuterium: 9e8 }, 254103: { metal: 2e8, crystal: 1e8, deuterium: 5e7 }, 254104: { metal: 1e8, crystal: 5e7, deuterium: 1e7 },
        254105: { metal: 1e6, crystal: 1e6, deuterium: 1e6 }, 254106: { metal: 4e8, crystal: 3e8, deuterium: 2e8 } } });
    const page = await env.game('overview');
    await openTab(env, page, 'collect');
    await waitRows(page, ['p254102', 'p254103', 'p254104', 'p254106']);
    const rows = await rowsOf(page);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.deepEqual(rows.map((r) => r.key), ['p254102', 'p254103', 'p254104', 'p254106'], 'planet-list order, target excluded');
    assert.equal(by.p254102.code, 'ok');
    assert.equal(by.p254102.short, 0);
    assert.equal(by.p254103.code, 'ok');
    assert.equal(by.p254103.use, 1);
    assert.ok(by.p254103.short > 0 && by.p254103.need === by.p254103.short + 1, 'too few 217: sent with what is there');
    assert.match(by.p254103.warn, /не хватает \d+ Ул\. трансп\. \(останется .+\)/);
    assert.equal(by.p254104.code, 'no217', 'Small / Large Cargo and 219 are never used');
    assert.match(by.p254104.warn, /нет Ул\. трансп\.: нужно \d+/);
    assert.equal(await page.evaluate(() => document.querySelector('[data-ogx-act="fleethelp:collect-all"]').dataset.flights), '3');
    await page.waitForTimeout(1000);
    env.server.clearLog();

    // click 1: refresh (slots), plan, the dialog; cancel -> nothing POSTed
    await page.click('[data-ogx-act="fleethelp:collect-all"]');
    const dlg = await dialog(page);
    assert.equal(dlg.title, 'Сбор на 1992 [2:68:8]');
    assert.deepEqual(dlg.flights.map((f) => f.key), ['p254102', 'p254106', 'p254103'], 'largest cargo first');
    assert.ok(dlg.flights.every((f) => Object.keys(f.ships).join() === '217'), 'Battle Transporters only');
    assert.match(sp(dlg.flights[0].text), /^Главная планета \[2:68:5\] → 1992 \[2:68:8\] · Ул\. трансп\. \d+ · М [\d ]+ · К [\d ]+ · Д [\d ]+ · топливо [\d ]+ · [\d:]+ \(прилёт \d\d:\d\d:\d\d\)$/);
    assert.match(sp(dlg.flights[2].text), /не хватает \d+ Ул\. трансп\., останется/);
    assert.deepEqual(dlg.skips, [['p254104', 'no217']]);
    assert.equal(dlg.ok, 'Отправить 3 полёта');
    await shot(page, 'collect-confirm', false);
    await clickModal(page, false);
    await page.waitForTimeout(1000);
    assert.deepEqual(posts(env).map((x) => x.route), [], 'cancelled: no POST');
    assert.deepEqual((await journal(env, page, 'fleethelp', 'collect:confirm')).map((e) => [e.s, e.ok, e.flights]), [['U', false, 3]]);

    // click 2 + OK: three flights, each fleetStep1 -> 2 -> 3 naming its origin
    await page.click('[data-ogx-act="fleethelp:collect-all"]');
    await dialog(page);
    await clickModal(page, true);
    await page.waitForFunction((P) => document.querySelectorAll('.' + P + 'table tr[data-status="sent"]').length === 3, FH, { timeout: 30000 })
      .catch(async (e) => { console.log(await page.evaluate((P) => document.querySelector('.' + P + 'tab').innerText, FH)); throw e; });
    const sp3 = stepPosts(env);
    assert.deepEqual(sp3.map((r) => r.route.replace('page=', '')), ['fleetStep1', 'fleetStep2', 'fleetStep3', 'fleetStep1', 'fleetStep2', 'fleetStep3', 'fleetStep1', 'fleetStep2', 'fleetStep3']);
    assert.deepEqual(sp3.map((r) => r.cp), [254102, 254102, 254102, 254106, 254106, 254106, 254103, 254103, 254103], 'every POST names its origin');
    assert.deepEqual(st.sent.map((x) => x.origin), [254102, 254106, 254103]);
    for (const [i, s] of st.sent.entries()) {
      assert.deepEqual(Object.keys(s.ships), ['217'], 'only 217 posted');
      assert.equal(s.mission, 3);
      assert.deepEqual(s.target, { galaxy: 2, system: 68, planet: 8, type: 1 });
      const sum = s.cargo.metal + s.cargo.crystal + s.cargo.deuterium;
      assert.ok(sum > 0 && sum <= s.ships[217] * 60e6 - 1000, 'cargo within the server room: flight ' + i);
      assert.deepEqual(Object.keys(sp3[i * 3].form).filter((k) => /^ship/.test(k)), ['ship217']);
    }
    assert.ok(st.sent[2].cargo.deuterium > 0 && st.sent[2].cargo.crystal > 0 && st.sent[2].cargo.metal === 0, 'D -> C -> M fill: ' + JSON.stringify(st.sent[2].cargo));
    for (const i of [1, 2]) assert.ok(sp3[i * 3].t - sp3[i * 3 - 1].t >= 150, 'pause between flights ' + (sp3[i * 3].t - sp3[i * 3 - 1].t));
    const last3 = env.server.requests.indexOf(sp3[8]);
    assert.deepEqual(env.server.requests.slice(last3 + 1).filter((r) => r.route === 'page=overview').length, 1, 'one restore GET at the end');
    const done = await rowsOf(page);
    assert.match(done.find((r) => r.key === 'p254102').bst, /^✓ \d\d:\d\d:\d\d → прилёт \d\d:\d\d$/);
    assert.equal(done.find((r) => r.key === 'p254104').status, 'skip');
    await page.waitForFunction(() => /отправлено 3 из 3/.test((document.getElementById('ogx-toasts') || {}).textContent || ''), null, { timeout: 5000 });
    const sends = await journal(env, page, 'fleethelp', 'collect:send');
    assert.deepEqual(sends.map((e) => [e.key, e.ok]), [['p254102', true], ['p254106', true], ['p254103', true]]);
    const dn = await journal(env, page, 'fleethelp', 'collect:done');
    assert.equal(dn.length, 1);
    assert.equal(dn[0].sent, 3);
    assert.equal(dn[0].failed, 0);
    const disp = await journal(env, page, 'fleet', 'dispatch');
    assert.equal(disp.length, 3);
    assert.ok(disp.every((d) => d.ok && d.fleetroom > 0 && d.consumption === 1000));
    const b = await env.evalOgx(page, async () => (await OGX.state.bodies()).p254102.ships[217]);
    assert.equal(b, 200 - st.sent[0].ships[217], 'own send applied to the stored ships');
    await shot(page, 'collect-sent', false);
    await mandatory(env, 'collect all');
  } finally { await env.close(); }
});

T.test('fleethelp «Собрать всё»: cargo cut to the server room, the measured factor replaces the calc, a refused step 3 reads its message and stops the batch', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'core.httpGapMs': 200, 'fleethelp.collectTarget': 'p254105' }), storage: { '{ns}|cargoMeasured': MEASURED(1.5) } });
  try {
    const st = env.server.state;
    Object.assign(st, { planets: [MAIN, C6, C7, T8, C9], missions: [3, 4], cargoPerShip: { 217: 40e6 }, consumption: 1000, enforceRoom: true, fleetErrorAt: { 2: 'Fleet slots full' },
      bodyShips: { 254102: { 217: 50 }, 254103: { 217: 30 }, 254104: {}, 254105: {}, 254106: { 217: 10 } },
      bodyRes: { 254102: { metal: 5e9, crystal: 1e8, deuterium: 1e8 }, 254103: { metal: 3e9, crystal: 1e8, deuterium: 1e8 }, 254104: { metal: 0, crystal: 0, deuterium: 0 },
        254105: { metal: 0, crystal: 0, deuterium: 0 }, 254106: { metal: 1e9, crystal: 1e8, deuterium: 1e8 } } });
    const page = await env.game('overview');
    await openTab(env, page, 'collect');
    await waitRows(page, ['p254102', 'p254103', 'p254106']);
    assert.equal(await page.evaluate((P) => document.querySelector('.' + P + 'cargoinfo').dataset.cargo, FH), '60000000', 'stored measurement 1.5');
    await page.click('[data-ogx-act="fleethelp:collect-all"]');
    const dlg = await dialog(page);
    assert.deepEqual(dlg.flights.map((f) => f.key), ['p254102', 'p254103', 'p254106']);
    assert.deepEqual(dlg.skips.map((x) => x.join(':')), ['p254104:empty']);
    await clickModal(page, true);
    await page.waitForFunction((P) => document.querySelectorAll('.' + P + 'table tr[data-status="sent"], .' + P + 'table tr[data-status="failed"], .' + P + 'table tr[data-status="skipped"]').length === 3, FH, { timeout: 30000 });
    const rows = Object.fromEntries((await rowsOf(page)).map((r) => [r.key, r]));
    assert.equal(rows.p254102.status, 'sent');
    assert.equal(rows.p254103.status, 'failed');
    assert.equal(rows.p254103.bst, '✗ Fleet slots full', 'a recognised step-3 refusal: ✗, not «unknown»');
    assert.equal(rows.p254106.status, 'skipped', 'the first step-3 failure stops the batch');
    assert.equal(rows.p254106.bst, 'не отправлен: остановлено после ошибки');
    const dn = (await journal(env, page, 'fleethelp', 'collect:done'))[0];
    assert.deepEqual([dn.sent, dn.failed, dn.skipped, dn.aborted, dn.abortReason], [1, 1, 1, true, 'step3']);
    assert.deepEqual((await journal(env, page, 'fleet', 'batch:abort')).map((e) => [e.reason, e.step, e.left]), [['step3', 3, 1]]);
    await page.waitForFunction(() => /отправлено 1 из 3 .*ошибок 1, остановлено после ошибки 1/.test((document.getElementById('ogx-toasts') || {}).textContent || ''), null, { timeout: 5000 });
    const disp = await journal(env, page, 'fleet', 'dispatch');
    assert.equal(disp.length, 2);
    for (const d of disp.filter((x) => x.ok)) {
      assert.ok(d.clamped.length > 0, 'planned with 60 M per ship: cut to the 40 M room');
      const sum = d.cargoSent.metal + d.cargoSent.crystal + d.cargoSent.deuterium;
      assert.ok(sum <= d.fleetroom - d.consumption, 'posted cargo <= room');
    }
    assert.equal(st.sent.length, 1);
    for (const s of st.sent) assert.ok(s.cargo.metal + s.cargo.crystal + s.cargo.deuterium <= s.ships[217] * 40e6 - 1000);
    // the measured factor (fleetroom / props cargo = 1) replaces the stored 1.5
    const ss = await env.evalOgx(page, async () => { const s = (await OGX.state.shipStats())[217]; return { cargo: s.cargo, src: s.src }; });
    assert.deepEqual(ss, { cargo: 40000000, src: 'fleetroom' });
    assert.ok((await journal(env, page, 'fleet', 'cargo:measured')).some((e) => e.factor === 1));
    await page.waitForFunction((P) => document.querySelector('.' + P + 'cargoinfo').dataset.cargo === '40000000', FH, { timeout: 5000 });
    const plan1 = (await journal(env, page, 'fleethelp', 'collect:rows'))[0].rows.find((r) => r.key === 'p254103');
    const now103 = (await rowsOf(page)).find((r) => r.key === 'p254103');
    assert.ok(now103.need > plan1.need217, 're-plan with 40 M per ship needs more 217: ' + plan1.need217 + ' -> ' + now103.need);
    assert.match(sp(await page.evaluate((P) => document.querySelector('.' + P + 'cargoinfo').textContent, FH)), /^Ул\. трансп\.: 40 000 000 \(измерено \d\d:\d\d:\d\d\)$/);

    // step-3 page that is not a result: the message is never empty (title of the page); step 1 with ships gone: a reason
    env.server.route('POST', 'fleetStep3', (req, res, ctx) => ctx.send(200, '<!doctype html><html><head><title>X</title></head><body><p>?</p></body></html>'));
    const r = await env.evalOgx(page, async () => {
      const req = { galaxy: 2, system: 68, position: 8, type: 1, mission: 3, ships: { 217: 1 }, speed: 10, cargo: { metal: 1 } };
      const a = await OGX.fleet.gz.dispatch(req, { cp: 254103, fit: true });
      const b = await OGX.fleet.gz.dispatch(req, { cp: 254102, fit: true });
      return { a: [a.success, a.step, a.message], b: [b.success, b.step, b.message] };
    });
    assert.deepEqual(r.a, [false, 3, 'X']);
    assert.deepEqual(r.b, [false, 1, 'корабли не найдены на планете (их меньше, чем запрошено?)']);
    await mandatory(env, 'collect clamp');
  } finally { await env.close(); }
});

T.test('fleethelp «Сбор»: new colonies appear from one imperium GET (no click, no POST), a removed target falls back, moon as target (type 3) and as source (cp)', async () => {
  const env = await launch({ viewport: VIEW, settings: solo({ 'core.httpGapMs': 200, 'fleethelp.collectTarget': 'p254104' }) });
  try {
    const st = env.server.state;
    st.planets = [MAIN, C6, C7, T8];
    const page = await env.game('overview');
    assert.deepEqual(Object.keys(await env.evalOgx(page, () => OGX.state.bodies())).sort(), ['p254102', 'p254103', 'p254104', 'p254105']);
    // two colonies founded in another tab; the imperium lists its columns in its own order, the newest one all zero
    Object.assign(st, { planets: [MAIN, C6, C7, T8, Object.assign({ zero: true }, C9), P4], missions: [3, 4], cargoPerShip: { 217: 40e6 }, consumption: 500,
      bodyShips: { 254102: { 217: 40 }, 254103: { 217: 3 }, 254104: {}, 254105: { 217: 4 }, 254106: {}, 254107: { 217: 12 } },
      bodyRes: { 254107: { metal: 2e8, crystal: 1e8, deuterium: 5e7 } } });
    env.pageRequests.length = 0;
    env.server.clearLog();
    await openTab(env, page, 'collect');
    await waitRows(page, ['p254106', 'p254107']);
    await page.waitForTimeout(3000);
    assert.deepEqual(ownRequests(env).map((x) => x.method + ' ' + x.route), ['GET page=imperium'], 'one read-only GET, no cp switch');
    assert.deepEqual(posts(env).map((x) => x.route), [], 'nothing sent without a click');
    const rows = Object.fromEntries((await rowsOf(page)).map((r) => [r.key, r]));
    assert.deepEqual(Object.keys(rows), ['p254102', 'p254103', 'p254105', 'p254106', 'p254107'], 'every body but the target, planet-list order');
    assert.equal(rows.p254106.code, 'empty', 'zero colony: known, nothing to take');
    assert.equal(rows.p254107.code, 'ok', 'new colony with data, not «нет данных»');
    assert.equal(rows.p254107.have, 12);

    // the target planet disappears from the planet list: the target falls back to the main planet with a toast naming both
    st.planets = [MAIN, C6, T8, Object.assign({ zero: true }, C9), P4];
    await page.click('[data-ogx-act="fleethelp:refresh"]');
    await page.waitForFunction((P) => !document.querySelector('.' + P + 'table tr[data-key="p254104"]') && !document.querySelector('.' + P + 'target option[value="p254104"]'), FH, { timeout: 10000 });
    assert.equal(await env.evalOgx(page, () => OGX.settings.get('fleethelp.collectTarget')), 'p254102');
    assert.match(await page.evaluate(() => document.getElementById('ogx-toasts').textContent), /Цель сбора .*2:68:7.* удалена — новая цель: .*2:68:5.* \(можно сменить\)/);
    assert.deepEqual((await journal(env, page, 'fleethelp', 'collect:target-lost')).map((e) => e.old), ['p254104']);
    assert.deepEqual((await journal(env, page, 'fleethelp', 'collect:target-default')).map((e) => [e.key, e.why]), [['p254102', 'main']], 'the main planet');

    // a moon of 1992: target (type 3) ...
    Object.assign(st, { planets: [MAIN, C6, Object.assign({}, T8, { moon: { id: 254200, name: 'Луна' } }), Object.assign({ zero: true }, C9), P4] });
    st.bodyShips[254200] = { 217: 6 };
    st.bodyRes = { 254107: st.bodyRes[254107], 254200: { metal: 1e8, crystal: 1e8, deuterium: 1e7 } };
    await page.click('[data-ogx-act="fleethelp:refresh"]');
    await page.waitForFunction((P) => !!document.querySelector('.' + P + 'target option[value="m254200"]'), FH, { timeout: 10000 });
    assert.match(await page.evaluate((P) => document.querySelector('.' + P + 'target option[value="m254200"]').textContent, FH), /^↳ Луна \[2:68:8\]/);
    await page.selectOption('.' + FH + 'target', 'm254200');
    await waitRows(page, ['p254105', 'p254107']);
    env.server.clearLog();
    await page.click('[data-ogx-act="fleethelp:collect-all"]');
    const d1 = await dialog(page);
    assert.ok(d1.flights.some((f) => f.key === 'p254105'), 'the moon\'s own planet is a source (distance 5)');
    await clickModal(page, true);
    await page.waitForFunction((P) => !document.querySelector('.' + P + 'table tr[data-status="sending"]') && document.querySelectorAll('.' + P + 'table tr[data-status="sent"]').length > 0, FH, { timeout: 30000 });
    const s1 = stepPosts(env).filter((r) => r.route === 'page=fleetStep1');
    assert.ok(s1.length >= 2);
    assert.ok(s1.every((r) => r.form.type === '3' && r.form.planet === '8'), 'moon target: type 3');
    // ... and source (its POSTs name the moon's cp)
    await page.selectOption('.' + FH + 'target', 'p254102');
    await waitRows(page, ['m254200']);
    env.server.clearLog();
    await page.click('[data-ogx-act="fleethelp:collect-all"]');
    const d2 = await dialog(page);
    assert.ok(d2.flights.some((f) => f.key === 'm254200'));
    await clickModal(page, true);
    await page.waitForFunction((P) => !document.querySelector('.' + P + 'table tr[data-status="sending"]') && !!document.querySelector('.' + P + 'table tr[data-key="m254200"][data-status="sent"]'), FH, { timeout: 30000 });
    assert.ok(stepPosts(env).some((r) => r.cp === 254200 && r.route === 'page=fleetStep3'), 'the moon\'s flight names cp=254200');
    assert.ok(st.sent.some((x) => x.origin === 254200 && x.target.type === 1 && x.target.planet === 5));
    await mandatory(env, 'collect planets');
  } finally { await env.close(); }
});
