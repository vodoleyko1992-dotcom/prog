'use strict';
// GALAXYZ galaxy + messages (core 17-galaxy.js, 18-exptexts-data.js, 19-messages.js).
//   REAL pages (scratchpad/eu/pages): galaxy (own system 2:68), tournament, messages-spy / messages-all (two real spy reports).
//   INFERRED / UPSTREAM fixtures (specs/galaxyz/fixtures): the synthetic foreign galaxy rows, "not enough deuterium", the
//   2Moons-rendered message lists (combat, expedition, transport, return), the page=raport popup. The canonical recipe output
//   (fixtures/messages-expected-parse.json) is the oracle for the verbatim port.
// Plain Chromium: page hook at document_start, core files evaluated in order, OGX.boot without modules (localStorage storage).
//   node tests/gz-galaxy.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const T = require('./lib');
const { assert } = T;

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'shared');
const PAGES = process.env.OGX_GZ_PAGES || path.resolve(ROOT, '..', 'eu', 'pages');
const FIX = path.join(ROOT, 'specs', 'galaxyz', 'fixtures');
const coreFiles = fs.readdirSync(path.join(SHARED, 'core')).filter((f) => /^\d\d-.*\.js$/.test(f)).sort().map((f) => path.join(SHARED, 'core', f));
const hookSrc = fs.readFileSync(path.join(SHARED, 'main', 'page-hook.js'), 'utf8');
const strip = (html) => html.replace(/<meta http-equiv="refresh"[^>]*>/i, '');
const realPage = (name) => strip(fs.readFileSync(path.join(PAGES, name + '.html'), 'utf8'));
const fixture = (name) => strip(fs.readFileSync(path.join(FIX, name), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'messages-expected-parse.json'), 'utf8'));

/** /Aeternum/game.php?page=..: GET = saved page (`_f` = real page name, `_fx` = spec fixture file); `answers` override; `gets` recorded. */
function startServer() {
  const gets = [];
  const answers = {};
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    req.on('data', () => {});
    req.on('end', () => {
      const send = (code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=UTF-8' }); res.end(html); };
      if (u.pathname !== '/Aeternum/game.php') return send(404, 'not found');
      const pg = u.searchParams.get('page') || 'overview';
      const key = req.method + ' ' + pg;
      if (req.method === 'GET') gets.push(u.search);
      if (answers[key]) return send(200, typeof answers[key] === 'function' ? answers[key](u) : answers[key]);
      const fx = u.searchParams.get('_fx');
      if (fx) return send(200, fixture(path.basename(fx)));
      const name = path.basename(u.searchParams.get('_f') || pg + (u.searchParams.get('mode') ? '-' + u.searchParams.get('mode') : ''));
      if (!fs.existsSync(path.join(PAGES, name + '.html'))) return send(404, 'no page ' + name);
      send(200, realPage(name));
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, gets, answers, base: 'http://127.0.0.1:' + srv.address().port })));
}

