'use strict';
// GALAXYZ flights + fleet (core 15-flights.js, 16-fleet.js) on the REAL saved pages of ogamex.eu/Aeternum (scratchpad/eu/pages):
// event box -> Flight[], fleetTable movement rows and recall ids, the three-step dispatch bodies (fleetStep1 -> 2 -> 3, token of
// the previous step), the step-3 result, recall, flight math, the native prefill. Plain Chromium: the page hook at document_start,
// the core files evaluated in order, OGX.boot without modules (storage falls back to localStorage). Nothing leaves 127.0.0.1.
//   node tests/gz-flights.test.js
//   OGX_GZ_PAGES=/path/to/pages node tests/gz-flights.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const T = require('./lib');
const { assert } = T;

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'shared');
const PAGES = process.env.OGX_GZ_PAGES || path.resolve(ROOT, '..', 'eu', 'pages');
const coreFiles = fs.readdirSync(path.join(SHARED, 'core')).filter((f) => /^\d\d-.*\.js$/.test(f)).sort().map((f) => path.join(SHARED, 'core', f));
const hookSrc = fs.readFileSync(path.join(SHARED, 'main', 'page-hook.js'), 'utf8');
const page = (name) => fs.readFileSync(path.join(PAGES, name + '.html'), 'utf8').replace(/<meta http-equiv="refresh"[^>]*>/i, '');

/** Serves /Aeternum/game.php?page=..: GET = the saved page, POST = the next page of the real flow; `answers` overrides, `posts` records. */
function startServer() {
  const posts = [];
  const answers = {};
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=UTF-8' }); res.end(html); };
      if (u.pathname !== '/Aeternum/game.php') return send(404, 'not found');
      const pg = u.searchParams.get('page') || 'overview';
      const key = req.method + ' ' + pg + (u.searchParams.get('action') ? '&action=' + u.searchParams.get('action') : '');
      if (req.method === 'POST') posts.push({ key, query: u.search, body });
      if (answers[key]) return send(200, typeof answers[key] === 'function' ? answers[key](u, body) : answers[key]);
      const name = u.searchParams.get('_f') || pg + (u.searchParams.get('mode') ? '-' + u.searchParams.get('mode') : '');
      const file = path.join(PAGES, path.basename(name) + '.html');
      if (!fs.existsSync(file)) return send(404, 'no page ' + name);
      send(200, page(path.basename(name)));
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, posts, answers, base: 'http://127.0.0.1:' + srv.address().port })));
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
    // the saved pages lack the game's scripts: its inline handlers (updateVars, calculateTransportCapacity) fire on our change events
    p.on('pageerror', (e) => { if (/ogx:\/\//.test(e.stack || '') && !/^(updateVars|calculateTransportCapacity|maxShip\w*) is not defined/.test(e.message)) errors.push(String(e.message)); });
    await p.goto(server.base + '/Aeternum/game.php?' + query, { waitUntil: 'domcontentloaded' });
    for (const f of coreFiles) {
      await p.evaluate(([src, name]) => { (0, eval)(src + '\n//# sourceURL=ogx://' + name); }, [fs.readFileSync(f, 'utf8'), path.basename(f)]);
    }
    if (boot) {
      await p.evaluate(async () => { await OGX.boot({ ext: 'suite', modules: [] }); await OGX.storage.flush(); });
      await p.waitForTimeout(300);   // flights.init stores asynchronously
    }
    return p;
  };
  const close = async () => { await browser.close(); server.srv.close(); };
  const ogxErrors = (p) => p.evaluate(() => OGX.errors.map((e) => e.where + ': ' + e.message));
  return { server, open, close, errors, ogxErrors };
}

const body = (s) => Object.fromEntries(new URLSearchParams(s));

T.test('overview event box -> stored flights: both legs, ids, times, ships, departure, body keys', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=overview');
    const r = await p.evaluate(async () => {
      await OGX.storage.flush();
      const st = await OGX.storage.get('flights', null);
      return { src: st && st.src, list: st && st.flights, tz: OGX.time.tzOffsetMs / 3600000, cur: OGX.state.current().key };
    });
    assert.equal(r.src, 'page');
    assert.equal(r.tz, 2, 'Aeternum = UTC+2, calibrated from the event timer');
    assert.equal(r.list.length, 2);
    const [out, back] = r.list;
    assert.deepEqual(
      [out.rowId, out.fleetId, out.realMissionId, out.missionType, out.returnFlight, out.synthetic, out.arrival, out.from, out.fromType, out.to, out.toType],
      ['fleettime_1793348429396900', 396900, 396900, 8, false, null, 1793348429000, '2:68:5', 1, '2:87:8', 2]);
    assert.deepEqual([back.returnFlight, back.arrival, back.from, back.fromType, back.to, back.toType], [true, 1793350031000, '2:87:8', 2, '2:68:5', 1]);
    assert.deepEqual(out.ships, { 209: 8290 });
    assert.equal(out.units, 8290);
    assert.deepEqual(out.cargo, { metal: 0, crystal: 0, deuterium: 0, approx: false });
    assert.deepEqual([out.own, out.status, out.recallable, back.recallable], [true, 'friendly', true, false]);
    assert.deepEqual([out.originKey, out.destKey, back.originKey, back.destKey], [r.cur, null, null, r.cur]);
    // one way = return - arrival (no hold) -> departure = arrival - one way
    assert.equal(out.departure, 1793348429000 - (1793350031000 - 1793348429000));
    assert.equal(back.departure, out.departure);
    assert.deepEqual(await env.ogxErrors(p), []);
  } finally { await env.close(); }
});

