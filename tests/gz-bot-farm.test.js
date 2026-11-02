'use strict';
// botfarm end to end against the GALAXYZ mock in WORLD mode (tests/gz-world.js, combat through botsim) via tests/gz-bot-lib.js.
// Scenarios: fixtures/galaxyz/bot-scenarios/botfarm-three.json (empty 2:68:10, defended 2:68:13 = 20 LF + 50 RL, inactive in
// vacation 2:68:12; gamespeed 40) and botfarm-build.json (1 Battle Transporter + 5 large cargos at home, unit time 1 s).
// John's rule: loot is carried only by Battle Transporters 217 (the 202/203 at home are never picked).
//   (a) defaults / master off / module off -> nothing at all
//   (b) dry-run -> decisions + action-dry, zero mutating requests, vacation skipped
//   (c) live: spy count from the 2Moons formula, report parsed exactly, empty target -> cargo only with the exact capacity,
//       defended -> optimizeRaid composition (sim summary in the journal), vacation skipped, battle registry, escort spy before
//       the attack, loot = half of every resource
//   (d) scripted change after launch (target gains 50 heavy fighters) -> escort sees it -> recall before arrival + battle-cancelled
//   (e) buildShips -> build.units on the origin, then the attack with the built ships
//   the server's bash rule (attacks per day on one target) end to end: tests/gz-bot-farm-bash.test.js
// Every test: no [OGX errors, no bot console errors, a botfarm:decision before every botfarm action.
//   node tests/gz-bot-farm.test.js
const path = require('path');
const T = require('./lib');
const B = require('./gz-bot-lib');
const S = require('../ogamex-bot/modules/botsim/botsim.js');
const GW = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;
const OTHER_BOT = ['botsave', 'botdebris', 'botbuild', 'botexpo', 'botmissiles'];
const BASE = Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])),
  { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botfarm.minLoot': 100000, 'botfarm.escortLeadSec': 40,
    'spy.probes': 5 });   // the suite's probes per spy (default 1100; the home planet has 50)
const LIVE = { 'botcore.master': true, 'botcore.dryRun': false, 'botfarm.on': true };
const UNITS = S.unitTable(S.loadCatalog(path.join(__dirname, '..', 'shared', 'core', '08-catalog-data.js')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function leader(env) { await env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 25000, label: 'leader' }); }
/** Wakes the farm workers now (a settings change re-jitters them 40-140 s after a 2 s debounce: wait it out first). */
async function kick(env) {
  await sleep(2600);
  const p = await env.page();
  await env.evalOgx(p, () => { OGX.bus.emit('bot:fleet-returned', { fleetId: 0, mission: 0, bodyKey: null, at: OGX.time.serverNow(), why: 'test kick' }); });
}
async function startLive(env, extra = {}) {
  await env.game('galaxy', { query: { galaxy: 2, system: 68 } });      // the user views the system: the galaxy cache knows the targets
  const t0 = Date.now();
  await env.setSettings(Object.assign({}, LIVE, extra));
  await leader(env);
  await kick(env);
  return t0;
}
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
/** Every action botfarm queued (except the slot reads wctx.canSend makes itself) has a botfarm:decision of the same run before it. */
async function decisionsFirst(env, what) {
  const j = await env.journal();
  const acts = j.filter((e) => e.k === 'botcore:action-queued' && e.d && e.d.module === 'botfarm' && e.d.type !== 'read.fleetTable');
  assert.ok(acts.length > 0, what + ': botfarm queued actions');
  for (const a of acts) {
    const dec = j.filter((e) => e.k === 'botfarm:decision' && e.d && e.d.run === a.d.run && e.t <= a.t);
    assert.ok(dec.length, what + ': decision before ' + a.d.type + ' ' + (a.d.why || '') + ' (run ' + a.d.run + ')');
  }
  return acts;
}
const ev = (env, kind, pred) => env.waitJournal(kind, { pred, timeoutMs: 200000, stepMs: 700 });
const capOf = (id) => UNITS[id].capacity;