async function launch() {
  const server = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript({ content: hookSrc });
  await context.route('**/*', (route) => (route.request().url().startsWith(server.base) ? route.continue() : route.fulfill({ status: 404, body: '' })));
  const errors = [];
  const open = async (query, { boot = true } = {}) => {
    const p = await context.newPage();
    p.on('pageerror', (e) => { if (/ogx:\/\//.test(e.stack || '')) errors.push(String(e.message)); });
    await p.goto(server.base + '/Aeternum/game.php?' + query, { waitUntil: 'domcontentloaded' });
    for (const f of coreFiles) {
      await p.evaluate(([src, name]) => { (0, eval)(src + '\n//# sourceURL=ogx://' + name); }, [fs.readFileSync(f, 'utf8'), path.basename(f)]);
    }
    if (boot) {
      await p.evaluate(async () => { await OGX.boot({ ext: 'suite', modules: [] }); await OGX.storage.flush(); });
      await p.waitForTimeout(300);   // galaxy.init stores asynchronously
      await p.evaluate(() => OGX.storage.flush());
    }
    return p;
  };
  const close = async () => { await browser.close(); server.srv.close(); };
  const ogxErrors = (p) => p.evaluate(() => OGX.errors.map((e) => e.where + ': ' + e.message));
  return { server, open, close, errors, ogxErrors };
}

// ====================================================================================================== galaxy

T.test('REAL galaxy 2:68: header, own rows with ids from the planet list, free slots, cache, player index, slots', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=galaxy');
    const r = await p.evaluate(async () => {
      const sys = OGX.galaxy.parseGz(document);
      const cached = await OGX.galaxy.cached(2, 68);
      const me = await OGX.galaxy.player('vodoleyko1992');
      let render = null;
      const off = OGX.bus.on('galaxy:render', (ev) => { render = { g: ev.galaxy, s: ev.system, n: ev.rows.size, row5: ev.rows.get(5) && ev.rows.get(5).tagName }; });
      await OGX.galaxy.init();
      off();
      const rows = OGX.galaxy._rowsMap();
      const s5 = OGX.galaxy.rowSlot(rows.get(5), 'test');
      const s1 = OGX.galaxy.rowSlot(rows.get(1), 'test');
      const again = OGX.galaxy.rowSlot(rows.get(5), 'test');
      const hs = OGX.galaxy.headerSlot('test');
      return {
        engine: OGX.page.engine, isGalaxy: OGX.page.is('galaxy'), current: OGX.galaxy.current(), me: sys.me, head: OGX.galaxy.gz.header(document),
        colonized: sys.colonized, existing: sys.existingPlanets, positions: sys.positions, free: sys.free,
        cachedPos: cached && cached.positions.map((x) => [x.position, x.planetId, x.own, x.activity]), cachedFree: cached && cached.free.length, cachedEngine: cached && cached.engine,
        mePlanets: me && me.planets.map((x) => [x.coords, x.planetId]), meKey: me && me.id, meRank: me && me.rank,
        render, slot5Parent: s5.parentElement.className, slot1Parent: s1.parentElement.tagName + ':' + (s1.parentElement.className || ''), same: s5 === again,
        headerParent: hs && hs.parentElement.parentElement.className, cells5: rows.get(5).children.length,
      };
    });
    assert.equal(r.engine, 'galaxyz');
    assert.ok(r.isGalaxy);
    assert.deepEqual(r.current, { galaxy: 2, system: 68 });
    assert.deepEqual(r.head, { galaxy: 2, system: 68, probes: 102, recyclers: 0, gigaRecyclers: 0, missiles: 0, slotsUsed: 1, slotsMax: 13, existingPlanets: 1 });
    assert.deepEqual([r.me.playerName, r.me.currentPlanetId, r.me.probes, r.me.usedSlots, r.me.maxSlots], ['vodoleyko1992', 254102, 102, 1, 13]);
    assert.equal(r.colonized, 4, 'occupied rows, not "(1 Existing planets)"');
    assert.equal(r.existing, 1);
    assert.deepEqual(r.positions.map((x) => [x.position, x.coords, x.planetId, x.planetName, x.activity, x.playerName, x.playerId, x.own, x.rank, x.status, x.missions.join()]), [
      [5, '2:68:5', 254102, 'Главная планета', '*', 'vodoleyko1992', null, true, 194, '', '4,3'],
      [6, '2:68:6', 254103, 'Colony', 49, 'vodoleyko1992', null, true, 194, '', '4,3'],
      [7, '2:68:7', 254104, 'Colony', 49, 'vodoleyko1992', null, true, 194, '', '4,3'],
      [8, '2:68:8', 254105, 'Colony', 50, 'vodoleyko1992', null, true, 194, '', '4,3'],
    ]);
    for (const x of r.positions) assert.deepEqual([x.moon, x.debris, x.allianceTag, x.destroyed], [null, null, null, false]);
    assert.equal(r.free.length, 11);
    assert.deepEqual(r.free[0], { position: 1, fieldsMin: 215, fieldsMax: 244, tempMin: 220, tempMax: 260 });
    assert.ok(r.free.every((f) => Number.isFinite(f.fieldsMin) && Number.isFinite(f.tempMax)), 'every free slot has the colonisation hint');
    assert.deepEqual(r.cachedPos, [[5, 254102, true, '*'], [6, 254103, true, 49], [7, 254104, true, 49], [8, 254105, true, 50]]);
    assert.deepEqual([r.cachedFree, r.cachedEngine], [11, 'galaxyz']);
    assert.deepEqual(r.mePlanets, [['2:68:5', 254102], ['2:68:6', 254103], ['2:68:7', 254104], ['2:68:8', 254105]]);
    assert.deepEqual([r.meKey, r.meRank], [null, 194]);
    assert.deepEqual(r.render, { g: 2, s: 68, n: 15, row5: 'TR' });
    assert.equal(r.slot5Parent, 'action', 'no <td> added: slot inside td.action');
    assert.equal(r.slot1Parent, 'TD:', 'free row: slot inside the last cell');
    assert.ok(r.same);
    assert.equal(r.cells5, 11);
    assert.ok(/info_header/.test(r.headerParent));
    assert.deepEqual(await env.ogxErrors(p), []);
    assert.deepEqual(env.errors, []);
  } finally { await env.close(); }
});

T.test('INFERRED foreign rows: ids, moon, debris, alliance, flags -> status letters, activity', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=galaxy&_fx=galaxy-live-synthetic-system.html');
    const r = await p.evaluate(() => OGX.galaxy.parseGz(document).positions);
    const by = Object.fromEntries(r.map((x) => [x.position, x]));
    const a = by[1];
    assert.deepEqual([a.playerId, a.playerName, a.planetId, a.planetName, a.activity, a.rank, a.own, a.status], [3837, 'Flor', 301120, 'Arrakis', '*', 12, false, '']);
    assert.deepEqual(a.moon, { id: 301121, name: 'Mond', size: 8944, destroyed: false, activity: null });
    assert.deepEqual(a.debris, { metal: 120000, crystal: 45000, deuterium: 0, requiredShips: null });
    assert.deepEqual([a.allianceId, a.allianceTag, a.allianceName, a.allianceRelation], [7, 'AET', 'Aeternum Guard', 'friend']);
    assert.deepEqual([a.canPhalanx, a.canMissile, a.missions.join()], [true, true, '6,1,5,3']);
    assert.deepEqual([by[2].status, by[2].activity, by[2].debris.metal, by[2].playerId], ['i', 37, 3400, 3839]);
    assert.deepEqual([by[3].status, by[3].allianceTag, by[3].allianceRelation, by[3].allianceId], ['v', 'NW', 'enemy', 19]);
    assert.equal(by[4].status, 'bv');
    // rows without tooltips: ids from the action cell (doit / Dialog.PM)
    assert.deepEqual([by[9].status, by[9].playerId, by[9].planetId, by[9].activity], ['n', 4359, 301180, 23]);
    assert.deepEqual([by[10].status, by[10].planetName, !!by[10].moon, !!by[10].debris, by[10].allianceTag, by[10].allianceRelation], ['s', "King's Landing", true, true, 'NOVA', 'member']);
    assert.deepEqual([by[10].moon.id, by[10].debris.metal], [301191, 9800000]);
    assert.equal(by[11].status, 'I', 'longinactive wins over inactive');
    assert.deepEqual([by[5].own, by[5].planetId], [true, 254102]);
    assert.deepEqual(await env.ogxErrors(p), []);
  } finally { await env.close(); }
});

