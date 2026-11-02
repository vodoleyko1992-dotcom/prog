'use strict';
// botdebris (debris prediction, recyclers timed to the battle, own fields, logistics) end to end: the suite in a browser against the
// WORLD mode of the GALAXYZ mock (tests/gz-world.js, scenario fixtures/galaxyz/bot-scenarios/botdebris-battle.json: gamespeed 2000,
// recyclers fly 3 s at 100 % and 27 s at 10 %). Battles are registered through OGX.bot.battles.put in the page (no botfarm); the
// battle's debris appears in the world by a script setDebris at the battle second. John's rules: debris only in Battle Recyclers 219
// (catalog cargo 20 M; the 209 on the same bodies are never used), transports only in Battle Transporters 217 (the 203 stay home).
// Fields are 1000 x the old 209-era sizes so the recycler counts (cap 20 000 -> 20 000 000) stay the same.
//   node tests/gz-bot-debris.test.js
// Every test also checks: no [OGX errors / bot console errors, and every botdebris action has a preceding botdebris:decision of the
// same worker run.
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;     // [2:68:5] 300 x 219 (+ 300 x 209 never used), 20 x 217 (+ 200 x 203 never used)
const MOON = 254110;     // moon of 254102, 300 x 219 (+ 300 x 209)
const COL7 = 254104;     // [2:68:7] own field 30 G / 20 G
const CAP = 20000000;    // Battle Recycler 219 cargo (catalog)
const K = 1000;          // field scale against the 209-era test (cap 20 000)
const COLONY = 254106;   // [2:70:8]
const OTHER_BOT = ['botsave', 'botfarm', 'botbuild', 'botexpo'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0 };
const LIVE = { 'botcore.master': true, 'botcore.dryRun': false, 'botdebris.on': true };
const settings = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), FAST, { 'botdebris.ownDf': false }, extra);

/** The scenario with script entries added (relative seconds from the world start). */
function spec(script = [], mutate) {
  const s = JSON.parse(JSON.stringify(W.loadScenario('botdebris-battle')));
  s.script = (s.script || []).concat(script);
  if (mutate) mutate(s);
  return s;
}
const leader = (env) => env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 30000, label: 'leader' });
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
/** Every botdebris action (queued or refused at enqueue) is preceded by a botdebris:decision of the same run. Returns the count. */
async function decisionsFirst(env, what) {
  const ev = await env.journal();
  const acts = ev.filter((e) => (e.k === 'botcore:action-queued' || e.k === 'botcore:action-refused') && e.d && e.d.module === 'botdebris' && e.d.run);
  const queued = new Set(ev.filter((e) => e.k === 'botcore:action-queued').map((e) => e.d && e.d.action));
  let n = 0;
  for (const a of acts) {
    if (a.k === 'botcore:action-refused' && a.d.action && queued.has(a.d.action)) continue;
    n++;
    const dec = ev.find((e) => e.k === 'botdebris:decision' && e.d && e.d.run === a.d.run && e.t <= a.t);
    assert.ok(dec, what + ': decision before ' + a.k + ' ' + a.d.type + ' (' + (a.d.why || '') + ')');
  }
  return n;
}
/** OGX.bot.battles.put in the page (what botfarm does after its attack left). */
async function putBattle(env, b) {
  const page = await env.page();
  await env.evalOgx(page, (x) => { OGX.bot.battles.put(x); }, b);
}
function battle(id, coords, arrivalUnix, { existing = null, p50 = { metal: 3000000 * K, crystal: 1000000 * K }, owner = 'botfarm' } = {}) {
  const [galaxy, system, position] = coords.split(':').map(Number);
  return { id, owner, target: { galaxy, system, position, type: 1 }, arrival: arrivalUnix * 1000, fleetId: null, status: 'flying',
    debris: { metal: p50.metal, crystal: p50.crystal, p10: p50, p50 }, existingDebris: existing, sim: {}, updated: Date.now() };
}
/**
 * Setup: the core learns the server's fleet speed from a fleetStep1 page (data.gamespeed), as it does on the live server when the
 * user opens the fleet dispatch (there it is 7; this world runs at 2000). The page is fetched and merged here instead of being
 * opened in the tab, so no fleetStep «user busy» mark (C3.7) can outlive the test setup.
 */