T.test('(a) defaults, master off, module off: botfarm does nothing', async () => {
  const env = await B.launchBot({ world: 'botfarm-three', settings: BASE });
  try {
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    const t0 = Date.now();
    const st = await env.botStatus();
    assert.equal(st.master, false); assert.equal(st.dryRun, true);
    const def = await env.evalOgx(await env.page(), () => ({ on: OGX.settings.get('botfarm.on'), buildShips: OGX.settings.get('botfarm.buildShips'), scan: OGX.settings.get('botfarm.scanGalaxy') }));
    assert.deepEqual(def, { on: false, buildShips: false, scan: false }, 'off by default');
    await env.setSettings({ 'botfarm.on': true });                       // module on, master off
    await kick(env);
    await sleep(12000);
    await env.setSettings({ 'botcore.master': true, 'botcore.dryRun': false, 'botfarm.on': false });   // master on, module off
    await leader(env);
    await kick(env);
    await sleep(12000);
    const j = await env.journal({ kind: /^botfarm:/ });
    assert.deepEqual(j.map((e) => e.k + ' ' + e.w), [], 'no botfarm events');
    assert.deepEqual(env.mutating().filter((r) => r.t >= t0).map((r) => r.method + ' ' + r.url), [], 'nothing mutating');
    assert.equal(env.world.log.sent.length, 0);
    await clean(env, '(a)');
  } finally { await env.close(); }
}, { timeout: 120000 });

T.test('(b) dry-run: plans and journals, sends nothing; vacation target skipped', async () => {
  const env = await B.launchBot({ world: 'botfarm-three', settings: BASE });
  try {
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    const t0 = Date.now();
    await env.setSettings({ 'botcore.master': true, 'botfarm.on': true });   // dryRun stays on (default)
    await leader(env);
    await kick(env);
    const dry = await ev(env, 'botcore:action-dry', (e) => e.d && e.d.module === 'botfarm' && e.d.type === 'fleet.send');
    assert.equal(dry.d.params.mission, 6, 'the first planned action is espionage');
    assert.ok(JSON.stringify(dry.d.requests).includes('fleetStep3'), 'dry entry carries the requests');
    await ev(env, 'botfarm:skip', (e) => e.d && e.d.reason === 'vacation' && e.d.key === '2:68:12:1');
    await sleep(3000);
    assert.deepEqual(env.mutating().filter((r) => r.t >= t0).map((r) => r.method + ' ' + r.url), [], 'dry-run: nothing mutating');
    assert.equal(env.world.log.sent.length, 0);
    const targets = (await env.journal({ kind: 'botfarm:target' })).map((e) => e.d.key).sort();
    assert.deepEqual(targets, ['2:68:10:1', '2:68:13:1'], 'inactive targets only (no vacation, no active player, no own planet)');
    const dryOnes = (await env.journal({ kind: 'botcore:action-dry' })).filter((e) => e.d.module === 'botfarm');
    assert.ok(dryOnes.every((e) => !JSON.stringify(e.d.params).includes('"position":12')), 'never planned against the vacation target');
    await decisionsFirst(env, '(b)');
    await clean(env, '(b)');
  } finally { await env.close(); }
}, { timeout: 180000 });