T.test('galaxy.fetch: GET page=galaxy without cp, stored, galaxy:system scan event; deuterium error; tournament merges the id', async () => {
  const env = await launch();
  try {
    env.server.answers['GET galaxy'] = (u) => (u.searchParams.get('system') === '99' ? fixture('galaxy-upstream-nodeuterium.html') : fixture('galaxy-live-synthetic-system.html'));
    const p = await env.open('page=overview');
    const r = await p.evaluate(async () => {
      let ev = null;
      const off = OGX.bus.on('galaxy:system', (e) => { ev = { source: e.source, g: e.system.galaxy, n: e.system.positions.length }; });
      const sys = await OGX.galaxy.fetch(2, 68, { background: false, userStarted: true });
      off();
      const bad = await OGX.galaxy.fetch(2, 99, { background: false, userStarted: true });
      await OGX.storage.flush();
      const flor = await OGX.galaxy.player(3837);
      const me = await OGX.galaxy.player('vodoleyko1992');
      const scan = await OGX.galaxy.scan([[2, 68], [2, 99], [2, 70]], { delayMs: 0, jitterMs: 0, userStarted: true });
      return { n: sys.positions && sys.positions.length, ev, bad, flor: flor && [flor.id, flor.name, flor.allianceTag, flor.planets.map((x) => [x.coords, x.planetId, x.moonId])],
        me: me && [me.id, me.planets.length], scan };
    });
    assert.equal(r.n, 11);
    assert.deepEqual(r.ev, { source: 'scan', g: 2, n: 11 });
    assert.deepEqual([r.bad.stoppedBy, r.bad.error], ['deuterium', 'You dont have enough deuterium to view the galaxy']);
    assert.deepEqual(r.flor, [3837, 'Flor', 'AET', [['2:68:1', 301120, 301121]]]);
    assert.deepEqual(r.me, [null, 4]);
    assert.deepEqual(r.scan, { done: 1, stoppedBy: 'deuterium' }, 'the scan stops on the first error');
    const views = env.server.gets.filter((q) => /page=galaxy/.test(q));
    assert.equal(views.length, 4, 'fetch x2 + scan x2 (stopped at 2:99)');
    assert.ok(views.every((q) => !/[?&]cp=/.test(q)), 'never switches the planet');
    assert.ok(/galaxy=2/.test(views[0]) && /system=68/.test(views[0]));
    // tournament: id <-> name; the name-keyed own entry moves under the id with its planets
    const t = await env.open('page=tournament');
    const tr = await t.evaluate(async () => {
      await OGX.storage.flush();
      const idx = await OGX.storage.get('galaxy.players', {}, { scope: 'server' });
      const tour = OGX.galaxy.gz.tournament(document);
      return { me: idx['4377'] && [idx['4377'].name, idx['4377'].planets.length], nameKey: !!idx['n:vodoleyko1992'], terror: idx['4359'] && idx['4359'].name,
        boards: tour.boards.map((b) => [b.tab, b.rows.length]), ends: tour.endsInSec, byName: (await OGX.galaxy.player('vodoleyko1992') || {}).id };
    });
    assert.deepEqual(tr.me, ['vodoleyko1992', 4]);
    assert.equal(tr.nameKey, false);
    assert.equal(tr.terror, 'terror');
    assert.equal(tr.byName, 4377);
    assert.equal(tr.ends, 178960);
    assert.deepEqual(tr.boards.map((b) => b[0]), ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);
    assert.ok(tr.boards.every((b) => b[1] === 15));
    assert.deepEqual(await env.ogxErrors(p), []);
  } finally { await env.close(); }
});

