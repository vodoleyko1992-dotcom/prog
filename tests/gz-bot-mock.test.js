'use strict';
// World mode of the GALAXYZ mock (tests/gz-world.js + tests/gz-server.js { world }) and the bot helper tests/gz-bot-lib.js (C7):
//   node-only: formulas, send/arrive/return/recall, determinism, build queue, scenarios load, static mode unchanged;
//   browser (suite extension): the 3-step send through HTTP shows in the event box + fleetTable and parses with the core parsers,
//   recall changes the return, spy report parsed by OGX.messages.parse.espionageFull, hostile event parsed as hostile, galaxy view
//   (inactive rows, deuterium cost), staytime texts by haltSpeed, step-2 missions [7] / empty-debris error, buildings POST queue.
//   node tests/gz-bot-mock.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { startGzServer, pageNames, PAGES } = require('./gz-server');
const { assert } = T;

const NOW = 1793347417;
const http = (srv) => async (q, body) => {
  const r = await fetch(srv.origin + '/Aeternum/game.php?' + q, body ? { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' } : { redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location'), text: await r.text() };
};
/** fleetStep1 -> 2 -> 3 through HTTP like the game form; returns the step-3 html. */
async function send3(get, { cp, ships, target, mission, speed = 10, cargo = {}, staytime }) {
  const s1 = {}; for (const [id, n] of Object.entries(ships)) s1['ship' + id] = n;
  let r = await get(`page=fleetStep1&cp=${cp}`, Object.assign(s1, { galaxy: target.galaxy, system: target.system, planet: target.position, type: target.type || 1, target_mission: mission }));
  assert.equal(r.status, 200, 'step1');
  const token = /name="token" value="([^"]+)"/.exec(r.text)[1];
  r = await get('page=fleetStep2', { token, speed, galaxy: target.galaxy, system: target.system, planet: target.position, type: target.type || 1 });
  assert.equal(r.status, 200, 'step2');
  const body = Object.assign({ token, mission, metal: cargo.metal || 0, crystal: cargo.crystal || 0, deuterium: cargo.deuterium || 0 }, staytime !== undefined ? { staytime } : {});
  r = await get('page=fleetStep3', body);
  return r.text;
}

// ------------------------------------------------------------------ node only
T.test('world: formulas, missions, staytime, scenarios', async () => {
  for (const n of ['basic', 'botsave-attack', 'botfarm-inactives', 'botdebris-residual', 'botbuild-two-planets', 'botexpo-slots']) {
    const w = W.createWorld(n);
    assert.equal(w.player.name, 'vodoleyko1992', n);
    assert.ok(w.body(254102), n + ' home');
  }
  const w = W.createWorld('basic');
  assert.equal(w.clock.nowUnix(), NOW);
  assert.equal(w.distance([2, 68, 5], [2, 68, 6]), 1005);
  assert.equal(w.distance([2, 68, 5], [2, 70, 5]), 2890);
  assert.equal(w.distance([2, 68, 5], [3, 68, 5]), 20000);
  assert.equal(w.distance([2, 68, 5], [2, 68, 5]), 5);
  assert.equal(w.shipSpeed(202), 5000 * (1 + 0.2 * 10), 'small cargo on impulse 10');   // speedTech 4 switches at impulse 5
  assert.equal(w.shipSpeed(210), 100000000 * (1 + 0.1 * 12));
  assert.equal(w.slotsMax(), 13);
  assert.equal(w.expeditionsMax(), 3);
  assert.deepEqual(w.availableMissions({ 208: 1 }, { galaxy: 2, system: 68, position: 9, type: 1 }), [7]);
  assert.deepEqual(w.availableMissions({ 202: 1 }, { galaxy: 2, system: 68, position: 9, type: 1 }), []);
  assert.deepEqual(w.availableMissions({ 210: 3 }, { galaxy: 2, system: 68, position: 10, type: 1 }), [3, 6, 1, 5]);
  assert.deepEqual(w.availableMissions({ 202: 3 }, { galaxy: 2, system: 68, position: 6, type: 1 }), [3, 4]);
  assert.deepEqual(w.availableMissions({ 209: 3 }, { galaxy: 2, system: 68, position: 11, type: 2 }), [8]);
  assert.deepEqual(w.availableMissions({ 209: 3 }, { galaxy: 2, system: 68, position: 9, type: 2 }), []);
  assert.deepEqual(w.availableMissions({ 202: 3 }, { galaxy: 2, system: 68, position: 16, type: 1 }), [15]);
  assert.deepEqual(w.staytimeOptions([15]).slice(0, 2), [{ value: 1, hours: 1 }, { value: 2, hours: 2 }]);
  const e = W.createWorld('botexpo-slots');
  assert.deepEqual(e.staytimeOptions([15]).slice(0, 3).map((o) => o.hours), [0.5, 1, 1.5], 'haltSpeed 2');
  assert.deepEqual(e.staytimeOptions([5]).map((o) => o.value), [1, 2, 4, 8, 12, 16, 32]);
});

