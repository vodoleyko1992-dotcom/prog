'use strict';
// Core fleet gaps on GALAXYZ (review items M3 M4 M5 M11 M14 M16 M17), on the REAL saved pages served by tests/gz-server.js:
//  M3  OGX.fleet.gz DOM API (state, fillShips, setTarget, setSpeed, selectMission, fillCargo, maxCargo, setStaytime) and the
//      bridge 'fleet.*' methods answered on GALAXYZ; nothing is ever submitted (no POST reaches the mock)
//  M4  state.server(): economy/research speed null + *Known false on GALAXYZ; calc.config keeps fleetSpeed 7 when unknown
//  M5  game-sourced fleet:sent from the fleetStep3 result page (once) and from the game's fleetAjax XHR (+ fleet:ajax)
//  M11 officers: 607 cargo in shipStats, 611 in state.calcSlots, 613 in the flight estimate
//  M14 imperium stock kept for bodies never opened
//  M16 GALAXYZ flight polling policy (flights.gzPollReason)
//  M17 page hook: no window.__ogxHook / no command replies on other sites
//   node tests/gz-core-fleet.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

const noPosts = (env) => env.server.find('POST').map((r) => r.route || r.path);

T.test('M3 fleetTable: state, fillShips clamps to the planet, bridge fleet.* on GALAXYZ, never submits', async () => {
  const env = await G.launch();
  const page = await env.game('fleetTable');
  env.server.clearLog();
  const r = await env.evalOgx(page, async () => {
    const F = OGX.fleet.gz;
    const s0 = F.state();
    const viaBridge = await OGX.bridge.call('fleet.selectShips', { 210: 5, 208: 9 });
    const inputs = { 208: document.querySelector('input[name="ship208"]').value, 210: document.querySelector('input[name="ship210"]').value };
    const st = await OGX.bridge.call('fleet.state');
    const again = F.fillShips({ 208: 1 });            // reset: the probes go back to 0
    const inputs2 = { 208: document.querySelector('input[name="ship208"]').value, 210: document.querySelector('input[name="ship210"]').value };
    const mission = await OGX.bridge.call('fleet.selectMission', 6);
    const tgt = F.setTarget({ galaxy: 2, system: 70, position: 4, type: 1 });
    return {
      s0: { ok: s0.ok, step: s0.step, page: s0.page, available: s0.available, ships: s0.ships, target: s0.target, slots: s0.slots },
      viaBridge, inputs, st: { step: st.step, ships: st.ships, shipsToSend: st.shipsToSend, currentPage: st.currentPage, cap: st.capacityEstimate },
      again: again.ships, inputs2, mission, hidden: document.querySelector('form[action*="page=fleetStep1"] input[name="target_mission"]').value, tgt: tgt.target,
      wrongStep: F.setSpeed(5), goStep: await OGX.bridge.call('fleet.goStep', 2), submit: await OGX.bridge.call('fleet.submit'),
    };
  });
  assert.deepEqual(r.s0, { ok: true, step: 0, page: 'fleetTable', available: { 208: 2, 210: 102, 212: 797 }, ships: {},
    target: { galaxy: 2, system: 68, position: 5, type: 1 }, slots: { used: 1, max: 13 } });
  assert.deepEqual(r.viaBridge.ships, { 208: 2, 210: 5 });
  assert.deepEqual(r.viaBridge.short, [{ id: 208, want: 9, have: 2 }]);
  assert.deepEqual(r.inputs, { 208: '2', 210: '5' });
  assert.deepEqual(r.st.ships, { 208: 2, 210: 5 });
  assert.deepEqual(r.st.shipsToSend, r.st.ships);
  assert.equal(r.st.currentPage, 'fleetTable');
  assert.equal(r.st.cap, 2 * 7500 + 5 * 5, 'base cargo estimate (colony ship 7500, probe 5)');
  assert.deepEqual(r.again, { 208: 1 });
  assert.deepEqual(r.inputs2, { 208: '1', 210: '0' });
  assert.deepEqual(r.mission, { ok: true, step: 0, mission: 6 });
  assert.equal(r.hidden, '6');
  assert.deepEqual(r.tgt, { galaxy: 2, system: 70, position: 4, type: 1 });
  assert.equal(r.wrongStep.ok, false);
  assert.equal(r.wrongStep.error, 'step');
  assert.equal(r.goStep.ok, false);
  assert.equal(r.submit.ok, false);
  await page.waitForTimeout(300);
  assert.deepEqual(noPosts(env), [], 'nothing submitted');
  assert.deepEqual(env.ogxErrors(), []);
  await env.close();
});

