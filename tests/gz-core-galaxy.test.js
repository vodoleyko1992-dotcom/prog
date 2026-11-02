'use strict';
// Core API gaps for the GALAXYZ module port (core-galaxy work list), on the REAL saved pages (tests/gz-server.js mock):
//  M8  galaxy.fetch / galaxy.scan never spend deuterium without userStarted (stoppedBy 'cost'), confirm -> 'cancel'
//  M9  galaxy:system / galaxy:render replay for late subscribers (onSystem/onRender), galaxy.rows(), pageSystem, async ownId
//  M10 GALAXYZ page without a player name: boot refused read-only (no namespace '0'), reason journaled
//  M12 page.url id paths (/alliance/info/ID ...), page.gzRoute().shared for /resources + /facilities, page.urlFor('empire')
//  M18 side panel keeps the focus on tab clicks (Esc still closes), settings box of the journal titled «Журнал событий»
//   node tests/gz-core-galaxy.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;
const fs = require('fs');
const path = require('path');
const liveFixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'galaxyz', 'live', name + '.html'), 'utf8');

T.test('M9 galaxy page: late subscribers get the last galaxy:system / galaxy:render, rows(), pageSystem, own id from storage', async () => {
  const env = await G.launch();
  // tournament teaches the numeric id of the own player (state.player stores it by name)
  await env.game('tournament');
  const page = await env.game('galaxy');
  const r = await env.evalOgx(page, async () => {
    const got = {};
    const offS = OGX.galaxy.onSystem((ev) => { got.sys = [ev.source, ev.replay === true, ev.system.galaxy, ev.system.system, ev.system.positions.length]; });
    const offR = OGX.galaxy.onRender((ev) => { got.render = [ev.galaxy, ev.system, ev.rows.size, ev.replay === true, ev.rows.get(5) && ev.rows.get(5).tagName]; });
    const noReplay = [];
    const offN = OGX.galaxy.onSystem(() => noReplay.push(1), { replay: false });
    await new Promise((res) => setTimeout(res, 50));
    offS(); offR(); offN();
    const ps = await OGX.galaxy.pageSystem;
    const rows = OGX.galaxy.rows();
    return { got, noReplay: noReplay.length, rows: rows.size, row1: rows.get(1).tagName, last: OGX.galaxy.last().source, lastRender: !!OGX.galaxy.last('render'),
      ownId: await OGX.galaxy._ownId(), psMe: ps && ps.me.playerId, own5: ps && ps.positions.find((p) => p.position === 5).playerId };
  });
  assert.deepEqual(r.got.sys, ['page', true, 2, 68, 4]);
  assert.deepEqual(r.got.render, [2, 68, 15, true, 'TR']);
  assert.equal(r.noReplay, 0, 'replay: false = plain bus.on');
  assert.deepEqual([r.rows, r.row1, r.last, r.lastRender], [15, 'TR', 'page', true]);
  assert.equal(r.ownId, 4377, 'ownId awaits state.player() (the id learned on page=tournament)');
  assert.deepEqual([r.psMe, r.own5], [4377, 4377], 'own rows carry the numeric id');
  // other pages: no rows, pageSystem null
  const ov = await env.game('overview');
  const o = await env.evalOgx(ov, async () => ({ rows: OGX.galaxy.rows().size, ps: await OGX.galaxy.pageSystem, last: OGX.galaxy.last() }));
  assert.deepEqual(o, { rows: 0, ps: null, last: null });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M8 deuterium guard: fetch/scan send nothing without userStarted; confirm cancel; userStarted fetch goes out without cp', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  env.server.clearLog();
  const r = await env.evalOgx(page, async () => {
    const out = {};
    out.costs = OGX.galaxy.viewCostsDeuterium();
    out.fetch = await OGX.galaxy.fetch(2, 70);
    out.fetchBg = await OGX.galaxy.fetch(2, 70, { background: true, userStarted: 'yes' });
    out.scan = await OGX.galaxy.scan([[2, 70], [2, 71]], { delayMs: 0, jitterMs: 0 });
    // confirm: the dialog names the cost; "Отмена" -> cancel, nothing sent
    const p = OGX.galaxy.scan([[2, 70], [2, 71], [2, 72]], { delayMs: 0, jitterMs: 0, userStarted: true, confirm: true });
    await new Promise((res) => setTimeout(res, 100));
    const modal = Array.from(document.querySelectorAll('.ogx-modal')).pop();
    out.text = modal ? modal.textContent : null;
    const cancel = modal && Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Отмена');
    if (cancel) cancel.click();
    out.cancel = await p;
    return out;
  });
  assert.equal(r.costs, true);
  assert.deepEqual([r.fetch.stoppedBy, r.fetch.costsDeuterium, /userStarted/.test(r.fetch.error)], ['cost', true, true]);
  assert.equal(r.fetchBg.stoppedBy, 'cost', 'only userStarted === true counts');
  assert.deepEqual(r.scan, { done: 0, stoppedBy: 'cost' });
  assert.ok(r.text && /3 систем/.test(r.text) && /дейтерий/.test(r.text), 'confirm text: ' + r.text);
  assert.deepEqual(r.cancel, { done: 0, stoppedBy: 'cancel' });
  assert.deepEqual(env.server.find('GET', 'galaxy'), [], 'no galaxy view was requested');
  // a user-started fetch: one GET page=galaxy without cp, parsed + stored, scan event
  const f = await env.evalOgx(page, async () => {
    let ev = null;
    const off = OGX.galaxy.onSystem((e) => { ev = [e.source, e.replay === true]; }, { replay: false });
    const sys = await OGX.galaxy.fetch(2, 68, { background: false, userStarted: true });
    off();
    return { ok: !sys.error, n: sys.positions && sys.positions.length, ev, last: OGX.galaxy.last().source };
  });
  assert.deepEqual(f, { ok: true, n: 4, ev: ['scan', false], last: 'scan' });
  const views = env.server.find('GET', 'galaxy');
  assert.equal(views.length, 1);
  assert.ok(!/[?&]cp=/.test(views[0].url) && /galaxy=2/.test(views[0].url) && /system=68/.test(views[0].url), views[0].url);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M10 identity: a GALAXYZ page without the player name is refused read-only (no namespace 0), reason journaled', async () => {
  const env = await G.launch();
  env.server.route('GET', 'overview', (req, res, ctx) => ctx.sendPage('overview', (html) => html.replace(/<div id="playerName"[\s\S]*?<\/div>/, '<div id="playerNameGone"></div>')));
  const page = await env.game('overview', { waitReady: false });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ogx-suite') === 'refused', null, { timeout: 10000 });
  const r = await env.evalOgx(page, () => ({ refused: OGX.refused && OGX.refused.reason, ns: OGX.storage.ns || null, modules: OGX._ctxs.length }));
  assert.ok(/player name not found/.test(r.refused), r.refused);
  assert.equal(r.ns, null, 'storage never initialised');
  assert.equal(r.modules, 0);
  await page.waitForTimeout(500);
  const all = await env.storage('suite');
  assert.deepEqual(Object.keys(all).filter((k) => /\|0\|/.test(k)), [], 'nothing under player namespace 0');
  if (env.mode === 'extension') {
    const w = env.worker('suite');
    const reasons = w ? await w.evaluate(async () => { const s = await self.OGXDiagLib.openStore({ name: 'ogx-diag' }); const q = await s.query({}); return q.events.filter((e) => e.k === 'gated').map((e) => e.w + ' ' + e.d.reason); }) : [];
    assert.ok(reasons.some((x) => /no-player/.test(x)), reasons.join('\n'));
  }
  // the same page with the name boots normally, namespace n:<name>
  const ok = await env.game('research');
  assert.equal(await env.evalOgx(ok, () => OGX.storage.ns.playerId), 'n:vodoleyko1992');
});