T.test('world: send, arrive, return, recall, refusals, determinism', async () => {
  const w = W.createWorld('basic');
  const home = w.body(254102);
  const deut0 = home.res.deuterium;
  const r = w.send({ originId: 254102, ships: { 202: 10 }, target: { galaxy: 2, system: 68, position: 6, type: 1 }, mission: 3, cargo: { metal: 1000 } });
  assert.ok(r.ok, r.error);
  assert.equal(home.ships[202], 190);
  assert.equal(home.res.deuterium, deut0 - r.consumption);
  assert.equal(r.fleet.state, 'out');
  assert.equal(w.slotsUsed(), 1);
  const colony = w.body(254103); const m0 = colony.res.metal;
  w.clock.advance(r.duration);
  assert.equal(r.fleet.state, 'back');
  assert.ok(colony.res.metal >= m0 + 1000, 'delivered');
  w.clock.advance(r.duration);
  assert.equal(r.fleet.state, 'done');
  assert.equal(home.ships[202], 200);
  // recall: return = now + (now - start)
  const g = w.send({ originId: 254102, ships: { 202: 1 }, target: { galaxy: 3, system: 68, position: 6, type: 1 }, mission: 3, cargo: { metal: 1 } });
  assert.equal(g.ok, false, 'no target at 3:68:6');
  assert.equal(g.error, 'No available target planet');
  const f = w.send({ originId: 254102, ships: { 202: 1 }, target: { galaxy: 2, system: 70, position: 8, type: 1 }, mission: 4 }).fleet;
  w.clock.advance(3);
  const t = w.clock.nowUnix();
  assert.ok(w.recall(f.id));
  assert.equal(f.back, t + (t - f.start));
  assert.equal(f.state, 'back');
  assert.equal(w.recall(f.id), false, 'a returning fleet is not recallable');
  assert.equal(w.log.recalled.length, 1);
  // refusals: ships, deuterium, cargo, slots, same planet
  assert.equal(w.send({ originId: 254102, ships: { 202: 9999 }, target: { galaxy: 2, system: 68, position: 6, type: 1 }, mission: 4 }).error, 'Not all ships present.');
  assert.equal(w.send({ originId: 254102, ships: { 202: 1 }, target: { galaxy: 2, system: 68, position: 5, type: 1 }, mission: 4 }).error, 'Start and destination planet are identical!');
  assert.equal(w.send({ originId: 254102, ships: { 202: 1 }, target: { galaxy: 2, system: 68, position: 6, type: 1 }, mission: 3, cargo: { metal: 999999 } }).error, 'You have not enough cargo space available.');
  assert.equal(w.send({ originId: 254102, ships: { 202: 1 }, target: { galaxy: 2, system: 68, position: 12, type: 1 }, mission: 3, cargo: { metal: 1 } }).error, 'Target planet', 'vacation target');
  assert.equal(w.send({ originId: 254102, ships: { 202: 1 }, target: { galaxy: 2, system: 68, position: 16, type: 1 }, mission: 15, staytime: 99 }).error, 'Invalid retention time.');
  // determinism: same seed -> same spy outcome and same expedition draws
  const run = () => {
    const x = W.createWorld('basic');
    x.send({ originId: 254102, ships: { 210: 3 }, target: { galaxy: 2, system: 68, position: 10, type: 1 }, mission: 6 });
    for (let i = 0; i < 3; i++) x.send({ originId: 254102, ships: { 202: 5 }, target: { galaxy: 2, system: 68, position: 16, type: 1 }, mission: 15, staytime: 1 });
    x.clock.advance(4 * 3600);
    return JSON.stringify(x.log.events.filter((ev) => ev.kind === 'spy' || ev.kind === 'expedition'));
  };
  assert.equal(run(), run());
});