T.test('M3 fleetStep1: state numbers = the page (5 / 47 s / 2), setTarget and setSpeed recompute, bridge setSpeed', async () => {
  const env = await G.launch();
  const page = await env.openSaved('fleetStep1');
  env.server.clearLog();
  const r = await env.evalOgx(page, async () => {
    const F = OGX.fleet.gz;
    const s = F.state();
    const t = F.setTarget({ galaxy: 2, system: 68, position: 9 });
    const s9 = F.state();
    const sp = await OGX.bridge.call('fleet.setSpeed', 5);
    const d = s.data;
    return { s: { step: s.step, token: s.token, speed: s.speed, ships: s.ships, capacity: s.capacity, distance: s.distance, duration: s.duration, consumption: s.consumption, free: s.free, target: s.target },
      t: t.ok, s9: { distance: s9.distance, duration: s9.duration, consumption: s9.consumption, free: s9.free },
      sp, sel: document.querySelector('select[name="speed"]').value, expect5: F.duration(d, 1020, 5) };
  });
  // real page: distance 5, 0:00:47 h, consumption 2, storage 7.498; fleetStep2/3 for [2:68:9]: 1.020, 653 s, 118, 7.382
  assert.deepEqual(r.s, { step: 1, token: 'd583ed8b434e588148fe929b8f939eab', speed: 10, ships: { 208: 1 }, capacity: 7500, distance: 5, duration: 47, consumption: 2, free: 7498,
    target: { galaxy: 2, system: 68, position: 5, type: 1 } });
  assert.equal(r.t, true);
  assert.deepEqual(r.s9, { distance: 1020, duration: 653, consumption: 118, free: 7382 });
  assert.equal(r.sp.ok, true);
  assert.equal(r.sp.speed, 5);
  assert.equal(r.sp.duration, r.expect5);
  assert.ok(r.sp.duration > 653);
  assert.equal(r.sel, '5');
  await page.waitForTimeout(300);
  assert.deepEqual(noPosts(env), []);
  await env.close();
});

T.test('M3 fleetStep2: missions, fillCargo clamps to free capacity, maxCargo, bridge setCargo / selectMission', async () => {
  const env = await G.launch();
  const page = await env.openSaved('fleetStep2');
  env.server.clearLog();
  const r = await env.evalOgx(page, async () => {
    const F = OGX.fleet.gz;
    const s = F.state();
    const bad = await OGX.bridge.call('fleet.selectMission', 3);
    const good = await OGX.bridge.call('fleet.selectMission', 7);
    const c1 = await OGX.bridge.call('fleet.setCargo', { metal: 1000 });
    const c2 = F.fillCargo({ crystal: 10000 });
    const left = document.getElementById('remainingresources').textContent.trim();
    F.fillCargo({ metal: 0, crystal: 0 });
    const mx = F.maxCargo({ order: ['deuterium', 'metal'] });
    const st = F.state();
    return { s: { step: s.step, missions: s.missions.map((m) => m.id), mission: s.mission, capacity: s.capacity, consumption: s.consumption, free: s.free, cargo: s.cargo, origin: s.origin, stay: s.stayOptions },
      bad: { ok: bad.ok, error: bad.error, missions: bad.missions }, good, checked: document.getElementById('radio_7').checked,
      c1: { cargo: c1.cargo, free: c1.free, clamped: c1.clamped }, c2: { cargo: c2.cargo, free: c2.free, clamped: c2.clamped }, left,
      mx: { cargo: mx.cargo, free: mx.free }, st: { mission: st.mission, cargoMetal: st.cargoMetal }, stay: F.setStaytime(2), stock: F.stock() };
  });
  assert.deepEqual(r.s, { step: 2, missions: [7], mission: null, capacity: 7500, consumption: 118, free: 7382, cargo: { metal: 0, crystal: 0, deuterium: 0 }, origin: '2:68:5', stay: [] });
  assert.deepEqual(r.bad, { ok: false, error: 'notOffered', missions: [7] });
  assert.deepEqual(r.good, { ok: true, step: 2, mission: 7, missions: [7] });
  assert.equal(r.checked, true);
  assert.deepEqual(r.c1, { cargo: { metal: 1000, crystal: 0, deuterium: 0 }, free: 6382, clamped: [] });
  assert.deepEqual(r.c2, { cargo: { metal: 1000, crystal: 6382, deuterium: 0 }, free: 0, clamped: ['crystal'] });
  assert.ok(r.stock.metal > 1e9 && r.stock.deuterium > 7382, 'header stock: ' + JSON.stringify(r.stock));
  assert.deepEqual(r.mx, { cargo: { metal: 0, crystal: 0, deuterium: 7382 }, free: 0 });
  assert.deepEqual(r.st, { mission: 7, cargoMetal: 0 });
  assert.equal(r.stay.ok, false, 'no staytime select on a colonize step 2');
  await page.waitForTimeout(300);
  assert.deepEqual(noPosts(env), [], 'nothing submitted');
  await env.close();
});