// ====================================================================================================== messages

T.test('REAL messages-spy: list, keys, exact spy values from the Simulate link, categories, badge, watch', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=messages&_f=messages-spy');
    const r = await p.evaluate(async () => {
      const items = OGX.messages.parse.list(document);
      const full = items.map((it) => OGX.messages.parse.espionageFull(it));
      const short = OGX.messages.parse.espionageShort(items[0].li);
      const watched = [];
      const off = OGX.messages.watch((it) => watched.push([it.id, it.tab, it.subtab, it.isNew, !!it.body]));
      off();
      return {
        meta: [items.page, items.totalPages, items.cat],
        rows: items.map((it) => [it.id, it.key, it.kind, it.isNew, it.sender, it.title, it.date, it.ts === OGX.time.parseGameDate(it.date), it.li && it.li.id]),
        classify: items.map((it) => OGX.messages.classify(it.li, 0)),
        full, short: [short.id, short.resourcesApprox.metal, short.total, short.detailsUrl],
        docFull: OGX.messages.parse.espionageFull(document).id,
        cats: OGX.messages.gz.categories(document).map((c) => c.cat + ':' + c.unread + '/' + c.total).join(' '),
        badge: OGX.messages.gz.headerUnread(document), watched,
      };
    });
    assert.deepEqual(r.meta, [1, 1, 0]);
    assert.deepEqual(r.rows, [
      [520244, 'espionage_report', 'spy_report', true, 'Spying department', 'Intelligence report', '30. Oct 2026, 09:53:36', true, 'message_520244'],
      [520242, 'espionage_report', 'spy_report', true, 'Spying department', 'Intelligence report', '30. Oct 2026, 09:53:20', true, 'message_520242'],
    ]);
    assert.deepEqual(r.classify, ['espionage_report', 'espionage_report']);
    const [a, b] = r.full;
    assert.equal(a.id, 520244);
    assert.deepEqual(a.target, { coords: [2, 81, 10], coordsStr: '2:81:10', type: 'planet', planetType: 1, name: '2 bolygó' });
    assert.deepEqual(a.attackParams, { galaxy: 2, system: 81, position: 10, type: 1 });
    assert.deepEqual(a.resources, { metal: 2684939750000, crystal: 1700557697522, deuterium: 675144412230, energy: 356568 }, 'rounded Simulate floats = shown cells');
    assert.equal(Object.keys(a.ships).length, 19);
    assert.ok(Object.values(a.ships).every((n) => n === 0));
    assert.deepEqual(a.known, { ships: true, defense: false, buildings: false, research: false });
    assert.deepEqual([a.counterEspionage, a.probesDestroyed, a.exact, a.player, a.debris, a.date], [0, false, true, null, null, '30. Oct 2026, 09:53:36']);
    assert.equal(a.reportDate, '30. Oct 2026, 08:53:44', 'title time = another clock, kept apart');
    assert.deepEqual([b.id, b.resources, b.ships, b.known.ships], [520242, { metal: 11483000000, crystal: 11483000000, deuterium: 6263925000, energy: 3391 }, {}, false]);
    assert.deepEqual(r.short, [520244, 2684939750000, 2684939750000 + 1700557697522 + 675144412230, null]);
    assert.equal(r.docFull, 520244);
    assert.equal(r.cats, '0:0/2 1:0/0 2:0/0 3:0/0 4:0/0 5:0/0 15:0/0 50:0/0 99:0/0 100:0/2 999:0/0');
    assert.equal(r.badge, 2);
    assert.deepEqual(r.watched, [[520244, 'fleets', 'espionage', true, true], [520242, 'fleets', 'espionage', true, true]]);
    // messages-all: category 100, read now; the empty old form below is ignored
    const q = await env.open('page=messages&_f=messages-all');
    const all = await q.evaluate(() => { const it = OGX.messages.parse.list(document); return [it.cat, it.map((x) => [x.id, x.isNew, x.key])]; });
    assert.deepEqual(all, [100, [[520244, false, 'espionage_report'], [520242, false, 'espionage_report']]]);
    assert.deepEqual(await env.ogxErrors(p), []);
    assert.deepEqual(env.errors, []);
  } finally { await env.close(); }
});

