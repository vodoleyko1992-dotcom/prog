'use strict';
// Foundation integration: the bot runtime (botcore executor) against the WORLD mode of the GALAXYZ mock (tests/gz-world.js,
// combat through botsim) via tests/gz-bot-lib.js. Proves the three foundation parts fit together end to end:
//   (1) dry-run in the world: master on, actions planned and logged, zero mutating requests, world unchanged
//   (2) live: read.fleetTable slots = world slots, probe.target missions, fleet.send verified with the WORLD fleet id,
//       recall verified and recorded by the world, build.building verified against the world queue, bot:fleet-returned
//       when the world fleet comes home
//   (3) a hostile fleet added to the world shows as a Threat, locks the body, a normal send from it is refused 'threat'
//   node tests/gz-bot-integrate.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;      // [2:68:5]
const COLONY = 254103;    // [2:68:6]
const NEWCOL = 254106;    // [2:70:8]
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0 };
const isolate = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), FAST, extra);
const slim = (r) => JSON.parse(JSON.stringify(Object.assign({}, r, { data: r && r.data ? Object.assign({}, r.data, { doc: undefined, html: undefined }) : r && r.data })));

/** Registers a one-shot worker (module botcore) that runs fn(wctx) once; the JSON result lands in OGX.__t[tag]. */
async function runWorker(env, page, tag, fnSrc, arg) {
  await env.evalOgx(page, ({ tag, fnSrc, arg }) => {
    OGX.__t = OGX.__t || {};
    OGX.__t[tag] = { done: false };
    // eslint-disable-next-line no-new-func
    const fn = new Function('return (' + fnSrc + ')')();
    OGX.bot.register({
      id: 'botcore:' + tag, module: 'botcore', prio: 'fleet', startJitter: [0, 50],
      async run(w) {
        if (OGX.__t[tag].started) return { nextInMs: 3600000 };
        OGX.__t[tag].started = true;
        try { OGX.__t[tag].value = JSON.parse(JSON.stringify(await fn(w, arg, (r) => JSON.parse(JSON.stringify(Object.assign({}, r, { data: r && r.data ? Object.assign({}, r.data, { doc: undefined, html: undefined }) : r && r.data })))))); }
        catch (e) { OGX.__t[tag].error = String(e && e.stack || e); }
        OGX.__t[tag].done = true;
        return { nextInMs: 3600000, reason: 'test done' };
      },
    });
  }, { tag, fnSrc: fnSrc.toString(), arg });
  let out = null;
  await env.until(async () => {
    out = await env.evalOgx(page, (tag) => (OGX.__t && OGX.__t[tag] && OGX.__t[tag].done ? OGX.__t[tag] : null), tag);
    return !!out;
  }, { timeoutMs: 120000, stepMs: 400, label: 'worker ' + tag });
  if (out.error) throw new Error('worker ' + tag + ': ' + out.error);
  return out.value;
}
const leader = (env) => env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 20000, label: 'leader' });
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
const TRANSPORT = { type: 'fleet.send', bodyId: HOME, why: 'тест: транспорт на колонию',
  params: { target: { galaxy: 2, system: 68, position: 6, type: 1 }, ships: { 202: 10 }, mission: 3, speed: 10, cargo: { metal: 1000, crystal: 0, deuterium: 0 } } };

T.test('(1) world + dry-run: actions are planned and journaled, nothing mutating reaches the world', async () => {
  const env = await B.launchBot({ world: 'basic', settings: isolate({ 'botcore.master': true }) });
  try {
    const page = env.firstPage;
    await leader(env);
    const t0 = Date.now();
    const r = await runWorker(env, page, 'dry', async (w, a, s) => {
      w.decide('Тест: транспорт', { why: a.why, inputs: a.params, chosen: 'fleet.send', alternatives: [] });
      const send = s(await w.act(a));
      const probe = s(await w.act({ type: 'probe.target', bodyId: a.bodyId, why: 'тест: миссии', params: { ships: a.params.ships, target: a.params.target, speed: 10 } }));
      const build = s(await w.act({ type: 'build.building', bodyId: 254103, prio: 'build', why: 'тест: рудник', params: { id: 1, cmd: 'insert' } }));
      return { send, probe, build };
    }, TRANSPORT);
    assert.equal(r.send.dry, true); assert.equal(r.send.refused, 'dryRun'); assert.equal(r.send.ok, true, JSON.stringify(r.send));
    assert.equal(r.build.dry, true); assert.equal(r.build.refused, 'dryRun');
    assert.equal(r.probe.ok, true, 'probe.target runs in dry-run: ' + JSON.stringify(r.probe));
    assert.deepEqual(r.probe.data.missions.slice().sort(), [3, 4], 'world step 2 offers transport + deploy to an own planet');
    const muts = env.mutating().filter((x) => x.t >= t0 && !/^fleetStep[12]$/i.test(x.page || ''));
    assert.deepEqual(muts.map((x) => x.method + ' ' + x.url), [], 'only the probe steps 1-2 were posted');
    assert.equal(env.world.log.sent.length, 0); assert.equal(env.world.log.builds.length, 0);
    const dry = await env.waitJournal('botcore:action-dry', { pred: (e) => e.d && e.d.type === 'fleet.send' });
    assert.ok(JSON.stringify(dry.d).includes('fleetStep3'), 'the dry entry carries the request that would have been sent');
    await clean(env, '(1)');
  } finally { await env.close(); }
}, { timeout: 180000 });