T.test('M5 fleetStep3 result page emits one game fleet:sent (mission, coords, ships, times, fleet id from the event box)', async () => {
  const env = await G.launch();
  const page = await env.openSaved('fleetStep3');
  const r = await env.evalOgx(page, async () => {
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('ogx:fleetStep3:'));
    const got = [];
    OGX.bus.on('fleet:sent', (e) => got.push(e));
    for (const k of keys) sessionStorage.removeItem(k);
    OGX.fleet._initGameSendGz();   // the boot path again: emits (page is ready)
    OGX.fleet._initGameSendGz();   // same result page again: deduplicated
    const ev = got[0];
    return { keys: keys.length, count: got.length, ev: ev && { ok: ev.ok, source: ev.source, via: ev.via, mission: ev.mission, from: ev.from, to: ev.to, ships: ev.ships,
      consumption: ev.consumption, distance: ev.distance, fleetId: ev.fleetId, legs: [ev.arrival - OGX.time.serverNow() > -86400000, (ev.back - ev.arrival) / 1000],
      request: ev.request }, state: OGX.fleet.gz.state().step };
  });
  assert.equal(r.keys, 1, 'boot emitted once (dedupe key written)');
  assert.equal(r.count, 1);
  assert.deepEqual(r.ev, { ok: true, source: 'game', via: 'fleetStep3', mission: 7, from: '2:68:5', to: '2:68:9', ships: { 208: 1 }, consumption: 118, distance: 1020,
    fleetId: 396901, legs: [true, 654], request: { mission: 7, galaxy: 2, system: 68, position: 9, type: null, ships: { 208: 1 } } });
  assert.equal(r.state, 3);
  assert.deepEqual(env.ogxErrors(), []);
  await env.close();
});

T.test('M5 the game\'s fleetAjax (galaxy one-click spy) -> fleet:ajax always, fleet:sent only on code 600', async () => {
  const env = await G.launch();
  let answer = { slots: 2, ships: { 210: 101 }, code: 600, mess: 'Send 1 Spy Probe to 2:72:6 ...' };
  env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json(answer));
  const page = await env.game('galaxy');
  await env.evalOgx(page, () => { window.__ev = []; for (const n of ['fleet:ajax', 'fleet:sent']) OGX.bus.on(n, (e) => window.__ev.push([n, e])); });
  const xhr = (q) => page.evaluate((qq) => new Promise((res) => { const x = new XMLHttpRequest(); x.open('GET', 'game.php?' + qq); x.onload = () => res(x.status); x.send(); }), q);
  await xhr('page=fleetAjax&ajax=1&mission=6&planetID=4242');
  answer = { slots: 1, ships: {}, code: 610, mess: 'No probes' };
  await xhr('page=fleetAjax&ajax=1&mission=6&planetID=4243');
  await page.waitForTimeout(300);
  const ev = await env.evalOgx(page, () => window.__ev.map(([n, e]) => [n, { ok: e.ok, code: e.code, mission: e.mission, planetId: e.planetId, to: e.to, source: e.source, via: e.via || null, slots: e.slots === undefined ? null : e.slots, ships: e.ships }]));
  assert.deepEqual(ev, [
    ['fleet:ajax', { ok: true, code: 600, mission: 6, planetId: 4242, to: '2:72:6', source: 'game', via: null, slots: 2, ships: { 210: 101 } }],
    ['fleet:sent', { ok: true, code: 600, mission: 6, planetId: 4242, to: '2:72:6', source: 'game', via: 'fleetAjax', slots: null, ships: null }],
    ['fleet:ajax', { ok: false, code: 610, mission: 6, planetId: 4243, to: null, source: 'game', via: null, slots: 1, ships: {} }],
  ]);
  await env.close();
});

