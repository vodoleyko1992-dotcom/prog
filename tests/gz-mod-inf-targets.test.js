'use strict';
// Infinity modules «targets» (marks, notes, target list, search, player card) and «stalk» (activity tracking) on GALAXYZ
// (ogamex.eu/Aeternum) through the GALAXYZ mock (tests/gz-server.js).
//  - REAL pages: galaxy (own system 2:68, own rows only), overview, messages-all.
//  - DERIVED pages (built here, never saved live):
//      * foreign system 2:68 = specs/galaxyz/fixtures/galaxy-live-synthetic-system.html: the REAL galaxy.html skeleton and own
//        rows 5-8 + foreign rows 1-4, 9-11 written in the live style from the upstream 2Moons galaxy template rows
//        (page.galaxy.default.tpl / GalaxyRows.php) [INFERRED]; variants below change only the activity suffix of row 1;
//      * statistics = the REAL galaxy.html chrome with #content replaced by the [UPSTREAM] statistics player table;
//      * messages-all + the [UPSTREAM] "Spying activity" (spy_detected) row of fixtures/galaxyz/upstream/messages-view-cat100-p2.html.
//    search / playerCard / "not enough deuterium" answers are the [UPSTREAM] fixtures of specs/galaxyz/fixtures.
// Expected values are read from the fixture html (regex), never from the module. Also: no state-changing request without a
// click, no galaxy view (deuterium) without a click + confirmation, module UI inside td.action (no new <td>), the game table
// and chrome unmoved, no console errors. Screenshots: tests/out/gz-targets-*.png.
//   node tests/gz-mod-inf-targets.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;
const { PAGES: PAGE_DIR } = require('./gz-server');