T.test('world: hostile attack with botsim, expedition outcomes, colonize, recycle', async () => {
  const w = W.createWorld('botsave-attack');
  w.clock.advance(20);
  const h = w.fleets.find((f) => f.owner === 3843);
  assert.ok(h, 'hostile created at +20 s by the spec');
  assert.equal(h.arrival, NOW + 20 + 180);
  w.clock.advance(181);
  const battle = w.log.events.find((ev) => ev.kind === 'battle');
  assert.ok(battle, 'battle ran');
  assert.equal(battle.engine, W.botsim() ? 'botsim' : 'forced:win');
  assert.ok(w.messages.some((m) => m.cat === 3 && /raportMessage/.test(m.body)), 'combat message cat 3');
  assert.ok(w.raports[battle.rid], 'raport stored');
  const e = W.createWorld('botexpo-slots');
  const sent = [1, 2, 3].map(() => e.send({ originId: 254102, ships: { 202: 10 }, target: { galaxy: 2, system: 68, position: 16, type: 1 }, mission: 15, staytime: 1 }));
  assert.ok(sent.every((x) => x.ok), JSON.stringify(sent.map((x) => x.error)));
  assert.equal(e.send({ originId: 254102, ships: { 202: 10 }, target: { galaxy: 2, system: 68, position: 16, type: 1 }, mission: 15, staytime: 1 }).error, 'You cant start more expeditions!');
  assert.equal(sent[0].fleet.stayEnd - sent[0].fleet.arrival, 1800, 'staytime 1 = 0.5 h at haltSpeed 2');
  e.clock.advance(3 * 3600);
  const outs = e.log.events.filter((ev) => ev.kind === 'expedition').map((ev) => ev.outcome.type);
  assert.deepEqual(outs, ['resources', 'darkMatter', 'nothing']);
  assert.equal(e.messages.filter((m) => m.cat === 15).length, 3);
  assert.ok(e.messages.some((m) => m.cat === 4 && /It deliveres Metal 500\.000/.test(m.body)), 'expedition return message');
  const c = W.createWorld('basic');
  const col = c.send({ originId: 254102, ships: { 208: 1 }, target: { galaxy: 2, system: 68, position: 9, type: 1 }, mission: 7 });
  assert.ok(col.ok, col.error);
  c.clock.advance(col.duration + 1);
  assert.equal(c.planets().length, 6, 'new colony');
  assert.equal(c.fleets[0].state, 'done', 'the colony ship stays');
  const d = W.createWorld('botdebris-residual');
  const rc = d.send({ originId: 254102, ships: { 209: 10 }, target: { galaxy: 2, system: 70, position: 1, type: 2 }, mission: 8 });
  assert.ok(rc.ok, rc.error);
  d.clock.advance(rc.duration);
  const got = d.log.events.find((ev) => ev.kind === 'recycle').got;
  assert.equal(got.metal + got.crystal <= 10 * 20000 + 2, true, 'harvest limited by the recycler capacity');
  assert.ok(d.debris.get('2:70:1').metal > 0, 'residual debris left');
});

T.test('world: a moon created by a battle erases the whole debris field [UPSTREAM debris_moon 1, the default]; debrisMoon 0 keeps it', async () => {
  const mk = (debrisMoon) => {
    const spec = W.loadScenario('basic');
    spec.universe = Object.assign({}, spec.universe, { moonFactor: 100000, moonChance: 100 });
    if (debrisMoon === undefined) delete spec.universe.debrisMoon; else spec.universe.debrisMoon = debrisMoon;
    const t = spec.others[0].planets[0];
    t.ships = { 204: 200 }; t.debris = { metal: 5000000, crystal: 0 };
    const w = W.createWorld(spec);
    const r = w.send({ originId: 254102, ships: { 207: 20, 204: 50 }, target: { galaxy: 2, system: 68, position: 10, type: 1 }, mission: 1 });
    assert.ok(r.ok, r.error);
    w.clock.advance(r.duration + 1);
    const battle = w.log.events.find((e) => e.kind === 'battle');
    assert.ok(battle && battle.debris.metal + battle.debris.crystal > 0, 'the battle made debris');
    return { w, field: w.snapshot().debris['2:68:10'] || null };
  };
  const a = mk(1);
  assert.equal(a.field, null, 'field (old 5M + new) erased by the new moon');
  const rep = Object.values(a.w.raports).find((r) => r.coords === '2:68:10');
  assert.ok(rep && rep.moonCreated === true && rep.moonChance === 100, 'the battle created the moon: ' + JSON.stringify(rep && { moonCreated: rep.moonCreated, moonChance: rep.moonChance }));
  const dflt = mk(undefined);
  assert.equal(dflt.field, null, 'no debrisMoon in the spec: the upstream default 1 erases the field too');
  const b = mk(0);
  assert.ok(b.field && b.field.metal >= 5000000, 'debrisMoon 0: field kept ' + JSON.stringify(b.field));
});

