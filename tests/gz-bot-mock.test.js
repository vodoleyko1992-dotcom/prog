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
  // economy = the live account: resources page 2026-10-31 (eu/pages/resources.html) — Metal Mine (38) 938.100.934, Crystal Mine (35)
  // 432.777.527, basic income 440.000 / 220.000 (x 22000); the officers / premium bonus row comes on top (Total 1.932.927.923)
  const live = JSON.parse(JSON.stringify(W.loadScenario('basic')));
  live.bodies[0].levels = Object.assign({}, live.bodies[0].levels, { 1: 38, 2: 35, 3: 33 }); live.bodies[0].tempMax = 72; delete live.bodies[0].perHour;
  live.universe.ecoScale = 1;        // basic pins the old x22 incomes (0.001); the default is the live economy
  const ph = W.createWorld(live).perHour(W.createWorld(live).body(254102));
  assert.ok(Math.abs(ph.metal - (938100934 + 440000)) / 938100934 < 0.001, 'metal/h of a level-38 mine: ' + ph.metal);
  assert.ok(Math.abs(ph.crystal - (432777527 + 220000)) / 432777527 < 0.001, 'crystal/h of a level-35 mine: ' + ph.crystal);
  assert.ok(ph.deuterium > 1e8 && ph.deuterium < 5e8, 'deuterium/h of a level-33 synthesizer at 72 °C: ' + ph.deuterium);
  const tiny = JSON.parse(JSON.stringify(live)); tiny.universe.ecoScale = 0.001;
  assert.ok(Math.abs(W.createWorld(tiny).perHour(W.createWorld(tiny).body(254102)).metal - ph.metal / 1000) < 1, 'ecoScale knob');
  // the stock grows with that income and stops at the storage
  const g = W.createWorld(live); const hb = g.body(254102); hb.res.metal = 0; hb.levels[22] = 28;
  g.clock.advance(3600);
  assert.ok(Math.abs(hb.res.metal - ph.metal) < 1000, 'one hour of production: ' + hb.res.metal);
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

T.test('world: bash rule [UPSTREAM CheckBash]: the 7th attack on one target within 24 h is refused (fl_bash_protection en / ru), recalled fleets and other targets do not count, the window slides', async () => {
  const atk = (x, pos = 10, ships = { 204: 1 }) => x.send({ originId: 254102, ships, target: { galaxy: 2, system: 68, position: pos, type: 1 }, mission: 1, speed: 10 });
  const w = W.createWorld('botfarm-three');            // GALAXYZ defaults: bashOn, 6 attacks per 86400 s
  assert.deepEqual([w.universe.bashOn, w.universe.bashCount, w.universe.bashTime], [true, 6, 86400]);
  for (let i = 0; i < 6; i++) assert.ok(atk(w).ok, 'attack ' + (i + 1));
  const r7 = atk(w);
  assert.equal(r7.ok, false); assert.equal(r7.code, 'bash'); assert.equal(r7.error, 'Bash Rule', 'en text (language/en/INGAME.php fl_bash_protection)');
  assert.equal(w.log.refusals.filter((r) => r.code === 'bash').length, 1);
  assert.equal(w.bashCount(302000), 6);
  // another target and a spy on the same target are not affected; the rule counts the target BODY (a moon has its own id)
  assert.ok(atk(w, 13).ok, 'another target');
  assert.ok(w.send({ originId: 254102, ships: { 210: 1 }, target: { galaxy: 2, system: 68, position: 10, type: 1 }, mission: 6 }).ok, 'espionage is not an attack');
  // a recalled attack does not count (LOG_FLEETS fleet_state 2)
  const w2 = W.createWorld('botfarm-three');
  for (let i = 0; i < 6; i++) { const r = atk(w2); assert.ok(r.ok); if (i === 0) assert.ok(w2.recall(r.fleet.id)); }
  assert.ok(atk(w2).ok, 'the recalled one does not count');
  assert.equal(atk(w2).code, 'bash');
  // the window slides: a day later the first six are out of it (returned fleets still count until then)
  w.clock.advance(86401);
  assert.ok(atk(w).ok, 'after 24 h');
  // knobs: lang ru text, bashCount, bashOn false
  const ru = JSON.parse(JSON.stringify(W.loadScenario('botfarm-three'))); ru.lang = 'ru'; ru.universe.bashCount = 1;
  const w3 = W.createWorld(ru);
  assert.ok(atk(w3).ok);
  assert.equal(atk(w3).error, 'Превышен лимит количества атак в сутки на данный пункт назначения.', 'ru text (language/ru/INGAME.php fl_bash_protection)');
  const off = JSON.parse(JSON.stringify(W.loadScenario('botfarm-three'))); off.universe.bashOn = false;
  const w4 = W.createWorld(off);
  for (let i = 0; i < 8; i++) assert.ok(atk(w4).ok, 'bashOn false: attack ' + (i + 1));
  // through HTTP: step 3 answers the info page with the text (what botcore.mapStep3Text reads)
  const srv = await startGzServer({ world: W.createWorld(ru) });
  try {
    const get = http(srv);
    const ok = await send3(get, { cp: 254102, ships: { 204: 1 }, target: { galaxy: 2, system: 68, position: 10 }, mission: 1 });
    assert.match(ok, /class="success">Fleet sent/, 'first raid accepted');
    const no = await send3(get, { cp: 254102, ships: { 204: 1 }, target: { galaxy: 2, system: 68, position: 10 }, mission: 1 });
    assert.ok(!/class="success"/.test(no) && no.includes('<p>Превышен лимит количества атак в сутки на данный пункт назначения.</p>'), 'second raid: info page with the ru text');
    assert.equal(srv.world.log.refusals.filter((r) => r.code === 'bash').length, 1);
  } finally { await srv.close(); }
});