T.test('M12 page.url on GALAXYZ: id paths, shared /resources + /facilities, urlFor by PageName', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  const r = await env.evalOgx(page, () => {
    const rel = (u) => u.replace(/^https?:\/\/[^/]+/, '');
    return {
      ally: rel(OGX.page.url('/alliance/info/' + 7)),
      apply: rel(OGX.page.url('/alliance/apply/12')),
      player: rel(OGX.page.url('/player/4377')),
      raport: rel(OGX.page.url('/raport/abc123')),
      res: OGX.page.gzRoute('/resources'), fac: OGX.page.gzRoute('/facilities').shared, unknown: OGX.page.gzRoute('/nope'),
      empire: rel(OGX.page.urlFor('empire')), fleet: rel(OGX.page.urlFor('fleet', { galaxy: 2, position: 9 })), none: OGX.page.urlFor('nope'),
      galaxy: rel(OGX.page.url('/galaxy', { galaxy: 2, system: 70, position: 4 })),
    };
  });
  assert.equal(r.ally, '/Aeternum/game.php?page=alliance&mode=info&id=7');
  assert.equal(r.apply, '/Aeternum/game.php?page=alliance&mode=apply&id=12');
  assert.equal(r.player, '/Aeternum/game.php?page=playerCard&id=4377');
  assert.equal(r.raport, '/Aeternum/game.php?page=raport&raport=abc123');
  assert.deepEqual(r.res, { page: 'buildings', query: {}, rename: null, shared: ['/resources', '/facilities'] });
  assert.deepEqual(r.fac, ['/resources', '/facilities']);
  assert.equal(r.unknown, null);
  assert.equal(r.empire, '/Aeternum/game.php?page=imperium');
  assert.equal(r.fleet, '/Aeternum/game.php?page=fleetTable&galaxy=2&planet=9');
  assert.equal(r.none, null);
  assert.equal(r.galaxy, '/Aeternum/game.php?page=galaxy&galaxy=2&system=70&planet=4');
});