T.test('fetchList: mode=view fragment for messcat (OgameX subtab names map), never with cp', async () => {
  const env = await launch();
  try {
    const html = realPage('messages-spy');
    const frag = html.slice(html.indexOf('<form', html.indexOf('hard-table')), html.indexOf('</form>', html.indexOf('messagestable')) + 7);
    env.server.answers['GET messages'] = (u) => (u.searchParams.get('mode') === 'view' ? frag : html);
    const p = await env.open('page=overview');
    const r = await p.evaluate(async () => {
      const a = await OGX.messages.fetchList('fleets', 'espionage', 1, { background: false });
      const b = await OGX.messages.fetchList(15, null, 2, { background: false });
      return { a: [a.cat, a.page, a.items.map((x) => [x.id, x.item.key])], b: b.cat };
    });
    assert.deepEqual(r.a, [0, 1, [[520244, 'espionage_report'], [520242, 'espionage_report']]]);
    const views = env.server.gets.filter((q) => /mode=view/.test(q));
    assert.equal(views.length, 2);
    assert.ok(/messcat=0/.test(views[0]) && /site=1/.test(views[0]) && /ajax=1/.test(views[0]));
    assert.ok(/messcat=15/.test(views[1]) && /site=2/.test(views[1]));
    assert.ok(views.every((q) => !/[?&]cp=/.test(q)));
  } finally { await env.close(); }
});