T.test('fleetStep3 page (4 events): colony cargo, inFlight once per fleet, applyArrivals, hostile/incoming views', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=fleetStep3');
    const r = await p.evaluate(async () => {
      await OGX.storage.flush();
      const { flights } = await OGX.flights.get();   // the stored page list is fresh: no request
      const cur = OGX.state.current().key;
      const res = () => ({ metal: { amount: 100 }, crystal: { amount: 100 }, deuterium: { amount: 100 } });
      const bodies = { [cur]: { key: cur, res: res(), ships: {} } };
      const all = OGX.flights.applyArrivals(bodies, flights, 0, Infinity)[cur];
      return {
        rows: flights.map((f) => [f.fleetId, f.missionType, f.returnFlight, f.cargo.metal, Object.keys(f.ships).join()]),
        inF: OGX.flights.inFlight(flights), hostile: OGX.flights.hostile(flights).length,
        incoming: Object.fromEntries(Object.entries(OGX.flights.incomingByBody(flights)).map(([k, v]) => [k === cur ? 'cur' : k, v.map((f) => f.fleetId)])),
        all: [all.res.metal.amount, all.ships], cur,
      };
    });
    assert.deepEqual(r.rows, [[396901, 7, false, 7382, '208'], [396900, 8, false, 0, '209'], [396901, 7, true, 7382, '208'], [396900, 8, true, 0, '209']]);
    assert.deepEqual([r.inF.metal, r.inF.crystal, r.inF.deuterium], [7382, 0, 0]);
    assert.deepEqual(r.inF.byMission, { 7: { metal: 7382, crystal: 0, deuterium: 0 }, 8: { metal: 0, crystal: 0, deuterium: 0 } });
    assert.equal(r.hostile, 0);
    assert.deepEqual(r.incoming, { cur: [396901, 396900] });
    // both returns land at home: the colony ship brings the metal back, the recyclers return empty
    assert.deepEqual(r.all, [100 + 7382, { 208: 1, 209: 8290 }]);
    assert.deepEqual(await env.ogxErrors(p), []);
  } finally { await env.close(); }
});

