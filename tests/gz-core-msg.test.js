'use strict';
// Core API gaps for the GALAXYZ port (messages / http / parse / diaglib), on the real saved pages (tests/gz-server.js mock):
//  M1  messages.watch / list items: OgameX tab/subtab aliases (fleets/espionage, combat_reports, ...) + native cat/catName/kind
//  M2  api.resolvePlanetId (galaxy page, galaxy cache, own bodies; never a galaxy request) + api.sendMiniFleet from coords
//  M6  messages.fetchDetail / messages.full / fetchRaport on GALAXYZ (spy report from the row, combat -> page=raport [UPSTREAM])
//  M7  api.highscore / api.search / api.playerCard + parse.highscorePlayers / parse.gz.statistics|searchResult|playerCard [UPSTREAM]
//  M13 vacation from the topnav infobox (parse.gz.vacation)
//  M15 spy report values = rounded im[] floats (the shown cell value)
//  M18 diaglib export header for an empty host allow-list
//   node tests/gz-core-msg.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

const SPEC_FIX = path.join(__dirname, '..', 'specs', 'galaxyz', 'fixtures');
const specFix = (name) => fs.readFileSync(path.join(SPEC_FIX, name), 'utf8');

T.test('M1/M6/M15 real messages-spy: watch aliases, rounded spy values, fetchDetail/full from the row, no request', async () => {
  const env = await G.launch();
  const p = await env.openSaved('messages-spy');
  const r = await env.evalOgx(p, async () => {
    const watched = [];
    const off = OGX.messages.watch((it) => watched.push({ id: it.id, tab: it.tab, subtab: it.subtab, cat: it.cat, rowCat: it.rowCat, catName: it.catName,
      kind: it.kind, key: it.key, engine: it.engine, li: it.li && it.li.id, body: !!it.body }));
    off();
    const items = OGX.messages.parse.list(document);
    // the shown cells of report 520244 (Ressources: Metal, Crystal, Deuterium, Energy)
    const cells = Array.from(document.querySelectorAll('#message_520244 + tr .spyRaportContainerHeadClass900 ~ .spyRaportContainerRow .spyRaportContainerCell'))
      .map((c) => c.textContent.trim());
    const full = OGX.messages.parse.espionageFull(items[0]);
    const d = await OGX.messages.fetchDetail(520244, 'fleets', 'espionage', { background: true });
    const f2 = await OGX.messages.full(watched.length ? items[1] : null);
    const miss = await OGX.messages.fetchDetail(999999, 'fleets', 'espionage');
    const fullMiss = await OGX.messages.full(999999);
    return {
      watched, cells,
      list: items.map((m) => [m.id, m.tab, m.subtab, m.catName, m.rowCat]),
      res: full.resources,
      detail: { kind: d.kind, key: d.key, source: d.source, fullId: d.full && d.full.id, res: d.full && d.full.resources,
        docId: OGX.messages.parse.espionageFull(d.doc).id, htmlHasRow: /message_520244/.test(d.html), docRows: d.doc.querySelectorAll('tr.message_head').length },
      f2: { id: f2.id, kind: f2.kind, key: f2.key, source: f2.source, target: f2.full && f2.full.target.coordsStr },
      miss: [!!miss.error, miss.notFound], fullMiss: [!!fullMiss.error, fullMiss.notFound],
      alias: ['spy_report', 'combat', 'combat_expedition', 'expedition', 'transport_arrival', 'recycle', 'return', 'system', 'construction', 'game', 'player', 'alliance', 'outbox', 'unknown']
        .map((k) => { const a = OGX.messages.gz.aliasOf(k, 100); return [k, a.tab, a.subtab, a.catName]; }),
      byCat: [0, 3, 15, 5, 4, 50, 99, 1, 2, 999].map((c) => { const a = OGX.messages.gz.aliasOf('unknown', c); return [c, a.tab + '/' + a.subtab]; }),
    };
  });
  const w = (id) => ({ id, tab: 'fleets', subtab: 'espionage', cat: 0, rowCat: 0, catName: 'spy', kind: 'spy_report', key: 'espionage_report', engine: 'galaxyz', li: 'message_' + id, body: true });
  assert.deepEqual(r.watched, [w(520244), w(520242)]);
  assert.deepEqual(r.list, [[520244, 'fleets', 'espionage', 'spy', 0], [520242, 'fleets', 'espionage', 'spy', 0]]);
  // M15: im[903]=675144412229.63 is shown as 675.144.412.230 (pretty_number = sprintf %.0f): the parser now agrees with the cell
  assert.deepEqual(r.cells.slice(0, 8), ['Metal', '2.684.939.750.000', 'Crystal', '1.700.557.697.522', 'Deuterium', '675.144.412.230', 'Energy', '356.568']);
  assert.deepEqual(r.res, { metal: 2684939750000, crystal: 1700557697522, deuterium: 675144412230, energy: 356568 });
  assert.deepEqual(r.detail, { kind: 'spy_report', key: 'espionage_report', source: 'row', fullId: 520244, res: r.res, docId: 520244, htmlHasRow: true, docRows: 1 });
  assert.deepEqual(r.f2, { id: 520242, kind: 'spy_report', key: 'espionage_report', source: 'row', target: '2:72:6' });
  assert.deepEqual(r.miss, [true, true]);
  assert.deepEqual(r.fullMiss, [true, true]);
  assert.deepEqual(r.alias, [
    ['spy_report', 'fleets', 'espionage', 'spy'], ['combat', 'fleets', 'combat_reports', 'combat'], ['combat_expedition', 'fleets', 'combat_reports', 'combat'],
    ['expedition', 'fleets', 'expeditions', 'expedition'], ['transport_arrival', 'fleets', 'transport', 'transport'], ['recycle', 'fleets', 'transport', 'transport'],
    ['return', 'fleets', 'other', 'system'], ['system', 'fleets', 'other', 'system'], ['construction', 'fleets', 'other', 'construction'], ['game', 'fleets', 'other', 'game'],
    ['player', 'communication', 'messages', 'player'], ['alliance', 'communication', 'messages', 'alliance'], ['outbox', 'communication', 'messages', 'outbox'],
    ['unknown', 'fleets', 'other', null]]);
  assert.deepEqual(r.byCat, [[0, 'fleets/espionage'], [3, 'fleets/combat_reports'], [15, 'fleets/expeditions'], [5, 'fleets/transport'], [4, 'fleets/other'],
    [50, 'fleets/other'], [99, 'fleets/other'], [1, 'communication/messages'], [2, 'communication/messages'], [999, 'communication/messages']]);
  assert.equal(env.server.requests.filter((q) => q.page && !/^(messages)$/i.test(q.page)).length, 0, 'no request besides the page itself');
  // messages-all: list category 100, every row keeps its own category (spy) and the aliases follow it
  const q = await env.openSaved('messages-all');
  const all = await env.evalOgx(q, async () => {
    const out = [];
    const off = OGX.messages.watch((it) => out.push([it.id, it.cat, it.rowCat, it.catName, it.tab, it.subtab]));
    off();
    return out;
  });
  assert.deepEqual(all, [[520244, 100, 0, 'spy', 'fleets', 'espionage'], [520242, 100, 0, 'spy', 'fleets', 'espionage']]);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M1/M6 fetched lists: subtab aliases per category; combat fetchDetail -> page=raport [UPSTREAM]; expedition/transport full from the row', async () => {
  const env = await G.launch();
  const raport = specFix('messages-upstream-raport.html');
  env.server.route('GET', 'raport', (req, res, ctx) => ctx.send(200, raport));
  const p = await env.openSaved('messages-spy');
  env.server.clearLog();
  const r = await env.evalOgx(p, async () => {
    const out = {};
    for (const [tab, sub] of [['fleets', 'combat_reports'], ['fleets', 'expeditions'], ['fleets', 'transport'], ['fleets', 'other'], ['communication', 'messages'], [99, null]]) {
      const l = await OGX.messages.fetchList(tab, sub, 1, { background: true });
      out[sub || tab] = { cat: l.cat, rows: l.items.map((x) => [x.id, x.item.tab, x.item.subtab, x.item.catName]) };
    }
    const combatIds = out.combat_reports.rows.map((x) => x[0]);
    const d = await OGX.messages.fetchDetail(combatIds[0], 'fleets', 'combat_reports', { background: true });
    const short = d.short;
    const exp = await OGX.messages.full(out.expeditions.rows[0][0]);
    const tr = await OGX.messages.full(out.transport.rows[0][0]);
    const noRaport = await OGX.messages.full(combatIds[0], { raport: false });
    return { out, detail: { source: d.source, kind: d.kind, key: d.key, reportId: d.reportId, shortId: short && short.reportId, winner: d.full && d.full.winner,
      attacker: d.full && d.full.attacker.name, defender: d.full && d.full.defender.name, rounds: d.full && d.full.rounds, docIsRaport: !!(d.doc && d.doc.querySelector('body')) },
      exp: [exp.kind, exp.source, !!exp.full, exp.full && exp.full.key], tr: [tr.kind, tr.source, !!tr.full], noRaport: [noRaport.source, noRaport.full, !!noRaport.short] };
  });
  assert.equal(r.out.combat_reports.cat, 3);
  assert.ok(r.out.combat_reports.rows.length >= 3 && r.out.combat_reports.rows.every((x) => x[1] === 'fleets' && x[2] === 'combat_reports' && x[3] === 'combat'), JSON.stringify(r.out.combat_reports));
  assert.equal(r.out.expeditions.cat, 15);
  assert.ok(r.out.expeditions.rows.every((x) => x[2] === 'expeditions' && x[3] === 'expedition'));
  assert.equal(r.out.transport.cat, 5);
  assert.ok(r.out.transport.rows.every((x) => x[2] === 'transport'));
  assert.equal(r.out.other.cat, 4);
  assert.ok(r.out.other.rows.every((x) => x[2] === 'other' && x[3] === 'system'));
  assert.equal(r.out.messages.cat, 1);
  assert.ok(r.out.messages.rows.every((x) => x[1] === 'communication' && x[2] === 'messages'));
  assert.ok(r.out['99'].rows.every((x) => x[2] === 'other' && x[3] === 'construction'));
  assert.equal(r.detail.source, 'raport');
  assert.equal(r.detail.kind, 'combat');
  assert.equal(r.detail.key, 'battle_report');
  assert.equal(r.detail.reportId, r.detail.shortId);
  assert.equal(r.detail.reportId, '3f9a2c7e5b1d4e8f9a0b1c2d3e4f5a6b');
  assert.equal(r.detail.winner, 'attacker');
  assert.equal(r.detail.attacker, 'vodoleyko1992');
  assert.equal(r.detail.defender, 'Kovacs');
  assert.ok(r.detail.rounds >= 1);
  const rq = env.server.find('GET', 'raport');
  assert.equal(rq.length, 1, 'one page=raport request');
  assert.equal(rq[0].query.raport, '3f9a2c7e5b1d4e8f9a0b1c2d3e4f5a6b');
  assert.equal(rq[0].cp, null, 'no cp');
  assert.deepEqual(r.exp.slice(0, 3), ['expedition', 'row', true]);
  assert.ok(/^expedition_/.test(r.exp[3]));
  assert.deepEqual(r.tr.slice(1), ['row', true]);
  assert.deepEqual(r.noRaport, ['row', null, true]);
  assert.equal(env.server.find(null, /page=(fleetAjax|galaxy|fleetStep)/i).length, 0);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('expedition flavour: ё folding, no short/empty prefix match, dark-matter fallback, unknown text journaled via learn', async () => {
  const env = await G.launch();
  const p = await env.openSaved('messages-spy');
  const r = await env.evalOgx(p, () => {
    const one = (html) => {
      const body = document.createElement('div'); body.innerHTML = html;
      const x = OGX.messages.gz.expedition({ body, subject: 'Результат экспедиции', wall: null });
      return x && [x.outcome, x.key, x.textSample || null];
    };
    const dm = 'Экспедиции удалось поймать и законсервировать немного Тёмной материи.';
    const out = {
      exact: one(dm),
      yo: one(dm.replace(/ё/g, 'е')),
      edited: one('Экспедиции удалось поймать немного Тёмной материи!'),
      empty: one(''),
      brFirst: one('<br>Экспедиции удалось поймать и законсервировать немного Тёмной материи.'),
      short: one('Часть<br>'),
      hole: one('Часть Вашего флота засосало в чёрную дыру.'),
      unknown: one('Совершенно новый текст сервера Aeternum про экспедицию.'),
      ships: one('Ваша экспедиция обнаружила несколько кораблей в отличном состоянии. К флоту присоединились:<br><br>Малый транспорт: 3'),
    };
    out.alerts = OGX.learn.isActive() ? OGX.learn.state().alertLog.filter((a) => /^expedition-text:/.test(a.key)).map((a) => [a.kind, a.data.text, a.data.fallback]) : null;
    return out;
  });
  assert.deepEqual(r.exact, ['darkmatter', 'sys_expe_found_dm_1_1', null]);
  assert.deepEqual(r.yo, ['darkmatter', 'sys_expe_found_dm_1_1', null], 'е instead of ё still matches the table');
  assert.deepEqual(r.edited, ['darkmatter', 'fallback:darkmatter', 'Экспедиции удалось поймать немного Тёмной материи!']);
  assert.deepEqual(r.empty, [null, null, null], 'an empty body never matches the first table entry (black hole)');
  assert.deepEqual(r.brFirst.slice(0, 2), ['darkmatter', 'sys_expe_found_dm_1_1'], 'a body starting with <br>: the first non-empty segment');
  assert.deepEqual(r.short, [null, null, 'Часть'], 'a short first segment is no prefix of «Часть Вашего флота засосало…»');
  assert.deepEqual(r.hole.slice(0, 2), ['fleet_lost', 'sys_expe_blackholl_1']);
  assert.deepEqual(r.unknown, [null, null, 'Совершенно новый текст сервера Aeternum про экспедицию.']);
  assert.deepEqual(r.ships.slice(0, 2), ['ships', 'sys_expe_found_ships']);
  if (r.alerts) {
    assert.deepEqual(r.alerts.map((a) => a[0]), ['expedition-text-unknown', 'expedition-text-unknown', 'expedition-text-unknown'], JSON.stringify(r.alerts));
    assert.deepEqual(r.alerts.map((a) => a[2]), ['darkmatter', null, null]);
  }
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M2 resolvePlanetId: galaxy page, galaxy cache, own bodies, unresolvable with a suggestion; sendMiniFleet from coords', async () => {
  const env = await G.launch();
  const sys = specFix('galaxy-live-synthetic-system.html');
  env.server.route('GET', 'galaxy', (req, res, ctx) => ctx.send(200, ctx.rewrite(sys)));
  const g = await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
  const onPage = await env.evalOgx(g, async () => {
    const R = (t, ty) => OGX.api.resolvePlanetId(t, ty).then((x) => [x.planetId, x.source]);
    return [await R('2:68:9'), await R({ galaxy: 2, system: 68, position: 10, type: 3 }), await R([2, 68, 1], 2)];
  });
  assert.deepEqual(onPage, [[301180, 'galaxy-page'], [301191, 'galaxy-page'], [301120, 'galaxy-page']]);
  const o = await env.game('overview');
  env.server.clearLog();
  const r = await env.evalOgx(o, async () => {
    const R = (t, ty) => OGX.api.resolvePlanetId(t, ty);
    const cache = await R('2:68:11');
    const moon = await R('2:68:1', 3);
    const own = await R('2:68:5');
    const none = await R({ galaxy: 2, system: 99, planet: 4 });
    const noMoon = await R('2:68:9', 3);
    const bad = await R('x');
    return { cache: [cache.planetId, cache.source, typeof cache.t], moon: [moon.planetId, moon.source], own: [own.planetId, own.source],
      none, noMoon: [noMoon.planetId, !!noMoon.error], bad: [bad.planetId, bad.error], ownId: OGX.parse.gz.bodies(document).list.find((b) => b.coords === '2:68:5' && !b.isMoon).id };
  });
  assert.deepEqual(r.cache, [301150, 'galaxy-cache', 'number']);
  assert.deepEqual(r.moon, [301121, 'galaxy-cache']);
  assert.equal(r.own[0], r.ownId);
  assert.ok(['galaxy-cache', 'own-body'].includes(r.own[1]), r.own[1]);
  assert.equal(r.none.planetId, null);
  assert.equal(r.none.coords, '2:99:4');
  assert.ok(/2:99:4/.test(r.none.error), r.none.error);
  assert.ok(/галактик/i.test(r.none.suggestion) && /дейтерий/.test(r.none.suggestion), r.none.suggestion);
  assert.ok(/page=galaxy&galaxy=2&system=99$/.test(r.none.galaxyUrl), r.none.galaxyUrl);
  assert.deepEqual(r.noMoon, [null, true]);
  assert.deepEqual(r.bad, [null, 'bad coordinates']);
  assert.equal(env.server.requests.length, 0, 'resolving never requests anything (galaxy views cost deuterium)');

  // sendMiniFleet: coords only -> planetID from the cache; upstream answer "Send 3 Spy Probe to 2:68:9 ..." -> shipsSent 3
  let answer = { slots: 2, ships: { 210: 99 }, code: 600, mess: 'Send 3 Spy Probe to 2:68:9 ...' };
  env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json(answer));
  const send = (q) => env.evalOgx(o, (a) => OGX.api.sendMiniFleet(a), q);
  const s1 = await send({ mission: 6, galaxy: 2, system: 68, position: 9, type: 1, shipCount: 1 });
  // no cached probe counts on this profile -> the current body is the origin (no cp switch)
  assert.deepEqual(s1, { success: true, message: 'Send 3 Spy Probe to 2:68:9 ...', serverMessage: 'Send 3 Spy Probe to 2:68:9 ...', shipsSent: 3, code: 600, slots: 2,
    shipsLeft: { 210: 99 }, planetId: 301180, resolvedBy: 'galaxy-cache', targetCoords: '2:68:9', mismatch: false,
    origin: { id: s1.origin.id, coords: '2:68:5', name: s1.origin.name, probes: null, current: true, source: 'current' }, shipCount: 1 });
  const fa = env.server.find('GET', 'fleetAjax');
  assert.equal(fa.length, 1);
  assert.deepEqual([fa[0].query.mission, fa[0].query.planetID, fa[0].query.ajax, fa[0].query.cp], ['6', '301180', '1', undefined]);
  // recycle on 2:68:1: the debris belongs to the planet row id
  answer = { slots: 2, ships: { 219: 0, 209: 0 }, code: 600, mess: 'Send 12 Recycler to 2:68:1 ...' };
  const s2 = await send({ mission: 8, galaxy: 2, system: 68, position: 1, type: 2 });
  assert.deepEqual([s2.success, s2.shipsSent, s2.planetId, env.server.find('GET', 'fleetAjax')[1].query.planetID], [true, 12, 301120, '301120']);
  // stale id: the server names other coords -> mismatch flagged (the fleet was sent)
  answer = { slots: 2, ships: { 210: 99 }, code: 600, mess: 'Send 3 Spy Probe to 2:70:9 ...' };
  const s3 = await send({ mission: 6, galaxy: 2, system: 68, position: 9 });
  assert.deepEqual([s3.success, s3.mismatch, s3.targetCoords], [true, true, '2:70:9']);
  // refused by the server: shipsSent 0, code kept
  answer = { slots: 1, ships: { 210: 99 }, code: 603, mess: 'Player is too weak' };
  const s4 = await send({ mission: 6, galaxy: 2, system: 68, position: 9 });
  assert.deepEqual([s4.success, s4.shipsSent, s4.code, s4.message, s4.serverMessage], [false, 0, 603, 'игрок под защитой новичков (слишком слабый)', 'Player is too weak']);
  // explicit planetId wins (no lookup)
  answer = { slots: 2, ships: { 210: 99 }, code: 600, mess: 'Send 1 Spy Probe to 2:68:4 ...' };
  const s5 = await send({ mission: 6, planetId: 301170, galaxy: 2, system: 68, position: 4 });
  assert.deepEqual([s5.success, s5.resolvedBy, s5.planetId, s5.shipsSent], [true, 'given', 301170, 1]);
  // unresolvable: no fleetAjax request at all, a clear error + suggestion
  const before = env.server.find('GET', 'fleetAjax').length;
  const s6 = await send({ mission: 6, galaxy: 2, system: 99, position: 4 });
  assert.equal(s6.success, false);
  assert.equal(s6.unresolved, true);
  assert.equal(s6.shipsSent, 0);
  assert.ok(/2:99:4/.test(s6.message) && /галактик/i.test(s6.suggestion), JSON.stringify(s6));
  assert.equal(env.server.find('GET', 'fleetAjax').length, before);
  assert.equal(env.server.find('GET', 'galaxy').length, 0, 'never a galaxy view');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M7 highscore / search / playerCard on GALAXYZ [UPSTREAM]: requests, OgameX-compatible shapes, errors never silent', async () => {
  const env = await G.launch();
  const stats = { 1: specFix('galaxy-upstream-statistics-players.html'), 2: specFix('galaxy-upstream-statistics-alliances.html') };
  let statsBroken = false;
  env.server.route('GET', 'statistics', (req, res, ctx) => (statsBroken ? ctx.sendPage('overview') : ctx.send(200, ctx.rewrite(stats[ctx.query.who === '2' ? 2 : 1]))));
  env.server.route('GET', 'playerCard', (req, res, ctx) => ctx.send(200, specFix('galaxy-upstream-playercard.html')));
  env.server.route('GET', 'search', (req, res, ctx) => ctx.send(200, specFix(/^ally/.test(ctx.query.type) ? 'galaxy-upstream-search-alliances.html' : 'galaxy-upstream-search-players.html')));
  const p = await env.game('overview');
  env.server.clearLog();
  const r = await env.evalOgx(p, async () => {
    const html = await OGX.api.highscore({ category: 1, type: 0, page: 2, background: true });
    const hs = OGX.parse.highscorePlayers(html);
    const top = OGX.parse.topScore(html);
    const fleetHtml = await OGX.api.highscore({ category: 1, type: 3 });
    const fleet = OGX.parse.highscorePlayers(fleetHtml);
    const allyHtml = await OGX.api.highscore({ category: 2, type: 0 });
    const ally = OGX.parse.highscorePlayers(allyHtml);
    const allyStats = OGX.parse.gz.statistics(allyHtml);
    const cardHtml = await OGX.api.highscore({ category: 1, type: 0, searchRelId: 3843 });
    const card = OGX.parse.highscorePlayers(cardHtml);
    const card2 = await OGX.api.playerCard(3843);
    const sp = await OGX.api.search('o', 2);
    const spl = await OGX.api.search('Castle', 3);
    const sa = await OGX.api.search('Nova', 4);
    const empty = await OGX.api.search('  ', 2);
    return { typeofHtml: typeof html, hs: { type: hs.type, gzType: hs.gzType, page: hs.page, pages: hs.pages, source: hs.source, engine: hs.engine, n: hs.rows.length, first: hs.rows[0], me: hs.rows.find((x) => x.me), error: hs.error || null },
      top, fleet: [fleet.type, fleet.gzType], ally: [ally.rows.length, !!ally.error], allyStats: [allyStats.who, allyStats.rows[0]],
      card: { source: card.source, rows: card.rows.map((x) => [x.id, x.rank, x.name, x.points, x.homeCoords, x.allianceId, x.allianceName]), error: card.error || null },
      card2: [card2.id, card2.points.total, card2.ranks.fleet, card2.fights.won],
      sp: [sp.status, sp.results[0]], spl: [spl.status, spl.results[0]], sa: [sa.status, sa.results[0]], empty: [empty.status, empty.results.length] };
  });
  assert.equal(r.typeofHtml, 'string');
  assert.deepEqual(r.hs.first, { id: 3843, rank: 1, name: 'Jon Snow', me: false, admin: false, homeCoords: null, allianceId: 12, allianceName: 'Nova Collective', points: 1834221, totalShips: null, change: 0 });
  assert.equal(r.hs.me.id, 4377);
  assert.equal(r.hs.me.name, 'vodoleyko1992');
  assert.deepEqual([r.hs.type, r.hs.gzType, r.hs.page, r.hs.source, r.hs.engine, r.hs.error], [0, 1, 1, 'statistics', 'galaxyz', null]);
  assert.ok(r.hs.pages >= 1 && r.hs.n >= 5);
  assert.deepEqual(r.top, { playerId: 3843, rank: 1, points: 1834221 });
  assert.deepEqual(r.ally, [0, true], 'an alliance page is not a silent empty player list');
  assert.equal(r.allyStats[0], 2);
  assert.deepEqual([r.allyStats[1].kind, r.allyStats[1].id, r.allyStats[1].name, r.allyStats[1].members], ['alliance', 12, 'Nova Collective', 8]);
  assert.deepEqual(r.card, { source: 'playerCard', rows: [[3843, 1, 'Jon Snow', 1834221, '2:70:9', 12, 'Nova Collective']], error: null });
  assert.deepEqual(r.card2, [3843, 1834221, 1, { count: 42, pct: 84 }]);
  assert.deepEqual(r.sp, ['success', { id: 3843, type: 'player', name: 'Jon Snow', owner_id: 3843, owner_name: 'Jon Snow', coordinates: '2:70:9', planetName: 'Castle Black', allianceId: 12, allianceName: 'Nova Collective', rank: 1 }]);
  assert.deepEqual(r.spl, ['success', { id: null, type: 'planet', name: 'Castle Black', owner_id: 3843, owner_name: 'Jon Snow', coordinates: '2:70:9', rank: 1 }]);
  assert.equal(r.sa[0], 'success');
  assert.equal(r.sa[1].type, 'alliance');
  assert.deepEqual(r.empty, ['error', 0]);
  // the requests: GET page=statistics who/type/range (type 3 OgameX military -> 2 fleet), page=playerCard&id, page=search&mode=result
  const st = env.server.find('GET', 'statistics').map((x) => [x.query.who, x.query.type, x.query.range, x.cp]);
  assert.deepEqual(st, [['1', '1', '101', null], ['1', '2', '1', null], ['2', '1', '1', null]]);
  assert.deepEqual(env.server.find('GET', 'playerCard').map((x) => x.query.id), ['3843', '3843']);
  assert.deepEqual(env.server.find('GET', 'search').map((x) => [x.query.mode, x.query.ajax, x.query.type, x.query.search]),
    [['result', '1', 'playername', 'o'], ['result', '1', 'planetname', 'Castle'], ['result', '1', 'allyname', 'Nova']]);
  assert.equal(env.server.requests.filter((x) => x.method !== 'GET').length, 0);
  // state.ensureTopScore works on GALAXYZ (free background GET page=statistics); indexHighscore keeps a galaxy-learned alliance TAG
  env.server.clearLog();
  const ts = await env.evalOgx(p, async () => {
    const S = { scope: 'server' };
    await OGX.storage.set('topScore', null, S);
    await OGX.storage.set('galaxy.players', { 3843: { id: 3843, name: 'Jon Snow', allianceId: 12, allianceTag: 'NOVA', planets: [] } }, S);
    const top = await OGX.state.ensureTopScore();
    const e = (await OGX.storage.get('galaxy.players', {}, S))[3843];
    return { top: top && [top.playerId, top.points], e: [e.allianceId, e.allianceTag, e.allianceName, e.points, e.rank] };
  });
  assert.deepEqual(ts.top, [3843, 1834221]);
  assert.deepEqual(ts.e, [12, 'NOVA', 'Nova Collective', 1834221, 1]);
  assert.deepEqual(env.server.find('GET', 'statistics').map((x) => [x.query.who, x.query.type, x.query.range, x.cp]), [['1', '1', '1', null]]);
  // a page without the ranking table: rows [] + error
  statsBroken = true;
  const b = await env.evalOgx(p, async () => { const h = await OGX.api.highscore({}); const x = OGX.parse.highscorePlayers(h); return [x.rows.length, x.error, x.engine, OGX.parse.topScore(h)]; });
  assert.equal(b[0], 0);
  assert.ok(typeof b[1] === 'string' && b[1].length > 0, 'error text');
  assert.deepEqual([b[2], b[3]], ['galaxyz', null]);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M13 vacation from the topnav infobox; M18 diaglib header for an empty allow-list', async () => {
  const env = await G.launch();
  const p = await env.game('overview');
  const r = await env.evalOgx(p, async () => {
    const html = document.documentElement.outerHTML;
    const D = (h) => new DOMParser().parseFromString(h, 'text/html');
    // vacation [UPSTREAM main.topnav.tpl]: no topnav <script> block (no `var vacation`), an infobox after the topnav
    const vac = html.replace(/var\s+vacation\s*=\s*\d+;/, '').replace(/<\/body>/i, '<div class="infobox">Now you\'re in vacation mode 05. Nov 2026, 10:00:00</div></body>');
    const vacRu = html.replace(/var\s+vacation\s*=\s*\d+;/, '').replace(/<\/body>/i, '<div class="infobox">Вы будете находиться в режиме отпуска по крайней мере до 05. Nov 2026, 10:00:00</div></body>');
    const varOnly = html.replace(/var\s+vacation\s*=\s*\d+;/, 'var vacation = 1;');
    const g = OGX.parse.gz;
    return {
      real: g.vacation(document), realPlayer: [g.player(document).vacation, OGX.parse.player(document).vacation],
      vac: g.vacation(D(vac)), vacPlayer: [g.player(D(vac)).vacation, g.player(D(vac)).vacationUntil, OGX.parse.player(D(vac)).vacation],
      ru: g.vacation(D(vacRu)), varOnly: g.vacation(D(varOnly)),
      header: OGX.diaglib.headerLines({ allowHosts: [] }, []).find((l) => l.startsWith('Серверы (allow-list):')),
      header2: OGX.diaglib.headerLines({ allowHosts: ['ogamex.eu'], host: 'ogamex.eu' }, []).find((l) => l.startsWith('Серверы (allow-list):')),
    };
  });
  assert.deepEqual(r.real, { vacation: false, until: null, source: 'var' });
  assert.deepEqual(r.realPlayer, [false, false]);
  assert.deepEqual(r.vac, { vacation: true, until: '05. Nov 2026, 10:00:00', source: 'infobox' });
  assert.deepEqual(r.vacPlayer, [true, '05. Nov 2026, 10:00:00', true]);
  assert.deepEqual(r.ru, { vacation: true, until: '05. Nov 2026, 10:00:00', source: 'infobox' });
  assert.deepEqual(r.varOnly, { vacation: true, until: null, source: 'var' });
  assert.equal(r.header, 'Серверы (allow-list): список пуст — работает на всех игровых страницах (GALAXYZ/2Moons и OgameX)');
  assert.ok(!/OgameX \(список пуст\)/.test(r.header));
  assert.equal(r.header2, 'Серверы (allow-list): ogamex.eu');
  assert.deepEqual(env.ogxErrors(), []);
});

// review fix: the TXT export («Логи для разбора») names the GALAXYZ context in its header: engine + version, universe, page,
// resource speed x22000, fleet speed; GALAXYZ has no classes, so no English 'none' placeholder.
T.test('M18 diag export header on GALAXYZ: engine, version, universe, page, x22000, no «класс none»', async () => {
  const env = await G.launch();
  for (const n of ['overview', 'fleetTable']) { const q = await env.openSaved(n); await q.waitForTimeout(800); await q.close(); }
  const p = await env.game('overview');
  await p.waitForTimeout(800);
  const r = await env.evalOgx(p, async () => {
    const ctx = await OGX.diag.context();
    return { ctx: { engine: ctx.engine, universe: ctx.universe, gzPage: ctx.gzPage, resourceMultiplier: ctx.resourceMultiplier, engineVersion: ctx.engineVersion },
      header: OGX.diaglib.headerLines(ctx, []).join('\n') };
  });
  assert.equal(r.ctx.engine, 'galaxyz');
  assert.equal(r.ctx.universe, 'Aeternum');
  assert.equal(r.ctx.resourceMultiplier, 22000);
  assert.match(r.header, /Движок: GALAXYZ 1\.8\S*\s+вселенная Aeternum\s+страница overview\s+добыча ресурсов x22000\s+скорость флота x7/);
  assert.match(r.header, /Игрок: id \S+\s+класс нет \(в GALAXYZ классов нет\)/);
  assert.ok(!/класс none/.test(r.header), r.header);
  assert.deepEqual(env.ogxErrors(), []);
  await env.close();
});