T.test('(c) live: formula probes, exact report, cargo-only and simulated attacks, escort, battle registry', async () => {
  const env = await B.launchBot({ world: 'botfarm-three', settings: BASE });
  try {
    const W = env.world;
    await startLive(env);
    // espionage: 2:68:10 and 2:68:13 with the suite setting spy.probes (5), the formula (our 12, theirs ≈10) only as the minimum
    const want = Math.max(S.spyNeeded({ ourSpy: 12, theirSpy: 10, want: 'defense' }), 5);
    assert.equal(want, 5, 'spy.probes is the count');
    const spy10 = await ev(env, 'botfarm:spy-sent', (e) => e.d.key === '2:68:10:1');
    const spy13 = await ev(env, 'botfarm:spy-sent', (e) => e.d.key === '2:68:13:1');
    assert.equal(spy10.d.probes, want); assert.equal(spy13.d.probes, want);
    const wspy = W.log.sent.filter((x) => x.mission === 6);
    assert.deepEqual(wspy.slice(0, 2).map((x) => [x.to, x.ships[210], x.originId]).sort(), [['2:68:10', want, HOME], ['2:68:13', want, HOME]]);
    // reports parsed exactly (world stock at the probes' arrival)
    const rep13 = await ev(env, 'botfarm:report', (e) => e.d.key === '2:68:13:1' && !e.d.kind);
    assert.deepEqual(rep13.d.known, { ships: true, defense: true, buildings: true, research: true });
    assert.deepEqual(rep13.d.units, { ships: { 204: 20 }, defense: { 401: 50 } });
    assert.equal(rep13.d.research[106], 3);
    const rep10 = await ev(env, 'botfarm:report', (e) => e.d.key === '2:68:10:1' && !e.d.kind);
    assert.deepEqual(rep10.d.units, { ships: {}, defense: {} });
    assert.ok(Math.abs(rep10.d.res.metal - 2000000) < 1000 && Math.abs(rep10.d.res.crystal - 1000000) < 1000, JSON.stringify(rep10.d.res));
    // attacks
    const sent10 = await ev(env, 'botfarm:attack-sent', (e) => e.d.key === '2:68:10:1');
    const sent13 = await ev(env, 'botfarm:attack-sent', (e) => e.d.key === '2:68:13:1');
    const plan10 = (await env.journal({ kind: 'botfarm:attack-planned' })).filter((e) => e.d.key === '2:68:10:1').pop();
    const plan13 = (await env.journal({ kind: 'botfarm:attack-planned' })).filter((e) => e.d.key === '2:68:13:1').pop();
    // empty target: cargo only, count = ceil(minCapacityForLoot(expected) x 1.10 / capacity)
    assert.equal(plan10.d.undefended, true);
    const ids10 = Object.keys(plan10.d.ships).map(Number);
    assert.deepEqual(ids10, [217], 'cargo only, Battle Transporters only: ' + JSON.stringify(plan10.d.ships));
    const need = Math.ceil(S.minCapacityForLoot(plan10.d.expected) * 1.1 / capOf(ids10[0]));
    // the other attack may have left first and taken some cargo ships: then the count is capped by what was at home.
    // Only fleets still AWAY at the send count: a fleet whose return (or recall) landed before the send is home again
    // (the 2:68:13 raid can land one second before the 2:68:10 raid leaves; the farm re-reads the ships after a landing).
    const wa10s = W.log.sent.find((x) => x.mission === 1 && x.to === '2:68:10');
    const homeShips = (W.spec.bodies.find((b) => +b.id === HOME).ships || {})[ids10[0]] || 0;
    const backOf = (x) => { const rc = W.log.recalled.find((r) => r.fleetId === x.fleetId); return rc && rc.back ? rc.back : x.back; };
    const takenBefore = W.log.sent.filter((x) => x.fleetId !== wa10s.fleetId && x.originId === HOME && x.t <= wa10s.t && backOf(x) > wa10s.t).reduce((s2, x) => s2 + (x.ships[ids10[0]] || 0), 0);
    assert.equal(plan10.d.ships[ids10[0]], Math.min(need, homeShips - takenBefore), `exact capacity with 10 % surplus (need ${need}, at home ${homeShips - takenBefore})`);
    if (need > homeShips - takenBefore) assert.ok(plan10.d.lootExpMsu < plan10.d.lootHalvesMsu, 'capped fleet: journal loot is the cargo-limited loot, not the planet half');
    // defended: optimizeRaid composition with combat ships, win >= winMin, the summary in the journal
    assert.equal(plan13.d.undefended, false);
    assert.ok(Object.keys(plan13.d.ships).some((id) => [204, 205, 206, 207, 211, 213, 215].includes(+id)), 'combat escort: ' + JSON.stringify(plan13.d.ships));
    assert.ok(!Object.keys(plan13.d.ships).some((id) => [202, 203].includes(+id)), 'no 202/203 as loot carriers: ' + JSON.stringify(plan13.d.ships));
    assert.ok(plan13.d.win >= 0.99, 'win ' + plan13.d.win);
    assert.ok(plan13.d.tried > 0, 'simulated variants');
    const sim13 = (await env.journal({ kind: 'botfarm:sim' })).find((e) => e.d.key === '2:68:13:1' && e.d.ok);
    assert.ok(sim13 && sim13.d.runs >= 60 && sim13.d.lootMsu > 0 && sim13.d.debris && sim13.d.debris.p50, 'sim summary journaled');
    const wa10 = W.log.sent.find((x) => x.mission === 1 && x.to === '2:68:10');
    const wa13 = W.log.sent.find((x) => x.mission === 1 && x.to === '2:68:13');
    assert.deepEqual(wa10.ships, plan10.d.ships); assert.deepEqual(wa13.ships, plan13.d.ships);
    assert.equal(wa10.originId, HOME); assert.equal(sent10.d.fleetId, wa10.fleetId); assert.equal(Math.round(sent10.d.arrival / 1000), wa10.arrival);
    // battle registry entry (owner botfarm, debris from the raid sim)
    const page = await env.page();
    const battles = await env.evalOgx(page, () => OGX.bot.battles.list());
    const b10 = battles.find((b) => b.id === 'farm:2:68:10:1:' + wa10.arrival);
    const b13 = battles.find((b) => b.id === 'farm:2:68:13:1:' + wa13.arrival);
    assert.ok(b10 && b13, 'battles: ' + JSON.stringify(battles.map((b) => b.id)));
    assert.equal(b13.owner, 'botfarm'); assert.equal(b13.fleetId, wa13.fleetId); assert.equal(b13.status, 'flying');
    assert.ok(b13.debris && b13.debris.p50 && b13.debris.p10 && b13.debris.metal >= 0, JSON.stringify(b13.debris));
    // vacation target skipped, never spied or attacked
    await ev(env, 'botfarm:skip', (e) => e.d && e.d.reason === 'vacation' && e.d.key === '2:68:12:1');
    assert.equal(W.log.sent.filter((x) => x.to === '2:68:12').length, 0);
    // escort: probes arrive before the attack, report read, no change
    const esc = await ev(env, 'botfarm:escort-spy', (e) => e.d.spyArrival && e.d.battle === b13.id);
    assert.ok(esc.d.spyArrival < wa13.arrival * 1000, 'escort probes arrive before the attack');
    // botfarm-4: the probes arrive escortLeadSec (90) .. +30 s before the hit, never later than 30 s before it
    const escLead = wa13.arrival * 1000 - esc.d.spyArrival;
    assert.ok(escLead >= 29000 && escLead <= 125000, 'escort lead 90-120 s: ' + escLead);
    const er = await ev(env, 'botfarm:escort-report', (e) => e.d.battle === b13.id);
    assert.equal(er.d.changed, false);
    const wEsc = W.log.sent.filter((x) => x.mission === 6 && x.to === '2:68:13' && x.t * 1000 > sent13.t - 60000 && x.arrival < wa13.arrival);
    assert.ok(wEsc.length >= 1, 'escort probes in the world');
    // battles: won, every resource halved (capacity enough)
    await env.until(async () => W.log.events.filter((e) => e.kind === 'battle').length >= 2, { timeoutMs: 150000, stepMs: 1000, label: 'battles' });
    const bt10 = W.log.events.find((e) => e.kind === 'battle' && e.coords === '2:68:10');
    assert.equal(bt10.won, 'a');
    const left = W.other(3900).planets[0].res;
    if (need <= homeShips - takenBefore) {
      for (const r of ['metal', 'crystal', 'deuterium']) assert.ok(Math.abs(left[r] - bt10.loot[r]) <= 1 + left[r] * 0.001, r + ': loot ' + bt10.loot[r] + ' vs left ' + left[r]);
    } else {
      // the attack on 2:68:13 left first and took cargo ships: the capped fleet loots what its capacity allows (calculateSteal)
      const before = {}; for (const r of ['metal', 'crystal', 'deuterium']) before[r] = left[r] + bt10.loot[r];
      const exp = S.steal({ ships: wa10.ships, planet: before, units: UNITS });
      for (const r of ['metal', 'crystal', 'deuterium']) assert.ok(Math.abs(exp[r] - bt10.loot[r]) <= 1 + exp[r] * 0.002, r + ': capped loot ' + bt10.loot[r] + ' vs steal ' + exp[r]);
    }
    assert.equal(W.log.events.find((e) => e.kind === 'battle' && e.coords === '2:68:13').won, 'a');
    assert.equal(W.log.recalled.length, 0, 'nothing recalled');
    // calibration: the combat report read back (predicted vs actual loot)
    const comb = await ev(env, 'botfarm:report', (e) => e.d.kind === 'combat' && e.d.key === '2:68:10:1');
    assert.equal(comb.d.loot.metal, bt10.loot.metal, 'actual loot from the combat message');
    assert.ok(comb.d.predicted.metal > 0 && comb.d.ratio > 0.5 && comb.d.ratio < 1.5, JSON.stringify(comb.d));
    // after its own attack the farm never plans from a report taken before the IMPACT (the escort report is older than the
    // battle): lastAttackAt = arrival, and once the fleet is home the next step on 2:68:13 is a new espionage, not an attack
    // (on a slow machine the farm runs its next cycle on 2:68:13 — spy, plan, attack again — before this check: then the two
    // fields belong to that later attack; either way lastAttackAt is the impact time of a world attack on 2:68:13)
    const T13 = await env.evalOgx(await env.page(), () => { const t = OGX.botFarm._M.targets['2:68:13:1']; return t ? { lastAttackAt: t.lastAttackAt, lastAttackSentAt: t.lastAttackSentAt } : null; });
    const impacts13 = W.log.sent.filter((x) => x.mission === 1 && x.to === '2:68:13').map((x) => x.arrival * 1000);
    assert.ok(impacts13.includes(T13.lastAttackAt), `lastAttackAt = impact time of an attack on 2:68:13 (${impacts13.join(', ')}): ` + JSON.stringify(T13));
    assert.ok(T13.lastAttackSentAt < T13.lastAttackAt, 'send time kept separately');
    const nextOf13 = (e) => e.d && e.d.key === '2:68:13:1' && e.t > sent13.t;
    await env.waitJournal(/^botfarm:(spy-sent|attack-planned)$/, { pred: nextOf13, timeoutMs: 240000, stepMs: 1000 });
    const after13 = (await env.journal({ kind: /^botfarm:(spy-sent|attack-planned)$/ })).filter(nextOf13).sort((x, y) => x.t - y.t)[0];
    assert.equal(after13.k, 'botfarm:spy-sent', 'after the battle: spy again before the next attack, got ' + after13.k + ' ' + after13.w);
    // a fleet landing on the origin invalidates the farm's cached ship counts (the next plan reads page=fleetTable again)
    const inval = await env.evalOgx(await env.page(), (home) => {
      const M = OGX.botFarm._M; M.shipsSeen = M.shipsSeen || {}; M.shipsSeen[home] = { t: OGX.time.serverNow(), ships: { 202: 1 } };
      OGX.bus.emit('bot:fleet-returned', { fleetId: 1, mission: 1, bodyKey: 'p' + home, at: OGX.time.serverNow(), why: 'test' });
      return { seen: !!M.shipsSeen[home], returnedAt: (M.returnedAt || {})[home] || 0 };
    }, HOME);
    assert.equal(inval.seen, false, 'cached counts dropped on bot:fleet-returned'); assert.ok(inval.returnedAt > 0);
    // panel section: targets table and flying attacks
    const panel = await env.evalOgx(await env.page(), () => { const d = document.createElement('div'); OGX.bot._panelSection('botfarm')(d); return { rows: d.querySelectorAll('table.ogx-b-farm-targets tr[data-key]').length, text: d.textContent }; });
    assert.ok(panel.rows >= 2 && /База целей/.test(panel.text) && /Оценка/.test(panel.text) && /Скачать базу целей/.test(panel.text), JSON.stringify(panel));
    await decisionsFirst(env, '(c)');
    await clean(env, '(c)');
  } finally { await env.close(); }
}, { timeout: 660000 });