T.test('(2) world + live: slots, probe, send verified with the world fleet id, recall, build, fleet-returned', async () => {
  const env = await B.launchBot({ world: 'basic', settings: isolate({ 'botcore.master': true, 'botcore.dryRun': false }) });
  try {
    const page = env.firstPage;
    await leader(env);
    const W = env.world;
    const ships0 = W.body(HOME).ships[202];
    const r = await runWorker(env, page, 'live', async (w, a, s) => {
      const ft = s(await w.act({ type: 'read.fleetTable', bodyId: a.t.bodyId, prio: 'read', why: 'тест: слоты', params: {} }));
      const slots = await w.slots();
      const send = s(await w.act(a.t));
      const deploy = s(await w.act({ type: 'fleet.send', bodyId: a.t.bodyId, why: 'тест: перебазирование', params: { target: { galaxy: 2, system: 70, position: 8, type: 1 }, ships: { 202: 5 }, mission: 4, speed: 1 } }));
      const recall = deploy.data && deploy.data.fleetId ? s(await w.act({ type: 'fleet.recall', bodyId: a.t.bodyId, why: 'тест: отзыв', params: { fleetId: deploy.data.fleetId } })) : null;
      const build = s(await w.act({ type: 'build.building', bodyId: a.colony, prio: 'build', why: 'тест: фабрика роботов', params: { id: 14, cmd: 'insert' } }));
      // not affordable (metal mine 31 on 254105, empty queue): the world refuses silently (redirect) -> ok, not verified
      const poor = s(await w.act({ type: 'build.building', bodyId: a.poor, prio: 'build', why: 'тест: рудник без ресурсов', params: { id: 1, cmd: 'insert' } }));
      return { ft, slots, send, deploy, recall, build, poor };
    }, { t: TRANSPORT, colony: COLONY, poor: 254105 });
    assert.equal(r.ft.ok, true, JSON.stringify(r.ft));
    assert.equal(r.slots.known, true); assert.equal(r.slots.fleet.max, W.slotsMax(), 'slots max from the world fleetTable');
    // transport
    assert.equal(r.send.ok, true, 'send: ' + JSON.stringify(r.send)); assert.equal(r.send.verified, true, 'verified ' + JSON.stringify(r.send));
    const sent = W.log.sent.find((x) => x.mission === 3);
    assert.ok(sent, 'the world accepted the transport');
    assert.equal(r.send.data.fleetId, sent.fleetId, 'fleetId = world fleet id');
    assert.equal(Math.round(r.send.data.arrival / 1000), sent.arrival, 'arrival = world arrival');
    assert.equal(sent.originId, HOME); assert.equal(sent.cargo.metal, 1000);
    // deploy + recall
    assert.equal(r.deploy.ok, true, 'deploy: ' + JSON.stringify(r.deploy));
    assert.ok(r.recall, 'recall ran');
    assert.equal(r.recall.ok, true, JSON.stringify(r.recall)); assert.equal(r.recall.verified, true);
    assert.deepEqual(W.log.recalled.map((x) => x.fleetId), [r.deploy.data.fleetId]);
    // build
    assert.equal(r.build.ok, true, JSON.stringify(r.build)); assert.equal(r.build.verified, true, 'world queue box names it');
    assert.ok(W.log.builds.some((b) => (b.cp === COLONY || b.bodyId === COLONY) && b.id === 14), JSON.stringify(W.log.builds));
    assert.equal(W.body(COLONY).buildQueue.length, 1, 'world queue holds the order');
    assert.equal(r.poor.verified, false, 'silent refusal is not verified: ' + JSON.stringify(r.poor));
    assert.ok(W.log.refusals.some((x) => x.kind === 'buildings' && x.bodyId === 254105 && x.why === 'resources'), JSON.stringify(W.log.refusals));
    const h202 = W.body(HOME).ships[202];
    assert.ok(h202 >= ships0 - 15 && h202 <= ships0 - 10, 'transport out, recalled deploy maybe home: ' + h202);
    // the transport comes home -> bot:fleet-returned (runtime timer on the parsed event box)
    const back = W.fleets.find((f) => f.id === sent.fleetId).back;
    const waitSec = back - W.clock.nowUnix();
    assert.ok(waitSec < 60, 'gamespeed 2000: short flight ' + waitSec);
    await env.evalOgx(page, () => { OGX.__ret = []; OGX.bus.on('bot:fleet-returned', (p) => OGX.__ret.push(p)); });
    await env.until(async () => (await env.evalOgx(page, (id) => OGX.__ret.some((p) => p.fleetId === id), sent.fleetId)), { timeoutMs: (waitSec + 30) * 1000, label: 'fleet-returned' });
    const st = await env.botStatus();
    assert.equal(st.limits.fleetSends.used, 2);
    assert.equal(st.limits.builds.used, 2);
    await env.waitJournal('botcore:action-verify-fail', { pred: (e) => e.d && e.d.type === 'build.building' });
    await clean(env, '(2)');
  } finally { await env.close(); }
}, { timeout: 240000 });

