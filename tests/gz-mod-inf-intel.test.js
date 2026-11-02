'use strict';
// Infinity modules «spy» and «stats» on GALAXYZ (ogamex.eu/Aeternum) through the GALAXYZ mock (tests/gz-server.js):
//  - spy: the REAL saved pages messages-spy / messages-all (two real spy reports). Every expected number is read from the
//    saved page source (the im[] floats of the Simulate link, rounded like the cell) and the 2Moons rules (50 % loot,
//    calculateSteal fill order, distance/duration formulas), never from the module itself.
//  - stats: combat / expedition / transport / system lists are [UPSTREAM] fixtures (fixtures/galaxyz/upstream, served for
//    page=messages&mode=view&messcat=N) loaded by the game's own JS after a click on the category link, or by the module's
//    «Сканировать сообщения» (explicit click + confirm). Expected values come from the fixture html.
// Also: no state-changing or background request without a click, badges inside the body cell (no extra table column),
// game chrome unmoved, no console errors. Screenshots: tests/out/gz-intel-*.png.
//   node tests/gz-mod-inf-intel.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G0 = require('./gz-lib');
// The «mail» module replaces the native messages page; these tests check the native table, so it is kept off here.
const G = Object.assign({}, G0, { launch: (o = {}) => G0.launch(Object.assign({}, o, { settings: Object.assign({ 'mail.replace': false }, o.settings || {}) })) });
// Raids are sized in Battle Transporters only (217, cargo 40 000 000, John's rule). An old saved 'spy.raidShip' = 203
// (Large Cargo, removed setting) must be ignored: every spy test runs with it stored.
const LC = { 'spy.raidShip': 203 };
const CAP217 = 40000000;
const { assert } = T;
const { PAGES: PAGE_DIR } = require('./gz-server');

const OUT = path.join(__dirname, 'out');
const UP = path.join(__dirname, '..', 'fixtures', 'galaxyz', 'upstream');
const SPEC_FIX = path.join(__dirname, '..', 'specs', 'galaxyz', 'fixtures');
const saved = (name) => fs.readFileSync(path.join(PAGE_DIR, name + '.html'), 'utf8');
const upstream = (name) => fs.readFileSync(path.join(UP, name + '.html'), 'utf8');
const shot = async (page, name, full = true) => { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'gz-intel-' + name + '.png'), fullPage: full }); };
const digits = (s) => +String(s).replace(/[^\d]/g, '');
const fmtNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');   // OGX.fmt.num (ru, nbsp groups)
const sameNum = (text, n) => digits(text) === n;

// ---------------------------------------------------------------------------------------------- expected values (no OGX)
// PHP sprintf('%.0f'): nearest integer, exact .5 ties to even
const php0 = (x) => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));
/** Spy reports of a saved page: [{ id, coords, name, res: {metal, crystal, deuterium, energy}, units: {id: n}, sim }] from the html. */
function spyReports(html) {
  const out = [];
  const re = /<tr id="message_(\d+)" class="message_head[^"]*">[\s\S]*?<div class="spyRaportHead">\s*<a[^>]*>Spy Report ([^[]*?)\s*\[(\d+):(\d+):(\d+)\][\s\S]*?href="([^"]*page=battleSimulator[^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const sim = m[6].replace(/&amp;/g, '&');
    const im = {};
    for (const [, id, v] of sim.matchAll(/im\[(\d+)\]=([\d.]+)/g)) im[id] = php0(parseFloat(v));
    out.push({ id: +m[1], name: m[2].trim(), coords: [+m[3], +m[4], +m[5]], sim,
      res: { metal: im[901], crystal: im[902], deuterium: im[903], energy: im[911] }, units: Object.fromEntries(Object.entries(im).filter(([k]) => +k < 900)) });
  }
  return out;
}
/** 2Moons calculateSteal (MissionCaseAttack) on the lootable amounts, independent of the core. */
function steal(L, cap) {
  const d = { metal: 0, crystal: 0, deuterium: 0 };
  d.metal = Math.min(cap / 3, L.metal); cap -= d.metal;
  d.crystal = Math.min(cap / 2, L.crystal); cap -= d.crystal;
  d.deuterium = Math.min(cap, L.deuterium); cap -= d.deuterium;
  const m2 = Math.min(cap / 2, L.metal - d.metal); d.metal += m2; cap -= m2;
  d.crystal += Math.min(cap, L.crystal - d.crystal);
  return d.metal + d.crystal + d.deuterium;
}
/** Battle Transporters (217, 40 000 000) needed to take the whole 50 % loot, +10 % reserve (spy defaults). */
function raidShips(res, cap = CAP217) {
  const L = { metal: res.metal * 0.5, crystal: res.crystal * 0.5, deuterium: res.deuterium * 0.5 };
  const total = L.metal + L.crystal + L.deuterium;
  let ships = Math.ceil(total / cap);
  // smallest ship count whose (unreserved) capacity takes everything, then the reserve on that capacity
  let lo = ships, hi = ships * 3;
  while (steal(L, hi * cap) < total - 1) hi *= 2;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (steal(L, mid * cap) >= total - 1) hi = mid; else lo = mid + 1; }
  return { loot: Math.floor(L.metal) + Math.floor(L.crystal) + Math.floor(L.deuterium), minShips: lo };
}
/** Battle Transporter (217: speed 6000 without drive research known) at 100 %, fleet speed 7 (2Moons GetMissionDuration). */
function flightSecs(from, to) {
  const dist = from[0] !== to[0] ? 20000 * Math.abs(from[0] - to[0]) : from[1] !== to[1] ? 2700 + 95 * Math.abs(from[1] - to[1]) : 1000 + 5 * Math.abs(from[2] - to[2]);
  return Math.max(Math.round((35000 / 10 * Math.sqrt(dist * 10 / 6000) + 10) / 7), 5);
}
const hms = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };

/** Boxes of the game chrome that the modules must not move. */
const layout = (p) => p.evaluate(() => {
  const out = {};
  for (const sel of ['#links', '#inhalt', '#rechts', '#resTable', '#menuTable', '#messagestable']) {
    const e = document.querySelector(sel);
    if (e) { const r = e.getBoundingClientRect(); out[sel] = [Math.round(r.left), Math.round(sel === '#messagestable' ? 0 : r.top), Math.round(r.width)]; }
  }
  out.cols = [...document.querySelectorAll('#messagestable tr.message_head')].map((tr) => tr.children.length);
  out.hscroll = document.documentElement.scrollWidth > innerWidth + 1;
  return out;
});
/** Text of our widgets: never 'x0', 'NaN', 'undefined', 'null', 'Infinity'. */
async function noJunk(env, page, where) {
  const text = await env.evalOgx(page, () => [...document.querySelectorAll('[class*="ogx-i-spy-"], [class*="ogx-i-stats-"]')]
    .map((e) => e.textContent + ' ' + (e.getAttribute('title') || '')).join('\n'));
  for (const bad of [/\bx0\b/, /NaN/, /undefined/, /\bnull\b/, /Infinity/]) assert.ok(!bad.test(text), where + ': ' + bad + ' in ' + (text.match(new RegExp('.{0,40}' + bad.source + '.{0,40}')) || [])[0]);
}
const OFF = { 'spy.enabled': false, 'stats.enabled': false };
const openTab = (env, page, tab) => env.evalOgx(page, async (t) => {
  const sp = OGX.dom.sidePanel('infinity');
  sp.open(); sp.selectTab(t);
  await new Promise((r) => setTimeout(r, 400));
  return !!document.querySelector('.ogx-i-' + t + '-root');
}, tab);
/** Clicks the OK (or cancel) button of the open OGX modal. */
const answerModal = (page, ok = true) => page.evaluate((yes) => {
  const b = document.querySelector('.ogx-modal-overlay:last-of-type .ogx-modal-buttons button:' + (yes ? 'last-child' : 'first-child'));
  if (!b) return false;
  b.click();
  return true;
}, ok);
const waitModal = (page) => page.waitForSelector('.ogx-modal-overlay .ogx-modal', { timeout: 5000 });
/** Click on the game's own category link (Message.getMessages(cat) -> AJAX list), then wait for that list. */
async function openCategory(page, cat) {
  await page.click(`a[onclick^="Message.getMessages(${cat});"]`);
  await page.waitForFunction((c) => { const i = document.querySelector('form input[name=messcat]'); return i && i.value === String(c) && document.querySelector('#messagestable'); }, cat);
  await page.waitForTimeout(500);
}

// ------------------------------------------------------------------------------------------------------------ spy
T.test('spy: real messages-spy -> exact reports from the rows, badges inside the body cell, layout kept, no request', async () => {
  const html = saved('messages-spy');
  const reps = spyReports(html);
  assert.equal(reps.length, 2, 'two real reports in the saved page');
  const base = await G.launch({ settings: OFF });
  let before;
  try {
    const p0 = await base.openSaved('messages-spy');
    before = await layout(p0);
    await shot(p0, 'spy-baseline');
  } finally { await base.close(); }

  const env = await G.launch({ settings: LC });
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-spy-badge');
    await p.waitForTimeout(600);
    const after = await layout(p);
    for (const k of ['#links', '#inhalt', '#rechts', '#resTable', '#menuTable', '#messagestable']) assert.deepEqual(after[k], before[k], k + ' unchanged');
    assert.deepEqual(after.cols, before.cols, 'no extra cell in the message rows');
    assert.equal(after.hscroll, false);

    // stored reports = the page source
    const stored = (await env.get('spy.reports')).items;
    for (const r of reps) {
      const s = stored[r.id];
      assert.ok(s, 'report ' + r.id + ' stored');
      assert.deepEqual(s.resources, r.res, 'resources of ' + r.id);
      assert.deepEqual(s.target.coords, r.coords);
      assert.equal(s.target.name, r.name);
      assert.equal(s.full, true);
      assert.equal(s.approx, false);
      assert.equal(s.player, null, 'GALAXYZ reports carry no player');
      assert.equal(s.simHref.replace(/^https?:\/\/[^/]+/, ''), r.sim.replace(/^https?:\/\/[^/]+/, '').replace(/^/, ''), 'simulator link of the report');
      for (const [id, n] of Object.entries(r.units)) assert.equal((s.ships[id] ?? s.defense[id]), n, 'unit ' + id);
    }
    assert.ok(stored[520244].known.ships && !stored[520244].known.defense, '520244: fleet revealed, defence not');
    assert.ok(!stored[520242].known.ships, '520242: resources only');

    // badges: in the td of tr.messages_body, loot = 50 % of the exact values, cargo by the fill order
    const badges = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-spy-badge')].map((b) => ({
      id: +b.dataset.msgId, inBody: !!b.closest('tr.messages_body > td'), first: b.parentElement.firstElementChild === b,
      loot: b.querySelector('.ogx-i-spy-b-loot').textContent, cargo: b.querySelector('.ogx-i-spy-b-cargo').textContent,
      flight: (b.querySelector('.ogx-i-spy-b-flight') || {}).textContent || null, flightTitle: (b.querySelector('.ogx-i-spy-b-flight') || {}).title || '', text: b.textContent,
      raid: { disabled: b.querySelector('button').disabled, title: b.querySelector('button').title } })));
    assert.equal(badges.length, 2);
    const own = [2, 68, 5];
    for (const b of badges) {
      const r = reps.find((x) => x.id === b.id);
      const exp = raidShips(r.res);
      assert.ok(b.inBody && b.first, 'badge at the top of the body cell ' + b.id);
      assert.ok(sameNum(b.loot.replace(/^.*?:/, ''), exp.loot), `loot ${b.loot} = ${exp.loot}`);
      assert.match(b.loot, /^Добыча 50%/);
      const n = digits(b.cargo.replace(/^[^:]*:/, ''));
      // reserve 10 % on top of the capacity the fill order needs: between minShips*1.1 - 1 and that + 1
      assert.ok(Math.abs(n - exp.minShips * 1.1) <= exp.minShips * 1.1 * 1e-6 + 2, `cargo ships ${n} vs ${exp.minShips} x 1.1`);
      // drive research never seen in this profile -> base speed, marked as a guess (≈ + the reason in the title)
      assert.equal(b.flight, '≈' + hms(flightSecs(own, r.coords)), 'flight time from [2:68:5] ' + b.id);
      assert.match(b.flightTitle, /Уровни двигателей неизвестны/);
      assert.ok(!/null|NaN|undefined/.test(b.text), b.text);
    }
    // the first report: metal-heavy -> the fill order needs more room than the loot sum
    const big = reps.find((x) => x.id === 520244);
    const e1 = raidShips(big.res);
    assert.ok(e1.minShips * CAP217 > e1.loot * 1.1, 'fill-order capacity > loot sum');
    // 217 only: the cargo badge and the raid button name the Battle Transporter, never the Large Cargo of the old setting
    for (const b of badges) { assert.match(b.cargo, /Ул\. трансп\./, b.cargo); assert.doesNotMatch(b.text + b.raid.title, /Бол\. трансп|Большой транспорт/); }
    await noJunk(env, p, 'messages-spy');
    assert.deepEqual(env.server.requests.filter((x) => !(x.method === 'GET' && x.page === 'messages' && !x.mode)).map((x) => x.method + ' ' + x.url), [], 'no request besides the page');
    await shot(p, 'spy-messages');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