T.test('(d) target gains 50 heavy fighters after launch -> escort -> recall before arrival, battle cancelled', async () => {
  const env = await B.launchBot({ world: 'botfarm-three', settings: Object.assign({}, BASE, { 'botfarm.exclude': ['2:68:13'] }) });
  try {
    const W = env.world;
    await startLive(env);
    const p0 = await env.page();
    await env.evalOgx(p0, () => { OGX.__cancel = []; OGX.bus.on('bot:battle-cancelled', (x) => OGX.__cancel.push(x)); });
    const sent = await ev(env, 'botfarm:attack-sent', (e) => e.d.key === '2:68:10:1');
    // the scripted change: 50 heavy fighters appear on the target while our cargos fly
    assert.equal(W.command('setOther', { id: 3900, planet: { coords: '2:68:10', ships: { 205: 50 } } }), true);
    const esc = await ev(env, 'botfarm:escort-report', (e) => e.d.battle === 'farm:2:68:10:1:' + Math.round(sent.d.arrival / 1000));
    assert.equal(esc.d.changed, true, JSON.stringify(esc.d));
    assert.equal(esc.d.kind, 'units');
    assert.ok(esc.d.sim && esc.d.sim.win < 0.99, 'resimulated with the flying fleet');
    const rc = await ev(env, 'botfarm:attack-recalled', (e) => e.d.battle === esc.d.battle && e.d.ok);
    const rec = W.log.recalled.find((x) => x.fleetId === sent.d.fleetId);
    assert.ok(rec, 'world recall of the attack fleet');
    assert.ok(rec.t * 1000 <= sent.d.arrival - 3000, 'recalled before arrival - 3 s');
    assert.equal(rc.d.verified, true);
    const st = await env.evalOgx(p0, (id) => ({ battle: OGX.bot.battles.get(id), cancelled: OGX.__cancel || [] }), esc.d.battle);
    assert.equal(st.battle, null, 'removed from the battle registry');
    assert.ok(st.cancelled.some((x) => x.id === esc.d.battle && /recall/.test(x.reason)), 'bus bot:battle-cancelled: ' + JSON.stringify(st.cancelled));
    // the fleet comes home, no battle happened at the target
    await env.until(async () => { W.process(); return W.log.events.some((e) => e.kind === 'return' && e.fleetId === sent.d.fleetId); }, { timeoutMs: 120000, stepMs: 1000, label: 'return' });
    assert.equal(W.log.events.filter((e) => e.kind === 'battle' && e.coords === '2:68:10').length, 0, 'no battle');
    const cool = await ev(env, 'botfarm:cooldown', (e) => e.d.key === '2:68:10:1');
    assert.equal(cool.d.state, 'notSuitable');
    await decisionsFirst(env, '(d)');
    await clean(env, '(d)');
  } finally { await env.close(); }
}, { timeout: 360000 });

