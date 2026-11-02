'use strict';
// botmissiles end to end against the GALAXYZ mock in WORLD mode (tests/gz-world.js: page=fleetMissile, mission 10 flight + impact
// = MissionCaseMIP / calculateMIPAttack, silo capacity) via tests/gz-bot-lib.js.
// Scenarios: fixtures/galaxyz/bot-scenarios/botmissiles.json (home silo 5, no IPM; the farm target DefendedInactive 2:68:13 has
// 1200 RL + 300 LL + 10 ABM, need ≈ 29 = wave 25 + 3) and botmissiles-none.json (impulse 1 = range 4, the inactive target is
// 7 systems away; Jon Snow active in range).
//   (a) live: botfarm spies, botmissiles orders 503, launches waves (mission 10, no fleet slot), re-spies through botfarm,
//       the target's defence ends at 0 and botfarm raids it
//   (b) negatives: out of range -> nothing; an active player in `targets` -> skip 'active'
//   (c) dry-run: action-dry for fleet.missile, no mission 10, no 503 order
//   (d) silo < 4: journal 'silo'; buildSilo off -> no wants; on -> OGX.bot.wants has { id 44, level 4 }
//   node tests/gz-bot-missiles.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const GW = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;
const TGT = '2:68:13';
const OTHER_BOT = ['botsave', 'botdebris', 'botbuild', 'botexpo'];
const BASE = Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])),
  { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botfarm.minLoot': 100000, 'botfarm.escortLeadSec': 40,
    'spy.probes': 5 });   // the suite's probes per spy (default 1100; the home planet has 50)
// the all-off test baseline (tests/bot-baseline.js) switches buildMissiles / buildSilo off: the defaults (on) are set here
const LIVE = { 'botcore.master': true, 'botcore.dryRun': false, 'botfarm.on': true, 'botmissiles.on': true, 'botmissiles.buildMissiles': true, 'botmissiles.buildSilo': true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => +v || 0;

async function leader(env) { await env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 25000, label: 'leader' }); }
/** Wakes botfarm (bot:fleet-returned) and botmissiles (bot:intel) now (a settings change re-jitters the workers after a 2 s debounce). */
async function kick(env) {
  await sleep(2600);
  const p = await env.page();
  await env.evalOgx(p, () => {
    OGX.bus.emit('bot:fleet-returned', { fleetId: 0, mission: 0, bodyKey: null, at: OGX.time.serverNow(), why: 'test kick' });
    OGX.bus.emit('bot:intel', { key: 'test', ts: null });
  });
}
async function startLive(env, extra = {}) {
  await env.game('galaxy', { query: { galaxy: 2, system: 68 } });      // the user views the system: the galaxy cache knows the targets
  await env.setSettings(Object.assign({}, LIVE, extra));
  await leader(env);
  await kick(env);
}
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
/** Every mutating action botmissiles queued has a botmissiles:decision of the same run before it. */
async function decisionsFirst(env, what) {
  const j = await env.journal();
  const acts = j.filter((e) => e.k === 'botcore:action-queued' && e.d && e.d.module === 'botmissiles' && !/^read\./.test(e.d.type));
  assert.ok(acts.length > 0, what + ': botmissiles queued actions');
  for (const a of acts) {
    const dec = j.filter((e) => e.k === 'botmissiles:decision' && e.d && e.d.run === a.d.run && e.t <= a.t);
    assert.ok(dec.length, what + ': decision before ' + a.d.type + ' ' + (a.d.why || '') + ' (run ' + a.d.run + ')');
  }
  return acts;
}
const ev = (env, kind, pred, timeoutMs = 240000) => env.waitJournal(kind, { pred, timeoutMs, stepMs: 700 });
function spec(name, fn) { const s = JSON.parse(JSON.stringify(GW.loadScenario(name))); fn(s); return s; }