T.test('fleetTable: recall ids from the movement list, movement rows, Deploy outward added from the table, foreign/hostile events', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=fleetTable');
    const ft = page('fleetTable');
    // a second own fleet the box does not show (Deploy outward), and an outward fleet without a recall form
    const deploy = ft.replace(/(<tr>\s*<td>1<\/td>[\s\S]*?<\/tr>)/, (row) => row + row.replace('<td>1</td>', '<td>2</td>').replace(/Recycle/, 'Deploy')
      .replace('value="396900"', 'value="396950"').replace('10:20:29', '11:00:00').replace('[2:87:8]', '[2:68:6]').replace('data-fleet-end-time="1793350031"', 'data-fleet-end-time="1793350800"'));
    const noRecall = ft.replace(/<form action="[^"]*sendfleetback[\s\S]*?<\/form>/, '-');
    // a foreign attack on us [UPSTREAM markup: no "own" prefix, Dialog.PM link, ship types without counts below espionage 8]
    const hostile = page('overview').replace(/class="flight ownharvest"/g, 'class="flight attack"').replace(/ownharvest/g, 'attack')
      .replace(/\(8290 Recycler\)/g, '(approaching 12 ships: Light Fighter; Cruiser)').replace(/One of your/g, 'A fleet of Bob <a href="#" onclick="return Dialog.PM(4377)">PM</a>');
    const r = await p.evaluate(async ([deploy, noRecall, hostile]) => {
      await OGX.storage.flush();
      const st = await OGX.storage.get('flights', null);
      const mv = OGX.flights.parseMovement(document);
      const d = OGX.flights.parseEventList(deploy);
      const n = OGX.flights.parseEventList(noRecall);
      const h = OGX.flights.parseEventList(hostile);
      return {
        stored: st.flights.map((f) => [f.fleetId, f.returnFlight, f.recallable]),
        mv: mv.map((m) => ({ id: m.id, recallId: m.recallId, mission: m.missionType, ret: m.returnFlight, timer: m.timer, back: m.returnArrival, arrival: m.arrival, ships: m.ships, units: m.units, from: m.from, to: m.to })),
        deploy: d.map((f) => [f.rowId, f.fleetId, f.missionType, f.returnFlight, f.arrival, f.to, f.recallable, f.units]),
        noRecall: n.map((f) => f.recallable),
        hostile: h.map((f) => ({ own: f.own, status: f.status, units: f.units, ships: f.ships, unknown: f.unknownShips, recallable: f.recallable, cargoApprox: f.cargo.approx })),
        hostileList: OGX.flights.hostile(h).length,
        wall: OGX.time.parseGameDate('30. Oct 2026, 10:20:29'),
      };
    }, [deploy, noRecall, hostile]);
    assert.deepEqual(r.stored, [[396900, false, true], [396900, true, false]]);
    assert.equal(r.mv.length, 1);
    assert.deepEqual(r.mv[0], { id: 396900, recallId: 396900, mission: 8, ret: false, timer: 1793350031000, back: 1793350031000, arrival: 1793348429000,
      ships: { 209: 8290 }, units: 8290, from: '2:68:5', to: '2:87:8' }, 'fleetTable dates (server wall, UTC+2) agree with the unix timers');
    assert.equal(r.wall, 1793348429000);
    assert.deepEqual(r.deploy.map((x) => x[1]), [396900, 396900, 396950], 'sorted by arrival');
    assert.deepEqual(r.deploy[2], ['fleet_396950', 396950, 4, false, r.wall + (11 * 3600 - (10 * 3600 + 20 * 60 + 29)) * 1000, '2:68:6', true, 8290]);
    assert.deepEqual(r.noRecall, [false, false], 'no recall form on the fleetTable row -> not recallable');
    assert.equal(r.hostile.length, 2);
    assert.deepEqual(r.hostile[0], { own: false, status: 'hostile', units: 12, ships: {}, unknown: { 'Light Fighter': null, Cruiser: null }, recallable: false, cargoApprox: true });
    assert.equal(r.hostileList, 1, 'hostile() keeps the outward leg only');
    assert.deepEqual(await env.ogxErrors(p), []);
  } finally { await env.close(); }
});