async function learnGameSpeed(env) {
  const page = await env.page();
  const fs = await env.evalOgx(page, async (cp) => {
    const body = new URLSearchParams({ galaxy: '2', system: '68', planet: '6', type: '1', target_mission: '0', ship210: '1' });
    const r = await fetch('game.php?page=fleetStep1&cp=' + cp, { method: 'POST', body, credentials: 'include' });
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    await OGX.state.merge(OGX.state.snapshotSync(doc));
    return (await OGX.state.server()).fleetSpeed;
  }, HOME);
  assert.equal(fs, 2000, 'fleet speed stored from the fleetStep1 data');
}
const recycleSends = (env) => env.world.log.sent.filter((x) => x.mission === 8);
const galaxyGets = (env) => env.server.requests.filter((r) => r.t >= env.launchedAt && r.page && /^galaxy$/i.test(r.page));

T.test('pre-send to a residual field: probe instead of a galaxy view, moon first on ties, floor((field - residual)/cap) when the margin would take the residual, step 3 at the precise second -> arrival in [battle+1, battle+2]', async () => {
  const BATTLE_IN = 150;
  const env = await B.launchBot({ world: spec([{ at: BATTLE_IN, do: 'setDebris', args: { coords: '2:68:10', metal: 3000000 * K + 1000, crystal: 1000000 * K } }]), settings: settings(LIVE) });
  try {
    const Wd = env.world;
    await learnGameSpeed(env);
    await leader(env);
    const battleAt = Wd.spec.startUnix + BATTLE_IN;
    await putBattle(env, battle('farm:2:68:10:1:' + battleAt, '2:68:10', battleAt, { existing: { metal: 1000, crystal: 0 } }));
    const planned = await env.waitJournal('botdebris:recyclers-planned', { timeoutMs: 60000 });
    assert.equal(planned.d.mode, 'pre', 'residual field -> pre-send: ' + JSON.stringify(planned.d).slice(0, 400));
    assert.deepEqual(planned.d.probe && planned.d.probe.missions.includes(8), true, 'probe.target offered mission 8');
    assert.equal(planned.d.shipId, 219, 'Battle Recyclers only');
    assert.equal(planned.d.n, Math.floor((4000000 * K) / CAP), 'recyclers = floor((field - residual) / cap) = 200: ceil x 1.1 = 220 would take the residual too');
    assert.equal(planned.d.origin, MOON, 'moon first on ties (same coordinates, both have 300)');
    assert.equal(galaxyGets(env).length, 0, 'no galaxy view (deuterium) for the field check');
    const probes = env.server.requests.filter((r) => r.t >= env.launchedAt && r.method === 'POST' && /fleetStep2/i.test(r.page || ''));
    assert.ok(probes.length >= 1, 'probe = steps 1-2');
    const sentEv = await env.waitJournal('botdebris:recyclers-sent', { timeoutMs: 200000 });
    const s = recycleSends(env);
    assert.equal(s.length, 1, 'one recycler send: ' + JSON.stringify(s));
    const x = s[0];
    assert.equal(x.originId, MOON, 'sent from the moon (cp)'); assert.equal(x.to, '2:68:10'); assert.equal(x.type, 2, 'to the debris field');
    assert.deepEqual(x.ships, { 219: 200 });
    if (process.env.OGX_DEBRIS_DBG || !(x.arrival - battleAt >= 1 && x.arrival - battleAt <= 2)) {
      const dbg = (await env.journal()).filter((e) => /timer-armed|timer-fired|recyclers-planned|recyclers-sent|recyclers-late/.test(e.k)).map((e) => e.k + ' ' + JSON.stringify(e.d).slice(0, 500));
      const step3 = env.server.requests.filter((r) => r.method === 'POST' && /fleetStep3/i.test(r.page || '')).map((r) => r.t);
      (x.arrival - battleAt >= 1 && x.arrival - battleAt <= 2 ? console.log : assert.fail)(`arrival battle + ${x.arrival - battleAt} s (step 3 at server second ${x.t}, flight ${x.arrival - x.t} s, speed ${x.speed}); battle ${battleAt}; step-3 local ms ${JSON.stringify(step3)}; world exact ${Wd.clock.nowExact()} at local ${Date.now()}\n  ${dbg.join('\n  ')}`);
    }
    assert.equal(x.speed, planned.d.speed, 'the planned (cheapest-fuel) speed');
    assert.ok(x.speed < 10, 'a slower, cheaper speed than 100 % fits the 90 s lead');
    assert.equal(sentEv.d.fleetId, x.fleetId, 'verified fleet id');
    assert.equal(Wd.log.recalled.length, 0, 'not recalled');
    // the world: battle debris at the battle second, recyclers harvest at +1..2 s, then the module reads the recycling report
    await env.until(() => { Wd.process(Wd.clock.nowUnix()); return Wd.log.events.some((e) => e.kind === 'recycle' && e.fleetId === x.fleetId); }, { timeoutMs: 60000, label: 'harvest' });
    const ev = Wd.log.events.find((e) => e.kind === 'recycle' && e.fleetId === x.fleetId);
    assert.ok(ev.got.metal + ev.got.crystal >= 4000000 * K, 'harvested the battle field: ' + JSON.stringify(ev));
    await env.game('overview', { cp: HOME });
    const h = await env.waitJournal('botdebris:harvest-own', { pred: (e) => e.d && e.d.kind === 'battle', timeoutMs: 60000 });
    assert.equal(h.d.harvested.metal + h.d.harvested.crystal, ev.got.metal + ev.got.crystal, 'journal: harvested from the report');
    assert.equal(h.d.predicted.metal + h.d.predicted.crystal, 4000000 * K + 1000, 'journal: predicted field');
    const n = await decisionsFirst(env, 'pre-send');
    assert.ok(n >= 3, 'probe, send, report read journaled: ' + n);
    await clean(env, 'pre-send');
  } finally { await env.close(); }
}, { timeout: 360000 });