T.test('(a) live: 503 built in waves within the silo, launched (no fleet slot), re-spied, defence 0, then botfarm raids', async () => {
  const env = await B.launchBot({ world: 'botmissiles', settings: BASE });
  try {
    const W = env.world;
    await startLive(env);
    // the farm spies the target; the report wakes botmissiles (bot:intel)
    await ev(env, 'botfarm:report', (e) => e.d && e.d.key === TGT + ':1');
    const plan = await ev(env, 'botmissiles:plan', (e) => e.d && e.d.key === TGT + ':1');
    assert.equal(plan.d.abm, 10, 'interceptors counted from the report');
    assert.equal(plan.d.defLeft, 1500);
    assert.equal(plan.d.need, 29, 'weapons 10 vs shield 3: 17 hits + 10 interceptors + 10 % reserve');
    // wave 1: 25 IPM (silo 5 = 50 slots) built on the home planet, then launched
    const b1 = await ev(env, 'botmissiles:build', (e) => e.d && e.d.ok && e.d.key === TGT + ':1');
    assert.equal(b1.d.wave.build, 25);
    const order = W.log.builds.find((x) => x.accepted && x.accepted[503]);
    assert.ok(order, 'the world got a 503 order'); assert.equal(order.accepted[503], 25); assert.equal(order.bodyId, HOME);
    const l1 = await ev(env, 'botmissiles:launch', (e) => e.d && e.d.ok && e.d.n === 25);
    assert.equal(l1.d.launcher, '2:68:5');
    const m1 = W.log.sent.find((x) => x.mission === 10);
    assert.ok(m1, 'mission 10 in the world'); assert.equal(m1.via, 'fleetMissile'); assert.equal(m1.to, TGT); assert.equal(m1.ships[503], 25);
    // no fleet slot: the world's slot count ignores mission 10, and botcore never refused it for slots
    assert.equal(W.slotsUsed(), W.ownFleets().filter((f) => f.mission !== 10).length);
    // impact 1: 10 intercepted, the rest destroys rocket launchers and part of the light lasers
    await env.until(() => W.log.events.some((x) => x.kind === 'missile'), { timeoutMs: 60000, label: 'impact 1' });
    const i1 = W.log.events.find((x) => x.kind === 'missile');
    assert.equal(i1.missiles, 25); assert.equal(i1.intercepted, 10);
    await ev(env, 'botmissiles:impact', (e) => e.d && e.d.key === TGT + ':1');
    // the farm re-spies after the impact; wave 2 is planned from that report (no interceptors left)
    const plan2 = await ev(env, 'botmissiles:plan', (e) => e.d && e.d.key === TGT + ':1' && e.d.abm === 0);
    assert.ok(plan2.d.need > 0 && plan2.d.need < 25, 'a small second wave: ' + plan2.d.need);
    await ev(env, 'botmissiles:launch', (e) => e.d && e.d.ok && e.t > l1.t);
    const cleared = await ev(env, 'botmissiles:cleared', (e) => e.d && e.d.key === TGT + ':1', 300000);
    assert.ok(cleared.d.waves >= 2);
    const def = W.other(3901).planets[0].defense;
    assert.equal(num(def[401]), 0, 'rocket launchers gone'); assert.equal(num(def[402]), 0, 'light lasers gone');
    assert.equal(num(def[502]), 0, 'interceptors consumed');
    const mis = W.log.sent.filter((x) => x.mission === 10);
    assert.ok(mis.length >= 2 && mis.every((x) => x.to === TGT && x.originId === HOME));
    const refusals = (await env.journal({ kind: 'botcore:action-done' })).filter((e) => e.d && e.d.module === 'botmissiles' && e.d.refused === 'slots');
    assert.deepEqual(refusals, [], 'never a slots refusal');
    // botfarm raids the undefended target with Battle Transporters
    await env.until(() => W.log.sent.some((x) => x.mission === 1 && x.to === TGT), { timeoutMs: 300000, stepMs: 1000, label: 'raid' });
    const raid = W.log.sent.find((x) => x.mission === 1 && x.to === TGT);
    assert.ok(raid.t >= W.log.events.filter((x) => x.kind === 'missile').pop().t, 'the raid leaves after the last impact');
    assert.ok(num(raid.ships[217]) > 0, 'with 217');
    // the panel tab lists the campaign
    const row = await env.evalOgx(await env.page(), () => { const M = OGX.botMissiles._M; const C = M.targets['2:68:13:1']; return C ? { state: C.state, launched: C.launched } : null; });
    assert.equal(row.state, 'cleared'); assert.equal(row.launched, mis.reduce((s, x) => s + x.ships[503], 0));
    await decisionsFirst(env, '(a)');
    await clean(env, '(a)');
  } finally { await env.close(); }
}, { timeout: 900000 });

