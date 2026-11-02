'use strict';
// botexpo (expeditions + colonisation) end to end: the suite in a browser against the WORLD mode of the GALAXYZ mock
// (tests/gz-world.js; scenarios fixtures/galaxyz/bot-scenarios/botexpo-*.json: gamespeed 2000, flights of a few seconds).
//   node tests/gz-bot-expo.test.js
// Every test also checks: no [OGX errors / bot console errors, and every botexpo action has a preceding botexpo:decision of the
// same worker run.
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;   // [2:68:5] 50 probes, 300 light cargo, 1 colony ship
const COL6 = 254103;   // [2:68:6] 20 light cargo, 10 probes
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botbuild'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0 };
const LIVE = { 'botcore.master': true, 'botcore.dryRun': false, 'botexpo.on': true };
const QUICK = { 'botexpo.mode': 'dm', 'botexpo.expoProbes': 1, 'botexpo.probeBuild': false, 'botexpo.dmHunt': false, 'botexpo.betweenMinSec': 1, 'botexpo.betweenMaxSec': 2, 'botexpo.afterReturnMinSec': 1, 'botexpo.afterReturnMaxSec': 3 };
const settings = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), FAST, QUICK, extra);

function spec(name, mutate) {
  const s = JSON.parse(JSON.stringify(W.loadScenario(name)));
  if (mutate) mutate(s);
  return s;
}
const leader = (env) => env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 30000, label: 'leader' });
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
/** Every botexpo action (queued or refused at enqueue) is preceded by a botexpo:decision of the same run. Returns the count. */
async function decisionsFirst(env, what) {
  const ev = await env.journal();
  const acts = ev.filter((e) => (e.k === 'botcore:action-queued' || e.k === 'botcore:action-refused') && e.d && e.d.module === 'botexpo' && e.d.run);
  const queued = new Set(ev.filter((e) => e.k === 'botcore:action-queued').map((e) => e.d && e.d.action));
  let n = 0;
  for (const a of acts) {
    if (a.k === 'botcore:action-refused' && a.d.action && queued.has(a.d.action)) continue;
    n++;
    const dec = ev.find((e) => e.k === 'botexpo:decision' && e.d && e.d.run === a.d.run && e.t <= a.t);
    assert.ok(dec, what + ': decision before ' + a.k + ' ' + a.d.type + ' (' + (a.d.why || '') + ')');
  }
  return n;
}
const expoSends = (env) => env.world.log.sent.filter((x) => x.mission === 15);
const reqs = (env, since = env.launchedAt) => env.server.requests.filter((r) => r.t >= since);
/** server wall clock 'HH:MM' (UTC+2) of a unix time */
const wall = (unix) => { const d = new Date((unix + 7200) * 1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };

T.test('mode dm, 2 expedition slots: two 1-probe expeditions to g:s:16 (mission 15, 100 %), staytime option chosen by its hour text, slots re-read before each fleet, EV journaled', async () => {
  const env = await B.launchBot({ world: spec('botexpo-dm'), settings: settings(LIVE) });
  try {
    await leader(env);
    await env.until(() => expoSends(env).length >= 2, { timeoutMs: 120000, label: 'two expeditions' });
    await new Promise((r) => setTimeout(r, 4000));
    const s = expoSends(env);
    assert.equal(s.length, 2, 'exactly two expeditions (2 expedition slots): ' + JSON.stringify(s));
    for (const x of s) {
      assert.equal(x.originId, HOME, 'cp = the origin with probes');
      assert.equal(x.to, '2:68:16', 'own system, position 16');
      assert.deepEqual(x.ships, { 210: 1 }, 'one probe per slot (cheapest ship offered mission 15)');
      assert.equal(x.speed, 10, '100 %');
      assert.equal(x.staytime, 2, 'haltSpeed 2: the option with text "1" (stayHours 1) is value 2');
      assert.deepEqual(x.cargo, { metal: 0, crystal: 0, deuterium: 0 }, 'never loaded');
    }
    // the probe (steps 1-2 without step 3) offered mission 15 and the staytime texts
    const probe = (await env.journal({ kind: 'botcore:action-done' })).find((e) => e.d && e.d.module === 'botexpo' && e.d.type === 'probe.target');
    assert.ok(probe, 'probe.target before the first send');
    // slots re-read: a page=fleetTable GET of the origin between the two step-3 posts
    const step3 = reqs(env).filter((r) => r.method === 'POST' && /fleetStep3/i.test(r.page || ''));
    assert.equal(step3.length, 2);
    const ftBetween = reqs(env).filter((r) => r.method === 'GET' && /^fleetTable$/i.test(r.page || '') && r.t > step3[0].t && r.t < step3[1].t);
    assert.ok(ftBetween.length >= 1, 'fleetTable read between the two fleets');
    const gap = (s[1].t - s[0].t);
    assert.ok(gap >= 1, 'a pause between the fleets (' + gap + ' s)');
    const ev = await env.waitJournal('botexpo:expo-ev', { timeoutMs: 5000 });
    assert.equal(ev.d.mode, 'dm'); assert.equal(ev.d.slots, 2);
    assert.deepEqual(ev.d.fleet, { 210: 1 });
    assert.ok(ev.d.ev && Number.isFinite(ev.d.ev.perTrip), 'EV per trip: ' + JSON.stringify(ev.d.ev));
    const sent = await env.journal({ kind: 'botexpo:expo-sent' });
    assert.equal(sent.length, 2);
    assert.ok(sent.every((e) => e.d.verified && e.d.fleetId && e.d.staytime && e.d.staytime.hours === 1), 'verified, option text 1 h: ' + JSON.stringify(sent.map((e) => e.d)));
    const ws = env.world.snapshot();
    assert.equal(ws.slots.expeditions, 2);
    const n = await decisionsFirst(env, 'dm');
    assert.ok(n >= 4, 'reads, probe, two sends journaled: ' + n);
    await clean(env, 'dm');
  } finally { await env.close(); }
}, { timeout: 240000 });

T.test('return -> next round after the return + afterReturn delay; scripted outcomes (resources, black hole, DM) read from messages cat 15 / cat 4 -> expo-result and botexpo.stats (F5: find = min(free cargo, sum(M+C)))', async () => {
  const env = await B.launchBot({ world: spec('botexpo-cycle'), settings: settings(Object.assign({}, LIVE, { 'botexpo.stayHours': 0.01 })) });
  try {
    const Wd = env.world;
    await leader(env);
    await env.until(() => expoSends(env).length >= 2, { timeoutMs: 120000, label: 'first round' });
    const first = expoSends(env).slice(0, 2);
    assert.ok(first.every((x) => x.staytime === 1), 'haltSpeed 100: option 1 = "0.01" h');
    // first return (the black-hole fleet never returns) -> next round after back + 1..3 s
    await env.until(() => expoSends(env).length >= 3, { timeoutMs: 180000, label: 'second round' });
    const third = expoSends(env)[2];
    const ret = Wd.log.events.filter((e) => e.kind === 'return' && e.mission === 15).map((e) => e.t);
    assert.ok(ret.length >= 1, 'one expedition returned');
    const firstBack = Math.min(...first.map((x) => x.back));
    assert.ok(third.t >= firstBack + 1, `next round ${third.t} after the first return ${firstBack} + afterReturn (>= 1 s)`);
    // results: outcome messages (cat 15) and the return message (cat 4) of the resources trip
    const resEv = await env.waitJournal('botexpo:expo-result', { pred: (e) => e.d && e.d.f5, timeoutMs: 120000 });
    assert.equal(resEv.d.outcome, 'resources');
    assert.equal(resEv.d.f5.match, true, 'F5: the find equals min(free cargo, sum(M+C)) of the fleet: ' + JSON.stringify(resEv.d.f5));
    assert.equal(resEv.d.f5.expected, 5, 'one probe: free cargo 5 < sum(M+C) 1000 -> 5');
    const bh = await env.waitJournal('botexpo:expo-result', { pred: (e) => e.d && e.d.outcome === 'blackHole', timeoutMs: 60000 });
    assert.ok(bh, 'black hole read');
    await env.waitJournal('botexpo:expo-result', { pred: (e) => e.d && e.d.outcome === 'darkMatter', timeoutMs: 150000 });
    // the stats are written at the end of the worker run (after the journal event): poll the storage
    let stats = null;
    await env.until(async () => { stats = await env.evalOgx(await env.page(), async () => OGX.storage.get('botexpo.stats', null)); return stats && stats.trips >= 3 && stats.outcomes.darkMatter >= 1; }, { timeoutMs: 20000, label: 'stats saved' });
    assert.ok(stats && stats.trips >= 3, 'stats persisted: ' + JSON.stringify(stats));
    assert.equal(stats.outcomes.resources, 1); assert.equal(stats.outcomes.blackHole, 1); assert.ok(stats.outcomes.darkMatter >= 1);
    assert.equal(stats.finds.length, 1); assert.equal(stats.finds[0].ratio, 1);
    assert.deepEqual(stats.lostShips, { 210: 1 }, 'the black hole took the probe');
    const msgViews = reqs(env).filter((r) => /^messages$/i.test(r.page || '') && String(r.mode || '').toLowerCase() === 'view');
    assert.ok(msgViews.length >= 2, 'messages read (cat 15 and cat 4)');
    await decisionsFirst(env, 'cycle');
    await clean(env, 'cycle');
  } finally { await env.close(); }
}, { timeout: 480000 });

T.test('colonisation: probe.target (no galaxy view) finds 2:68:10 occupied -> blacklist -> 2:68:9 empty -> mission 7 with one 208 and payload fleetroom - fuel; colony founded (fields below the threshold only journaled) -> max planets reached -> stop', async () => {
  const env = await B.launchBot({ world: spec('botexpo-colonize'), settings: settings(Object.assign({}, LIVE, { 'botexpo.expeditions': false, 'botexpo.colonize': true,
    'botexpo.colonizeTargets': [{ galaxy: 2, systems: [68, 68], positions: [10, 9] }], 'botexpo.colonizeMinFields': { 9: 200 } })) });
  try {
    const Wd = env.world;
    await leader(env);
    const occ = await env.waitJournal('botexpo:colonize-target', { pred: (e) => e.d && e.d.coords === '2:68:10', timeoutMs: 90000 });
    assert.equal(occ.d.ok, false, 'occupied position: step 2 does not offer 7: ' + JSON.stringify(occ.d));
    assert.ok(!occ.d.missions.includes(7));
    const sentEv = await env.waitJournal('botexpo:colonize-sent', { timeoutMs: 60000 });
    const s = Wd.log.sent.filter((x) => x.mission === 7);
    assert.equal(s.length, 1, 'one colony ship: ' + JSON.stringify(s));
    const x = s[0];
    assert.equal(x.to, '2:68:9'); assert.equal(x.type, 1); assert.equal(x.originId, HOME); assert.deepEqual(x.ships, { 208: 1 });
    assert.equal(x.cargo.metal + x.cargo.crystal, 7500 - x.consumption, 'payload = fleetroom - fuel: ' + JSON.stringify(x));
    assert.equal(x.cargo.metal, 7500 - x.consumption, 'metal first');
    assert.equal(sentEv.d.fleetId, x.fleetId);
    const galaxyGets = reqs(env).filter((r) => r.page && /^galaxy$/i.test(r.page));
    assert.equal(galaxyGets.length, 0, 'no galaxy view (deuterium)');
    const res = await env.waitJournal('botexpo:colonize-result', { timeoutMs: 90000 });
    assert.equal(res.d.ok, true, 'colony founded: ' + JSON.stringify(res.d));
    assert.equal(res.d.coords, '2:68:9');
    if (res.d.fields !== null) assert.equal(res.d.lowFields, true, 'colony fields ' + res.d.fields + ' < 200: journaled as low (never abandoned)');
    assert.equal(Wd.planets().length, 6);
    // (a run while the colonizer is still in flight may already skip with 5/6 + 1 in flight: wait for the stop after the colony)
    const stop = await env.waitJournal('botexpo:skip', { pred: (e) => e.d && e.d.reason === 'maxPlanets' && e.d.count && e.d.count.used === 6, timeoutMs: 60000 });
    assert.deepEqual(stop.d.count, { used: 6, max: 6 });
    const t1 = Date.now();
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(reqs(env, t1).filter((r) => r.method === 'POST').length, 0, 'nothing posted after max planets');
    const page = await env.page();
    const black = await env.evalOgx(page, async () => OGX.storage.get('botexpo.black', {}));
    assert.ok(black['2:68:10'] && black['2:68:10'].until > Date.now() + 20 * 3600000, 'occupied position blacklisted for a day: ' + JSON.stringify(black));
    await decisionsFirst(env, 'colonize');
    await clean(env, 'colonize');
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('master off -> nothing at all; master on with dry-run -> planned expeditions and colonisation journaled (action-dry), nothing mutating sent (no POST, no messages view)', async () => {
  const env = await B.launchBot({ world: spec('botexpo-colonize'), settings: settings({ 'botcore.master': false, 'botexpo.on': true, 'botexpo.colonize': true,
    'botexpo.colonizeTargets': [{ galaxy: 2, systems: [68, 68], positions: [9] }] }) });
  try {
    await new Promise((r) => setTimeout(r, 25000));
    let ev = await env.journal({ kind: /^botexpo:/ });
    assert.deepEqual(ev.map((e) => e.k), [], 'master off: no botexpo events');
    assert.deepEqual(env.mutating(), [], 'master off: nothing mutating');
    assert.equal(reqs(env).filter((r) => /^fleetTable$/i.test(r.page || '')).length, 0, 'master off: not even reads');
    await env.setSettings({ 'botcore.master': true });
    const st = await env.botStatus();
    assert.equal(st.dryRun, true, 'dry-run stays on (default)');
    await leader(env);
    const ex = await env.waitJournal('botexpo:expo-sent', { pred: (e) => e.d && e.d.dry, timeoutMs: 90000 });
    assert.deepEqual(ex.d.ships, { 210: 1 });
    const col = await env.waitJournal('botexpo:colonize-sent', { pred: (e) => e.d && e.d.dry, timeoutMs: 90000 });
    assert.equal(col.d.coords, '2:68:9');
    ev = await env.journal({ kind: 'botcore:action-dry' });
    const dry = ev.filter((e) => e.d && e.d.module === 'botexpo');
    assert.ok(dry.some((e) => e.d.type === 'fleet.send'), 'action-dry with the request that would have been sent');
    await env.waitJournal('botexpo:expo-ev', { timeoutMs: 5000 });
    assert.deepEqual(env.mutating().map((r) => r.method + ' ' + r.page), [], 'dry-run: nothing mutating');
    assert.equal(env.world.log.sent.length, 0);
    await decisionsFirst(env, 'dry');
    await clean(env, 'dry');
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('guards: threat lock on the main body (skip) and a return inside the sleep window (skip) -> no expedition sent', async () => {
  const W0 = spec('botexpo-dm', (s) => { s.hostile = [{ at: 0, from: '2:69:4', toBodyId: HOME, mission: 1, ships: { 204: 50 }, ownerId: 3843, ownerName: 'Jon Snow', flightSec: 3000 }]; });
  const now = Math.floor(Date.now() / 1000);
  const env = await B.launchBot({ world: W0, settings: settings(Object.assign({}, LIVE, { 'botcore.sleepOn': true, 'botcore.sleepFrom': wall(now + 20 * 60), 'botcore.sleepTo': wall(now + 5 * 3600) })) });
  try {
    await leader(env);
    const th = await env.waitJournal('botexpo:skip', { pred: (e) => e.d && e.d.reason === 'threat', timeoutMs: 90000 });
    assert.equal(th.d.body, HOME);
    const sl = await env.waitJournal('botexpo:skip', { pred: (e) => e.d && e.d.reason === 'returnsInSleep', timeoutMs: 30000 });
    assert.ok(sl.d.backAt > Date.now(), 'return time in the coming sleep window');
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(expoSends(env).length, 0, 'nothing sent');
    assert.equal(reqs(env).filter((r) => r.method === 'POST' && /fleetStep3/i.test(r.page || '')).length, 0, 'no step 3');
    await decisionsFirst(env, 'guards');
    await clean(env, 'guards');
  } finally { await env.close(); }
}, { timeout: 240000 });

T.test('slot reserve: 2 fleet slots, reserve 1 -> one expedition only, then «резерв» skip (never the last free slot)', async () => {
  const env = await B.launchBot({ world: spec('botexpo-dm', (s) => { s.player.research['108'] = 1; }), settings: settings(LIVE) });
  try {
    await leader(env);
    await env.until(() => expoSends(env).length >= 1, { timeoutMs: 120000, label: 'one expedition' });
    await env.until(async () => { const st = await env.botStatus(); const w = st && st.workers.find((x) => x.id === 'botexpo'); return w && w.lastRun && w.nextAt && w.nextAt - Date.now() > 5000; }, { timeoutMs: 20000, label: 'rescheduled' });
    const st = await env.botStatus();
    const w = st.workers.find((x) => x.id === 'botexpo');
    assert.ok(w.nextAt - Date.now() > 200000 && w.nextAt - Date.now() < 370000, 'expedition slot left free by the reserve: retry in 4-6 min, not at the 1 h return: ' + JSON.stringify(w));
    // a botcore setting change restarts the workers (C8 A6): the next run sees the reserve
    await env.setSettings({ 'botcore.maxGapMs': 501 });
    const sk = await env.waitJournal('botexpo:skip', { pred: (e) => e.d && e.d.reason === 'reserve', timeoutMs: 90000 });
    assert.deepEqual(sk.d.slots.fleet, { used: 1, max: 2 });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(expoSends(env).length, 1, 'the reserved slot stays free');
    await decisionsFirst(env, 'reserve');
    await clean(env, 'reserve');
  } finally { await env.close(); }
}, { timeout: 240000 });