T.test('dispatch: the three POST bodies match the real forms, token from the previous step; step-3 result parsed', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=fleetTable');
    const req = { galaxy: 2, system: 68, position: 9, type: 1, mission: 7, ships: { 208: 1, 210: 0 }, speed: 10, cargo: { metal: 7382.6 } };
    const forms = await p.evaluate((req) => {
      const G = OGX.parse.gz, F = OGX.fleet.gz;
      const s1 = { token: 'd583ed8b434e588148fe929b8f939eab', fleetGroup: 0, targetMission: 0, target: { galaxy: 2, system: 68, planet: 5, type: 1 } };
      let noTok = null, notOffered = null;
      try { F.step2Form({ token: null }, req); } catch (e) { noTok = e.message; }
      try { F.step3Form({ token: 't', missions: [{ id: 7 }], stayOptions: [] }, { mission: 3 }); } catch (e) { notOffered = e.message; }
      const stay = F.step3Form({ token: 't', missions: [{ id: 15 }], stayOptions: [{ value: 1, hours: 0.5 }, { value: 2, hours: 1 }, { value: 3, hours: 1.5 }] }, { mission: 15, holdingtime: 1 });
      return { f1: F.step1Form(req), f2: F.step2Form(s1, req), f2def: F.step2Form(s1, { speed: 3.4 }), noTok, notOffered, stay, isGz: G.is(document) };
    }, req);
    assert.deepEqual(forms.f1, { galaxy: 2, system: 68, planet: 9, type: 1, target_mission: 7, ship208: 1 });
    assert.deepEqual(forms.f2, { token: 'd583ed8b434e588148fe929b8f939eab', fleet_group: 0, target_mission: 7, galaxy: 2, system: 68, planet: 9, type: 1, speed: 10 });
    assert.deepEqual(forms.f2def, { token: 'd583ed8b434e588148fe929b8f939eab', fleet_group: 0, target_mission: 0, galaxy: 2, system: 68, planet: 5, type: 1, speed: 3 });
    assert.match(forms.noTok, /no token/);
    assert.match(forms.notOffered, /mission 3 not offered/);
    assert.deepEqual(forms.stay, { token: 't', mission: 15, metal: 0, crystal: 0, deuterium: 0, staytime: 2 }, 'expedition: hours -> option value');

    const res = await p.evaluate((req) => OGX.fleet.gz.dispatch(req, { cp: 254102 }), req);
    const posts = env.server.posts.splice(0);
    assert.deepEqual(posts.map((x) => x.key), ['POST fleetStep1', 'POST fleetStep2', 'POST fleetStep3']);
    assert.ok(posts.every((x) => /[?&]cp=254102\b/.test(x.query)), 'cp on every step');
    assert.deepEqual(body(posts[0].body), { galaxy: '2', system: '68', planet: '9', type: '1', target_mission: '7', ship208: '1' });
    assert.deepEqual(body(posts[1].body), { token: 'd583ed8b434e588148fe929b8f939eab', fleet_group: '0', target_mission: '7', galaxy: '2', system: '68', planet: '9', type: '1', speed: '10' });
    assert.deepEqual(body(posts[2].body), { token: 'd583ed8b434e588148fe929b8f939eab', mission: '7', metal: '7382', crystal: '0', deuterium: '0' });
    assert.equal(res.success, true);
    const x = res.result;
    assert.deepEqual([x.missionId, x.distance, x.maxSpeed, x.consumption, x.from, x.to, x.ships, x.message], [7, 1020, 6000, 118, '2:68:5', '2:68:9', { 208: 1 }, 'Fleet sent']);
    // "30. Oct 2026, 10:20:01" = the colony event end 1793348401; the stored return is round(T + 2 x 653.35 s) = 1793349055
    // (event box 10:30:55), 1 s later than the result table's "10:30:54"
    assert.deepEqual([x.arrival, x.back - x.arrival, x.back, x.fleetId], [1793348401000, 654000, 1793349055000, 396901]);

    // step 2 does not offer the mission -> no step-3 POST
    const bad = await p.evaluate((req) => OGX.fleet.gz.dispatch(Object.assign({}, req, { mission: 3 })), req);
    assert.deepEqual([bad.success, bad.step, bad.missions], [false, 3, [7]]);
    assert.deepEqual(env.server.posts.splice(0).map((x) => x.key), ['POST fleetStep1', 'POST fleetStep2']);
    // step 1 without ships: the server answers with fleetTable (no step-1 form)
    env.server.answers['POST fleetStep1'] = page('fleetTable');
    const noShips = await p.evaluate((req) => OGX.fleet.gz.dispatch(req), req);
    assert.deepEqual([noShips.success, noShips.step], [false, 1]);
    assert.deepEqual(env.server.posts.splice(0).map((x) => x.key), ['POST fleetStep1']);
    delete env.server.answers['POST fleetStep1'];
    // a step-3 refusal (info page) carries the server's text
    env.server.answers['POST fleetStep3'] = page('transport');
    const refused = await p.evaluate((req) => OGX.fleet.gz.dispatch(req), req);
    assert.deepEqual([refused.success, refused.step, refused.message], [false, 3, 'You need Admiral officier at level 10!!']);
    env.server.posts.splice(0);
    assert.deepEqual(await env.ogxErrors(p), []);
  } finally { await env.close(); }
});