T.test('M4 server speeds unknown on GALAXYZ (null + Known false); calc.config keeps fleet speed 7 unless measured', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  const r = await env.evalOgx(page, async () => {
    const s = await OGX.state.server();
    return { eco: s.economySpeed, res: s.researchSpeed, ecoK: s.economySpeedKnown, resK: s.researchSpeedKnown, fsK: s.fleetSpeedKnown,
      cfg: OGX.calc.config(s).fleetSpeed, cfg1: OGX.calc.config({ fleetSpeed: 1, fleetSpeedKnown: false }).fleetSpeed,
      cfgKnown: OGX.calc.config({ fleetSpeed: 3, fleetSpeedKnown: true }).fleetSpeed, cfgPlain: OGX.calc.config({ fleetSpeed: 5 }).fleetSpeed };
  });
  assert.deepEqual(r, { eco: null, res: null, ecoK: false, resK: false, fsK: false, cfg: 7, cfg1: 7, cfgKnown: 3, cfgPlain: 5 });
  await env.close();
});

T.test('M11 officers: 607 cargo in shipStats and the estimate, 611 slots, 613 flight time', async () => {
  const env = await G.launch();
  await env.game('research');
  const page = await env.game('overview');
  const base = await env.evalOgx(page, async () => {
    const st = await OGX.state.shipStats();
    const e = await OGX.fleet.estimate({ from: '2:68:5', to: '2:68:9', ships: { 208: 1 }, mission: 7 });
    return { cargo: st[208].cargo, dur: e.duration, estCargo: e.cargo, slots: await OGX.state.calcSlots() };
  });
  await env.evalOgx(page, async () => {
    await OGX.storage.update('player', (p) => Object.assign({}, p, { officers: { 607: 2, 611: 3, 613: 1 } }), null);
    await OGX.storage.flush();
  });
  const r = await env.evalOgx(page, async () => {
    const st = await OGX.state.shipStats();
    const e = await OGX.fleet.estimate({ from: '2:68:5', to: '2:68:9', ships: { 208: 1 }, mission: 7 });
    const f = await OGX.state.factors();
    return { cargo: st[208].cargo, dur: e.duration, estCargo: e.cargo, slots: await OGX.state.calcSlots(), f: [f.ShipStorage, f.FleetSlots, f.FlyTime] };
  });
  assert.equal(base.cargo, 7500);
  assert.equal(base.dur, 653);
  assert.equal(base.slots.known, true);
  assert.deepEqual(r.f, [1, 9, -0.1]);
  assert.equal(r.cargo, 15000);
  assert.equal(r.estCargo, 15000);
  assert.ok(Math.abs(r.dur - 653 * 0.9) < 1e-6, 'General -10 %: ' + r.dur);
  assert.equal(r.slots.fleet, base.slots.fleet + 9);
  assert.equal(r.slots.officersKnown, true);
  await env.close();
});

T.test('M14 imperium keeps the stock of bodies never opened (storage/perHour null, amount held flat)', async () => {
  const env = await G.launch();
  const page = await env.game('imperium');
  const r = await env.evalOgx(page, async () => {
    await OGX.storage.flush();
    const bodies = await OGX.state.bodies();
    const cur = OGX.state.current();
    return Object.values(bodies).filter((b) => b.type === 'planet').map((b) => ({ cur: b.id === cur.id, src: b.res && b.res.src || null,
      metal: b.res && b.res.metal, projected: b.res ? OGX.state.projected(b, OGX.time.serverNow() + 3600000).res.metal.amount : null }));
  });
  assert.equal(r.length, 4, JSON.stringify(r));
  const others = r.filter((x) => !x.cur);
  assert.equal(others.length, 3);
  for (const o of others) {
    assert.equal(o.src, 'imperium');
    assert.ok(o.metal.amount > 0, JSON.stringify(o));
    assert.equal(o.metal.storage, null);
    assert.equal(o.metal.perHour, null);
    assert.equal(o.projected, o.metal.amount);
  }
  assert.ok(r.find((x) => x.cur).metal.storage > 0, 'the current body keeps its full header data');
  await env.close();
});

T.test('M16 GALAXYZ polling: only on a reason (ended flight, invalidated, no event box and old), never while hidden', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  const r = await env.evalOgx(page, () => {
    const R = OGX.flights.gzPollReason, now = 10000000;
    const list = (t, arr) => ({ t, flights: arr.map((a) => ({ arrival: a })) });
    return [
      R(list(now - 120000, [now + 60000]), { now, sec: 60, hasBox: true }),
      R(list(now - 120000, [now - 1000]), { now, sec: 60, hasBox: true }),
      R(list(now - 120000, [now - 1000]), { now, sec: 60, hasBox: true, hidden: true }),
      R(list(now - 120000, [now - 1000]), { now, sec: 0, hasBox: true }),
      R(list(0, []), { now, sec: 60 }),
      R(null, { now, sec: 60, hasBox: true }),
      R(null, { now, sec: 60, hasBox: false }),
      R(list(now - 300000, []), { now, sec: 60, hasBox: false }),
      R(list(now - 600000, []), { now, sec: 60, hasBox: false }),
      R(list(now - 3600000, []), { now, sec: 60, hasBox: true }),
    ];
  });
  assert.deepEqual(r, [null, 'ended', null, null, 'invalidated', null, 'empty', null, 'noBox', null]);
  // a tick on a page with an event box and nothing ended sends nothing
  env.server.clearLog();
  await env.evalOgx(page, async () => { OGX.flights.startPolling(); for (let i = 0; i < 3; i++) OGX.bus.emit('tick', OGX.time.serverNow()); await new Promise((r) => setTimeout(r, 300)); });
  assert.deepEqual(env.server.find('GET', 'fleetTable'), []);
  await env.close();
});