T.test('world: build queue, research, shipyard, refusals', async () => {
  const w = W.createWorld('botbuild-two-planets');
  const b = w.body(254102);
  const m0 = b.res.metal;
  assert.ok(w.order('buildings', 254102, { cmd: 'insert', id: 1 }).ok);
  assert.ok(b.res.metal < m0, 'cost paid at start');
  assert.equal(b.buildQueue[0].end - b.buildQueue[0].start, 30);
  assert.ok(w.order('research', 254102, { cmd: 'insert', id: 123 }).ok);
  assert.equal(w.order('buildings', 254102, { cmd: 'insert', id: 31 }).error, 'research running (31/6)');
  assert.ok(w.order('shipyard', 254102, { units: { 212: 3 } }).ok);
  assert.equal(w.order('buildings', 254102, { cmd: 'insert', id: 21 }).error, 'shipyard busy (15/21)');
  w.clock.advance(31);
  assert.equal(b.levels[1], 13);
  assert.equal(w.player.research[123], 1);
  assert.equal(b.ships[212], 3);
  assert.equal(w.log.refusals.filter((r) => r.kind === 'buildings').length, 2);
});

T.test('static mode: byte-identical pages, no world endpoints', async () => {
  const srv = await startGzServer({ gameJs: false });
  try {
    assert.equal(srv.world, null);
    const rewrite = (html) => html.replace(/https?:\/\/ogamex\.eu(?![:\w.-])/g, srv.origin);
    for (const name of pageNames()) {
      const r = await fetch(srv.origin + srv.pathFor(name));
      const want = rewrite(fs.readFileSync(path.join(PAGES, name + '.html'), 'utf8').replace(/<meta http-equiv="refresh"[^>]*>/i, ''));
      assert.equal(await r.text(), want, name);
    }
    const w = await fetch(srv.origin + '/__ogx/world');
    assert.equal(w.status, 404);
  } finally { await srv.close(); }
});

T.test('world server: inspection endpoint, logout, captcha', async () => {
  const srv = await startGzServer({ world: 'basic', gameJs: false });
  const get = http(srv);
  try {
    const snap = await (await fetch(srv.origin + '/__ogx/world')).json();
    assert.equal(snap.now >= NOW, true);
    assert.equal(snap.slots.max, 13);
    const r = await (await fetch(srv.origin + '/__ogx/world', { method: 'POST', body: JSON.stringify({ cmd: 'advance', args: { sec: 100 } }) })).json();
    assert.equal(r.ok, true);
    assert.ok(srv.world.clock.nowUnix() >= NOW + 100);
    srv.world.logout();
    let p = await get('page=overview');
    assert.equal(p.status, 302);
    assert.match(p.location, /index\.php$/);
    srv.world.login();
    srv.world.captcha(true);
    p = await get('page=overview');
    assert.match(p.text, /id="captcha"/);
    srv.world.captcha(false);
    p = await get('page=overview&ajax=1');
    assert.equal(p.status, 503, '503 on overview&ajax=1 kept');
    p = await get('page=fleetStep2', { token: 'nope' });
    assert.equal(p.status, 302);
    assert.match(p.location, /page=fleetTable&code=1/);
    // research levels and the imperium come from the world, never from the saved live account (impulse 7 / hyperspace 4)
    const R = srv.world.spec.player.research;
    p = await get('page=research');
    const lv = (html, id) => { const parts = html.split('data-technology="' + id + '"'); const m = /<span class="level"[^>]*>(\d+)</.exec(parts[2] || parts[1] || ''); return m ? +m[1] : null; };
    for (const id of [106, 115, 117, 118]) assert.equal(lv(p.text, id), +(R[id] || 0), 'research page level ' + id);
    p = await get('page=imperium');
    const rowOf = (name) => { const m = new RegExp('<td>' + name + '</td>\\s*<td>([\\d.]+)</td>').exec(p.text); return m ? +m[1].replace(/\./g, '') : null; };
    assert.equal(rowOf('Impulse Engine'), +(R[117] || 0), 'imperium research row from the world');
    assert.equal(rowOf('Hyperspace Engine'), +(R[118] || 0));
  } finally { await srv.close(); }
});