T.test('(e) buildShips: missing cargos ordered at the shipyard, then the attack', async () => {
  const env = await B.launchBot({ world: 'botfarm-build', settings: Object.assign({}, BASE, { 'botfarm.buildShips': true, 'botfarm.escort': false }) });
  try {
    const W = env.world;
    // the shipyard speed is learnt from a real queue the core saw (Body.queues.unit): the user opened the shipyard while it built
    assert.equal(W.order('shipyard', HOME, { units: { 210: 30 } }).ok, true);
    await env.game('shipyard', { mode: 'fleet', cp: HOME });
    await startLive(env);
    const bs = await ev(env, 'botfarm:build-ships', (e) => e.d.key === '2:68:10:1');
    const ids = Object.keys(bs.d.missing).map(Number);
    assert.deepEqual(ids, [217], 'the missing loot carriers are Battle Transporters: ' + JSON.stringify(bs.d.missing));
    const order = W.log.builds.find((b) => b.kind === 'shipyard' && b.accepted && b.accepted[ids[0]]);
    assert.ok(order, 'world shipyard order: ' + JSON.stringify(W.log.builds));
    assert.equal(order.bodyId, HOME); assert.equal(order.accepted[ids[0]], bs.d.missing[ids[0]]);
    const decB = (await env.journal({ kind: 'botfarm:decision' })).find((e) => e.d.chosen === 'build.units');
    assert.ok(decB && decB.d.inputs.unitSpeed > 0, 'decision with the calibrated unit time');
    const sent = await ev(env, 'botfarm:attack-sent', (e) => e.d.key === '2:68:10:1');
    const wa = W.log.sent.find((x) => x.mission === 1 && x.to === '2:68:10');
    assert.ok(wa, 'attack in the world');
    assert.ok((wa.ships[ids[0]] || 0) >= bs.d.missing[ids[0]], 'the attack uses the built ships: ' + JSON.stringify(wa.ships));
    assert.ok(wa.t * 1000 >= bs.t - 5000, 'after the build');
    assert.equal(sent.d.fleetId, wa.fleetId);
    await decisionsFirst(env, '(e)');
    await clean(env, '(e)');
  } finally { await env.close(); }
}, { timeout: 420000 });