T.test('fleet.send (user click path) confirms, dispatches and invalidates flights; recall posts sendfleetback', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=fleetTable');
    const r = await p.evaluate(async () => {
      const asked = [];
      OGX.dom.confirm = async (b, o) => { asked.push(o.title); return asked.length !== 2; };   // 2nd dialog: cancel
      const events = [];
      OGX.bus.on('fleet:sent', (e) => events.push(['sent', e.ok]));
      OGX.bus.on('fleet:recalled', (e) => events.push(['recalled', e.fleetId, e.ok]));
      const req = { galaxy: 2, system: 68, position: 9, type: 1, mission: 7, ships: { 208: 1 }, speed: 10, cargo: { metal: 100 } };
      const sent = await OGX.fleet.send(req);
      await new Promise((ok) => setTimeout(ok, 200));
      const t1 = (await OGX.storage.get('flights', null)).t;
      const cancelled = await OGX.fleet.send(req);
      const badSpeed = await OGX.fleet.send(Object.assign({}, req, { speed: 9.5 }));
      const recall = await OGX.fleet.recall(396900, { confirm: false });
      const recallNo = await OGX.fleet.recall(0);
      return { sent, t1, cancelled, badSpeed, recall, recallNo, asked, events };
    });
    assert.deepEqual(r.sent, { success: true, message: 'Fleet sent' });
    assert.equal(r.t1, 0, 'flights invalidated after a send');
    assert.equal(r.cancelled.cancelled, true);
    assert.match(r.badSpeed.message, /10%/);
    assert.deepEqual(r.asked, ['Отправка флота', 'Отправка флота']);
    const posts = env.server.posts.splice(0);
    assert.deepEqual(posts.map((x) => x.key), ['POST fleetStep1', 'POST fleetStep2', 'POST fleetStep3', 'POST fleetTable&action=sendfleetback']);
    assert.deepEqual(body(posts[3].body), { fleetID: '396900' });
    // the static server answers with the same fleetTable (recall form still there) -> not recalled
    assert.equal(r.recall.success, false);
    assert.equal(r.recallNo.success, false);
    assert.deepEqual(r.events, [['sent', true], ['recalled', 396900, false]]);
    env.server.answers['POST fleetTable&action=sendfleetback'] = page('fleetTable').replace(/<form action="[^"]*sendfleetback[\s\S]*?<\/form>/, '-');
    const ok = await p.evaluate(() => OGX.fleet.recall(396900, { confirm: false }));
    assert.equal(ok.success, true);
    assert.deepEqual(await env.ogxErrors(p), []);
  } finally { await env.close(); }
});

T.test('flight math reproduces the real pages; estimate uses the stored game speed; status() reads fleetTable', async () => {
  const env = await launch();
  try {
    const p = await env.open('page=fleetStep1');
    const r = await p.evaluate(async () => {
      const F = OGX.fleet.gz;
      const data = OGX.parse.gz.fleetStep1(document).data;
      const row = (to) => { const d = F.distance('2:68:5', to); const s = F.duration(data, d, 10); const c = F.consumption(data, d, s); return [d, s, c, +data.fleetroom - c]; };
      const server = await OGX.state.server();
      const est = await OGX.fleet._estimateGz({ from: '2:68:5', to: '2:68:9', ships: { 208: 1 }, data });
      const calc = F.dataFor({ 208: 1, 210: 0 }, { 208: { speed: 6000, fuel: 1000 } }, server);
      const rec = F.dataFor({ 209: 1 }, { 209: { speed: 4400, fuel: 300 } }, server);
      const recD = F.distance('2:68:5', '2:87:8');
      const est87 = await OGX.fleet._estimateGz({ from: '2:68:5', to: '2:87:8', ships: { 209: 1 }, data: rec });
      return { same: row('2:68:5'), r9: row('2:68:9'), r70: row('2:70:5'), r3: row('3:68:5'), gamespeed: server.fleetSpeed, est: [est.distance, est.duration, est.fuelBudget, est.speedFactor], calc,
        legs9: [est.back - est.arrival - est.duration * 1000, (est.back - est.arrival) / 1000],
        rec: [recD, F.duration(rec, recD, 10), +F.durationRaw(rec, recD, 10).toFixed(2), est87.duration, (est87.back - est87.arrival) / 1000] };
    });
    assert.deepEqual(r.same, [5, 47, 2, 7498]);
    assert.deepEqual(r.r9, [1020, 653, 118, 7382]);
    assert.deepEqual(r.r70, [2890, 1099, 331, 7169]);
    assert.deepEqual(r.r3, [20000, 2888, 2287, 5213]);
    assert.equal(r.gamespeed, 7, 'fleetStep1 data.gamespeed stored as server.fleetSpeed');
    assert.deepEqual(r.est, [1020, 653, 118, 7]);
    // return = round(T + 2 d_raw): colony 2 x 653.35 -> 1307 (event box 10:20:01 -> 10:30:55), recycler 2 x 1601.32 -> 3203 (fleetTable 10:20:29 -> 10:47:11)
    assert.deepEqual(r.legs9, [1000, 654], 'return leg 1 s longer than the rounded one-way time');
    assert.deepEqual(r.rec, [4505, 1601, 1601.32, 1601, 1602]);
    assert.deepEqual(r.calc, { gamespeed: 7, fleetspeedfactor: 1, fleetMinDuration: 5, ships: { 208: { speed: 6000, consumption: 1000, amount: 1 } }, maxspeed: 6000 });
    // status(): this page is not fleetTable -> one GET without cp
    const st = await p.evaluate(() => OGX.fleet.status());
    assert.deepEqual([st.slots, st.expeditions, st.ships, st.speeds[208], st.flights.length, st.flights[0].recallId],
      [{ used: 1, max: 13 }, { used: 0, max: 2 }, { 208: 2, 210: 102, 212: 797 }, 6000, 1, 396900]);
    assert.deepEqual(await env.ogxErrors(p), []);
  } finally { await env.close(); }
});