T.test('M17 page hook: marker and command replies only on game pages', async () => {
  const env = await G.launch();
  const probe = (p) => p.evaluate(() => new Promise((res) => {
    const out = { hook: window.__ogxHook ? window.__ogxHook.version : null, reply: null };
    document.addEventListener('ogx:reply', (e) => { out.reply = JSON.parse(e.detail); }, { once: true });
    document.dispatchEvent(new CustomEvent('ogx:call', { detail: JSON.stringify({ id: 'x1', method: 'ping', args: [] }) }));
    setTimeout(() => res(out), 300);
  }));
  const other = await env.open('/other', { waitReady: false });
  await other.waitForTimeout(500);
  const o = await probe(other);
  // review fix: fetch / XHR stay native on other sites (and on the GALAXYZ login page); XHR instances get no expando there.
  // On the game page they are patched before the game's own scripts (journal + relay keep working).
  const natives = (p) => p.evaluate(() => {
    const x = new XMLHttpRequest(); x.open('GET', location.href);
    return { fetch: /native code/.test(String(window.fetch)), open: /native code/.test(String(XMLHttpRequest.prototype.open)),
      send: /native code/.test(String(XMLHttpRequest.prototype.send)), expando: Object.keys(x).length };
  });
  assert.deepEqual(await natives(other), { fetch: true, open: true, send: true, expando: 0 }, 'foreign page untouched');
  const login = await env.open('/Aeternum/index.php', { waitReady: false });
  await login.waitForTimeout(800);
  assert.deepEqual(await natives(login), { fetch: true, open: true, send: true, expando: 0 }, 'login page untouched');
  const game = await env.game('overview');
  const g = await probe(game);
  assert.deepEqual(o, { hook: null, reply: null });
  assert.equal(g.hook, '0.4.0');
  assert.deepEqual(g.reply, { id: 'x1', ok: true, result: { ok: true, version: '0.4.0' } });
  const gn = await natives(game);
  assert.deepEqual([gn.fetch, gn.open, gn.send], [false, false, false], 'game page patched');
  await env.close();
});


// review fix (high): a refresh of other bodies running in this tab (http.withPlanet) must not hand its cp to a click action.
// Before: fleet.send from the current planet went out with the refreshed body's cp (the fleet left from another planet).
T.test('cp race: fleet.send / addBuild during a body refresh always name this page\'s body (every step), refresh keeps its own cp', async () => {
  const env = await G.launch({ settings: { 'core.cpConfirmed': true, 'core.confirmActions': false } });
  try {
    for (const n of ['overview', 'imperium', 'fleetTable']) { const q = await env.openSaved(n); await q.waitForTimeout(800); await q.close(); }
    const page = await env.game('overview');
    await page.waitForTimeout(800);
    env.server.clearLog();
    env.server.state.latencyMs = 700; env.server.state.missions = [3, 4];
    const r0 = await env.evalOgx(page, async () => {
      window.__cur = OGX.state.current();
      window.__refresh = OGX.state.refreshBodies({ keys: ['p254104', 'p254105'], include: ['fleet'] });
      await new Promise((r) => setTimeout(r, 1000));
      const active = OGX.http._activeCp();
      window.__send = OGX.fleet.send({ ships: { 202: 1 }, galaxy: 2, system: 68, position: 6, type: 1, mission: 3, speed: 10, cargo: { metal: 0, crystal: 0, deuterium: 0 } });
      window.__build = OGX.api.addBuild('resources', 1, { confirm: false });
      return { cur: window.__cur && window.__cur.id, active };
    });
    assert.equal(r0.cur, 254102);
    assert.equal(r0.active, 254104, 'the refresh is running when the click happens');
    for (let i = 0; i < 20; i++) { const b = await page.$('button:has-text("Отправить")'); if (b) { await b.click(); break; } await page.waitForTimeout(200); }
    const r = await env.evalOgx(page, async () => ({ sent: await window.__send, build: await window.__build, refresh: await window.__refresh }));
    assert.equal(r.sent.success, true, JSON.stringify(r.sent));
    const posts = env.server.find('POST').map((x) => [x.page || x.route || x.path, x.cp]);
    const steps = posts.filter(([pg]) => /fleetStep/.test(pg));
    assert.equal(steps.length, 3, JSON.stringify(posts));
    for (const [pg, cp] of steps) assert.equal(String(cp), '254102', pg + ' leaves from the current planet');
    const build = posts.filter(([pg]) => /buildings/.test(pg));
    assert.deepEqual(build.map(([, cp]) => String(cp)), ['254102'], 'build order names the current planet');
    const gets = env.server.find('GET', 'fleetTable').map((x) => String(x.cp));
    assert.deepEqual(gets, ['254104', '254105'], 'the refresh keeps its own cp per request');
  } finally { await env.close(); }
});