/** Opens the «⋯» action row of a report in the spy tab (secondary actions live there, the 440 px panel has no room). */
async function openMore(p, id) {
  if (await p.$(`.ogx-i-spy-table tbody tr[data-for="${id}"]`)) return;
  await p.click(`.ogx-i-spy-table tbody tr[data-key="${id}"] .ogx-i-spy-more`);
  await p.waitForSelector(`.ogx-i-spy-table tbody tr[data-for="${id}"] .ogx-i-spy-sim`);
}

T.test('spy: flight time with the drive research known is exact (no ≈): 217 2:68:5 -> 2:81:10 = 14:25', async () => {
  const env = await G.launch({ settings: LC });
  try {
    await env.openSaved('research');   // combustion 12 / impulse 7 / hyperspace 4 stored
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-spy-badge .ogx-i-spy-b-flight');
    const f = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-spy-badge .ogx-i-spy-b-flight')].map((x) => ({ text: x.textContent, title: x.title })));
    // 217 (hyperspace drive) 6000*(1+0.3*4)=13200, distance 2700+95*13=3935: (3500*sqrt(39350/13200)+10)/7 = 865 s
    assert.ok(f.some((x) => x.text === '14:25'), JSON.stringify(f));
    for (const x of f) { assert.ok(!x.text.startsWith('≈'), x.text); assert.doesNotMatch(x.title, /неизвестны/); }
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('spy: tab «Шпионаж» — table values, simulator = game page with the report values, probes only on click (unresolved -> suggestion)', async () => {
  const reps = spyReports(saved('messages-spy'));
  const env = await G.launch({ settings: LC });
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-spy-badge');
    env.server.clearLog();
    assert.ok(await openTab(env, p, 'spy'), 'spy tab rendered');
    const rows = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-spy-table tbody tr[data-key]')].map((tr) => ({
      id: +tr.dataset.key, cells: [...tr.children].map((td) => td.textContent.trim()),
      loot: +tr.querySelector('.ogx-i-spy-loot').dataset.total, head: [...tr.closest('table').querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      coords: tr.querySelector('a.ogx-i-spy-coords').textContent.trim(), pname: tr.querySelector('.ogx-i-spy-pname').textContent.trim(),
      fleet: tr.querySelector('.ogx-i-spy-u-fleet').textContent.trim(), debris: tr.querySelector('.ogx-i-spy-u-debris').textContent.trim(),
      risky: tr.classList.contains('ogx-i-spy-risky'), raid: tr.querySelector('.ogx-i-spy-raid').disabled })));
    assert.equal(rows.length, 2);
    const head = rows[0].head;
    assert.ok(!head.includes('Игрок') && !head.includes('Планета'), 'target name under the coordinates, no own column: ' + head);
    for (const row of rows) {
      const r = reps.find((x) => x.id === row.id);
      const cell = (label) => row.cells[head.indexOf(label)];
      assert.equal(row.coords, `[${r.coords.join(':')}]`);
      assert.equal(row.pname, r.name, 'planet name (GALAXYZ reports have no player) under the coordinates');
      assert.equal(row.loot, raidShips(r.res).loot);
      assert.equal(cell('Полёт'), '≈' + hms(flightSecs([2, 68, 5], r.coords)), 'base speed while the drives are unknown');
      assert.equal(row.debris, '—', 'debris field unknown in GALAXYZ reports');
      assert.ok(row.risky, 'defence not revealed -> risky');
    }
    assert.equal(rows.find((x) => x.id === 520244).fleet, '0', 'fleet revealed and empty');
    assert.equal(rows.find((x) => x.id === 520242).fleet, '?', 'fleet not revealed');
    await noJunk(env, p, 'spy tab');
    await shot(p, 'spy-tab', false);

    // Simulator: the game's own page=battleSimulator with the report's im[] values (opened by the click only)
    await env.evalOgx(p, () => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await openMore(p, '520244');
    await p.click('.ogx-i-spy-table tbody tr[data-for="520244"] .ogx-i-spy-sim');
    const opened = await env.evalOgx(p, () => window.__opened);
    assert.equal(opened.length, 1);
    assert.match(opened[0], /\/Aeternum\/game\.php\?page=battleSimulator&im\[901\]=2684939750000&im\[902\]=1700557697522\.1&im\[903\]=675144412229\.63/);

    // Probes: 2:72:6 is in no galaxy page/cache -> nothing is sent, the core's suggestion + galaxy link are shown
    assert.equal(env.server.find('GET', 'fleetAjax').length, 0, 'nothing before the click');
    await openMore(p, '520242');
    await p.click('.ogx-i-spy-table tbody tr[data-for="520242"] .ogx-i-spy-spy');
    await waitModal(p);
    const modal = await p.evaluate(() => { const m = document.querySelector('.ogx-modal'); const a = m.querySelector('a.ogx-i-spy-galaxy-link'); return { text: m.textContent, href: a && a.getAttribute('href') }; });
    assert.match(modal.text, /2:72:6/);
    assert.match(modal.text, /дейтерий/);
    assert.match(modal.href, /page=galaxy&galaxy=2&system=72$/);
    await shot(p, 'spy-unresolved', false);
    await answerModal(p, true);
    assert.equal(env.server.find('GET', 'fleetAjax').length, 0, 'unresolved: nothing sent');
    assert.equal(env.server.find('GET', 'galaxy').length, 0, 'no galaxy view (costs deuterium)');

    // Raid: only after the click AND the confirmation; cancelled -> no dispatch request
    const raidEnabled = await p.evaluate(() => !document.querySelector('.ogx-i-spy-table tbody tr[data-key="520242"] .ogx-i-spy-raid').disabled);
    if (raidEnabled) {
      await p.click('.ogx-i-spy-table tbody tr[data-key="520242"] .ogx-i-spy-raid');
      await waitModal(p);
      await answerModal(p, false);
      await p.waitForTimeout(300);
    }
    assert.deepEqual(env.server.requests.map((x) => x.method + ' ' + x.url), [], 'no request at all (simulator is a new tab, probes unresolved, raid cancelled)');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('spy: «Рейд» sends Battle Transporters (217) only, even with an old saved raid ship 203', async () => {
  const env = await G.launch({ settings: LC });
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-spy-badge');
    const schema = await env.evalOgx(p, () => { try { return Object.keys(((OGX.settings.schema && OGX.settings.schema('spy')) || {}).spy || {}); } catch (e) { return null; } });
    if (schema) assert.ok(!schema.includes('raidShip'), 'no raid-ship choice in the settings');
    // capture the dispatch instead of posting it (the core's own fleet.send is tested elsewhere)
    await env.evalOgx(p, () => { window.__sent = []; OGX.fleet.send = async (req) => { window.__sent.push(req); return { success: true, message: 'ok' }; }; });
    const btns = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-spy-badge .ogx-i-spy-b-raid')].map((b) => ({ disabled: b.disabled, title: b.title })));
    assert.ok(btns.length >= 1, 'raid buttons');
    let clicked = 0;
    let dialogs = 0;
    for (let i = 0; i < btns.length; i++) {
      if (btns[i].disabled) { assert.doesNotMatch(btns[i].title, /Бол\. трансп|Мал\. трансп/, btns[i].title); continue; }
      await p.evaluate((k) => document.querySelectorAll('.ogx-i-spy-badge .ogx-i-spy-b-raid')[k].click(), i);
      clicked++;
      await p.waitForTimeout(400);
      if (await p.$('.ogx-modal-overlay .ogx-modal')) { dialogs++; await answerModal(p, true); await p.waitForTimeout(300); }
    }
    const sent = await env.evalOgx(p, () => window.__sent);
    assert.equal(sent.length, clicked, 'one dispatch per click');
    // both real reports are risky (defence / fleet not seen): the confirmRisky dialog comes first, with core.confirmActions at its default (on)
    assert.equal(dialogs, clicked, 'risk dialog before every raid, independent of core.confirmActions');
    assert.ok(clicked >= 1, 'at least one raid could be sent');
    for (const r of sent) { assert.deepEqual(Object.keys(r.ships), ['217'], JSON.stringify(r.ships)); assert.equal(r.mission, 1); }
  } finally { await env.close(); }
});

T.test('spy: «Шпионить» with a known planet id sends exactly one fleetAjax on the click; messages-all reports collected too', async () => {
  const sys = fs.readFileSync(path.join(SPEC_FIX, 'galaxy-live-synthetic-system.html'), 'utf8');
  const env = await G.launch({
    storage: {
      '{ns}|spy.reports': { v: 1, items: { 900001: { id: 900001, ts: null, target: { coords: [2, 68, 9], coordsStr: '2:68:9', planetType: 1, name: 'Probe target' },
        attackParams: { galaxy: 2, system: 68, position: 9, type: 1 }, player: null, resources: { metal: 3000000, crystal: 1500000, deuterium: 600000, energy: 0 }, debris: null,
        ships: {}, defense: {}, buildings: {}, research: {}, known: { ships: true, defense: true, buildings: false, research: false }, full: true, approx: false } } },
    },
  });
  try {
    env.server.route('GET', 'galaxy', (req, res, ctx) => ctx.send(200, ctx.rewrite(sys)));
    env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({ slots: 2, ships: { 210: 99 }, code: 600, mess: 'Send 3 Spy Probe to 2:68:9 ...' }));
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });   // the user's own galaxy view fills the cache
    const p = await env.openSaved('messages-all');
    await p.waitForSelector('.ogx-i-spy-badge');
    const stored = (await env.get('spy.reports')).items;
    assert.ok(stored[520244] && stored[520242], 'reports of the "All messages" list (category 100) collected');
    assert.equal(await p.evaluate(() => document.querySelectorAll('tr.messages_body > td > .ogx-i-spy-badge').length), 2);
    env.server.clearLog();
    assert.ok(await openTab(env, p, 'spy'));
    const row = await p.evaluate(() => { const tr = document.querySelector('.ogx-i-spy-table tbody tr[data-key="900001"]'); return tr ? [...tr.children].map((td) => td.textContent.trim()) : null; });
    assert.ok(row, 'seeded report listed');
    assert.equal(env.server.find('GET', 'fleetAjax').length, 0);
    await openMore(p, '900001');
    await p.click('.ogx-i-spy-table tbody tr[data-for="900001"] .ogx-i-spy-spy');
    await p.waitForFunction(() => document.querySelector('.ogx-toast'));
    const fa = env.server.find('GET', 'fleetAjax');
    assert.equal(fa.length, 1, 'one probe request after the click');
    assert.deepEqual([fa[0].query.mission, fa[0].query.planetID, fa[0].cp], ['6', '301180', null]);
    const toast = await p.evaluate(() => [...document.querySelectorAll('.ogx-toast')].map((t) => t.textContent).join('|'));
    assert.match(toast, /Зонды отправлены \(3\)/);
    assert.deepEqual(env.server.requests.filter((x) => x.page !== 'fleetAjax').map((x) => x.method + ' ' + x.url), []);
    // «Удалить»: only on the click (+ the core confirmation): POST page=messages deletemarked messageID[520242]; both rows removed
    env.server.clearLog();
    await openMore(p, '520242');
    await p.click('.ogx-i-spy-table tbody tr[data-for="520242"] .ogx-i-spy-delete');
    const asked = await p.waitForSelector('.ogx-modal-overlay .ogx-modal', { timeout: 1500 }).then(() => true, () => false);
    if (asked) await answerModal(p, true);
    await p.waitForFunction(() => !document.getElementById('message_520242'), null, { timeout: 5000 });
    const del = env.server.find('POST', 'messages');
    assert.equal(del.length, 1, 'one delete POST');
    assert.equal(del[0].form.actionTop, 'deletemarked');
    assert.equal(del[0].form['messageID[520242]'], '1');
    assert.equal(await p.evaluate(() => document.querySelectorAll('#messagestable tr.messages_body').length), 1, 'the body row went with its head');
    let gone = false;
    for (let i = 0; i < 20 && !gone; i++) { gone = !(await env.get('spy.reports')).items[520242]; if (!gone) await p.waitForTimeout(150); }
    assert.ok(gone, 'removed from the store');
    assert.ok(await p.evaluate(() => /Доклад удалён/.test([...document.querySelectorAll('.ogx-toast')].map((t) => t.textContent).join('|'))), 'toast');
    await noJunk(env, p, 'messages-all');
    await shot(p, 'spy-all', false);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

// ------------------------------------------------------------------------------------------------------------ stats
/** Expected combat values of the cat-3 fixture: { id: { win, losses: [att, def], loot: [m,c,d], debris: [m,c], expedition } }. */
function combatFixture(html) {
  const out = {};
  const re = /<tr id="message_(\d+)"[\s\S]*?<tr class="messages_body">([\s\S]*?)<\/tr>\s*(?=<tr id="message_|<tr style)/g;
  let m;
  while ((m = re.exec(html))) {
    const b = m[2];
    if (!/raportMessage/.test(b)) { out[m[1]] = { missile: true, text: b }; continue; }
    const n = (cls, id) => digits((new RegExp('class="(?:report|raport)' + cls + ' element' + id + '">([\\d.]+)<')).exec(b)[1]);
    out[m[1]] = {
      mine: /<span class="(raport\w+)">Fight report/.exec(b)[1], expedition: /CombatReport\.php/.test(b),
      losses: [digits(/Attacker: ([\d.]+)/.exec(b)[1]), digits(/Defender: ([\d.]+)/.exec(b)[1])],
      attWon: /<span class="raportWin">Attacker/.test(b),
      loot: [n('Steal', 901), n('Steal', 902), n('Steal', 903)], debris: [n('Debris', 901), n('Debris', 902)],
    };
  }
  return out;
}

T.test('stats: category clicks (game AJAX) -> badges + summaries with the fixture values; tab totals; no other request', async () => {
  const cat3 = combatFixture(upstream('messages-view-cat3'));
  assert.equal(Object.keys(cat3).length, 4);
  const base = await G.launch({ settings: OFF });
  const before = {};
  try {
    const p0 = await base.openSaved('messages-spy');
    for (const c of [3, 15]) { await openCategory(p0, c); before[c] = await layout(p0); }
  } finally { await base.close(); }

  const env = await G.launch();
  try {
    const p = await env.openSaved('messages-spy');
    env.server.clearLog();
    // ---- combat (cat 3)
    await openCategory(p, 3);
    await p.waitForSelector('.ogx-i-stats-badge');
    const after3 = await layout(p);
    for (const k of ['#links', '#inhalt', '#rechts', '#resTable', '#menuTable', '#messagestable']) assert.deepEqual(after3[k], before[3][k], 'cat 3 ' + k);
    assert.deepEqual(after3.cols, before[3].cols, 'no extra cell in the rows');
    const b3 = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ogx-i-stats-badge')].map((b) => [b.dataset.msgId, { text: b.textContent, inBody: !!b.closest('tr.messages_body > td') }])));
    for (const [id, f] of Object.entries(cat3)) {
      const b = b3[id];
      assert.ok(b && b.inBody, 'badge in the body of ' + id);
      if (f.missile) {
        // 25 rockets, 5 intercepted, Missile Launcher (-300) 2000 M each + Light Laser Turret (-120) 1500 M + 500 C
        assert.match(b.text, /Ракетный удар/);
        assert.match(b.text, /Ракет 25, перехвачено 5/);
        assert.ok(b.text.includes('Уничтожено обороны на ' + fmtNum(300 * 2000 + 120 * 2000)), b.text);
        continue;
      }
      const role = f.expedition ? 'Экспедиция' : (f.mine === 'raportWin') === f.attWon ? 'Атака' : 'Защита';
      const res = f.mine === 'raportWin' ? 'Победа' : 'Поражение';
      assert.ok(b.text.startsWith(`${role}: ${res}`), id + ': ' + b.text);
      const ownIdx = role === 'Защита' ? 1 : 0;
      assert.ok(b.text.includes(`Потери ${fmtNum(f.losses[ownIdx])} / противник ${fmtNum(f.losses[1 - ownIdx])}`), id + ': ' + b.text);
      const loot = f.loot.reduce((a, x) => a + x, 0);
      if (loot && role !== 'Экспедиция') assert.ok(b.text.includes('Добыча ' + fmtNum(loot)), id + ': ' + b.text);
      const deb = f.debris[0] + f.debris[1];
      if (deb) assert.ok(b.text.includes('Обломки ' + fmtNum(deb)), id + ': ' + b.text);
      // default metal-unit rate = the server's trader rate (REAL trader.html «4/2/1» = M:C:D 1:2:4, mechanics.md §8)
      const lootMsu = f.loot[0] + f.loot[1] * 2 + f.loot[2] * 4;
      const net = role === 'Атака' ? lootMsu - f.losses[0] : role === 'Защита' ? -lootMsu - f.losses[1] : -f.losses[0];
      assert.ok(b.text.replace(/−/g, '-').includes('Итог ' + (net > 0 ? '+' : net < 0 ? '-' : '') + fmtNum(Math.abs(Math.round(net)))), id + ' net ' + net + ': ' + b.text);
    }
    const sum3 = await p.evaluate(() => { const s = document.querySelector('tr.ogx-i-stats-summary-row'); return s && { text: s.textContent, beforeFirst: s.nextElementSibling.matches('tr.message_head'), cells: s.children.length }; });
    assert.ok(sum3 && sum3.beforeFirst && sum3.cells === 1, 'summary row above the first message');
    assert.match(sum3.text, /3 боя: побед 1, поражений 2/);
    await noJunk(env, p, 'cat 3');
    await shot(p, 'stats-combat');

    // ---- expeditions (cat 15): outcomes from the texts, ships found from the list
    await openCategory(p, 15);
    await p.waitForSelector('.ogx-i-stats-badge');
    const after15 = await layout(p);
    for (const k of ['#links', '#inhalt', '#rechts', '#messagestable']) assert.deepEqual(after15[k], before[15][k], 'cat 15 ' + k);
    const b15 = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ogx-i-stats-badge')].map((b) => [b.dataset.msgId, b.textContent])));
    assert.match(b15[520918], /^Корабли МТ 37, ЛИ 1\s?250$/);
    assert.match(b15[520920], /^Ресурсы количество — в сообщении о возвращении флота$/);
    assert.match(b15[520913], /^Чёрная дыра/);
    assert.match(b15[520912], /^Пираты/);
    assert.match(b15[520916], /^Ничего/);
    // ---- transport (cat 5) and system (cat 4): amounts from the texts
    await openCategory(p, 5);
    await p.waitForSelector('.ogx-i-stats-badge');
    await openCategory(p, 4);
    await p.waitForSelector('.ogx-i-stats-badge');
    const b4 = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ogx-i-stats-badge')].map((b) => [b.dataset.msgId, b.textContent])));
    assert.match(b4[520607], /из экспедиции/);
    assert.match(b4[520607], /ТМ 450/);
    await noJunk(env, p, 'cat 4');
    await shot(p, 'stats-system');

    // ---- tab totals (period 7 days: the fixtures are dated today)
    assert.ok(await openTab(env, p, 'stats'));
    const kv = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ogx-i-stats-kv')].map((e) => [e.dataset.k, e.querySelector('.ogx-i-stats-v').textContent])));
    const out = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ogx-i-stats-orow')].map((e) => [e.dataset.outcome, +e.querySelector('.ogx-i-stats-ocount').textContent])));
    const note = await p.evaluate(() => (document.querySelector('[data-k="gz-note"]') || {}).textContent || '');
    assert.match(note, /2Moons/);
    assert.ok(kv['combat-count'].startsWith('3'), kv['combat-count']);
    assert.ok(sameNum(kv['combat-loot'].split(' М')[0], 19129801), kv['combat-loot']);
    assert.ok(sameNum(kv['combat-loot-lost'], 250000), kv['combat-loot-lost']);
    assert.ok(sameNum(kv['combat-losses-own'], 36000 + 4400000 + 2300000), kv['combat-losses-own']);
    assert.match(kv['combat-moons'], /неизвестно/);
    assert.equal(out.resources, 2); assert.equal(out.dark_matter, 1); assert.equal(out.ships, 2); assert.equal(out.nothing, 1);
    assert.equal(out.delay, 1); assert.equal(out.speedup, 1); assert.equal(out.pirates, 1); assert.equal(out.fleet_lost, 1);
    assert.ok(kv['exp-count'].startsWith('10'));
    assert.equal(kv['exp-resources'].replace(/\s/g, ''), 'М1254000·К0·Д0', 'expedition find = the return of the expedition fleet');
    assert.equal(kv['exp-dm'], '450');
    assert.ok(sameNum(kv['harvest-total'].split(' М')[0], 4145000 + 2072500), kv['harvest-total']);
    assert.equal(kv['harvest-field'], undefined, 'no field size in GALAXYZ recycle messages');
    assert.equal(kv['tr-received'].replace(/\s/g, ''), 'М1000·К2000·Д3000');
    assert.equal(kv['tr-delivered'].replace(/\s/g, ''), 'М500000·К250000·Д100000');
    await noJunk(env, p, 'stats tab');
    await shot(p, 'stats-tab', false);

    const stored = await env.get('stats.combat');
    assert.equal(Object.keys(stored.items).length, 4);
    assert.ok(Object.values(stored.items).every((r) => r.unverified === true), 'UPSTREAM-derived records are marked');
    // only the game's own category loads (user clicks), nothing from the modules
    assert.deepEqual(env.server.requests.map((x) => x.route + (x.query.messcat ? ' ' + x.query.messcat : '')),
      ['page=messages&mode=view 3', 'page=messages&mode=view 15', 'page=messages&mode=view 5', 'page=messages&mode=view 4']);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('stats: «Сканировать сообщения» only after the click + confirm (cats 3/15/5/4); full combat reports via page=raport when enabled', async () => {
  const env = await G.launch({ settings: { 'stats.fetchFullCombat': true } });
  try {
    const raport = fs.readFileSync(path.join(SPEC_FIX, 'messages-upstream-raport.html'), 'utf8');
    env.server.route('GET', 'raport', (req, res, ctx) => ctx.send(200, raport));
    const p = await env.game('overview');
    await p.waitForTimeout(800);
    assert.deepEqual(env.server.requests.filter((x) => x.page !== 'overview').map((x) => x.url), [], 'nothing on boot');
    env.server.clearLog();
    assert.ok(await openTab(env, p, 'stats'));
    await p.click('.ogx-i-stats-scan');
    await waitModal(p);
    const text = await p.evaluate(() => document.querySelector('.ogx-modal').textContent);
    assert.match(text, /прочитанными/);
    assert.match(text, /page=raport/);
    // cancel first: nothing
    await answerModal(p, false);
    await p.waitForTimeout(200);
    assert.equal(env.server.requests.length, 0, 'cancelled: no request');
    await p.click('.ogx-i-stats-scan');
    await waitModal(p);
    await answerModal(p, true);
    await p.waitForFunction(() => /Сканирование завершено/.test([...document.querySelectorAll('.ogx-toast')].map((t) => t.textContent).join('|')), null, { timeout: 30000 });
    await p.waitForFunction(() => true);
    // the background raport queue (one per battle with a report link)
    for (let i = 0; i < 50 && env.server.find('GET', 'raport').length < 3; i++) await p.waitForTimeout(200);
    await p.waitForTimeout(800);
    const views = env.server.find('GET', 'page=messages&mode=view').map((x) => x.query.messcat + '/' + x.query.site);
    assert.deepEqual(views.slice(0, 2), ['3/1', '15/1']);
    assert.ok(views.includes('5/1') && views.includes('4/1'), views.join());
    assert.ok(views.every((v) => /^(3|15|5|4)\//.test(v)), 'only the combat/expedition/transport/system categories');
    assert.ok(env.server.find('GET', 'page=messages&mode=view').every((x) => x.cp === null), 'never cp');
    const rq = env.server.find('GET', 'raport').map((x) => x.query.raport).sort();
    assert.deepEqual(rq, ['0123456789abcdef0123456789abcdef', '3f9a2c7e5b1d4e8f9a0b1c2d3e4f5a6b', '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b'].sort());
    assert.equal(env.server.requests.filter((x) => !/^page=(messages&mode=view|raport)$/.test(x.route)).length, 0, 'nothing else (no fleet, no galaxy)');
    const combat = (await env.get('stats.combat')).items;
    const exp = (await env.get('stats.expeditions')).items;
    const fleet = (await env.get('stats.fleet')).items;
    assert.equal(Object.keys(combat).length, 4);
    assert.equal(Object.keys(exp).length, 10);
    assert.ok(Object.keys(fleet).length >= 10, 'transport + system records: ' + Object.keys(fleet).length);
    // the raport fixture (3f9a…) applied to message 520410: full, rounds, names
    const r = combat[520410];
    assert.equal(r.full, true, 'full report applied');
    assert.equal(r.role, 'attack');
    assert.equal(r.result, 'win');
    assert.ok(r.rounds >= 1);
    assert.equal(r.attacker, 'vodoleyko1992');
    assert.equal(r.opponent, 'Kovacs');
    assert.ok(Number.isFinite(r.loot.total) && Number.isFinite(r.debris.total));
    // the mock answers every raport id with the same battle at [2:70:4]: the other messages ([2:68:5], [2:68:16]) keep their list values
    assert.equal(combat[520402].full, false, 'a raport of another battle is not applied');
    assert.equal(combat[520402].loot.total, 250000);
    assert.equal(combat[520399].full, false);
    assert.equal(combat[520402].raportMismatch, '2:70:4', 'remembered: not requested again');
    await p.waitForTimeout(300);
    await noJunk(env, p, 'after scan');
    await shot(p, 'stats-after-scan', false);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('spy + stats: no request and no error on the other real pages (overview, fleetTable, imperium, research)', async () => {
  // the other modules off: their own (allowed, free) requests, e.g. the top-1 statistics of «expedition», are not ours
  const others = ['menu', 'planetbar', 'inflight', 'techcost', 'fleetinfo', 'expedition', 'timeline', 'empire', 'targets', 'stalk', 'flights', 'fleethelp', 'todo', 'mail', 'prefs'];
  const env = await G.launch({ settings: Object.fromEntries(others.map((m) => [m + '.enabled', false])) });
  try {
    for (const [pg, o] of [['overview', {}], ['fleetTable', {}], ['imperium', {}], ['research', {}]]) {
      env.server.clearLog();
      const p = await env.game(pg, o);
      await p.waitForTimeout(500);
      assert.deepEqual(env.server.requests.filter((x) => x.page !== pg).map((x) => x.url), [], pg + ': no request from the modules');
      assert.equal(await p.evaluate(() => document.querySelectorAll('.ogx-i-spy-badge, .ogx-i-stats-badge, .ogx-i-stats-summary').length), 0);
    }
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

// review fix: Spy «Прибыль» uses the account's metal-unit rate (Stats setting stats.msuRates), else the server's trader rate
// (REAL trader.html «The exchange rate is: 4/2/1» = M:C:D 1:2:4); before it was always 1:1.5:3.
T.test('spy: «Прибыль» at the trader rate 1:2:4 by default and at the Stats rate when set (same rate as the Stats tab)', async () => {
  const trader = saved('trader');
  assert.match(trader, /exchange rate is:(?:\s|<[^>]*>)*4\/2\/1/i, 'REAL trader rate');
  const reps = spyReports(saved('messages-spy'));
  for (const [settings, rates, label] of [[{}, [1, 2, 4], '1:2:4'], [{ 'stats.msuRates': '1:1.5:3' }, [1, 1.5, 3], '1:1,5:3']]) {
    const env = await G.launch({ settings });
    try {
      const p = await env.openSaved('messages-spy');
      await p.waitForSelector('.ogx-i-spy-badge');
      assert.ok(await openTab(env, p, 'spy'), 'spy tab rendered');
      const rows = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-spy-table tbody tr[data-key]')].map((tr) => {
        const l = tr.querySelector('.ogx-i-spy-loot').dataset;
        const pr = tr.querySelector('.ogx-i-spy-pos, .ogx-i-spy-neg');
        return { id: +tr.dataset.key, loot: { metal: +l.metal, crystal: +l.crystal, deuterium: +l.deuterium }, title: pr ? pr.title : '' };
      }));
      assert.equal(rows.length, reps.length);
      for (const row of rows) {
        const msu = row.loot.metal * rates[0] + row.loot.crystal * rates[1] + row.loot.deuterium * rates[2];
        assert.match(row.title, new RegExp(`\\(в единицах металла ${label.replace(/[.]/g, '\\.')}\\)$`), row.title);
        assert.equal(+row.title.match(/^Добыча ([\d\s  ]+)/)[1].replace(/\D/g, ''), Math.round(msu), label + ' ' + row.title);
      }
      if (!settings['stats.msuRates']) {
        const st = await env.evalOgx(p, () => OGX.calc.msuRates());
        assert.deepEqual(st, [1, 2, 4], 'Stats uses the same default');
      }
      assert.deepEqual(env.ogxErrors(), []);
    } finally { await env.close(); }
  }
});

T.test('spy: older reports of the same target are removed automatically (planet and moon kept apart), newest stays', async () => {
  const now = Date.now();
  const rep = (id, coords, type, ts) => ({ id, ts, full: true, target: { coords, planetType: type, name: 'x' }, resources: { metal: 1000, crystal: 0, deuterium: 0 }, ships: {}, defense: {}, known: { ships: true, defense: true } });
  const items = {
    101: rep(101, [2, 63, 7], 1, now - 3600000),   // older duplicate of 103
    103: rep(103, [2, 63, 7], 1, now - 60000),
    102: rep(102, [2, 63, 7], 3, now - 3600000),   // the moon at the same coords: its own target
    104: rep(104, [2, 72, 6], 1, now - 7200000),
    105: rep(105, [2, 72, 6], 1, now - 7200000),   // same time: the higher id wins
  };
  const env = await G.launch({ storage: { '{ns}|spy.reports': { v: 1, items } } });
  try {
    const p = await env.game('overview');
    let ids = [];
    for (let i = 0; i < 30; i++) { ids = Object.keys((await env.get('spy.reports')).items).sort(); if (ids.length === 3) break; await p.waitForTimeout(150); }
    assert.deepEqual(ids, ['102', '103', '105']);
    // The pass over the whole store ran once and left its stamp. A duplicate written behind the module's back (another
    // writer, an import) is NOT chased on the next page load within the hour — onReport keeps its own writes clean — and
    // is removed again once the stamp is older than an hour.
    const st1 = await env.get('spy.dedupedAt');
    assert.ok(st1 >= now && st1 <= Date.now(), 'dedupedAt stamp stored in its own key: ' + st1);
    assert.equal((await env.get('spy.reports')).dedupedAt, undefined, 'no stamp inside the reports store');
    const dup = rep(106, [2, 63, 7], 1, now - 1800000);     // older than 103
    await env.evalOgx(p, async (d) => { await OGX.storage.update('spy.reports', (o) => { o.items[106] = d; return o; }); await OGX.storage.flush(); }, dup);
    const p2 = await env.game('overview');
    await p2.waitForTimeout(600);
    const st2 = await env.get('spy.reports');
    assert.deepEqual(Object.keys(st2.items).sort(), ['102', '103', '105', '106'], 'no second pass within the hour');
    assert.equal(await env.get('spy.dedupedAt'), st1, 'stamp untouched');
    await env.evalOgx(p2, async () => { await OGX.storage.set('spy.dedupedAt', Date.now() - 2 * 3600000); await OGX.storage.flush(); });
    const p3 = await env.game('overview');
    let ids3 = [];
    for (let i = 0; i < 30; i++) { ids3 = Object.keys((await env.get('spy.reports')).items).sort(); if (ids3.length === 3) break; await p3.waitForTimeout(150); }
    assert.deepEqual(ids3, ['102', '103', '105'], 'stale stamp -> the pass runs again');
    const st3 = await env.get('spy.dedupedAt');
    assert.ok(st3 > st1, 'stamp refreshed');
    // a stale stamp over a clean store: only the stamp is written, the big reports key is left alone (no change in other tabs)
    await env.evalOgx(p3, async () => {
      window.__repWrites = 0;
      OGX.storage.subscribe('spy.reports', () => { window.__repWrites++; });
      await OGX.storage.set('spy.dedupedAt', Date.now() - 2 * 3600000); await OGX.storage.flush();
    });
    const p4 = await env.game('overview', { newPage: true });
    for (let i = 0; i < 30; i++) { if ((await env.get('spy.dedupedAt')) > st3) break; await p4.waitForTimeout(150); }
    assert.ok((await env.get('spy.dedupedAt')) > st3, 'stamp refreshed by the clean pass');
    await p4.waitForTimeout(300);
    assert.equal(await env.evalOgx(p3, () => window.__repWrites), 0, 'clean pass: reports not rewritten');
    const dedupeEvents = await env.evalOgx(p3, () => OGX.diag.recent({ s: 'B', k: 'spy' }).filter((e) => e.w === 'dedupe').map((e) => e.d));
    assert.deepEqual(dedupeEvents.map((d) => d.removed), [1], 'the pass of this page is journaled (1 removed), the stamped page loads are silent');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});