const OUT = path.join(__dirname, 'out');
const UP = path.join(__dirname, '..', 'fixtures', 'galaxyz', 'upstream');
const SPEC_FIX = path.join(__dirname, '..', 'specs', 'galaxyz', 'fixtures');
const saved = (name) => fs.readFileSync(path.join(PAGE_DIR || path.join(__dirname, '..', 'fixtures', 'galaxyz', 'pages'), name + '.html'), 'utf8');
const specFix = (name) => fs.readFileSync(path.join(SPEC_FIX, name), 'utf8');
const shot = async (page, name, full = true) => { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'gz-targets-' + name + '.png'), fullPage: full }); };
const digits = (s) => +String(s).replace(/[^\d]/g, '');
const dec = (s) => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ------------------------------------------------------------------------------------------------ derived fixtures
const SYNTH = specFix('galaxy-live-synthetic-system.html');
/** Foreign system 2:68; `act1` replaces the activity suffix of row 1 (Arrakis): '(*)', '(23 min)' or '' (> 60 min). */
function foreignSystem(act1) {
  if (act1 === undefined) return SYNTH;
  return SYNTH.replace('>Arrakis (*)</td>', '>Arrakis' + (act1 ? ' ' + act1 : '') + '</td>');
}
/** Foreign rows of the derived system, read from its html: position -> { name, playerId, planetId, planetName, activity, rank, flags }. */
function foreignRows(html) {
  const out = {};
  const body = html.slice(html.indexOf('<tbody>', html.indexOf('id="galaxytableHead"')), html.indexOf('</tbody>', html.indexOf('id="galaxytableHead"')));
  const rows = body.split('<tr class="row">').slice(1);
  rows.forEach((r, i) => {
    if (!/OGX GUESS: foreign row/.test(r)) return;
    const d = dec(dec(r));
    const name = (/class="[^"]*galaxy-username[^"]*">([^<]+)</.exec(r) || [])[1];
    const pn = (/class="planetname1"[^>]*>([^<]*)</.exec(r) || [])[1].trim();
    const act = /\((\*|\d+) min\)$|\((\*)\)$/.exec(pn);
    out[i + 1] = {
      name, playerId: +(/Dialog\.(?:Playercard|PM|Buddy)\((\d+)/.exec(d) || [])[1],
      planetId: +(/doit\(6,\s*(\d+)/.exec(d) || [])[1],
      planetName: pn.replace(/\s*\((\*|\d+ min)\)$/, ''),
      activity: act ? (act[2] === '*' || act[1] === '*' ? '*' : +act[1]) : null,
      rank: +(/Ranking:\s*(\d+)/.exec(d) || [])[1] || null,
      flags: [...r.matchAll(/galaxy-short-(\w+) galaxy-short/g)].map((m) => m[1]),
      moon: /class="moon"[^>]*>\s*<a/.test(r),
    };
  });
  return out;
}
const FR = foreignRows(SYNTH);

/** REAL galaxy.html chrome with the [UPSTREAM] statistics content (page=statistics is not saved live). */
function statisticsPage() {
  const real = saved('galaxy');
  const up = specFix('galaxy-upstream-statistics-players.html');
  const inner = up.slice(up.indexOf('<div id="content">') + '<div id="content">'.length, up.lastIndexOf('</table>') + '</table>'.length);
  const a = real.indexOf('<div id="content" style="padding:0px">');
  const tStart = real.indexOf('<table id="galaxytableHead"', a);
  const tEnd = real.indexOf('</table>', real.indexOf('</tfoot>', tStart)) + '</table>'.length;
  return real.slice(0, tStart).replace('<body id="galaxy"', '<body id="statistics"').replace(/<title>Galaxy/, '<title>Statistics') + inner + real.slice(tEnd);
}
/** Statistics rows of the upstream fixture: [{ id, name, rank, points }]. */
function statRows(html) {
  return [...html.matchAll(/<tr>\s*<td><a class="tooltip"[^\n]*?>(\d+)<\/a><\/td>\s*<td><a href="#" onclick="return Dialog\.Playercard\((\d+), '([^']*)'\);"[^>]*>[^<]*<\/a><\/td>[\s\S]*?<td>([\d.]+)<\/td>\s*<\/tr>/g)]
    .map((m) => ({ rank: +m[1], id: +m[2], name: m[3], points: digits(m[4]) }));
}
/** REAL messages-all + the [UPSTREAM] spy_detected row 530101. */
function messagesWithSpyDetected() {
  const real = saved('messages-all');
  const up = fs.readFileSync(path.join(UP, 'messages-view-cat100-p2.html'), 'utf8');
  const a = up.indexOf('<tr id="message_530101"');
  const b = up.indexOf('<tr id="message_530099"');
  const rows = up.slice(a, b);
  const at = real.indexOf('<tr id="message_520244"');
  return { html: real.slice(0, at) + rows + real.slice(at), rows };
}

// ------------------------------------------------------------------------------------------------ helpers
const OFF = { 'targets.enabled': false, 'stalk.enabled': false };
/** Game requests (page != null) of the mock since the last clearLog. */
const gameReqs = (env) => env.server.requests.filter((r) => r.page != null).map((r) => r.method + ' ' + r.url.replace(/^\/Aeternum\/game\.php/, ''));
/** Boxes of the game chrome and of the galaxy table (rows: height, cell count). */
const layout = (p) => p.evaluate(() => {
  const out = {};
  for (const sel of ['#links', '#inhalt', '#rechts', '#resTable', '#menuTable', '#galaxytableHead', '#content']) {
    const e = document.querySelector(sel);
    if (e) { const r = e.getBoundingClientRect(); out[sel] = [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }
  }
  out.rows = [...document.querySelectorAll('#galaxytableHead > tbody > tr.row')].map((tr) => [tr.children.length, Math.round(tr.getBoundingClientRect().height)]);
  out.hscroll = document.documentElement.scrollWidth > innerWidth + 1;
  return out;
});
/** Text of our widgets: never 'x0', 'NaN', 'undefined', 'null', 'Infinity'. */
async function noJunk(env, page, where) {
  const text = await env.evalOgx(page, () => [...document.querySelectorAll('[class*="ogx-i-targets-"], [class*="ogx-i-stalk-"]')]
    .map((e) => e.textContent + ' ' + (e.getAttribute('title') || '')).join('\n'));
  for (const bad of [/\bx0\b/, /NaN/, /undefined/, /\bnull\b/, /Infinity/]) assert.ok(!bad.test(text), where + ': ' + bad + ' in ' + (text.match(new RegExp('.{0,40}' + bad.source + '.{0,40}')) || [])[0]);
}
const openTab = (env, page, tab) => env.evalOgx(page, async (t) => {
  const sp = OGX.dom.sidePanel('infinity');
  sp.open(); sp.selectTab(t);
  await new Promise((r) => setTimeout(r, 500));
  return true;
}, tab);
const answerModal = (page, ok = true) => page.evaluate((yes) => {
  const ov = [...document.querySelectorAll('.ogx-modal-overlay')].pop();
  const b = ov && ov.querySelector('.ogx-modal-buttons button:' + (yes ? 'last-child' : 'first-child'));
  if (!b) return null;
  const text = ov.textContent;
  b.click();
  return text;
}, ok);
const waitModal = (page) => page.waitForSelector('.ogx-modal-overlay .ogx-modal', { timeout: 5000 });
const flush = (env, p) => env.evalOgx(p, async () => { await new Promise((r) => setTimeout(r, 300)); await OGX.storage.flush(); return true; });

// ================================================================================================ targets + stalk, galaxy
T.test('REAL galaxy 2:68 (own rows): marks/notes in td.action, no star and no eye on own rows, layout unchanged, no request', async () => {
  const base = await G.launch({ settings: OFF });
  let before;
  try {
    const p0 = await base.game('galaxy');
    before = await layout(p0);
  } finally { await base.close(); }
  const env = await G.launch();
  try {
    const p = await env.game('galaxy');
    await p.waitForSelector('.ogx-gx-slot[data-owner="targets"]');
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => [...document.querySelectorAll('#galaxytableHead > tbody > tr.row')].map((tr, i) => ({
      pos: i + 1,
      targets: !!tr.querySelector('td.action > .ogx-gx-slot[data-owner="targets"]'),
      dot: !!tr.querySelector('.ogx-i-targets-dot'), note: !!tr.querySelector('.ogx-i-targets-note'), star: !!tr.querySelector('.ogx-i-targets-star'),
      eye: !!tr.querySelector('.ogx-i-stalk-eye'),
    })));
    for (const x of r) {
      const own = x.pos >= 5 && x.pos <= 8;   // REAL galaxy.html: own planets 2:68:5..8, the rest free
      assert.deepEqual([x.targets, x.dot, x.note, x.star, x.eye], [own, own, own, false, false], 'row ' + x.pos);
    }
    const after = await layout(p);
    assert.deepEqual(after, before, 'table, rows (cells, height) and chrome unchanged');
    assert.equal(after.hscroll, false);
    await shot(p, 'galaxy-real-own');
    // note editor on an own row: planet note only (no player part), saved on the click
    env.server.clearLog();
    await p.click('#galaxytableHead tr.row:nth-child(5) .ogx-i-targets-note');
    await waitModal(p);
    assert.equal(await p.evaluate(() => document.querySelectorAll('.ogx-modal textarea').length), 1);
    await p.fill('.ogx-modal textarea', 'Главная — не трогать');
    await answerModal(p, true);
    await flush(env, p);
    const marks = await env.get('targets.marks');
    assert.equal(marks.planets['2:68:5:1'].note, 'Главная — не трогать');
    assert.deepEqual(marks.players, {});
    assert.deepEqual(gameReqs(env), [], 'no game request for marks/notes');
    await noJunk(env, p, 'galaxy real');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('DERIVED foreign system: tools on foreign rows, tint by mark, star/colour/eye clicks stored with ids from the rows, no request', async () => {
  const seed = {
    '{ns}|targets.marks': { v: 1, planets: { '2:68:2:1': { color: 'red', note: 'фарм', playerId: FR[2].playerId, playerName: FR[2].name, isTarget: true, updatedAt: 1, addedAt: 1 } },
      players: { [FR[1].playerId]: { color: 'blue', note: 'опасен', name: FR[1].name, updatedAt: 1 } } },
  };
  const base = await G.launch({ settings: OFF });
  let before;
  try {
    base.server.route('GET', 'galaxy', (req, res, ctx) => ctx.send(200, ctx.rewrite(SYNTH)));
    before = await layout(await base.game('galaxy'));
  } finally { await base.close(); }
  const env = await G.launch({ storage: seed });
  try {
    env.server.route('GET', 'galaxy', (req, res, ctx) => ctx.send(200, ctx.rewrite(SYNTH)));
    const p = await env.game('galaxy');
    await p.waitForSelector('.ogx-i-stalk-eye');
    await p.waitForTimeout(500);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#galaxytableHead > tbody > tr.row')].map((tr, i) => ({
      pos: i + 1, cls: [...tr.classList].filter((c) => c.startsWith('ogx-')).join(' '),
      star: !!tr.querySelector('td.action .ogx-i-targets-star'), starOn: !!tr.querySelector('.ogx-i-targets-star-on'),
      eye: !!tr.querySelector('td.action .ogx-i-stalk-eye'), eyeId: (tr.querySelector('.ogx-i-stalk-eye') || { dataset: {} }).dataset.playerId || null,
      tint: getComputedStyle(tr.children[1] || tr).backgroundColor,
    })));
    const foreign = Object.keys(FR).map(Number);
    assert.deepEqual(foreign, [1, 2, 3, 4, 9, 10, 11]);
    for (const x of rows) {
      const isF = foreign.includes(x.pos);
      assert.equal(x.star, isF, 'star on foreign rows only, row ' + x.pos);
      assert.equal(x.eye, isF, 'eye on foreign rows only, row ' + x.pos);
      if (isF) assert.equal(x.eyeId, String(FR[x.pos].playerId), 'eye carries the player id of the row ' + x.pos);
    }
    assert.equal(rows[1].cls, 'ogx-i-targets-mark-red', 'row 2 tinted by its planet mark');
    assert.equal(rows[1].starOn, true);
    assert.equal(rows[0].cls, 'ogx-i-targets-mark-blue', 'row 1 tinted by its player mark');
    assert.equal(rows[0].tint, 'rgba(41, 182, 246, 0.22)');
    assert.ok(rows.filter((x) => x.cls).length === 2);
    const after = await layout(p);
    assert.deepEqual(after, before, 'table, rows (cells, height) and chrome unchanged');
    await shot(p, 'galaxy-foreign');

    env.server.clearLog();
    // star on row 9 -> target with the row's ids and names
    await p.click('#galaxytableHead tr.row:nth-child(9) .ogx-i-targets-star');
    await p.waitForSelector('#galaxytableHead tr.row:nth-child(9) .ogx-i-targets-star-on');
    // colour menu on row 1: planet, moon (row 1 has a moon) and player sections; pick green for the player
    await p.click('#galaxytableHead tr.row:nth-child(1) .ogx-i-targets-dot');
    await p.waitForSelector('.ogx-i-targets-menu');
    const labels = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-targets-menu-label')].map((e) => e.textContent));
    assert.deepEqual(labels.map((l) => l.split(' ')[0]), ['Планета', 'Луна', 'Игрок']);
    assert.ok(labels[2].includes(FR[1].name));
    await shot(p, 'galaxy-colour-menu', false);
    await p.click('.ogx-i-targets-menu [data-ogx-act="targets:color-player:green"]');
    await p.waitForSelector('#galaxytableHead tr.row:nth-child(1).ogx-i-targets-mark-green');
    // eye on row 1 -> tracked with the system, its planet and the page's activity sample
    await p.click('#galaxytableHead tr.row:nth-child(1) .ogx-i-stalk-eye');
    await p.waitForSelector('#galaxytableHead tr.row:nth-child(1) .ogx-i-stalk-eye-on');
    await flush(env, p);
    const marks = await env.get('targets.marks');
    const t9 = marks.planets['2:68:9:1'];
    assert.deepEqual([t9.isTarget, t9.playerId, t9.playerName, t9.planetName], [true, FR[9].playerId, FR[9].name, FR[9].planetName]);
    assert.deepEqual([marks.players[FR[1].playerId].color, marks.players[FR[1].playerId].note], ['green', 'опасен']);
    const st = await env.get('stalk.players');
    const fl = st.items[String(FR[1].playerId)];
    assert.ok(fl, 'tracked under the numeric id');
    assert.deepEqual([fl.name, fl.systems], [FR[1].name, ['2:68']]);
    assert.equal(fl.planets['2:68:1'].planetId, FR[1].planetId);
    const lg = (await env.get('stalk.log')).items[String(FR[1].playerId)];
    assert.ok(lg && lg.length === 1, 'one sample: planet only (GALAXYZ shows one activity for planet + moon)');
    // seeded from the galaxy cache the page just filled (no request)
    assert.deepEqual([lg[0].coords, lg[0].body, lg[0].activity, lg[0].src], ['2:68:1', 'p', FR[1].activity, 'cache']);
    assert.equal(lg[0].activity, '*');
    // own rows are never tracked/eyed, even via the bus
    const self = await env.evalOgx(p, async () => {
      // the game's one-click spy on row 2 (core emits fleet:sent via 'fleetAjax' for code 600): a self-caused hit
      OGX.bus.emit('fleet:sent', { request: { page: 'fleetAjax', ajax: '1', mission: '6', planetID: '301140' }, ok: true, source: 'game', via: 'fleetAjax', mission: 6, to: '2:68:2', planetId: 301140 });
      await new Promise((r) => setTimeout(r, 400));
      await OGX.storage.flush();
      return true;
    });
    assert.ok(self);
    const selfHits = (await env.get('stalk.self')).items;
    assert.deepEqual(selfHits.map((x) => [x.coords, x.body, x.mission, x.arrival]), [['2:68:2', 'p', 6, null]]);
    assert.deepEqual(gameReqs(env), [], 'marks, targets and tracking send nothing');
    await shot(p, 'galaxy-foreign-after');
    await noJunk(env, p, 'galaxy foreign');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

// ================================================================================================ targets tab
T.test('tab «Цели»: rows from marks + galaxy cache + spy report; spy = one fleetAjax on click (id from the cache); unresolved = no request', async () => {
  const res2 = { metal: 4000000, crystal: 2000000, deuterium: 1000000 };
  const env = await G.launch({
    storage: {
      '{ns}|targets.marks': { v: 1, planets: {
        '2:68:2:1': { color: 'red', note: 'фарм', playerId: FR[2].playerId, playerName: FR[2].name, isTarget: true, updatedAt: 2, addedAt: 2 },
        '2:99:9:1': { color: null, note: '', playerId: null, playerName: 'Ghost', isTarget: true, updatedAt: 1, addedAt: 1 },
      }, players: {} },
      '{ns}|spy.reports': { v: 1, items: { 900002: { id: 900002, ts: Date.now() - 3600e3, target: { coords: [2, 68, 2], coordsStr: '2:68:2', planetType: 1, name: 'Colony' },
        attackParams: { galaxy: 2, system: 68, position: 2, type: 1 }, player: null, resources: Object.assign({ energy: 0 }, res2), debris: null,
        ships: {}, defense: {}, buildings: {}, research: {}, known: { ships: true, defense: true, buildings: false, research: false }, full: true, approx: false } } },
    },
  });
  try {
    env.server.route('GET', 'galaxy', (req, res, ctx) => ctx.send(200, ctx.rewrite(SYNTH)));
    env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({ slots: 2, ships: { 210: 99 }, code: 600, mess: 'Send 3 Spy Probe to 2:68:2 ...' }));
    await env.game('galaxy');                       // the user's own galaxy view fills the cache
    const p = await env.game('overview');
    env.server.clearLog();
    await openTab(env, p, 'targets');
    await p.waitForSelector('.ogx-i-targets-table tbody tr[data-key="2:68:2:1"]');
    const row = await p.evaluate(() => {
      const tr = document.querySelector('.ogx-i-targets-table tbody tr[data-key="2:68:2:1"]');
      const tds = [...tr.children].map((td) => td.textContent.trim());
      return { tds, loot: tr.querySelector('.ogx-i-targets-spy') && tr.querySelector('.ogx-i-targets-spy').dataset.loot, cls: tr.className };
    });
    // coords | player | status | rank | mark | note | spy | activity | actions
    assert.equal(row.tds[0], '[2:68:2]');
    assert.equal(row.tds[1], FR[2].name);
    assert.deepEqual(FR[2].flags, ['inactive']);
    assert.equal(row.tds[2], 'i');
    assert.equal(digits(row.tds[3]), FR[2].rank);
    assert.equal(row.tds[5], 'фарм');
    assert.equal(+row.loot, (res2.metal + res2.crystal + res2.deuterium) / 2, '2Moons loot 50 %');
    assert.match(row.tds[7], new RegExp(String(FR[2].activity) + ' мин|мин'));
    assert.ok(/ogx-i-targets-tr-red/.test(row.cls));
    const ghost = await p.evaluate(() => [...document.querySelector('.ogx-i-targets-table tbody tr[data-key="2:99:9:1"]').children].map((td) => td.textContent.trim()));
    assert.deepEqual([ghost[0], ghost[1], ghost[3], ghost[6], ghost[7]], ['[2:99:9]', 'Ghost', '—', '—', '—']);
    const tip = await p.evaluate(() => document.querySelector('.ogx-i-targets-table tbody tr[data-key="2:68:2:1"] .ogx-i-targets-a-galaxy').title);
    assert.match(tip, /стоит дейтерий/);
    await shot(p, 'tab-targets');
    await noJunk(env, p, 'tab targets');
    assert.deepEqual(gameReqs(env), [], 'opening the tab sends nothing');

    // «Шпионить» on 2:68:2 -> exactly one fleetAjax with the planet id of the cached row, without cp
    await p.click('.ogx-i-targets-table tbody tr[data-key="2:68:2:1"] .ogx-i-targets-a-spy');
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-toast')].some((t) => /Зонды отправлены/.test(t.textContent)));
    const fa = env.server.find('GET', 'fleetAjax');
    assert.equal(fa.length, 1);
    assert.deepEqual([fa[0].query.mission, fa[0].query.planetID, fa[0].cp], ['6', String(FR[2].planetId), null]);
    assert.match(await p.evaluate(() => [...document.querySelectorAll('.ogx-toast')].map((t) => t.textContent).join('|')), /Зонды отправлены на \[2:68:2\]: 3 шт\./);
    // «Шпионить» on 2:99:9 (system never viewed) -> nothing sent, the core's suggestion in a dialog with the galaxy link
    env.server.clearLog();
    await p.click('.ogx-i-targets-table tbody tr[data-key="2:99:9:1"] .ogx-i-targets-a-spy');
    await waitModal(p);
    const dlg = await p.evaluate(() => ({ text: document.querySelector('.ogx-modal').textContent, href: (document.querySelector('.ogx-modal .ogx-i-targets-gal-link') || {}).href || '' }));
    assert.match(dlg.text, /Шпионаж не отправлен/);
    assert.match(dlg.text, /дейтерий/);
    assert.match(dlg.href, /page=galaxy/);
    assert.match(dlg.href, /galaxy=2/);
    assert.match(dlg.href, /system=99/);
    await shot(p, 'spy-unresolved', false);
    await answerModal(p, true);
    assert.deepEqual(gameReqs(env), [], 'unresolved target: no request at all');
    // «Атака» -> native fleetTable with the target (prefill), nothing posted
    await p.click('.ogx-i-targets-table tbody tr[data-key="2:68:2:1"] .ogx-i-targets-a-attack');
    await p.waitForURL(/page=fleetTable/);
    await p.waitForTimeout(800);
    const u = new URL(p.url());
    assert.deepEqual(['galaxy', 'system', 'planet', 'planettype', 'target_mission'].map((k) => u.searchParams.get(k)), ['2', '68', '2', '1', '1']);
    assert.deepEqual(env.server.requests.filter((r) => r.method === 'POST'), [], 'attack never posts');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

// ================================================================================================ search + card
T.test('tab «Поиск»: player search, card from page=playerCard, alliance results without id, only the clicked requests', async () => {
  const players = specFix('galaxy-upstream-search-players.html');
  const allys = specFix('galaxy-upstream-search-alliances.html');
  const card = specFix('galaxy-upstream-playercard.html');
  // expected from the fixtures
  const hits = [...players.matchAll(/Dialog\.Playercard\((\d+)\);">([^<]+)<\/a>[\s\S]*?\[(\d+:\d+:\d+)\][\s\S]*?<td>(\d+)<\/td>/g)].map((m) => ({ id: +m[1], name: m[2], home: m[3], rank: +m[4] }));
  assert.ok(hits.length >= 2);
  const cardRows = [...card.matchAll(/<tr>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>(?:\s*<td[^>]*>([\s\S]*?)<\/td>)?\s*<\/tr>/g)].map((m) => [m[1].trim(), m[2].replace(/<[^>]*>/g, '').trim(), (m[3] || '').replace(/<[^>]*>/g, '').trim()]);
  const total = cardRows.find((r) => /^Total$/i.test(r[0]) || /Total/i.test(r[0]));
  assert.ok(total, 'total row in the card fixture');
  const home = /\[(\d+:\d+:\d+)\]/.exec(card)[1];
  const env = await G.launch();
  try {
    env.server.route('GET', 'search', (req, res, ctx) => ctx.send(200, ctx.query.type === 'playername' ? players : allys));
    env.server.route('GET', 'playerCard', (req, res, ctx) => ctx.send(200, card));
    const p = await env.game('overview');
    env.server.clearLog();
    await openTab(env, p, 'search');
    await p.fill('.ogx-i-targets-q', 'o');
    await p.click('.ogx-i-targets-go');
    await p.waitForSelector('.ogx-i-targets-rplayer');
    const list = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-targets-rplayer')].map((e) => ({ id: e.dataset.id, text: e.textContent })));
    assert.deepEqual(list.map((x) => +x.id), hits.map((x) => x.id));
    for (let i = 0; i < hits.length; i++) {
      assert.ok(list[i].text.includes(hits[i].name));
      assert.ok(list[i].text.includes('[' + hits[i].home + ']'), 'home coordinates of the result');
      assert.ok(list[i].text.includes('место ' + hits[i].rank));
    }
    let reqs = gameReqs(env);
    assert.equal(reqs.length, 1);
    assert.match(reqs[0], /^GET \?page=search&mode=result&ajax=1&type=playername&search=o$/);
    // card of the first hit
    env.server.clearLog();
    await p.click('.ogx-i-targets-rplayer [data-ogx-act="targets:result-card"]');
    await p.waitForSelector('.ogx-i-targets-card[data-player-id="' + hits[0].id + '"]');
    const kv = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ogx-i-targets-card .ogx-i-targets-kv')].map((e) => [e.children[0].textContent.replace(':', ''), e.children[1].textContent])));
    assert.equal(digits(kv['Очки']), digits(total[1]));
    assert.equal(digits(kv['Место']), digits(total[2]));
    assert.equal(kv['Главная планета'], '[' + home + ']');
    assert.ok(await p.evaluate((h) => !!document.querySelector('.ogx-i-targets-ptable tr[data-coords="' + h + '"]'), home));
    reqs = gameReqs(env);
    assert.deepEqual(reqs, ['GET ?page=playerCard&id=' + hits[0].id], 'one card request, no planet search on GALAXYZ');
    await shot(p, 'tab-search-card');
    // «В цели» of the card: the home planet becomes a target of that player
    await p.click('.ogx-i-targets-c-add');
    await flush(env, p);
    const marks = await env.get('targets.marks');
    assert.deepEqual([marks.planets[home + ':1'].isTarget, marks.planets[home + ':1'].playerId, marks.planets[home + ':1'].playerName], [true, hits[0].id, hits[0].name]);
    // alliance search: no alliance id in the GALAXYZ result -> no broken link
    env.server.clearLog();
    await p.selectOption('.ogx-i-targets-cat', '4');
    await p.click('.ogx-i-targets-go');
    await p.waitForSelector('.ogx-i-targets-rally');
    const al = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-targets-rally')].map((e) => ({ text: e.textContent, link: !!e.querySelector('a') })));
    const expectAl = [...allys.matchAll(/<tr>\s*<td>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?<\/td>\s*<td>([^<]+)<\/td>\s*<td>([\d.]+)<\/td>\s*<td>([\d.]+)<\/td>/g)].map((m) => ({ tag: m[1].trim(), name: m[2].trim(), members: digits(m[3]), points: digits(m[4]) }));
    assert.equal(al.length, expectAl.length);
    al.forEach((a, i) => {
      assert.equal(a.link, false);
      assert.ok(a.text.includes('[' + expectAl[i].tag + ']') && a.text.includes(expectAl[i].name), a.text);
      assert.ok(a.text.includes('нет ссылки'));
    });
    assert.deepEqual(gameReqs(env), ['GET ?page=search&mode=result&ajax=1&type=allyname&search=o']);
    await shot(p, 'tab-search-ally');
    await noJunk(env, p, 'search');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

// ================================================================================================ statistics
T.test('DERIVED statistics page: dots before marked players, nothing else touched, no request', async () => {
  const html = statisticsPage();
  const rows = statRows(html);
  assert.ok(rows.length >= 5, 'player rows in the derived page');
  const flor = rows.find((r) => r.name === 'Flor');
  const tx = rows.find((r) => r.name === 'Txemin');
  const seed = { '{ns}|targets.marks': { v: 1, players: { [flor.id]: { color: 'blue', note: 'опасен', name: 'Flor', updatedAt: 1 } },
    planets: { '2:68:2:1': { color: null, note: '', playerId: tx.id, playerName: 'Txemin', isTarget: true, updatedAt: 1, addedAt: 1 } } } };
  const base = await G.launch({ settings: OFF });
  let before;
  try {
    base.server.route('GET', 'statistics', (req, res, ctx) => ctx.send(200, ctx.rewrite(html)));
    const p0 = await base.game('statistics');
    before = await p0.evaluate(() => [...document.querySelectorAll('#content table')].map((t) => Math.round(t.getBoundingClientRect().width)));
  } finally { await base.close(); }
  const env = await G.launch({ storage: seed });
  try {
    env.server.route('GET', 'statistics', (req, res, ctx) => ctx.send(200, ctx.rewrite(html)));
    const p = await env.game('statistics');
    await p.waitForSelector('.ogx-i-targets-hsdot');
    assert.ok(await env.evalOgx(p, () => OGX.page.is('highscore')));
    const dots = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-targets-hsdot')].map((d) => ({ next: d.nextElementSibling && d.nextElementSibling.textContent.trim(), text: d.textContent, color: d.dataset.color, title: d.title })));
    assert.deepEqual(dots.map((d) => [d.next, d.text, d.color]), [['Flor', '', 'blue'], ['Txemin', '★', '']]);
    assert.match(dots[0].title, /опасен/);
    assert.match(dots[1].title, /Целей: 1/);
    const after = await p.evaluate(() => [...document.querySelectorAll('#content table')].map((t) => Math.round(t.getBoundingClientRect().width)));
    assert.deepEqual(after, before, 'ranking tables keep their width');
    env.server.clearLog();
    await p.waitForTimeout(800);
    assert.deepEqual(gameReqs(env), []);
    // the visited statistics page indexes the players (core): the card later knows the rank
    const idx = await env.evalOgx(p, async () => { await OGX.storage.flush(); return OGX.galaxy.player(3837); });
    assert.equal(idx && idx.rank, flor.rank);
    await shot(p, 'statistics');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

// ================================================================================================ stalk
T.test('stalk: scan only after click + confirmation (cancel = no request), auto-scan off until confirmed, deuterium stop', async () => {
  const id = String(FR[1].playerId);
  // the saved pages carry a fixed server clock (30 Oct 2026 ~10:04): 'old' must be older than that, not than the real time
  const old = Date.UTC(2026, 9, 29, 0, 0, 0);
  const env = await G.launch({
    storage: { '{ns}|stalk.players': { v: 1, items: { [id]: { name: FR[1].name, addedAt: old, systems: ['2:68'], manual: [], scans: { '2:68': old }, planets: {} } } } },
    settings: { 'stalk.autoScan': true },   // e.g. imported from an OgameX profile: never confirmed on this server
  });
  try {
    let answer = foreignSystem('(23 min)');
    env.server.route('GET', 'galaxy', (req, res, ctx) => ctx.send(200, ctx.rewrite(answer)));
    const p = await env.game('overview');
    await p.waitForTimeout(3500);          // first scheduler check at 2.5 s
    assert.deepEqual(gameReqs(env).filter((r) => /page=galaxy/.test(r)), [], 'auto-scan never runs unconfirmed on GALAXYZ');
    env.server.clearLog();
    await openTab(env, p, 'stalk');
    await p.waitForSelector('.ogx-i-stalk-card[data-player-id="' + id + '"]');
    const status = await p.evaluate(() => document.querySelector('.ogx-i-stalk-status').textContent);
    assert.match(status, /просмотр галактики стоит дейтерий/);
    assert.equal(await p.evaluate(() => document.querySelector('.ogx-i-stalk-auto').checked), false, 'checkbox shows off');
    assert.match(await p.evaluate(() => document.querySelector('.ogx-i-stalk-scan').title), /дейтерий/);
    await shot(p, 'stalk-tab-unconfirmed');
    // «Сканировать» -> core confirmation; cancel -> nothing
    await p.click('.ogx-i-stalk-scan');
    await waitModal(p);
    const q = await answerModal(p, false);
    assert.match(q, /дейтерий/);
    await p.waitForFunction(() => /отменено/.test((document.querySelector('.ogx-i-stalk-result') || {}).textContent || ''));
    assert.deepEqual(gameReqs(env), [], 'cancelled: no galaxy view');
    // again, confirmed -> exactly one view of 2:68 without cp; the new activity is recorded
    await p.click('.ogx-i-stalk-scan');
    await waitModal(p);
    await answerModal(p, true);
    await p.waitForFunction(() => /Проверено 1/.test((document.querySelector('.ogx-i-stalk-result') || {}).textContent || ''));
    await flush(env, p);
    const views = env.server.find('GET', 'galaxy');
    assert.equal(views.length, 1);
    assert.deepEqual([views[0].query.galaxy, views[0].query.system, views[0].cp], ['2', '68', null]);
    let lg = (await env.get('stalk.log')).items[id];
    assert.deepEqual(lg.map((s) => [s.coords, s.body, s.activity, s.src]), [['2:68:1', 'p', 23, 'scan']]);
    assert.equal(lg[0].lastSeen, lg[0].t - 23 * 60000);
    const pl = (await env.get('stalk.players')).items[id];
    assert.equal(pl.planets['2:68:1'].planetId, FR[1].planetId);
    assert.ok(pl.scans['2:68'] > old);
    await shot(p, 'stalk-tab-scanned');

    // auto-scan checkbox: confirmation, cancel -> stays off
    env.server.clearLog();
    await p.click('.ogx-i-stalk-auto');
    await waitModal(p);
    assert.match(await answerModal(p, false), /стоит дейтерий/);
    await p.waitForTimeout(400);
    assert.equal(await env.evalOgx(p, () => OGX.settings.get('stalk.autoScan')), false);
    // confirmed -> on, confirmation stored
    await p.click('.ogx-i-stalk-auto');
    await waitModal(p);
    await answerModal(p, true);
    await p.waitForTimeout(400);
    await flush(env, p);
    assert.equal(await env.evalOgx(p, () => OGX.settings.get('stalk.autoScan')), true);
    assert.ok((await env.get('stalk.sched')).gzConfirmedAt > 0);
    assert.deepEqual(gameReqs(env), [], 'switching the auto-scan sends nothing');
    // confirmed auto-scan: a due system is viewed by the scheduler (user-started), once
    const players = await env.get('stalk.players');
    players.items[id].scans['2:68'] = old;
    await env.setStorage({ [env.key('stalk.players')]: players });
    answer = foreignSystem('');
    env.server.clearLog();
    const p2 = await env.game('overview');
    for (let i = 0; i < 40 && !env.server.find('GET', 'galaxy').length; i++) await p2.waitForTimeout(250);   // first check at 2.5 s
    await p2.waitForTimeout(800);
    const auto = env.server.find('GET', 'galaxy');
    assert.equal(auto.length, 1, 'confirmed auto-scan viewed the due system once');
    assert.equal(auto[0].cp, null);
    await flush(env, p2);
    lg = (await env.get('stalk.log')).items[id];
    // (the saved pages carry a fixed server clock, so this page's time can be earlier than the previous one: no order check)
    assert.equal(lg.length, 2);
    assert.ok(lg.some((x) => x.activity === null && x.lastSeen === null && x.src === 'scan'), '> 60 min sample of the auto-scan');
    assert.ok((await env.get('stalk.sched')).runs.some((r) => !r.manual && r.n === 1 && r.stoppedBy === null), 'auto run recorded');
    // not enough deuterium: stops, says so, pauses the auto-scan for an hour
    answer = specFix('galaxy-upstream-nodeuterium.html');
    env.server.clearLog();
    await openTab(env, p2, 'stalk');
    await p2.click('.ogx-i-stalk-scan');
    await waitModal(p2);
    await answerModal(p2, true);
    await p2.waitForFunction(() => /дейтерия/.test((document.querySelector('.ogx-i-stalk-result') || {}).textContent || ''));
    await flush(env, p2);
    const sc = await env.get('stalk.sched');
    assert.equal(sc.pauseReason, 'deuterium');
    const nowSrv = await env.evalOgx(p2, () => OGX.time.serverNow());
    assert.ok(sc.pausedUntil > nowSrv + 50 * 60000, 'paused for an hour (server clock)');
    assert.match(await p2.evaluate(() => document.querySelector('.ogx-i-stalk-status').textContent), /не хватает дейтерия/);
    await shot(p2, 'stalk-tab-deuterium');
    await noJunk(env, p2, 'stalk tab');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('stalk: spy_detected message (no attacker name on GALAXYZ) -> activity of the tracked planet, no request', async () => {
  const { html, rows } = messagesWithSpyDetected();
  const from = /\[(\d+:\d+:\d+)\]/.exec(rows)[1];
  const date = /<td>(\d+\. \w+ \d{4}, \d\d:\d\d:\d\d)<\/td>/.exec(rows)[1];
  const env = await G.launch({
    storage: { '{ns}|stalk.players': { v: 1, items: { 3850: { name: 'Aldebaran', addedAt: 1, systems: [from.split(':').slice(0, 2).join(':')], manual: [], scans: {}, planets: { [from]: { name: 'Aldebaran', planetId: 1, moonId: null } } } } } },
  });
  try {
    env.server.route('GET', 'messages', (req, res, ctx) => ctx.send(200, ctx.rewrite(html)));
    const p = await env.game('messages');
    await p.waitForTimeout(1200);
    await flush(env, p);
    const lg = (await env.get('stalk.log')).items['3850'];
    const ts = await env.evalOgx(p, (d) => OGX.time.parseGameDate(d), date);
    assert.ok(lg && lg.length === 1, 'one sample');
    assert.deepEqual([lg[0].coords, lg[0].body, lg[0].activity, lg[0].src, lg[0].msg, lg[0].t], [from, 'p', '*', 'spy', 530101, ts]);
    const reqs = gameReqs(env).filter((r) => !/^GET \?page=messages$/.test(r));
    assert.deepEqual(reqs, [], 'no request (the game page itself only)');
    await shot(p, 'messages-spy-detected');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});


// review fix: «Атака» sizes the raid fleet with the 2Moons calculateSteal fill order (core calc.lootCapacity), the same
// cargo as the Spy tab's «Трюмы» for the same report; the loot-sum formula left ~3 % of the metal behind despite the reserve.
// Aeternum (user decision 2026-10-31): raids go only with Battle Transporters (217), not Large Cargo.
T.test('tab «Цели»: «Атака» on the REAL messages-spy report prefills Battle Transporters of the fill order (= Spy «Трюмы»), whole loot fits', async () => {
  const env = await G.launch({ storage: { '{ns}|targets.marks': { v: 1, planets: { '2:81:10:1': { color: 'red', note: 'x', isTarget: true, updatedAt: 1, addedAt: 1 } }, players: {} } } });
  try {
    // the real fleetTable plus a row of 100000 Battle Transporters (the saved page predates them)
    env.server.route('GET', 'fleetTable', (req, res, ctx) => ctx.sendPage('fleetTable', (html) => html.replace(
      /<tr>\s*<td><img src="[^"]*\/210\.gif"[\s\S]*?<\/tr>/,
      (m) => m + '\n<tr>' + m.slice(4).replace(/210/g, '217').replace('Spy Probe', 'Battle Transporter').replace('Spy Probe', 'Battle Transporter').replace('>102<', '>100000<'))));
    for (const n of ['research', 'officier', 'fleetTable', 'messages-spy']) { const q = await env.openSaved(n); await q.waitForTimeout(1200); await q.close(); }
    const p = await env.openSaved('overview');
    await p.waitForTimeout(1200);
    const spy = await env.evalOgx(p, async () => {
      const st = await OGX.state.shipStats();
      const cap = st[217].cargo;
      const loot = OGX.calc.loot({ metal: 2684939750000, crystal: 1700557697522, deuterium: 675144412230 });
      return { cap, n: OGX.calc.cargoNeeded(OGX.calc.lootCapacity(loot), 217, { 217: { cargo: cap } }, { reservePct: 10 }) };
    });
    assert.ok(spy.cap >= 40000000, 'Battle Transporter cargo from the catalog (40 000 000 on Aeternum) plus officers: ' + spy.cap);
    await openTab(env, p, 'targets');
    await p.waitForSelector('.ogx-i-targets-a-attack');
    const nav = p.waitForNavigation({ timeout: 5000 }).catch(() => null);
    await p.click('.ogx-i-targets-a-attack');
    await nav;
    const pf = await env.get('prefill');
    const ships = pf && pf.spec && pf.spec.ships || {};
    assert.deepEqual(Object.keys(ships), ['217'], 'only Battle Transporters: ' + JSON.stringify(pf && pf.spec));
    assert.equal(ships[217], spy.n, 'same count as the Spy tab (fill order + 10 %)');
    const left = await env.evalOgx(p, (a) => {
      const loot = OGX.calc.loot({ metal: 2684939750000, crystal: 1700557697522, deuterium: 675144412230 });
      const d = OGX.calc.distributeLoot(loot, a.k * a.cap);
      return loot.total - (d.metal + d.crystal + d.deuterium);
    }, { k: ships[217], cap: spy.cap });
    assert.ok(left < 1, 'the prefilled fleet carries the whole loot, left behind: ' + left);
  } finally { await env.close(); }
});

T.test('OGX.targets read API for other modules (the bot): marks() / markOf() / playerMark() / colors() hand out copies; targets:changed on the bus', async () => {
  const seed = { '{ns}|targets.marks': { v: 1, planets: { '2:68:2:1': { color: 'red', note: 'фарм', playerId: FR[2].playerId, playerName: FR[2].name, isTarget: true, updatedAt: 1, addedAt: 1 } },
    players: { [FR[1].playerId]: { color: 'blue', note: 'опасен', name: FR[1].name, updatedAt: 1 }, 'n:Безымянный': { color: 'green', note: 'без id', name: 'Безымянный', updatedAt: 1 } } } };
  const env = await G.launch({ storage: seed });
  try {
    env.server.route('GET', 'galaxy', (req, res, ctx) => ctx.send(200, ctx.rewrite(SYNTH)));
    const p = await env.game('galaxy');
    await p.waitForSelector('.ogx-i-targets-star');
    const r = await env.evalOgx(p, (a) => {
      const api = OGX.targets;
      const out = { active: api.active(), keys: Object.keys(api).sort() };
      out.byStr = api.markOf('2:68:2');
      out.byBracket = api.markOf('[2:68:2]', 'planet');
      out.byArr = api.markOf([2, 68, 2], 1);
      out.byObj = api.markOf({ galaxy: 2, system: 68, position: 2 });
      out.moon = api.markOf('2:68:2', 3);
      out.none = api.markOf('2:68:3');
      out.bad = api.markOf('x');
      out.player = api.playerMark(a.p1);
      out.playerStr = api.playerMark(String(a.p1));
      out.byName = api.playerMark('Безымянный');
      out.byNKey = api.playerMark('n:Безымянный');
      out.unknownPlayer = api.playerMark(999999);
      out.colors = api.colors().map((c) => c.id);
      const snap = api.marks();
      snap.planets['2:68:2:1'].color = 'green'; delete snap.players[String(a.p1)];
      const again = api.marks();
      out.copy = [again.planets['2:68:2:1'].color, Object.keys(again.players).length];
      window.__tc = [];
      OGX.bus.on('targets:changed', (e) => window.__tc.push(e));
      return out;
    }, { p1: FR[1].playerId });
    assert.equal(r.active, true);
    assert.deepEqual(r.keys, ['active', 'colors', 'markOf', 'marks', 'playerMark']);
    assert.deepEqual([r.byStr.color, r.byStr.note, r.byStr.isTarget, +r.byStr.playerId], ['red', 'фарм', true, +FR[2].playerId]);
    assert.deepEqual(r.byBracket, r.byStr); assert.deepEqual(r.byArr, r.byStr); assert.deepEqual(r.byObj, r.byStr);
    assert.deepEqual([r.moon, r.none, r.bad, r.unknownPlayer], [null, null, null, null]);
    assert.deepEqual([r.player.color, r.player.note, r.playerStr.color], ['blue', 'опасен', 'blue']);
    assert.deepEqual([r.byName.color, r.byNKey.color], ['green', 'green']);
    assert.deepEqual(r.colors, ['red', 'orange', 'yellow', 'green', 'blue', 'purple']);
    assert.deepEqual(r.copy, ['red', 2], 'marks() hands out copies');
    // a change through the UI (star on row 9) -> targets:changed, the API sees the new mark
    await p.click('#galaxytableHead tr.row:nth-child(9) .ogx-i-targets-star');
    await p.waitForSelector('#galaxytableHead tr.row:nth-child(9) .ogx-i-targets-star-on');
    await flush(env, p);
    const after = await env.evalOgx(p, () => ({ events: window.__tc, mark: OGX.targets.markOf('2:68:9', 1) }));
    assert.ok(after.events.length >= 1 && after.events.every((e) => e.planets === 2 && e.players === 2), JSON.stringify(after.events));
    assert.equal(after.events[0].local, true);
    assert.deepEqual([after.mark.isTarget, +after.mark.playerId], [true, +FR[9].playerId]);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});