T.test('collect v2 core: fleetTable merge zeroes missing types, applySent, fitCargo, never-empty step errors, sendBatch needs confirmed, measured cargo until newer officers', async () => {
  const { fleetTableShips } = require('./gz-server');
  const env = await G.launch();
  try {
    let page = await env.game('fleetTable');
    const r1 = await env.evalOgx(page, async () => {
      const b = (await OGX.state.bodies()).p254102;
      const before = { ships: Object.assign({}, b.ships), metal: b.res.metal.amount, deut: b.res.deuterium.amount, slots: (await OGX.state.slots()).fleet };
      const key = await OGX.state.applySent({ originId: 254102, ships: { 210: 2 }, cargo: { metal: 100 }, consumption: 10 });
      const a = (await OGX.state.bodies()).p254102;
      return { key, before, after: { s210: a.ships[210], metal: a.res.metal.amount, deut: a.res.deuterium.amount, shipsT: a.shipsT === b.shipsT, slots: (await OGX.state.slots()).fleet } };
    });
    assert.equal(r1.before.ships[208], 2);
    assert.equal(r1.before.ships[210], 102);
    assert.equal(r1.before.ships[217], 0, 'a type the fleetTable does not list is 0');
    assert.equal(r1.before.ships[202], 0);
    assert.equal(r1.key, 'p254102');
    assert.equal(r1.after.s210, 100);
    assert.equal(r1.after.metal, r1.before.metal - 100);
    assert.equal(r1.after.deut, r1.before.deut - 10);
    assert.ok(r1.after.shipsT, 'shipsT unchanged');
    assert.deepEqual(r1.after.slots, { used: r1.before.slots.used + 1, max: r1.before.slots.max });

    // a fleetTable with no ship row (#warning): the whole fleet is known to be 0, the satellite keeps its count
    env.server.route('GET', 'fleetTable', (req, res, ctx) => ctx.sendPage('fleetTable', (html) => fleetTableShips(html, {})));
    page = await env.game('fleetTable');
    const r2 = await env.evalOgx(page, async () => { const b = (await OGX.state.bodies()).p254102; return { s208: b.ships[208], s210: b.ships[210], s212: b.ships[212], noShips: OGX.parse.gz.fleetTable(document).noShips }; });
    assert.deepEqual(r2, { s208: 0, s210: 0, s212: 797, noShips: true });

    env.server.clearLog();
    const r3 = await env.evalOgx(page, async () => {
      const F = OGX.fleet.gz;
      const fit1 = F.fitCargo({ cargo: { metal: 50, crystal: 50, deuterium: 50 }, fleetroom: 110, consumption: 10, stock: { metal: 1000, crystal: 1000, deuterium: 1000 }, order: 'dcm' });
      const fit2 = F.fitCargo({ cargo: { metal: 50, crystal: 50, deuterium: 50 }, fleetroom: 1000, consumption: 10, stock: { metal: 1000, crystal: 20, deuterium: 45 }, keepDeut: 5 });
      const fit3 = F.fitCargo({ cargo: { metal: 50 }, fleetroom: 10, consumption: 10, stock: {} });
      const doc = (h) => new DOMParser().parseFromString(h, 'text/html');
      const e1 = F._stepFail(3, null, { r: { doc: doc('<html><head><title>X</title></head><body></body></html>'), url: 'u1', status: 200 } });
      const e2 = F._stepFail(2, null, { r: { doc: doc('<html><body></body></html>'), text: '<html><body></body></html>', url: 'u2', status: 200 } });
      const e3 = F._stepFail(1, null, { r: { doc: doc('<div class="mainRS"> Слишком   много </div>'), url: 'u3' } });
      const refused = await OGX.fleet.sendBatch([{ originId: 254102, galaxy: 2, system: 68, position: 8, type: 1, mission: 3, ships: { 217: 1 }, cargo: {} }]);
      const order = OGX.fleet.fillByOrder({ metal: 10, crystal: 10, deuterium: 10 }, 25, 'mcd');
      const prop = OGX.fleet.fillByOrder({ metal: 60, crystal: 30, deuterium: 10 }, 50, 'prop');
      // measured cargo factor wins over the officer calc until a newer officier page
      const now = OGX.time.serverNow();
      await OGX.storage.set('cargoMeasured', { factor: 1.5, t: now, ships: { 217: 1 }, fleetroom: 60000000, o607: 1 });
      const m1 = (await OGX.state.shipStats())[217];
      await OGX.storage.update('player', (p) => Object.assign({}, p || {}, { officers: { 607: 1 }, officersT: now + 500 }), null);
      const m1b = (await OGX.state.shipStats())[217];
      await OGX.storage.update('player', (p) => Object.assign({}, p || {}, { officers: { 607: 0 }, officersT: now + 1000 }), null);
      const m2 = (await OGX.state.shipStats())[217];
      // batch abort rules: a clean step-1/2 refusal goes on; step 3 after its POST, http, unrecognised pages and exceptions stop
      const BF = OGX.fleet._batchFatal;
      const fatal = [BF({ step: 1, kind: 'refusal', status: 200, message: 'нет свободных слотов флота' }), BF({ step: 2, kind: 'refusal', message: 'Нет места' }),
        BF({ step: 0, message: 'Неверные координаты' }), BF({ step: 3, kind: 'refusal', message: 'mission 3 not offered' }),
        BF({ step: 3, posted: true, kind: 'refusal', status: 200 }), BF({ step: 3, posted: true, kind: 'http', status: 0 }), BF({ step: 1, kind: 'http', status: 503 }),
        BF({ step: 2, kind: 'unrecognized', status: 200 }), BF({ step: 1, loggedOut: true }), BF({ exception: true, message: 'x' })];
      const kinds = [e1.kind, e2.kind, e3.kind, F._stepFail(1, 'msg', { r: { ok: true, doc: doc('<p></p>'), status: 200 } }).kind, F._stepFail(1, 'http 500', { r: { ok: false, status: 500 } }).kind];
      return { fit1: [fit1.sent, fit1.clamped, fit1.free], fit2: [fit2.sent, fit2.clamped], fit3: fit3.error, e1: e1.message, e2: e2.message, e3: e3.message, refused,
        order, prop, m1: [m1.cargo, m1.src], m1b: [m1b.cargo, m1b.src], m2: [m2.cargo, m2.src], fatal, kinds };
    });
    assert.deepEqual(r3.fit1, [{ metal: 0, crystal: 50, deuterium: 50 }, ['metal'], 100], 'room 110 - 10, deuterium then crystal');
    assert.deepEqual(r3.fit2, [{ metal: 50, crystal: 20, deuterium: 30 }, ['crystal', 'deuterium']], 'stock clamp: deuterium - consumption - keepDeut');
    assert.equal(r3.fit3, 'Нет места: топливо больше вместимости');
    assert.equal(r3.e1, 'X');
    assert.match(r3.e2, /^шаг 2: страница не распознана \(\d+ байт, u2\)$/);
    assert.equal(r3.e3, 'Слишком много');
    assert.equal(r3.refused.refused, true);
    assert.equal(r3.refused.sent, 0);
    assert.deepEqual(r3.order, { metal: 10, crystal: 10, deuterium: 5 });
    assert.deepEqual(r3.prop, { metal: 30, crystal: 15, deuterium: 5 });
    assert.deepEqual(r3.m1, [60000000, 'fleetroom']);
    assert.deepEqual(r3.m1b, [60000000, 'fleetroom'], 'newer officier page with the same 607 level: the measurement stays');
    assert.deepEqual(r3.m2, [40000000, 'calc'], 'newer officers with another 607 level: back to the calc');
    assert.deepEqual(r3.fatal, [null, null, null, null, 'step3', 'step3', 'http', 'unrecognized', 'loggedOut', 'exception']);
    assert.deepEqual(r3.kinds, ['unrecognized', 'unrecognized', 'unrecognized', 'refusal', 'http']);
    await page.waitForTimeout(300);
    assert.deepEqual(noPosts(env), [], 'sendBatch without confirmed sends nothing');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('api.sendFleet on GALAXYZ = fleet.gz.dispatch: cargo fitted to the step-2 room, staytime by hours, fleet id from the result (core-fleet-12)', async () => {
  const env = await G.launch();
  try {
    const page = await env.game('fleetTable');
    env.server.clearLog();
    Object.assign(env.server.state, { missions: [3], cargoPerShip: { 208: 1000 }, consumption: 100, enforceRoom: true });
    const r = await env.evalOgx(page, async () => {
      const send = await OGX.api.sendFleet({ galaxy: 2, system: 68, position: 9, type: 1, mission: 3, speed: 10, ships: { 208: 1 }, cargo: { metal: 5000, crystal: 0, deuterium: 0 } });
      // staytime: the option whose HOURS match holdingtime (values 1/2/4/8 = 0.5/1/2/4 h at haltSpeed 2), never the raw value
      const step2 = { token: 't', missions: [{ id: 5 }], stayOptions: [{ value: 1, hours: 0.5 }, { value: 2, hours: 1 }, { value: 4, hours: 2 }, { value: 8, hours: 4 }] };
      const f = OGX.fleet.gz.step3Form(step2, { mission: 5, cargo: {}, holdingtime: 2 });
      return { ok: send.success, step: send.step, clamped: send.fit && send.fit.clamped, cargo: send.cargo, stay: f.staytime };
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.step, 3);
    assert.deepEqual(r.clamped, ['metal'], 'cargo above the room is cut before step 3');
    assert.equal(r.cargo.metal, 900, 'room 1000 - consumption 100');
    assert.equal(r.stay, 4, 'holdingtime 2 h -> the option with hours 2 (value 4)');
    const st = env.server.state;
    assert.deepEqual(st.sent.map((x) => [x.mission, x.cargo.metal]), [[3, 900]], 'the server got the fitted cargo, no "Not enough cargo space" refusal');
    assert.deepEqual(env.requests('POST').map((x) => x.route).filter((x) => /fleetStep/.test(x)), ['page=fleetStep1', 'page=fleetStep2', 'page=fleetStep3']);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('step 3 refusals [UPSTREAM ShowFleetStep3Page]: more ships than the planet holds pass step 1 and are refused at step 3 (en / ru), botcore maps the exact en / ru texts', async () => {
  // tests-mock-17: upstream step 1 does not compare the posted ships with the planet; step 3 answers fl_not_all_ship_avalible
  const { STEP3_TEXTS } = require('./gz-server');
  const env = await G.launch();
  try {
    const page = await env.game('fleetTable');
    const out = {};
    for (const lang of ['en', 'ru']) {
      env.setState({ lang, bodyShips: { 254102: { 210: 2 } }, missions: [3], token: null, fleet: null });
      env.server.clearLog();
      out[lang] = await env.evalOgx(page, async () => {
        const r = await OGX.fleet.gz.dispatch({ galaxy: 2, system: 68, position: 8, type: 1, mission: 3, ships: { 210: 5 }, cargo: {} }, { cp: 254102 });
        return { ok: !!r.success, step: r.step, kind: r.kind, message: r.message, posted: !!r.posted };
      });
      const posts = env.server.find('POST').map((x) => x.page);
      assert.deepEqual(posts, ['fleetStep1', 'fleetStep2', 'fleetStep3'], lang + ': step 1 accepts the over-count, step 3 refuses it');
      assert.deepEqual(out[lang], { ok: false, step: 3, kind: 'refusal', message: STEP3_TEXTS[lang].ships, posted: true }, lang);
    }
    assert.equal(env.server.state.sent.length, 0, 'nothing was sent');
    const mapped = await env.evalOgx(page, (texts) => {
      const map = OGX.bot && OGX.bot._mapStep3Text;
      if (!map) return null;
      const r = {};
      for (const [lang, t] of Object.entries(texts)) { r[lang] = {}; for (const [code, s] of Object.entries(t)) r[lang][code] = map(s); }
      return r;
    }, STEP3_TEXTS);
    assert.ok(mapped, 'OGX.bot._mapStep3Text is loaded');
    for (const lang of ['en', 'ru']) {
      for (const code of ['ships', 'slots', 'fuel', 'cargo']) assert.equal(mapped[lang][code], code, `${lang} ${code}: «${STEP3_TEXTS[lang][code]}»`);
    }
    assert.equal(mapped.ru.attackLimit, 'attackLimit', 'ru fl_bash_protection (John\'s UI)');
    // KNOWN botcore gaps (reported for the botcore scope, not asserted here): en fl_bash_protection 'Bash Rule' maps to 'other'
    // instead of 'attackLimit', and ru fl_no_noresource 'Ресурсы не погружены.' to 'other' while the en text maps to 'cargo'.
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});