/** Runs the ported recipe on a fixture loaded as the page (no boot) and compares with the canonical recipe output. */
async function recipeMatches(env, file) {
  const p = await env.open('page=messages&_fx=' + file, { boot: false });
  const got = await p.evaluate(() => {
    const G = OGX.messages.gz;
    const l = G.list(document);
    if (l) return { kind: 'list', cat: l.cat, page: l.page, pages: l.pages, items: l.items.map((it) => G.parseItem(it, l.cat)) };
    return { kind: 'raport', r: G.combatReport(document) };
  });
  const want = expected[file].live;
  if (got.kind === 'list') {
    assert.deepEqual({ cat: got.cat, page: got.page, pages: got.pages }, { cat: want.list.cat, page: want.list.page, pages: want.list.pages }, file);
    assert.deepEqual(JSON.parse(JSON.stringify(got.items)), want.list.items, file);
  } else {
    assert.deepEqual(JSON.parse(JSON.stringify(got.r)), want, file);
  }
  await p.close();
}

T.test('verbatim recipe port: REAL + UPSTREAM fixtures equal messages-expected-parse.json', async () => {
  const env = await launch();
  try {
    const files = ['messages-real-spy.html', 'messages-real-all.html', 'messages-upstream-view-100-p2.html', 'messages-upstream-view-cat0.html',
      'messages-upstream-view-cat3.html', 'messages-upstream-view-cat4.html', 'messages-upstream-view-cat5.html', 'messages-upstream-view-cat15.html',
      'messages-upstream-view-cat99.html', 'messages-upstream-view-999.html', 'messages-live-synthetic-cat15.html', 'messages-live-synthetic-cat3.html',
      'messages-live-synthetic-cat4.html', 'messages-live-synthetic-cat5.html', 'messages-upstream-raport.html', 'messages-upstream-raport-defender-won.html'];
    for (const f of files) await recipeMatches(env, f);
  } finally { await env.close(); }
});

T.test('spy values = the shown cells (PHP sprintf %.0f: rounded, exact .5 ties to even) on every spy report fixture', async () => {
  const env = await launch();
  try {
    let n = 0;
    for (const f of ['messages-real-spy.html', 'messages-upstream-view-cat0.html', 'messages-upstream-view-100-p2.html']) {
      const p = await env.open('page=messages&_fx=' + f, { boot: false });
      const bad = await p.evaluate(() => {
        const out = [];
        let n = 0;
        for (const sr of document.querySelectorAll('.spyRaport')) {
          const parsed = OGX.messages.gz.spyReport(sr);
          if (!parsed || !parsed.exact || !parsed.resources) continue;
          const cells = [...sr.querySelectorAll('.spyRaportContainerHeadClass900')].map((h) => h.closest('.spyRaportContainer'))[0];
          const own = [...cells.querySelectorAll('.spyRaportContainerCell')].filter((x) => x.closest('.spyRaportContainer') === cells);
          const shown = [];
          for (let i = 1; i < own.length; i += 2) shown.push(parseInt(own[i].textContent.replace(/[^\d-]/g, ''), 10));
          const got = Object.values(parsed.resources);
          n++;
          if (JSON.stringify(got) !== JSON.stringify(shown)) out.push([got, shown]);
        }
        return { out, n };
      });
      assert.deepEqual(bad.out, [], f);
      n += bad.n;
      await p.close();
    }
    assert.ok(n >= 4, 'spy reports checked: ' + n);
  } finally { await env.close(); }
});