T.test('no residual field: post-battle send at battle + 1 s at 100 % (no probe before the battle), recycler count with the residual kept (ceil + metal ballast)', async () => {
  const BATTLE_IN = 45;
  const env = await B.launchBot({ world: spec([{ at: BATTLE_IN, do: 'setDebris', args: { coords: '2:69:9', metal: 2000000 * K, crystal: 1000000 * K } }]), settings: settings(LIVE) });
  try {
    const Wd = env.world;
    await learnGameSpeed(env);
    await leader(env);
    const t1 = Date.now();
    const battleAt = Wd.spec.startUnix + BATTLE_IN;
    await putBattle(env, battle('farm:2:69:9:1:' + battleAt, '2:69:9', battleAt, { existing: null, p50: { metal: 2000000 * K, crystal: 1000000 * K } }));
    const planned = await env.waitJournal('botdebris:recyclers-planned', { timeoutMs: 40000 });
    assert.equal(planned.d.mode, 'post', 'no field before the battle -> post-battle: ' + JSON.stringify(planned.d).slice(0, 300));
    assert.equal(planned.d.n, Math.ceil((3000000 * K - 1000) / CAP), 'ceil((field - residual) / cap) = 150');
    assert.equal(planned.d.ballast, 150 * CAP - (3000000 * K - 1000), 'ballast 1 000 metal: storage 2 999 999 000 leaves exactly the residual');
    assert.ok(/остаток/.test(planned.w) && /поля нет до боя/.test(planned.w), 'the reason in the journal line: ' + planned.w);
    assert.equal(planned.d.departAt, battleAt * 1000 + 1000, 'timer at battle + 1 s');
    const sentEv = await env.waitJournal('botdebris:recyclers-sent', { timeoutMs: (BATTLE_IN + 60) * 1000 });
    const pre = env.server.requests.filter((r) => r.t >= t1 && r.method === 'POST' && /fleetStep/i.test(r.page || '') && r.t < battleAt * 1000);
    assert.equal(pre.length, 0, 'nothing posted before the battle (mission 8 is refused while the field is empty)');
    const s = recycleSends(env);
    assert.equal(s.length, 1, JSON.stringify(s));
    const x = s[0];
    assert.equal(x.speed, 10, '100 %'); assert.equal(x.to, '2:69:9'); assert.equal(x.type, 2);
    assert.deepEqual(x.ships, { 219: 150 });
    assert.equal(x.cargo.metal, 1000, 'ballast loaded: ' + JSON.stringify(x.cargo));
    // the field after the harvest keeps the residual (2Moons storage = recyclers - cargo on board)
    await env.until(async () => Wd.log.events.some((e) => e.kind === 'recycle' && e.fleetId === x.fleetId), { timeoutMs: 120000, stepMs: 1000, label: 'recycle' });
    const rec = Wd.log.events.find((e) => e.kind === 'recycle' && e.fleetId === x.fleetId);
    assert.ok(rec.left.metal + rec.left.crystal >= 998 && rec.left.metal + rec.left.crystal <= 1000, 'residual left: ' + JSON.stringify(rec.left));
    assert.ok(x.t >= battleAt + 1 && x.t <= battleAt + 6, `step 3 at battle + ${x.t - battleAt} s`);
    assert.equal(sentEv.d.mode, 'post');
    assert.equal(sentEv.d.fleetId, x.fleetId);
    const tm = await env.journal({ kind: 'botcore:timer-armed' });
    assert.ok(tm.some((e) => e.d && e.d.label === 'botdebris:post'), 'persisted timer botdebris:post');
    assert.ok(await decisionsFirst(env, 'post') >= 1);
    await clean(env, 'post');
  } finally { await env.close(); }
}, { timeout: 240000 });