T.test('(h) no Battle Transporters at home: the target is skipped «не хватает N Ул. трансп.», no 202/203 fallback, no attack', async () => {
  const spec = JSON.parse(JSON.stringify(GW.loadScenario('botfarm-three')));
  delete spec.bodies.find((b) => +b.id === HOME).ships[217];
  const env = await B.launchBot({ world: spec, settings: Object.assign({}, BASE, { 'botfarm.exclude': ['2:68:13'], 'botfarm.escort': false }) });
  try {
    const W = env.world;
    await startLive(env);
    await ev(env, 'botfarm:report', (e) => e.d.key === '2:68:10:1' && !e.d.kind);
    const sk = await ev(env, 'botfarm:skip', (e) => e.d && e.d.reason === 'transport' && e.d.key === '2:68:10:1');
    assert.ok(/не хватает \d+ Ул\. трансп\./.test(sk.w), sk.w);
    assert.ok(sk.d.short >= 1 && sk.d.have === 0, JSON.stringify(sk.d));
    await sleep(3000);
    assert.equal(W.log.sent.filter((x) => x.mission === 1).length, 0, 'no attack with 202/203');
    const home = W.body(HOME).ships;
    assert.equal(home[202], 200); assert.equal(home[203], 250);
    await clean(env, '(h)');
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('(i) defended target, no Battle Transporters at home: no combat-only raid (escort hold is no carrier), «не хватает N Ул. трансп.»', async () => {
  const spec = JSON.parse(JSON.stringify(GW.loadScenario('botfarm-three')));
  delete spec.bodies.find((b) => +b.id === HOME).ships[217];
  // a low loot threshold and partial loot on: the old planner accepted the escort's hold as the carrier here
  const env = await B.launchBot({ world: spec, settings: Object.assign({}, BASE, { 'botfarm.exclude': ['2:68:10'], 'botfarm.escort': false, 'botfarm.minLoot': 1, 'botfarm.partialLoot': true, 'botfarm.minLootShare': 0.01 }) });
  try {
    const W = env.world;
    await startLive(env);
    await ev(env, 'botfarm:report', (e) => e.d.key === '2:68:13:1' && !e.d.kind);
    const sk = await ev(env, 'botfarm:skip', (e) => e.d && e.d.reason === 'transport' && e.d.key === '2:68:13:1');
    assert.ok(/не хватает \d+ Ул\. трансп\./.test(sk.w), sk.w);
    assert.ok(sk.d.short >= 1 && sk.d.have === 0, JSON.stringify(sk.d));
    await sleep(3000);
    assert.equal(W.log.sent.filter((x) => x.mission === 1).length, 0, 'no attack without 217');
    await clean(env, '(i)');
  } finally { await env.close(); }
}, { timeout: 300000 });