T.test('UPSTREAM (unverified) shapes: combat message, page=raport, expedition keys, transport / return / recycle texts', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=messages&_fx=messages-upstream-view-100-p2.html', { boot: false });
    const r = await p.evaluate(() => {
      const M = OGX.messages;
      const items = M.parse.list(document);
      const by = Object.fromEntries(items.map((it) => [it.id, it]));
      const combat = items.find((it) => it.kind === 'combat');
      return {
        keys: items.map((it) => it.id + ':' + it.key),
        combat: M.parse.battleShort(combat.li),
        transport: M.parse.fleetMessage(by[530080].li), received: M.parse.fleetMessage(by[530079].li), ret: M.parse.fleetMessage(by[530090].li),
        recycle: M.parse.fleetMessage(by[530085].li), back: M.parse.fleetMessage(by[530067].li),
        exp: M.parse.expedition(by[530069].li), detected: M.parse.espionageDetected(by[530101].li),
        place: M.parse.placeLink(by[530080].body.querySelector('a[href*="page=galaxy"]')),
      };
    });
    const keys = Object.fromEntries(r.keys.map((k) => k.split(':')));
    assert.deepEqual([keys[530101], keys[530090], keys[530085], keys[530080], keys[530079], keys[530075], keys[530070], keys[530069], keys[530068], keys[530067], keys[530055]],
      ['espionage_detected', 'return_of_fleet_with_resources', 'debris_field_harvest', 'transport_arrived', 'transport_received', 'return_of_fleet',
        'expedition_gain_resources', 'expedition_gain_ships', 'expedition_failed', 'return_of_fleet_with_resources', 'fleet_deployment_with_resources']);
    const c = r.combat;
    assert.deepEqual([c.coords, c.defenderPlace.coords, c.winner, c.unverified, c.reportId.length], ['2:70:4', [2, 70, 4], 'attacker', true, 32]);
    assert.deepEqual(c.loot, { metal: 2261500000, crystal: 605250000, deuterium: 49000000 });
    assert.deepEqual(c.debris, { metal: 1374000, crystal: 1260000 });
    assert.deepEqual([c.attacker.losses, c.defender.losses], [12000, 4580000]);
    assert.ok(/page=raport&raport=/.test(c.detailsUrl));
    assert.deepEqual([r.transport.key, r.transport.to.coords, r.transport.resources], ['transport_arrived', [2, 68, 6], { metal: 7382, crystal: 0, deuterium: 0 }]);
    assert.deepEqual([r.received.from.coords, r.received.to.coords, r.received.resources.metal], [[2, 66, 7], [2, 68, 5], 1000000]);
    assert.deepEqual([r.ret.from.coords, r.ret.resources], [[2, 70, 4], { metal: 2261500000, crystal: 605250000, deuterium: 49000000 }]);
    assert.deepEqual([r.recycle.resources.metal, r.recycle.resources.crystal, r.recycle.to], [1374000, 1260000, null]);
    assert.deepEqual([r.back.kind, r.back.resources.metal, r.back.darkMatter], ['return_expedition', 812000, 0]);
    assert.deepEqual([r.exp.key, r.exp.outcome, r.exp.ships, r.exp.unverified], ['expedition_gain_ships', 'ships', { 202: 1200, 206: 35 }, true]);
    assert.deepEqual([r.detected.from.coords, r.detected.target.coords, r.detected.attackerName], [[2, 66, 7], [2, 68, 6], null]);
    assert.deepEqual(r.place, { coords: [2, 68, 6], coordsStr: '2:68:6', type: 'planet', planetType: 1, name: null });
    // page=raport popup
    const q = await env.open('page=raport&_fx=messages-upstream-raport.html', { boot: false });
    const f = await q.evaluate(() => OGX.messages.parse.battleFull(document));
    assert.deepEqual([f.winner, f.moonCreated, f.moonChance, f.unverified, f.date], ['attacker', true, 7, true, '30. Oct 2026, 08:54:00']);
    assert.deepEqual(f.loot, { metal: 12053668, crystal: 5251102, deuterium: 1825031 });
    assert.deepEqual(f.defenderPlanet.coords, [2, 70, 4]);
    assert.deepEqual(f.start.attacker, { 203: 400, 207: 150 });
    assert.deepEqual([f.attacker.name, f.defender.name, f.attacker.weapons], ['vodoleyko1992', 'Kovacs', 140]);
    assert.ok(f.unitsLost.defender && Object.keys(f.unitsLost.defender).length > 0);
    // expedition texts list (cat 15): outcome keys
    const e = await env.open('page=messages&_fx=messages-upstream-view-cat15.html', { boot: false });
    const ek = await e.evaluate(() => OGX.messages.parse.list(document).map((it) => it.key));
    assert.deepEqual(ek.slice(0, 7), ['expedition_gain_resources', 'expedition_gain_dark_matter', 'expedition_gain_ships', 'expedition_gain_ships',
      'expedition_failed', 'expedition_failed_and_delay', 'expedition_failed_and_speedup']);
  } finally { await env.close(); }
});