// ------------------------------------------------------------------ browser
T.test('bot env: 3-step send -> event box + fleetTable, recall, return', async () => {
  const env = await B.launchBot({ world: 'basic' });
  try {
    // the world clock runs in real time at gamespeed 2000: this flight takes seconds, so a slow page load could see it already
    // home after the recall. Almost freeze the clock; the test moves it with advance().
    env.world.clock.speedup = 0.001;
    const get = http(env.server);
    const html = await send3(get, { cp: 254102, ships: { 202: 10 }, target: { galaxy: 2, system: 70, position: 8 }, mission: 3, cargo: { metal: 5000 } });
    assert.match(html, /class="success">Fleet sent/);
    const f = env.world.fleets[0];
    assert.equal(f.mission, 3);
    const page = await env.game('overview', { cp: 254102 });
    const ev = await env.evalOgx(page, () => OGX.parse.gz.events(document));
    const fl = ev.filter((x) => x.fleetId === f.id);
    assert.deepEqual(fl.map((x) => [x.status, x.own, x.mission, x.from, x.to, x.endUnix]), [
      ['flight', true, 3, '2:68:5', '2:70:8', f.arrival], ['return', true, 3, '2:68:5', '2:70:8', f.back]]);
    assert.equal(fl[0].shipsText, '10 ' + W.catalog().name(202));
    assert.match(fl[0].cargoText, /5\.000 Metal/);
    const st = await env.evalOgx(page, () => OGX.parse.gz.serverTime(document));
    const nowU = env.world.clock.nowUnix();
    assert.ok(st.renderUnix <= nowU && st.renderUnix >= nowU - 5, `render ${st.renderUnix} vs world ${nowU}`);
    let ft = await env.evalOgx(await env.game('fleetTable'), () => OGX.parse.gz.fleetTable(document));
    assert.deepEqual(ft.slots, { used: 1, max: 13 });
    assert.equal(ft.flights.length, 1);
    assert.equal(ft.flights[0].fleetId, f.id);
    assert.equal(ft.flights[0].missionId, 3);
    assert.equal(ft.flights[0].recallable, true);
    assert.ok(ft.ships.some((s) => s.id === 202 && s.count === 190 && s.speed === 15000));
    assert.deepEqual(ft.bonus, { attack: 100, defense: 100, shield: 100, combustion: 120, impulse: 200, hyperspace: 240 });
    // recall through the form (one world second into the flight: the way back takes that long)
    assert.ok(f.arrival - env.world.clock.nowUnix() > 2, 'still outward');
    env.world.clock.advance(1);
    const r = await get('page=fleetTable&action=sendfleetback', { fleetID: f.id });
    assert.equal(r.status, 200);
    assert.equal(f.state, 'back');
    assert.equal(env.world.log.recalled.length, 1);
    ft = await env.evalOgx(await env.game('fleetTable'), () => OGX.parse.gz.fleetTable(document));
    assert.equal(ft.flights[0].returning, true);
    assert.equal(ft.flights[0].recallable, false);
    assert.equal(ft.flights[0].timerUnix, f.back);
    env.world.clock.advance(f.back - env.world.clock.nowUnix() + 1);
    assert.equal(f.state, 'done');
    assert.equal(env.world.body(254102).ships[202], 200);
    assert.ok(env.mutating().some((x) => x.page === 'fleetStep3'));
  } finally { await env.close(); }
});