T.test('(3) world hostile attack -> Threat + lock; a normal send from the body is refused, other bodies are free', async () => {
  const env = await B.launchBot({ world: 'basic', settings: isolate({ 'botcore.master': true, 'botcore.dryRun': false }) });
  try {
    const W = env.world;
    const h = W.addHostile({ toBodyId: HOME, mission: 1, ships: { 204: 500, 207: 20 }, ownerId: 3843, flightSec: 1800 });
    const page = await env.game('overview', { cp: HOME });
    await leader(env);
    await env.until(async () => (await env.evalOgx(page, () => OGX.bot.threats().length)) > 0, { timeoutMs: 15000, label: 'threat' });
    const th = await env.evalOgx(page, () => ({ threats: OGX.bot.threats(), locked: OGX.bot.lockedBodies() }));
    const t = th.threats[0];
    assert.equal(t.fleetId, h.id); assert.equal(t.mission, 1); assert.equal(t.bodyKey, 'p' + HOME);
    assert.equal(t.arrival, h.arrival * 1000); assert.equal(t.ownerId, 3843); assert.equal(t.probesOnly, false);
    assert.ok(th.locked['p' + HOME], 'home locked');
    const n0 = W.log.sent.length;
    const r = await runWorker(env, page, 'th', async (w, a, s) => {
      const locked = w.locked('p' + a.home);
      const home = s(await w.act(a.t));
      const other = s(await w.act(Object.assign({}, a.t, { bodyId: a.newcol, why: 'тест: с другой планеты', params: Object.assign({}, a.t.params, { target: { galaxy: 2, system: 68, position: 6, type: 1 }, ships: { 202: 1 }, cargo: { metal: 100, crystal: 0, deuterium: 0 } }) })));
      return { locked: !!locked, home, other };
    }, { t: TRANSPORT, home: HOME, newcol: NEWCOL });
    assert.equal(r.locked, true);
    assert.equal(r.home.ok, false); assert.equal(r.home.refused, 'threat');
    assert.equal(r.other.ok, true, 'other body not locked: ' + JSON.stringify(r.other));
    assert.equal(W.log.sent.length, n0 + 1);
    assert.equal(W.log.sent[W.log.sent.length - 1].originId, NEWCOL);
    await env.waitJournal('botcore:threat');
    await clean(env, '(3)');
  } finally { await env.close(); }
}, { timeout: 180000 });