T.test('unknown markup never throws: garbage rows, empty docs, odd spy reports', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=messages&_f=messages-spy');
    const r = await p.evaluate(() => {
      const M = OGX.messages;
      const tr = document.createElement('tr'); tr.className = 'message_head'; tr.id = 'message_1';
      const junk = new DOMParser().parseFromString('<div class="spyRaport"><div class="spyRaportFooter">?</div></div><table id="messagestable"><tr class="message_head" id="message_x"><td></td></tr><tr class="messages_body"><td><b>??</b></td></tr></table>', 'text/html');
      const out = {};
      const run = (k, fn) => { try { out[k] = fn(); } catch (e) { out[k] = 'THREW ' + e.message; } };
      run('classify', () => M.classify(tr, 3));
      run('spyJunk', () => { const s = M.parse.espionageFull(junk); return s && [s.target, s.resources, s.known.ships]; });
      run('listJunk', () => M.parse.list(junk).length);
      run('battleShort', () => M.parse.battleShort(tr));
      run('fleet', () => M.parse.fleetMessage(tr));
      run('exp', () => M.parse.expedition(tr));
      run('detected', () => M.parse.espionageDetected(tr));
      run('raportEmpty', () => M.parse.battleFull(new DOMParser().parseFromString('<html><head><meta name="generator" content="GALAXYZ 1.8.git"></head><body class="popup"><div id="content"><table><tr><td><p>Invalid Battle Report ID</p></td></tr></table></div></body></html>', 'text/html')).error);
      run('gzListEmpty', () => M.gz.list(new DOMParser().parseFromString('', 'text/html')));
      run('galaxyEmpty', () => OGX.galaxy.parseGz(new DOMParser().parseFromString('<p>x</p>', 'text/html')));
      run('galaxyRowJunk', () => {
        const d = new DOMParser().parseFromString('<table id="galaxytableHead"><thead><tr><td><form id="galaxy_form"><input name="galaxy" value="1"><input name="system" value="2"></form></td></tr></thead><tbody><tr class="row"><td class="position">3</td><td class="microplanet1"><a title="&lt;b"></a></td><td class="planetname1"></td><td class="moon"><img></td><td class="debris"><a title="junk"></a></td></tr></tbody></table>', 'text/html');
        const s = OGX.galaxy.parseGz(d);
        return [s.galaxy, s.system, s.positions.length, s.positions[0].coords, s.positions[0].moon && s.positions[0].moon.id, s.positions[0].debris && s.positions[0].debris.metal];
      });
      return out;
    });
    for (const [k, v] of Object.entries(r)) assert.ok(!(typeof v === 'string' && v.startsWith('THREW')), k + ': ' + v);
    assert.equal(r.classify, 'unknown');
    assert.deepEqual(r.spyJunk, [null, null, false]);
    assert.equal(r.raportEmpty, 'Invalid Battle Report ID');
    assert.equal(r.gzListEmpty, null);
    assert.equal(r.galaxyEmpty, null);
    assert.deepEqual(r.galaxyRowJunk, [1, 2, 1, '1:2:3', null, null]);
  } finally { await env.close(); }
});