T.test('bot env: spy report parsed exactly, hostile event, galaxy view', async () => {
  const env = await B.launchBot({ world: 'basic' });
  try {
    const W0 = env.world;
    const get = http(env.server);
    // fleetAjax spy like the galaxy page does
    const aj = JSON.parse((await get('page=fleetAjax&ajax=1&mission=6&planetID=301140')).text);
    assert.equal(aj.code, 600);
    assert.equal(aj.mess, 'Send 3 Spy Probe to 2:68:10 ...');
    W0.clock.advance(3600);
    const spy = W0.log.events.find((e) => e.kind === 'spy');
    assert.ok(spy && !spy.destroyed, JSON.stringify(spy));
    const page = await env.game('messages', { query: { category: 0 } });
    const rep = await env.evalOgx(page, () => {
      const tr = document.querySelector('#messagestable tr.message_head');
      const r = OGX.messages.parse.espionageFull(tr);
      return { target: r.target, resources: r.resources, defense: r.defense, buildings: r.buildings, research: r.research, known: r.known, exact: r.exact, ce: r.counterEspionage };
    });
    const tp = W0.other(3839).planets[0];
    assert.equal(rep.exact, true);
    assert.deepEqual([rep.resources.metal, rep.resources.crystal, rep.resources.deuterium], [tp.res.metal, tp.res.crystal, tp.res.deuterium]);
    assert.equal(rep.defense[401], 10);
    assert.equal(rep.buildings[1], 20);
    assert.equal(rep.research[106], 4);
    assert.deepEqual(rep.known, { ships: true, defense: true, buildings: true, research: true });
    assert.equal(rep.ce, spy.targetChance);
    // hostile event on every page
    const h = W0.addHostile({ toBodyId: 254102, ownerId: 3843, mission: 1, ships: { 204: 100 }, flightSec: 600 });
    const ov = await env.game('overview');
    const hev = (await env.evalOgx(ov, () => OGX.parse.gz.events(document))).find((x) => x.fleetId === h.id);
    assert.ok(hev, 'hostile event shown');
    assert.deepEqual([hev.own, hev.hostile, hev.mission, hev.ownerId, hev.from, hev.to, hev.endUnix], [false, true, 1, 3843, '2:69:4', '2:68:5', h.arrival]);
    // galaxy: own system free of charge, another one costs deuterium; inactive and vacation flags, debris
    const deut = W0.body(254102).res.deuterium;
    const gp = await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    const sys = await env.evalOgx(gp, () => OGX.galaxy.parseGz(document));
    const p10 = sys.positions.find((p) => p.position === 10);
    assert.deepEqual([p10.playerName, p10.status, p10.planetId, p10.playerId, p10.rank], ['Txemin', 'i', 301140, 3839, 455]);
    assert.equal(sys.positions.find((p) => p.position === 12).status, 'v');
    assert.deepEqual(sys.positions.find((p) => p.position === 11), undefined, 'debris alone is no planet');
    assert.equal(sys.positions.find((p) => p.position === 5).own, true);
    assert.equal(sys.free.some((f) => f.position === 9), true);
    assert.equal(Math.floor(W0.body(254102).res.deuterium) >= Math.floor(deut), true, 'own system costs nothing');
    const before = W0.body(254102).res.deuterium;
    const gp2 = await env.game('galaxy', { query: { galaxy: 2, system: 69 } });
    const sys2 = await env.evalOgx(gp2, () => OGX.galaxy.parseGz(document));
    const js = sys2.positions.find((p) => p.position === 4);
    assert.deepEqual([js.playerName, js.moon && js.moon.id, js.allianceTag], ['Jon Snow', 301161, 'NOVA']);
    assert.equal(W0.log.galaxyViews.filter((v) => v.system === 69)[0].cost, 10);
    assert.ok(W0.body(254102).res.deuterium < before + 1);
    W0.body(254102).perHour = { metal: 0, crystal: 0, deuterium: 0 };
    W0.body(254102).res.deuterium = 5;
    const nd = await env.game('galaxy', { query: { galaxy: 2, system: 70 } });
    assert.equal(await env.evalOgx(nd, () => OGX.parse.gz.infoMessage(document)), 'You dont have enough deuterium to view the galaxy');
  } finally { await env.close(); }
});