T.test('prefill: native fleetTable link, ships filled on fleetTable, speed on step 1, mission + cargo on step 2, never submitted', async () => {
  const env = await launch();
  try {
    const p1 = await env.open('page=overview');
    const url = await p1.evaluate(async () => {
      let went = null;
      const go = OGX.page.go; OGX.page.go = (path, q) => { went = OGX.page.url(path, q); };
      await OGX.fleet.prefill.open({ originId: 254102, target: { galaxy: 2, system: 68, position: 5, type: 1 }, mission: 7, ships: { 208: 1, 210: 500 }, speed: 5, cargo: { metal: 1000 }, note: 'тест' });
      OGX.page.go = go;
      return went.replace(location.origin, '');
    });
    assert.equal(url, '/Aeternum/game.php?page=fleetTable&cp=254102&galaxy=2&system=68&planet=5&planettype=1&target_mission=7');
    await p1.close();
    const p2 = await env.open(url.split('?')[1]);
    const ft = await p2.evaluate(async () => ({ s208: document.querySelector('input[name=ship208]').value, s210: document.querySelector('input[name=ship210]').value,
      banner: (document.getElementById('ogx-fleet-prefill') || {}).textContent, stage: (await OGX.storage.get('prefill', null)).stage }));
    assert.deepEqual([ft.s208, ft.s210, ft.stage], ['1', '102', 1]);
    assert.match(ft.banner, /Флот подготовлен: тест\. Не хватает: .*102\/500/);
    assert.match(ft.banner, /нажмите «Continue»/, 'the page\'s own submit label');
    const s1 = await env.open('page=fleetStep1');
    const st1 = await s1.evaluate(async () => ({ speed: document.querySelector('select[name=speed]').value, rec: await OGX.storage.get('prefill', null) }));
    assert.deepEqual([st1.speed, st1.rec.stage, st1.rec.token], ['5', 2, 'd583ed8b434e588148fe929b8f939eab']);
    const s2 = await env.open('page=fleetStep2');
    const st2 = await s2.evaluate(async () => ({ m7: document.querySelector('input[name=mission][value="7"]').checked, metal: document.querySelector('form input[name=metal]').value,
      rec: await OGX.storage.get('prefill', null), banner: document.getElementById('ogx-fleet-prefill').textContent }));
    assert.deepEqual([st2.m7, st2.metal, st2.rec], [true, '1000', null]);
    assert.match(st2.banner, /нажмите «Continue»/);
    assert.deepEqual(env.server.posts, [], 'nothing was submitted');
    for (const p of [p2, s1, s2]) assert.deepEqual(await env.ogxErrors(p), []);
    assert.deepEqual(env.errors, []);
  } finally { await env.close(); }
});