T.test('(b) out of range / active player: nothing launches', async () => {
  const env = await B.launchBot({ world: 'botmissiles-none', settings: Object.assign({}, BASE, { 'botmissiles.targets': ['2:69:4'] }) });
  try {
    const W = env.world;
    await env.game('galaxy', { query: { galaxy: 2, system: 69 } });
    await env.game('galaxy', { query: { galaxy: 2, system: 75 } });
    await startLive(env);
    await ev(env, 'botmissiles:skip', (e) => e.d && e.d.reason === 'active' && e.d.key === '2:69:4:1');
    await ev(env, 'botfarm:report', (e) => e.d && e.d.key === '2:75:13:1');
    await sleep(8000);
    await kick(env);
    await sleep(8000);
    assert.deepEqual((await env.journal({ kind: /^botmissiles:(launch|build|plan)$/ })).map((e) => e.k + ' ' + e.w), [], 'no campaign: out of range (range 4, 7 systems)');
    assert.equal(W.log.sent.filter((x) => x.mission === 10).length, 0);
    assert.equal(W.log.builds.filter((x) => x.accepted && x.accepted[503]).length, 0);
    await clean(env, '(b)');
  } finally { await env.close(); }
}, { timeout: 400000 });

T.test('(c) dry-run: the launch is planned (action-dry fleet.missile), nothing is launched or built', async () => {
  const world = spec('botmissiles', (s) => { s.bodies[0].defense[503] = 25; });
  const env = await B.launchBot({ world, settings: BASE });
  try {
    const W = env.world;
    await startLive(env, { 'botmissiles.on': false });         // the farm gets the report first
    await ev(env, 'botfarm:report', (e) => e.d && e.d.key === TGT + ':1');
    await env.setSettings({ 'botcore.dryRun': true, 'botmissiles.on': true });
    await kick(env);
    const dry = await ev(env, 'botcore:action-dry', (e) => e.d && e.d.module === 'botmissiles' && e.d.type === 'fleet.missile');
    assert.equal(dry.d.params.count, 25);
    assert.ok(JSON.stringify(dry.d.requests).includes('fleetMissile'), 'dry entry carries the request');
    await sleep(3000);
    assert.equal(W.log.sent.filter((x) => x.mission === 10).length, 0);
    assert.equal(W.log.builds.filter((x) => x.accepted && x.accepted[503]).length, 0);
    assert.equal(num(W.body(HOME).defense[503]), 25);
    await clean(env, '(c)');
  } finally { await env.close(); }
}, { timeout: 400000 });

T.test('(d) no silo 4: journal «нужна ракетная шахта», buildSilo off -> no request, on -> OGX.bot.wants silo 4', async () => {
  const world = spec('botmissiles', (s) => { s.bodies[0].levels[44] = 2; });
  const env = await B.launchBot({ world, settings: BASE });
  try {
    const W = env.world;
    await startLive(env, { 'botmissiles.buildSilo': false });
    const silo = await ev(env, 'botmissiles:silo', () => true);
    assert.match(silo.w, /Нужна ракетная шахта 4/);
    assert.equal(silo.d.buildSilo, false);
    const p = () => env.page();
    assert.deepEqual(await env.evalOgx(await p(), () => OGX.bot.wants.list()), [], 'buildSilo off: no request');
    await env.setSettings({ 'botmissiles.buildSilo': true });
    await kick(env);
    await env.until(async () => (await env.evalOgx(await p(), () => OGX.bot.wants.list())).length > 0, { timeoutMs: 60000, label: 'wants' });
    const wants = await env.evalOgx(await p(), () => OGX.bot.wants.list());
    assert.equal(wants.length, 1);
    assert.deepEqual({ owner: wants[0].owner, kind: wants[0].kind, id: wants[0].id, level: wants[0].level, bodyId: wants[0].bodyId }, { owner: 'botmissiles', kind: 'building', id: 44, level: 4, bodyId: HOME });
    assert.equal(W.log.sent.filter((x) => x.mission === 10).length, 0);
    await clean(env, '(d)');
  } finally { await env.close(); }
}, { timeout: 400000 });