T.test('bot env: step 2 missions + staytime by haltSpeed, empty debris error, buildings queue', async () => {
  const env = await B.launchBot({ world: 'botexpo-slots' });
  try {
    const get = http(env.server);
    const step2 = async (ships, target) => {
      const s1 = {}; for (const [id, n] of Object.entries(ships)) s1['ship' + id] = n;
      const r1 = await get('page=fleetStep1&cp=254102', Object.assign(s1, { galaxy: target[0], system: target[1], planet: target[2], type: target[3] || 1 }));
      const token = /name="token" value="([^"]+)"/.exec(r1.text)[1];
      return { token, r: await get('page=fleetStep2', { token, speed: 10, galaxy: target[0], system: target[1], planet: target[2], type: target[3] || 1 }) };
    };
    // the html of a POST is loaded into the browser page through the route of the next GET (same parsers as live)
    const parseHtml = async (html, fn) => {
      const page = await env.page();
      return env.evalOgx(page, (a) => { const d = new DOMParser().parseFromString(a.html, 'text/html'); return OGX.parse.gz[a.fn](d); }, { html, fn });
    };
    let s = await step2({ 202: 5 }, [2, 68, 16]);
    let p = await parseHtml(s.r.text, 'fleetStep2');
    assert.deepEqual(p.missions.map((m) => m.id), [15]);
    assert.deepEqual(p.stayOptions.slice(0, 4).map((o) => o.hours), [0.5, 1, 1.5, 2]);
    assert.equal(p.stayOptions.length, 9);
    s = await step2({ 208: 1 }, [2, 68, 9]);
    p = await parseHtml(s.r.text, 'fleetStep2');
    assert.deepEqual(p.missions.map((m) => m.id), [7]);
    s = await step2({ 209: 1 }, [2, 68, 9, 2]);
    assert.equal(await parseHtml(s.r.text, 'infoMessage'), "Don't have any debris fields!");
    // step-1 data JSON from the world
    const r1 = await get('page=fleetStep1&cp=254102', { ship203: 2, galaxy: 2, system: 68, planet: 16, type: 1 });
    const d1 = await parseHtml(r1.text, 'fleetStep1');
    assert.deepEqual([d1.data.gamespeed, d1.data.fleetroom, d1.data.ships[203].amount, d1.data.planet.planet], [2000, '50000', '2', '5']);
    // no ships of the cp body -> back to fleetTable
    const r0 = await get('page=fleetStep1&cp=254102', { ship205: 1, galaxy: 2, system: 68, planet: 6 });
    assert.equal(r0.status, 302);
    // buildings POST -> queue box with timers, completes by the world clock
    const b = env.world.body(254102);
    const lv = b.levels[1];
    const post = await get('page=buildings&cp=254102', { cmd: 'insert', building: 1 });
    assert.equal(post.status, 302);
    const page = await env.game('buildings', { cp: 254102 });
    const box = await env.evalOgx(page, () => OGX.parse.gz.queueBox(document));
    assert.equal(box.empty, false);
    const q = b.buildQueue[0];
    assert.ok(box.timers.some((t) => t.dataTime === q.end), JSON.stringify(box.timers));
    // core items of the queue box: building id + target level, head rest seconds / end time
    assert.equal(box.items.length, 1, JSON.stringify(box.items));
    assert.equal(box.items[0].id, 1); assert.equal(box.items[0].level, q.level);
    assert.ok(box.items[0].endUnix === q.end || (box.items[0].restSec > 0 && box.items[0].restSec <= q.end - env.world.clock.nowUnix() + 2), JSON.stringify(box.items[0]));
    env.world.clock.advance(q.end - env.world.clock.nowUnix());
    assert.equal(b.levels[1], lv + 1);
    const items = await env.evalOgx(await env.game('buildings', { cp: 254102 }), () => OGX.parse.gz.techItems(document).find((x) => x.id === 1).value);
    assert.equal(items, lv + 1);
  } finally { await env.close(); }
});

T.test('bot env: journal, botStatus, setSettings, mutating', async () => {
  const env = await B.launchBot({ world: 'basic', settings: { 'botcore.master': false } });
  try {
    const st = await env.botStatus();
    assert.ok(st === null || typeof st === 'object');
    const j = await env.journal();
    assert.ok(Array.isArray(j) && j.length > 0, 'journal has the page events');
    await env.waitJournal(/./, { timeoutMs: 5000 });
    await env.setSettings({ 'botcore.master': false });
    await env.until(async () => true, { timeoutMs: 1000 });
    assert.ok(Array.isArray(env.mutating()));
  } finally { await env.close(); }
});