T.test('world: lang ru [UPSTREAM language/ru] — event box sentences, fleet refusals, ship names; queueMarkup live [REAL queue/*-live.html]', async () => {
  const spec = JSON.parse(JSON.stringify(W.loadScenario('botsave-attack'))); spec.lang = 'ru'; spec.queueMarkup = 'live'; spec.hostile = [];
  const srv = await startGzServer({ world: spec });
  try {
    const w = srv.world; const get = http(srv);
    assert.equal(w.name(204), 'Лёгкий истребитель');
    const hp = w.addHostile({ toBodyId: 254102, ownerId: 3843, mission: 1, ships: { 204: 100 }, flightSec: 600 });
    const hm = w.addHostile({ toBodyId: 254110, ownerId: 3843, mission: 1, ships: { 204: 50 }, flightSec: 700 });
    const ov = (await get('page=overview&cp=254102')).text;
    const plain = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    const box = plain(ov.slice(ov.indexOf('<div id="messages_collapsed"'), ov.indexOf('<div id="messages_collapsed"') + 20000));
    assert.match(box, /Чужой флот \(\d+ Лёгкий истребитель\) игрока Jon Snow \[ЛС\] летит с Планета Winterfell \[2:69:4\] на Планета [^[]+\[2:68:5\]\. Задание: Атака/, 'hostile to the planet (cff_mission_target_bad ru): ' + box.slice(0, 600));
    assert.match(box, /на Луна [^[]+\[2:68:5\]\. Задание: Атака/, 'hostile to the moon: type word «Луна»');
    assert.ok(ov.includes(`fleettime_${hp.arrival}${hp.id}`) && ov.includes(`fleettime_${hm.arrival}${hm.id}`));
    // spy tech below 8: only the size of the hostile fleet
    w.player.research[106] = 4;
    assert.match(plain((await get('page=overview&cp=254102')).text), /\(Флот состоит из 100 кораблей\.\)/, 'cff_aproaching + cff_ships ru');
    w.player.research[106] = 12;
    // own fleets: «Ваш флот … летит с … на … Задание: Транспорт»
    const ok = await send3(get, { cp: 254102, ships: { 202: 1 }, target: { galaxy: 2, system: 68, position: 6 }, mission: 3, cargo: { metal: 1000 } });
    assert.match(ok, /class="success"/);
    assert.match(plain((await get('page=overview&cp=254102')).text), /Ваш флот \([^)]*\) \([^)]*\) летит с Планета [^[]+\[2:68:5\] на Планета [^[]+\[2:68:6\]\. Задание: Транспорт/);
    // fleet refusals in ru (FLEET.php): not all ships present
    const no = await send3(get, { cp: 254102, ships: { 202: 999999 }, target: { galaxy: 2, system: 68, position: 6 }, mission: 3, cargo: { metal: 1000 } });
    assert.ok(no.includes('Не все корабли доступны.') || no.includes('Нет свободных слотов.'), 'ru refusal text: ' + plain(no).slice(0, 300));
    // live queue markup: running item + queued ones, no building/tech inputs (what the 0.3.2 parser reads)
    assert.ok(w.order('buildings', 254102, { cmd: 'insert', id: 1 }).ok && w.order('buildings', 254102, { cmd: 'insert', id: 2 }).ok);
    const bp = (await get('page=buildings&cp=254102')).text;
    const lb = bp.slice(bp.indexOf('<div class="largebox">'), bp.indexOf('<!-- closes .content -->'));
    assert.match(lb, /<img class="build-icon" src="\.\/styles\/theme\/gow\/gebaeude\/1\.png">/);
    assert.match(lb, /<span class="build-level">Улучшить уровень\s*<span>\d+<\/span>/);
    assert.match(lb, /class="construction-queue-item tooltip"[^>]*gebaeude\/2\.png/);
    assert.ok(!/name="(building|tech)"/.test(lb) && !/id="buildlist"/.test(lb), 'no upstream #buildlist / building inputs');
    assert.ok(w.order('research', 254102, { cmd: 'insert', id: 106 }).ok);
    const rp = (await get('page=research&cp=254102')).text;
    assert.match(rp, /<div id="progressbars" data-time="\d+"/);
    assert.equal((rp.match(/gebaeude\/106\.png/g) || []).length, 2, 'the research page repeats the running item in the queued row');
  } finally { await srv.close(); }
});

T.test('world: fleetHandlerOnAjax false [UPSTREAM common.php:125-127] — an arrived spy reports only with the next full page, not on a messages ajax read', async () => {
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const onAjax of [false, true]) {
    const spec = JSON.parse(JSON.stringify(W.loadScenario('basic'))); spec.fleetHandlerOnAjax = onAjax; spec.speedup = 2000;
    const srv = await startGzServer({ world: spec });
    try {
      const w = srv.world; const get = http(srv);
      const r = w.send({ originId: 254102, ships: { 210: 1 }, target: { galaxy: 2, system: 68, position: 10, type: 1 }, mission: 6, speed: 10 });
      assert.ok(r.ok, JSON.stringify(r));
      await sleepMs(Math.ceil((r.fleet.arrival - w.clock.nowUnix() + 5) * 1000 / 2000));     // world time passes, nothing processed it
      assert.ok(w.clock.nowUnix() > r.fleet.arrival);
      await get('page=messages&mode=view&messcat=0&site=1&ajax=1');
      assert.equal(w.log.events.some((e) => e.kind === 'spy'), onAjax, `onAjax ${onAjax}: the ajax read ${onAjax ? 'ran' : 'did not run'} the fleet handler`);
      await get('page=overview&cp=254102');
      assert.ok(w.log.events.some((e) => e.kind === 'spy'), 'a full page runs it');
    } finally { await srv.close(); }
  }
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

T.test('world: mission 11 dark matter search [UPSTREAM MissionCaseFoundDM] — default [GUESS] always finds 100..300; dmMission upstream / never / scrap false; ru texts', async () => {
  // tests-mock-10: botexpo's DM stats and stop rules must also meet trips that find nothing and collectors that come home
  const HOME = 254102; const MOON = 254190;
  const mk = (dmMission, lang, collectors = 40) => {
    const s = JSON.parse(JSON.stringify(W.loadScenario('botexpo-dm')));
    s.universe.dmStayHours = 0.01;
    if (dmMission !== undefined) s.universe.dmMission = dmMission;
    if (lang) s.lang = lang;
    const home = s.bodies.find((b) => b.id === HOME);
    home.ships[220] = collectors;
    s.bodies.push({ id: MOON, type: 'moon', name: 'Луна', coords: home.coords, planetId: HOME, fieldsMax: 1, res: { metal: 0, crystal: 0, deuterium: 0 }, levels: {}, ships: {} });
    return W.createWorld(s);
  };
  const trip = (w, n) => {
    const r = w.send({ originId: HOME, ships: { 220: n }, target: { galaxy: 2, system: 68, position: 5, type: 3 }, mission: 11, staytime: 1 });
    assert.ok(r.ok, r.error);
    w.clock.advance(r.fleet.back - w.clock.nowUnix() + 1);
    const dm = w.log.events.filter((e) => e.kind === 'dm').pop();
    const back = w.messages.filter((m) => m.cat === 4).pop();
    return { dm, back, home220: w.body(HOME).ships[220] || 0, dmTotal: w.player.darkMatter };
  };
  // default: the old model (every trip a find, collectors scrapped), unchanged for the existing tests
  const g = mk(undefined);
  const g1 = trip(g, 2);
  assert.ok(g1.dm.found >= 100 && g1.dm.found <= 300 && g1.dm.chance === null, JSON.stringify(g1.dm));
  assert.equal(g1.home220, 38, 'scrapped');
  assert.match(g1.back.body, /They found \(Dark Matter\)[\d.]+ but the ships were scrapped/);
  // never finds: the collectors come home, nothing is credited, the upstream «nothing» / «without dm» texts
  const n = mk({ base: -1, max: -1 });
  const n1 = trip(n, 5);
  assert.deepEqual([n1.dm.found, n1.home220], [0, 40], 'no find, all collectors back');
  assert.equal(n1.back.body, 'Your fleet has returned from the expedition.');
  assert.ok(n.messages.some((m) => m.cat === 15 && /nothing exciting/.test(m.body)), 'sys_expe_nothing_1');
  // always finds with the upstream amounts; scrap false keeps the collectors
  const a = mk({ base: 100, max: 100, scrap: false });
  const a1 = trip(a, 4);
  assert.ok(a1.dm.found >= 423 && a1.dm.found <= 1278 && a1.dm.chance === 100, JSON.stringify(a1.dm));
  assert.equal(a1.home220, 40, 'scrap false: collectors back');
  // upstream chance: min(50, 30 + 0.25 x ships) — 40 collectors in one fleet = 40 %; over 40 seeded trips of 1 collector
  // (30.25 %) both outcomes occur
  const u = mk('upstream', undefined, 400);
  const finds = []; for (let i = 0; i < 40; i++) finds.push(trip(u, 1).dm);
  assert.ok(finds.every((d) => d.chance === 30.25), 'chance 30 + 0.25 x 1');
  const won = finds.filter((d) => d.found > 0).length;
  assert.ok(won > 0 && won < 40, 'some finds, some empty: ' + won + '/40');
  // ru: the upstream ru texts (botexpo reads «Тёмная материя (N)» from them)
  const r = mk({ base: 100, max: 100 }, 'ru');
  const r1 = trip(r, 2);
  assert.match(r1.back.body, /^Ваш флот вернулся из экспедиции\.<br>Найдено Тёмная материя \([\d.]+\), но корабли были сильно повреждены/);
  assert.equal(r1.home220, 38);
  const r0 = mk({ base: -1, max: -1 }, 'ru');
  assert.equal(trip(r0, 2).back.body, 'Ваш флот вернулся из экспедиции ни с чем.');
});

T.test('world: expeditionModel upstream [UPSTREAM MissionCaseExpedition] — tiers, found ships of the fleet\'s own types, battles with losses, lost fleets, return time changes', async () => {
  // tests-mock-20: the default model stays as it was (other tests rely on it); 'upstream' gives botexpo damaged and lost fleets
  const mk = (outcomes) => {
    const s = JSON.parse(JSON.stringify(W.loadScenario('botexpo-slots')));
    s.universe.expeditionModel = 'upstream';
    s.expeditionOutcomes = outcomes || [];
    s.player.research[124] = 16;   // 4 expedition slots
    const b = s.bodies.find((x) => x.id === 254102);
    Object.assign(b.ships, { 202: 1000, 203: 1000, 209: 50, 210: 500 });
    return W.createWorld(s);
  };
  const go = (w, ships) => {
    const r = w.send({ originId: 254102, ships, target: { galaxy: 2, system: 68, position: 16, type: 1 }, mission: 15, staytime: 1 });
    assert.ok(r.ok, r.error);
    return r.fleet;
  };
  // forced battle without lossPct: a tier loss is drawn, the losses are logged, survivors come home
  const w = mk([{ type: 'battle' }, { type: 'ships' }, { type: 'battle', lossPct: 100 }, { type: 'time' }]);
  const f1 = go(w, { 202: 100, 210: 10 }); const f2 = go(w, { 202: 100, 209: 10 }); const f3 = go(w, { 203: 10 }); const f4 = go(w, { 202: 1 });
  w.clock.advance(f1.stayEnd - w.clock.nowUnix() + 1);
  const ev = w.log.events.filter((e) => e.kind === 'expedition').map((e) => e.outcome);
  assert.equal(ev.length, 4);
  assert.ok(ev[0].model === 'upstream' && ev[0].lossPct >= 10 && ev[0].lossPct <= 100 && ev[0].lost[202] > 0, 'battle loss: ' + JSON.stringify(ev[0]));
  assert.equal(f1.ships[202], 100 - ev[0].lost[202], 'survivors fly home');
  assert.ok(Object.keys(ev[1].ships).length >= 1 && !ev[1].ships[209], 'found ships of the fleet\'s own types, never recyclers: ' + JSON.stringify(ev[1].ships));
  assert.equal(f3.state, 'done', 'lossPct 100: the fleet is lost'); assert.equal(f3.endReason, 'expedition battle');
  assert.ok(ev[3].delaySec !== 0 && f4.back !== f1.back, 'return time changed: ' + ev[3].delaySec);
  // seeded draws over many trips: every type and both resource / DM tiers above 1 show up, DM reaches past 300
  const u = mk([]);
  const seen = {}; const dm = []; let tiers = new Set();
  for (let round = 0; round < 30; round++) {
    [0, 1, 2, 3].forEach(() => go(u, { 202: 5 }));
    for (let i = 0; i < 100 && u.missionCount(15) > 0; i++) u.clock.advance(1800);   // a slower return takes longer
  }
  for (const e of u.log.events.filter((x) => x.kind === 'expedition')) {
    seen[e.outcome.type] = (seen[e.outcome.type] || 0) + 1;
    if (e.outcome.tier) tiers.add(e.outcome.type + e.outcome.tier);
    if (e.outcome.type === 'darkMatter') dm.push(e.outcome.amount);
  }
  for (const k of ['resources', 'darkMatter', 'ships', 'battle', 'blackHole', 'time', 'nothing']) assert.ok(seen[k] > 0, k + ' never drawn: ' + JSON.stringify(seen));
  assert.ok(dm.every((x) => x >= 100 && x <= 3000), JSON.stringify(dm));
  assert.ok([...tiers].some((x) => /2$|3$/.test(x)), 'a tier above 1 was drawn: ' + [...tiers]);
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

/** The bot's threats once the page with the event box was read (a few seconds after the load). */
async function threatsAfter(env, page, n) {
  let th = [];
  await env.until(async () => { th = await env.evalOgx(page, () => (OGX.bot && OGX.bot.threats ? OGX.bot.threats() : [])); return th.length >= n; }, { timeoutMs: 30000, label: n + ' threats' });
  return th;
}
/** The core's body key of a body id (OGX.state.bodies). */
const keyOf = async (env, page, id) => env.evalOgx(page, async (bid) => { const b = (await OGX.state.bodies()) || {}; const x = Object.values(b).find((v) => +v.id === +bid); return x ? x.key : null; }, id);

T.test('bot env (lang ru, live queue markup): hostile event parsed, threat keyed to the planet with the full owner name, live queues parsed', async () => {
  const spec = JSON.parse(JSON.stringify(W.loadScenario('botsave-attack'))); spec.lang = 'ru'; spec.queueMarkup = 'live'; spec.hostile = [];
  const env = await B.launchBot({ world: spec });
  try {
    const W0 = env.world;
    const h = W0.addHostile({ toBodyId: 254102, ownerId: 3843, mission: 1, ships: { 204: 100, 205: 20 }, flightSec: 600 });
    const ov = await env.game('overview');
    const hev = (await env.evalOgx(ov, () => OGX.parse.gz.events(document))).find((x) => x.fleetId === h.id);
    assert.ok(hev, 'hostile event shown');
    assert.deepEqual([hev.own, hev.hostile, hev.mission, hev.ownerId, hev.from, hev.to, hev.endUnix], [false, true, 1, 3843, '2:69:4', '2:68:5', h.arrival]);
    const th = (await threatsAfter(env, ov, 1)).find((x) => x.fleetId === h.id);
    assert.ok(th, 'threat registered');
    assert.deepEqual([th.toType, th.ownerName, th.ships && th.ships[204], th.ships && th.ships[205], th.units], [1, 'Jon Snow', 100, 20, 120], 'ru: planet, owner name before «[ЛС]», ru ship names: ' + JSON.stringify(th));
    assert.equal(th.bodyKey, await keyOf(env, ov, 254102), 'keyed to the home planet');
    // live queue markup through the core parser (what botbuild reads)
    assert.ok(W0.order('buildings', 254102, { cmd: 'insert', id: 1 }).ok && W0.order('buildings', 254102, { cmd: 'insert', id: 2 }).ok);
    const bp = await env.game('buildings', { cp: 254102 });
    const qb = await env.evalOgx(bp, () => { const x = OGX.parse.gz.queueBox(document); return x && { empty: x.empty, items: x.items.map((i) => [i.id, i.level, i.restSec]) }; });
    const lv = W0.body(254102).buildQueue.map((x) => [x.id, x.level]);
    assert.deepEqual(qb.items.map((i) => [i[0], i[1]]), lv, 'buildings queue: ' + JSON.stringify(qb));
    assert.ok(qb.items[0][2] > 0, 'rest seconds of the running item');
    assert.ok(W0.order('research', 254102, { cmd: 'insert', id: 106 }).ok);
    const rp = await env.game('research', { cp: 254102 });
    const rq = await env.evalOgx(rp, () => OGX.parse.gz.queueBox(document).items.map((i) => [i.id, i.level]));
    assert.deepEqual(rq, [[106, W0.researchQueue[0].level]], 'research queue (the repeated running row dropped)');
    assert.deepEqual(env.ogxErrors().map((e) => e.text), [], 'no [OGX errors');
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
    // tests-mock-16: a journal that cannot be read (here: the page is closed) fails waitJournal fast with the cause, it does
    // not wait out timeoutMs and report «no events».
    assert.equal(env.journalErr.n, 0, 'good reads leave no journal error');
    const p = await env.page(false);
    await p.close();
    const t0 = Date.now();
    await assert.rejects(env.waitJournal('never-such-kind', { timeoutMs: 120000, failMs: 2000, stepMs: 200 }),
      (e) => /journal cannot be read for \d+ s/.test(e.message) && /last journal read error \(\d+ in a row\): \S/.test(e.message));
    assert.ok(Date.now() - t0 < 30000, 'failed fast: ' + (Date.now() - t0) + ' ms');
  } finally { await env.close(); }
});