T.test('M19 Russian galaxy page (live snapshot #43): header counts by ids in the short form (33K / 37.5K), free slots «от220°Cдо260°C»; English header unchanged', async () => {
  const env = await G.launch();
  const page = await env.game('galaxy');
  const r = await env.evalOgx(page, (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sys = OGX.galaxy.parseGz(doc, { playerName: 'vodoleyko1992' });
    const en = OGX.galaxy.gz.header(document);
    return { h: OGX.galaxy.gz.header(doc), free: sys && sys.free.slice(0, 2), freeN: sys && sys.free.length, positions: sys && sys.positions.map((p) => [p.position, p.own]),
      en: [en.galaxy, en.system, en.probes, en.recyclers, en.gigaRecyclers, en.missiles, en.slotsUsed, en.slotsMax, en.existingPlanets] };
  }, liveFixture('galaxy-ru'));
  assert.deepEqual(r.h, { galaxy: 2, system: 57, probes: 33000, recyclers: 0, gigaRecyclers: 37500, missiles: 90, slotsUsed: 1, slotsMax: 22, existingPlanets: 1 },
    'short counts by the span ids, not by English labels');
  assert.deepEqual(r.free[0], { position: 1, fieldsMin: 221, fieldsMax: 250, tempMin: 220, tempMax: 260 }, 'Russian colonisation hint');
  assert.equal(r.freeN + r.positions.length, 15);
  assert.equal(r.positions.length, 1, '(1 планет заселено)');
  assert.deepEqual(r.en, [2, 68, 102, 0, 0, 0, 1, 13, 1], 'the English page reads the same as before');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M18 side panel: tab clicks keep the focus in the panel (Esc closes); journal settings titled «Журнал событий»', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  await env.evalOgx(page, () => {
    const p = OGX.dom.sidePanel('cgtest', { title: 'T' });
    p.addTab({ id: 'a', label: 'AAA', render: (c) => { c.textContent = 'a'; } });
    p.addTab({ id: 'b', label: 'BBB', render: (c) => { c.textContent = 'b'; } });
    p.open();
    window.__cgPanel = p;
  });
  await page.click('#ogx-panel-cgtest button.ogx-tab[data-tab="b"]');
  const st = await env.evalOgx(page, () => ({ cur: window.__cgPanel.currentTab(), inPanel: document.getElementById('ogx-panel-cgtest').contains(document.activeElement) }));
  assert.deepEqual(st, { cur: 'b', inPanel: true });
  await page.keyboard.press('Escape');
  assert.equal(await env.evalOgx(page, () => window.__cgPanel.isOpen()), false, 'Esc closes the panel after a tab click');
  const legend = await env.evalOgx(page, () => { const f = OGX.dom.settingsForm(['diag']); const l = f.querySelector('legend'); return l ? l.textContent : null; });
  assert.equal(legend, 'Журнал событий');
  assert.deepEqual(env.ogxErrors(), []);
});