T.test('(4) module integration: probe returns the step-1 data + fleet speed learnt, sync flights, ships taken off, target claims, slot holds, cancel', async () => {
  // acts in the name of botfarm / botexpo: those modules must be on (an off module's actions are refused, BOT_CONTRACT C10 S4);
  // their own workers stay idle (no farm targets, expeditions off, start jitter beyond this test)
  const env = await B.launchBot({ world: 'basic', settings: isolate({ 'botcore.master': true, 'botcore.dryRun': false,
    'botfarm.enabled': true, 'botfarm.on': true, 'botexpo.enabled': true, 'botexpo.on': true, 'botexpo.expeditions': false, 'botexpo.dmHunt': false }) });
  try {
    const page = env.firstPage;
    await leader(env);
    const W = env.world;
    const r = await runWorker(env, page, 'mods', async (w, a, s) => {
      const out = {};
      // probe.target: fleetStep1 data (speeds, maxspeed, gamespeed) + step-2 data; the server fleet speed is stored
      const probe = s(await w.act({ type: 'probe.target', bodyId: a.home, why: 'тест: данные шага 1', params: { ships: { 202: 10 }, target: { galaxy: 2, system: 68, position: 6, type: 1 }, speed: 10 } }));
      const server = await OGX.state.server();
      out.probe = { maxspeed: probe.data.data.maxspeed, gamespeed: probe.data.data.gamespeed, ships: Object.keys(probe.data.data.ships || {}), fleetroom: probe.data.data.fleetroom, fleetSpeed: server.fleetSpeed, known: server.fleetSpeedKnown };
      // a send: the sync flight list knows the fleet, the state ships of the origin drop at once
      const ships0 = ((await OGX.state.bodies())['p' + a.home].ships || {})[202];
      const send = s(await w.act(a.t));
      let fl = [];
      for (let i = 0; i < 40 && !fl.some((f) => f.fleetId === send.data.fleetId); i++) { fl = w.flights(); await new Promise((res) => setTimeout(res, 100)); }
      await new Promise((res) => setTimeout(res, 300));
      out.send = { ok: send.ok, fleetId: send.data.fleetId, inFlights: fl.some((f) => f.fleetId === send.data.fleetId && f.own), ships0, ships1: ((await OGX.state.bodies())['p' + a.home].ships || {})[202] };
      // claims: botfarm attacks 2:68:10; another module's attack on the same planet is refused 'duplicate'
      const atk = { type: 'fleet.send', bodyId: a.home, why: 'тест: атака', params: { target: { galaxy: 2, system: 68, position: 10, type: 1 }, ships: { 202: 5 }, mission: 1, speed: 10 } };
      out.farm = s(await w.act(Object.assign({}, atk, { module: 'botfarm' })));
      out.other = s(await w.act(Object.assign({}, atk, { module: 'botexpo', why: 'тест: вторая атака другим модулем' })));
      out.claims = OGX.bot.claims().map((c) => c.key + ' ' + c.module + ' ' + c.state);
      // slot holds: botcore holds every slot above the reserve -> botexpo's normal send is refused 'slots', the holder still sends
      const sl = await w.slots();
      const holds = [];
      for (let i = 0; i < sl.fleet.max - sl.fleet.used - 1; i++) holds.push(w.holdSlot({ until: w.now() + 120000, label: 'тест' }));
      out.canHolder = await (async () => { const c = await w.canSend('normal'); return { ok: c.ok, held: c.held }; })();
      out.heldOther = s(await w.act(Object.assign({}, a.t, { module: 'botexpo', why: 'тест: слот удержан другим модулем' })));
      out.heldOwn = s(await w.act(Object.assign({}, a.t, { why: 'тест: держатель слота отправляет' })));
      for (const id of holds) w.releaseSlot(id);
      // cancel: a queued action (at +60 s) of this module is dropped before it starts
      const later = w.act({ type: 'read.page', bodyId: a.home, why: 'тест: позже', params: { page: 'overview' }, at: w.now() + 60000, dedupeKey: 'test:later' });
      out.cancelled = w.cancel('test:later');
      out.later = s(await later);
      return out;
    }, { t: TRANSPORT, home: HOME });
    assert.ok(r.probe.maxspeed > 0 && r.probe.gamespeed === 2000 && r.probe.ships.includes('202') && r.probe.fleetroom > 0, 'probe data: ' + JSON.stringify(r.probe));
    assert.equal(r.probe.fleetSpeed, 2000, 'server fleet speed stored from the executor step 1'); assert.equal(r.probe.known, true);
    assert.equal(r.send.ok, true); assert.equal(r.send.inFlights, true, 'wctx.flights() (sync) lists the fleet');
    assert.equal(r.send.ships1, r.send.ships0 - 10, 'state ships of the origin drop by the sent ships: ' + JSON.stringify(r.send));
    assert.equal(r.farm.ok, true, JSON.stringify(r.farm));
    assert.equal(r.other.refused, 'duplicate', JSON.stringify(r.other));
    assert.ok(r.claims.includes('1:2:68:10:1 botfarm flying'), JSON.stringify(r.claims));
    assert.equal(W.log.sent.filter((x) => x.mission === 1 && x.to === '2:68:10').length, 1, 'one attack in the world');
    assert.equal(r.canHolder.ok, true, 'the holder itself can still send');
    assert.equal(r.heldOther.refused, 'slots', JSON.stringify(r.heldOther));
    assert.match(r.heldOther.message, /занято другими модулями/);
    assert.equal(r.heldOwn.ok, true, JSON.stringify(r.heldOwn));
    assert.equal(r.cancelled, 1); assert.equal(r.later.refused, 'expired'); assert.match(r.later.message, /отменено модулем/);
    await clean(env, '(4)');
  } finally { await env.close(); }
}, { timeout: 180000 });