T.test('battle cancelled: before departure the plan is dropped (no send), after a pre-send departure the recyclers are recalled before arrival', async () => {
  const BATTLE_IN = 140;
  const env = await B.launchBot({ world: spec([]), settings: settings(LIVE) });
  try {
    const Wd = env.world;
    await learnGameSpeed(env);
    await leader(env);
    const battleAt = Wd.spec.startUnix + BATTLE_IN;
    const farAt = Wd.spec.startUnix + 1800;
    const near = battle('farm:2:68:10:1:' + battleAt, '2:68:10', battleAt, { existing: { metal: 1000, crystal: 0 } });
    const far = battle('farm:2:68:10:1:' + farAt, '2:68:10', farAt, { existing: { metal: 1000, crystal: 0 } });
    await putBattle(env, far);
    const pFar = await env.waitJournal('botdebris:recyclers-planned', { pred: (e) => e.d && e.d.battle === far.id, timeoutMs: 60000 });
    assert.equal(pFar.d.mode, 'pre');
    // cancelled long before its departure -> plan dropped, nothing queued
    await env.evalOgx(await env.page(), (id) => OGX.bot.battles.remove(id, 'recall: тест'), far.id);
    const cFar = await env.waitJournal('botdebris:skip', { pred: (e) => e.d && e.d.battle === far.id && e.d.reason === 'battleCancelled', timeoutMs: 30000 });
    assert.ok(/recall/.test(cFar.d.why), JSON.stringify(cFar.d));
    // the near battle: pre-send, then the attack is recalled while the recyclers fly
    await putBattle(env, near);
    await env.waitJournal('botdebris:recyclers-planned', { pred: (e) => e.d && e.d.battle === near.id, timeoutMs: 60000 });
    const sentEv = await env.waitJournal('botdebris:recyclers-sent', { pred: (e) => e.d && e.d.battle === near.id, timeoutMs: 200000 });
    const x = recycleSends(env).find((f) => f.fleetId === sentEv.d.fleetId);
    assert.ok(x, 'sent');
    await env.evalOgx(await env.page(), (id) => OGX.bot.battles.remove(id, 'recall: цель изменилась'), near.id);
    await env.waitJournal('botdebris:skip', { pred: (e) => e.d && e.d.reason === 'recalled' && e.d.battle === near.id, timeoutMs: 30000 });
    const rc = Wd.log.recalled.find((r) => r.fleetId === x.fleetId);
    assert.ok(rc, 'world recalled the recyclers');
    assert.ok(rc.t < x.arrival, `recalled ${x.arrival - rc.t} s before the arrival`);
    assert.equal(recycleSends(env).length, 1, 'only the near battle was sent');
    await decisionsFirst(env, 'cancel');
    await clean(env, 'cancel');
  } finally { await env.close(); }
}, { timeout: 360000 });