// Foreign-row variants built from the REAL foreign row of the live ru snapshot #43 (2:57:5 PARABELLUM, inactive): the player
// flag classes of upstream GalaxyRows.php getPlayerData (vacation+banned, banned, vacation, inactive+longinactive, inactive,
// noob, strong), and the moon / debris / alliance cells in the upstream template markup (page.galaxy.default.tpl:111-136: a
// table tooltip with the links in plain cells, Russian labels) - the live server has shown none of these yet (parsers-learn-11).
function realForeignRow() {
  const html = liveFixture('galaxy-ru');
  const rows = html.split(/<tr class="row">/).slice(1).map((x) => '<tr class="row">' + x.split(/<\/tr>/)[0] + '</tr>');
  const row = rows.find((x) => /PARABELLUM/.test(x));
  if (!row) throw new Error('fixture lost the PARABELLUM row');
  return row;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function variant(row, { flags, moon, debris, ally }) {
  let r = row;
  if (flags) {
    r = r.replace('class="galaxy-username-inactive galaxy-username"', `class="${flags.map((f) => 'galaxy-username-' + f).join(' ')} galaxy-username"`);
  }
  if (moon) {
    const tip = `<table style='width:240px'><tr><th colspan='2'>Луна ${moon.name} [2:57:5]</th></tr><tr><td style='width:80px'><img src='x/mond.jpg'></td><td><table style='width:100%'><tr><th colspan='2'>Характеристики</th></tr><tr><td>Диаметр</td><td>${moon.size}</td></tr><tr><td>Температура</td><td>-20</td></tr><tr><th colspan=2>Действия</th></tr><tr><td colspan='2'><a href='?page=fleetTable&amp;galaxy=2&amp;system=57&amp;planet=5&amp;planettype=3&amp;target_mission=1'>Атака</a><br><a href='javascript:doit(6,${moon.id});'>Шпионаж</a></td></tr></table></td></tr></table>`;
    r = r.replace(/<td class="moon"[^>]*>\s*<\/td>/, `<td class="moon" style="white-space: nowrap;"><a class="tooltip_sticky" data-tooltip-content="${esc(tip)}"><img src="x/s_mond.jpg" height="22" width="22" alt="${moon.name}"></a></td>`);
  }
  if (debris) {
    const tip = `<table style='width:240px'><tr><th colspan='2'>Поле обломков [2:57:5]</th></tr><tr><td style='width:80px'><img src='x/debris.jpg'></td><td><table style='width:100%'><tr><th colspan='2'>Ресурсы:</th></tr><tr><td>Металл: </td><td>${debris.metal}</td></tr><tr><td>Кристалл: </td><td>${debris.crystal}</td></tr><tr><th colspan='2'>Действия</th></tr><tr><td colspan='2'><a href='javascript:doit(8, 249873);'>Переработать</a></td></tr></table></td></tr></table>`;
    r = r.replace(/<td class="debris"[^>]*>\s*<\/td>/, `<td class="debris" style="white-space: nowrap;"><a class="tooltip_sticky" data-tooltip-content="${esc(tip)}"><img src="x/debris.jpg" height="22" width="22" alt=""></a></td>`);
  }
  if (ally) {
    const tip = `<table style='width:240px'><tr><th>Альянс ${ally.name} ${ally.members} участников</th></tr><td><table><tr><td><a href='?page=alliance&amp;mode=info&amp;id=${ally.id}'>Страница альянса</a></td></tr></table></td></table>`;
    r = r.replace(/<td class="allytag"[^>]*>\s*<\/td>/, `<td class="allytag" style="white-space: nowrap;"><a class="tooltip_sticky" data-tooltip-content="${esc(tip)}"><span class="galaxy-alliance-${ally.relation} galaxy-alliance">${ally.tag}</span></a></td>`);
  }
  return r;
}

T.test('M20 foreign rows: the real ru row + upstream flag classes and moon / debris / alliance cells (table tooltips, Russian labels)', async () => {
  const row = realForeignRow();
  const cases = [
    { flags: ['inactive'] }, { flags: ['inactive', 'longinactive'] }, { flags: ['vacation'] }, { flags: ['banned'] }, { flags: ['vacation', 'banned'] },
    { flags: ['noob'] }, { flags: ['strong'] }, { flags: [] },
    { moon: { id: 249874, name: 'Луна-1', size: '8.944' }, debris: { metal: '1.234.000', crystal: '567.000' }, ally: { id: 77, tag: 'AET', name: 'Aeternum Guard', members: 12, relation: 'member' } },
  ];
  const html = cases.map((c) => variant(row, c));
  assert.ok(html.slice(0, 8).every((h, i) => i === 0 ? h === row : h !== row), 'the flag variants changed the row');
  const env = await G.launch();
  const page = await env.game('galaxy');
  const r = await env.evalOgx(page, (rowsHtml) => rowsHtml.map((h) => {
    const doc = new DOMParser().parseFromString('<table><tbody>' + h + '</tbody></table>', 'text/html');
    const x = OGX.galaxy.gz.row(doc.querySelector('tr.row'), 4);
    return { status: OGX.galaxy.gz.statusOf(x.flags), playerId: x.playerId, planetId: x.planetId, name: x.playerName, rank: x.rank, moon: x.moon, debris: x.debris, alliance: x.alliance, missions: x.missions };
  }), html);
  assert.deepEqual(r.map((x) => x.status), ['i', 'I', 'v', 'b', 'bv', 'n', 's', '', 'i']);
  for (const x of r) assert.deepEqual([x.playerId, x.planetId, x.name, x.rank, x.missions], [4366, 249873, 'PARABELLUM', 542, [6, 1, 5, 3]]);
  assert.deepEqual([r[0].moon, r[0].debris, r[0].alliance], [null, null, null], 'the real row: empty cells');
  const full = r[8];
  assert.deepEqual(full.moon, { id: 249874, name: 'Луна-1', size: 8944, destroyed: false, activity: null });
  assert.deepEqual(full.debris, { metal: 1234000, crystal: 567000, deuterium: 0, requiredShips: null, recycleId: 249873 });
  assert.deepEqual(full.alliance, { id: 77, tag: 'AET', name: 'Aeternum Guard', members: 12, relation: 'member' });
  assert.deepEqual(env.ogxErrors(), []);
});