/** Opens the galaxy page of 2:68 as the user (the core caches the rows; the bot itself never views the galaxy with budget 0). */
async function viewOwnSystem(env) {
  const page = await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
  await env.until(async () => !!(await env.evalOgx(page, async () => { const s = await OGX.galaxy.cached(2, 68); return s && s.positions && s.positions.some((p) => p.debris); })), { timeoutMs: 15000, label: 'galaxy cache' });
  await env.game('overview', { cp: HOME });
}
const wakeBot = async (env) => env.evalOgx(await env.page(), () => OGX.bot.needs.set('test-wake', []));

T.test('own debris field: galaxy cache only, a flying own recycle fleet blocks a duplicate, then moon any before planet, one send', async () => {
  const env = await B.launchBot({ world: spec([]), settings: settings(Object.assign({}, LIVE, { 'botdebris.ownDf': true })) });
  try {
    const Wd = env.world;
    await learnGameSpeed(env);
    // an own recycle fleet (10 recyclers of 254103 at 10 %) already flies to the own field 2:68:7
    const other = Wd.send({ originId: 254103, ships: { 219: 10 }, target: { galaxy: 2, system: 68, position: 7, type: 2 }, mission: 8, speed: 1 });
    assert.ok(other.ok, JSON.stringify(other));
    await viewOwnSystem(env);
    const viewsBefore = galaxyGets(env).length;
    await leader(env);
    await env.until(async () => { await wakeBot(env); return (await env.journal({ kind: 'botdebris:skip' })).some((e) => e.d && e.d.reason === 'duplicate'); }, { timeoutMs: 60000, stepMs: 3000, label: 'duplicate skip' });
    const dup = (await env.journal({ kind: 'botdebris:skip' })).find((e) => e.d && e.d.reason === 'duplicate');
    assert.deepEqual(dup.d.fleets, [other.fleet.id], 'compared by value g:s:p:2 with the flying fleet');
    const bot = () => recycleSends(env).filter((x) => x.originId !== 254103);
    assert.equal(bot().length, 0, 'no duplicate send');
    // that fleet is home: the user views the system again (fresh cache) -> the bot harvests the rest
    await env.until(() => { Wd.process(Wd.clock.nowUnix()); return other.fleet.state === 'done'; }, { timeoutMs: 120000, label: 'first fleet home' });
    await viewOwnSystem(env);
    await env.until(async () => { await wakeBot(env); return bot().length > 0; }, { timeoutMs: 120000, stepMs: 3000, label: 'own send' });
    const sentEv = await env.waitJournal('botdebris:harvest-own', { pred: (e) => e.d && e.d.kind === 'own-sent', timeoutMs: 30000 });
    assert.equal(bot().length, 1, JSON.stringify(bot()));
    const x = bot()[0];
    assert.equal(x.to, '2:68:7'); assert.equal(x.type, 2);
    assert.equal(x.originId, MOON, 'moon with some recyclers before a planet (none has the 2740 needed)');
    assert.deepEqual(x.ships, { 219: 300 });
    assert.equal(sentEv.d.fleetId, x.fleetId);
    const dec = (await env.journal({ kind: 'botdebris:decision' })).find((e) => /своё поле/.test(e.w || ''));
    assert.ok(dec && /луна, сколько есть/.test(dec.d.why), 'origin class in the decision: ' + JSON.stringify(dec && dec.d));
    assert.equal(galaxyGets(env).length, viewsBefore + 1, 'only the user\'s second view: the bot viewed no galaxy (budget 0)');
    await decisionsFirst(env, 'own');
    await clean(env, 'own');
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('logistics: a botbuild need -> one exact transport (cargo + fuel <= capacity) from the storage body; the next run skips while it flies', async () => {
  const env = await B.launchBot({ world: spec([]), settings: settings(Object.assign({}, LIVE, { 'botdebris.logistics': true, 'botdebris.logisticsOrigin': String(HOME), 'botdebris.followBattles': false })) });
  try {
    const Wd = env.world;
    await learnGameSpeed(env);
    await leader(env);
    const key = await env.evalOgx(await env.page(), async (id) => Object.values(await OGX.state.bodies()).find((b) => +b.id === id).key, COLONY);
    await env.evalOgx(await env.page(), (k) => OGX.bot.needs.set('botbuild', [{ id: 'need:1', bodyKey: k, res: { metal: 1000000, crystal: 500000, deuterium: 0 }, forItem: { id: 1, level: 31 }, wantedBy: OGX.time.serverNow(), priority: 1 }]), key);
    const sentEv = await env.waitJournal('botdebris:transport-sent', { timeoutMs: 60000 });
    const s = Wd.log.sent.filter((x) => x.mission === 3);
    assert.equal(s.length, 1, JSON.stringify(s));
    const x = s[0];
    assert.equal(x.originId, HOME); assert.equal(x.to, '2:70:8');
    assert.deepEqual({ metal: x.cargo.metal, crystal: x.cargo.crystal, deuterium: x.cargo.deuterium }, { metal: 1000000, crystal: 500000, deuterium: 0 }, 'exactly the missing resources');
    assert.deepEqual(Object.keys(x.ships).map(Number), [217], 'Battle Transporters only (the 200 heavy cargo stay): ' + JSON.stringify(x.ships));
    const n = x.ships[217];
    assert.ok(n * 40000000 >= 1500000 + x.consumption && (n - 1) * 40000000 < 1500000 + x.consumption, `${n} x 217: smallest count with cargo + fuel ${x.consumption} <= capacity`);
    assert.equal(sentEv.d.fleetId, x.fleetId);
    // the need is still listed (botbuild has not re-planned): no second transport while ours flies
    await env.game('overview', { cp: HOME });
    await env.until(async () => {
      await env.evalOgx(await env.page(), (k) => OGX.bot.needs.set('botbuild', [{ id: 'need:1', bodyKey: k, res: { metal: 1000000, crystal: 500000, deuterium: 0 }, forItem: { id: 1, level: 31 }, wantedBy: OGX.time.serverNow(), priority: 1 }]), key);
      return (await env.journal({ kind: 'botdebris:skip' })).some((e) => e.d && e.d.reason === 'inFlight');
    }, { timeoutMs: 60000, stepMs: 3000, label: 'inFlight skip' });
    assert.equal(Wd.log.sent.filter((y) => y.mission === 3).length, 1, 'one transport');
    await decisionsFirst(env, 'logistics');
    await clean(env, 'logistics');
  } finally { await env.close(); }
}, { timeout: 240000 });

T.test('dry-run: every send is planned and journaled (action-dry), nothing mutating reaches the server; master off: nothing at all', async () => {
  const BATTLE_IN = 150;
  const env = await B.launchBot({ world: spec([]), settings: settings({ 'botcore.master': true, 'botcore.dryRun': true, 'botdebris.on': true, 'botdebris.ownDf': true, 'botdebris.logistics': true, 'botdebris.logisticsOrigin': String(HOME) }) });
  try {
    const Wd = env.world;
    await learnGameSpeed(env);
    await viewOwnSystem(env);
    await leader(env);
    const t1 = Date.now();
    const battleAt = Wd.spec.startUnix + BATTLE_IN;
    const postAt = Wd.spec.startUnix + 50;
    const key = await env.evalOgx(await env.page(), async (id) => Object.values(await OGX.state.bodies()).find((b) => +b.id === id).key, COLONY);
    await env.evalOgx(await env.page(), (k) => OGX.bot.needs.set('botbuild', [{ id: 'need:1', bodyKey: k, res: { metal: 1000000, crystal: 0, deuterium: 0 }, forItem: { id: 1, level: 31 }, wantedBy: OGX.time.serverNow(), priority: 1 }]), key);
    await putBattle(env, battle('farm:2:68:10:1:' + battleAt, '2:68:10', battleAt, { existing: { metal: 1000, crystal: 0 } }));
    await putBattle(env, battle('farm:2:69:9:1:' + postAt, '2:69:9', postAt, { existing: null }));
    const dryOf = async (pred) => (await env.journal({ kind: 'botcore:action-dry' })).filter((e) => e.d && e.d.module === 'botdebris' && pred(e.d));
    await env.until(async () => (await dryOf((d) => d.type === 'fleet.send' && d.params.mission === 8 && d.params.target.position === 10)).length > 0
      && (await dryOf((d) => d.type === 'fleet.send' && d.params.mission === 8 && d.params.target.position === 9)).length > 0
      && (await dryOf((d) => d.type === 'fleet.send' && d.params.mission === 8 && d.params.target.position === 7)).length > 0
      && (await dryOf((d) => d.type === 'fleet.send' && d.params.mission === 3)).length > 0, { timeoutMs: 150000, stepMs: 2000, label: 'dry sends' });
    const pre = (await dryOf((d) => d.type === 'fleet.send' && d.params.target.position === 10))[0];
    assert.ok(pre.d.requests.some((r) => r.page === 'fleetStep3'), 'the journal shows the step-3 request that would be sent');
    const plans = await env.journal({ kind: 'botdebris:recyclers-planned' });
    assert.equal(plans.find((e) => e.d.battle.includes('2:68:10')).d.mode, 'pre', 'pre-send planned from the residual hint (no probe in dry-run)');
    const panel = await env.evalOgx(await env.page(), () => { const d = document.createElement('div'); const r = OGX.bot._panelSection('botdebris'); if (r) r(d); return d.innerHTML; });
    assert.ok(/ogx-b-debris-plans/.test(panel) && /пред-отправка/.test(panel) && /после боя/.test(panel) && /пробный режим/.test(panel), 'panel section: plans with mode and status: ' + panel.slice(0, 300));
    assert.equal(env.mutating().filter((r) => r.t >= t1).length, 0, 'nothing mutating: ' + JSON.stringify(env.mutating().filter((r) => r.t >= t1).map((r) => r.method + ' ' + r.page)));
    assert.equal(Wd.log.sent.length, 0);
    await decisionsFirst(env, 'dry-run');
    await clean(env, 'dry-run');
  } finally { await env.close(); }
  // master off: the module is on, a battle is registered, still nothing runs
  const off = await B.launchBot({ world: spec([]), settings: settings({ 'botcore.master': false, 'botcore.dryRun': false, 'botdebris.on': true, 'botdebris.ownDf': true }) });
  try {
    const at = off.world.spec.startUnix + 120;
    await putBattle(off, battle('farm:2:68:10:1:' + at, '2:68:10', at, { existing: { metal: 1000, crystal: 0 } }));
    await new Promise((r) => setTimeout(r, 20000));
    await off.game('overview', { cp: HOME });
    assert.equal((await off.journal({ kind: /^botdebris:/ })).length, 0, 'no botdebris event while the master switch is off');
    assert.equal(off.mutating().length, 0, 'nothing mutating');
    assert.equal(off.world.log.sent.length, 0);
    await clean(off, 'master off');
  } finally { await off.close(); }
}, { timeout: 360000 });

T.test('gates: sleep runs nothing; the slot reserve stops own-field sends (normal class); a threat lock on the moon moves the send to the planet', async () => {
  const wall = new Date(Date.now() + 7200 * 1000);   // server wall clock (UTC+2)
  const hm = (h, m) => String((h + 24) % 24).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  const sleep = { 'botcore.sleepOn': true, 'botcore.sleepFrom': hm(wall.getUTCHours() - 1, wall.getUTCMinutes()), 'botcore.sleepTo': hm(wall.getUTCHours() + 1, wall.getUTCMinutes()) };
  const env = await B.launchBot({ world: spec([]), settings: settings(Object.assign({}, LIVE, sleep, { 'botdebris.ownDf': true })) });
  try {
    const Wd = env.world;
    await learnGameSpeed(env);
    await viewOwnSystem(env);
    await leader(env);
    // 1. sleep window around now
    await env.until(async () => (await env.botStatus()).state === 'sleeping', { timeoutMs: 30000, label: 'sleeping' });
    const t1 = Date.now();
    await wakeBot(env);
    await new Promise((r) => setTimeout(r, 12000));
    assert.equal((await env.journal({ kind: 'botdebris:decision' })).filter((e) => e.t >= t1).length, 0, 'no decisions while asleep');
    assert.equal(recycleSends(env).length, 0);
    // 2. slot reserve: 10 fleet slots (computer 9), reserve 10 (the maximum) -> no normal send
    Wd.player.research[108] = 9;
    await env.setSettings({ 'botcore.sleepOn': false, 'botcore.slotsReserve': 10 });
    await env.until(async () => { await wakeBot(env); return (await env.journal({ kind: 'botdebris:skip' })).some((e) => e.d && e.d.reason === 'slots'); }, { timeoutMs: 90000, stepMs: 3000, label: 'slots skip' });
    assert.equal(recycleSends(env).length, 0, 'slot reserve respected');
    // 3. hostile attack on the moon: locked -> the planet sends
    Wd.addHostile({ toBodyId: MOON, mission: 1, ships: { 204: 50 }, ownerId: 3843, flightSec: 600 });
    await env.game('overview', { cp: HOME });
    await env.until(async () => Object.keys(await env.evalOgx(await env.page(), () => OGX.bot.lockedBodies())).length > 0, { timeoutMs: 30000, label: 'lock' });
    await env.setSettings({ 'botcore.slotsReserve': 1 });
    await env.setSettings({ 'botdebris.checkMinMin': 1 });   // a module setting change re-checks the own fields
    await env.until(async () => { await wakeBot(env); return recycleSends(env).length > 0; }, { timeoutMs: 120000, stepMs: 3000, label: 'send from the planet' });
    const x = recycleSends(env)[0];
    assert.equal(x.originId, HOME, 'the locked moon is not used; among planets with some recyclers the one with most (254102: 300, 254103: 10)');
    assert.deepEqual(x.ships, { 219: 300 });
    await decisionsFirst(env, 'gates');
    await clean(env, 'gates');
  } finally { await env.close(); }
}, { timeout: 360000 });
