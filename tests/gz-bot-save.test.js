'use strict';
// botsave (fleet save + defense) end to end: the suite in a browser against the WORLD mode of the GALAXYZ mock
// (tests/gz-world.js, scenario fixtures/galaxyz/bot-scenarios/botsave-save.json: gamespeed 10, no production, silo 3).
//   node tests/gz-bot-save.test.js
// Every test also checks: no [OGX errors / bot console errors, and every botsave action has a preceding botsave:decision
// of the same worker run.
const T = require('./lib');
const B = require('./gz-bot-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;      // [2:68:5], moon 254110
const MOON = 254110;
const COLONY = 254103;    // [2:68:6]
const COL7 = 254104;      // [2:68:7]
const JON = 3843; const TXEMIN = 3839; const SEVERIAN = 3836;
const OTHER_BOT = ['botfarm', 'botdebris', 'botbuild', 'botexpo'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0 };
const SAVE = { 'botsave.on': true, 'botsave.saveLeadMinSec': 15, 'botsave.saveLeadMaxSec': 20, 'botsave.recallJitterMinSec': 1, 'botsave.recallJitterMaxSec': 3 };
const settings = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), FAST, SAVE, extra);
const FLYABLE = { 202: 200, 203: 100, 204: 50, 207: 20, 208: 2, 209: 50, 210: 100, 217: 2, 219: 2 };   // home fleet without 212
const GW = require('./gz-world');

const leader = (env) => env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 30000, label: 'leader' });
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
/** Every action of botsave (queued or refused at enqueue) is preceded by a botsave:decision of the same run. */
async function decisionsFirst(env, what) {
  const ev = await env.journal();
  const acts = ev.filter((e) => (e.k === 'botcore:action-queued' || e.k === 'botcore:action-refused') && e.d && e.d.module === 'botsave' && e.d.run);
  const seenQueued = new Set(ev.filter((e) => e.k === 'botcore:action-queued').map((e) => e.d && e.d.action));
  let n = 0;
  for (const a of acts) {
    if (a.k === 'botcore:action-refused' && a.d.action && seenQueued.has(a.d.action)) continue;   // refused after queueing: the queued one counts
    n++;
    const dec = ev.find((e) => e.k === 'botsave:decision' && e.d && e.d.run === a.d.run && e.t <= a.t);
    assert.ok(dec, what + ': decision before ' + a.k + ' ' + a.d.type + ' (' + (a.d.why || '') + ')');
  }
  return n;
}
/** Adds a hostile fleet to the world and loads a page so the event box shows it. */
async function hostile(env, h, cp = HOME) {
  const f = env.world.addHostile(Object.assign({ toBodyId: HOME, mission: 1, ships: { 204: 10 }, ownerId: JON, flightSec: 45 }, h));
  const page = await env.game('overview', { cp });
  return { f, page };
}
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
        const slim = (r) => JSON.parse(JSON.stringify(Object.assign({}, r, { data: r && r.data ? Object.assign({}, r.data, { doc: undefined, html: undefined }) : undefined })));
        try { OGX.__t[tag].value = await fn(w, arg, slim); } catch (e) { OGX.__t[tag].error = String(e && e.stack || e); }
        OGX.__t[tag].done = true;
        return { nextInMs: 3600000, reason: 'test done' };
      },
    });
  }, { tag, fnSrc: fnSrc.toString(), arg });
  let out = null;
  await env.until(async () => { out = await env.evalOgx(page, (t) => (OGX.__t && OGX.__t[t] && OGX.__t[t].done ? OGX.__t[t] : null), tag); return !!out; }, { timeoutMs: 120000, stepMs: 400, label: 'worker ' + tag });
  if (out.error) throw new Error('worker ' + tag + ': ' + out.error);
  return out.value;
}
const flyHome = (W) => { const s = W.body(HOME).ships; return Object.fromEntries(Object.keys(FLYABLE).map((id) => [id, s[id] || 0])); };

T.test('attack on 2:68:5: save in the lead window to the own moon, exact cargo, recall at half (timer survives a reload), fleet home after impact', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': true, 'botcore.dryRun': false, 'botsave.weakIgnore': false }) });
  try {
    const W = env.world;
    const { f: h } = await hostile(env, { ships: { 204: 10 }, flightSec: 50 });
    await leader(env);
    const seen = await env.waitJournal('botsave:threat-seen', { timeoutMs: 40000 });
    assert.equal(seen.d.decision, 'save', 'weakIgnore off: even a weak attack is saved: ' + JSON.stringify(seen.d));
    assert.equal(seen.d.ownerId, JON);
    const sentEv = await env.waitJournal('botsave:save-sent', { timeoutMs: 90000 });
    const sent = W.log.sent.find((x) => x.originId === HOME);
    assert.ok(sent, 'the world got the save: ' + JSON.stringify(W.log.sent));
    assert.equal(sent.fleetId, sentEv.d.fleetId, 'fleet id from the verified send');
    assert.equal(sent.mission, 4, 'deploy'); assert.equal(sent.to, '2:68:5'); assert.equal(sent.type, 3, 'to the own moon (moonsFirst)');
    // lead window [arrival - 20, arrival - 15] (+ the few seconds of fleetTable + steps 1-3)
    assert.ok(sent.t >= h.arrival - 20 - 8 && sent.t <= h.arrival - 15 + 3, `save start ${sent.t - h.arrival} s before impact`);
    assert.deepEqual(sent.ships, FLYABLE, 'all flyable ships, no satellites');
    assert.deepEqual({ metal: sent.cargo.metal, crystal: sent.cargo.crystal, deuterium: sent.cargo.deuterium }, { metal: 300000, crystal: 200000, deuterium: 100000 - sent.consumption }, 'exact cargo: all M/C, deuterium minus fuel (in the two 217)');
    const oneWay = sent.arrival - sent.t;
    assert.ok(oneWay >= (h.arrival - sent.t) * 1.3 + 20 - 10, `one-way ${oneWay} s reaches the threshold`);
    assert.equal(W.body(HOME).ships[207] || 0, 0, 'fleet left the planet');
    // reload: the recall timer is persisted (botcore.timers + onTimer('botsave:recall'))
    await env.game('overview', { cp: HOME });
    const rd = await env.waitJournal('botsave:recall-done', { timeoutMs: 120000 });
    assert.equal(rd.d.ok, true, JSON.stringify(rd.d));
    const rc = W.log.recalled.find((x) => x.fleetId === sent.fleetId);
    assert.ok(rc, 'world recalled the fleet');
    assert.ok(rc.t >= sent.t + oneWay / 2 - 1 && rc.t <= sent.t + oneWay / 2 + 3 + 8, `recall at half: ${rc.t - sent.t} s of one-way ${oneWay}`);
    assert.ok(rc.t < sent.arrival - 4, 'recall strictly before the arrival at the moon');
    assert.ok(rc.back >= h.arrival + 25, `fleet home ${rc.back - h.arrival} s after the impact`);
    // the impact happens while the fleet is away; then the fleet lands home with its cargo
    await env.until(() => { W.process(W.clock.nowUnix()); return W.clock.nowUnix() > rc.back + 1 && (W.body(HOME).ships[207] || 0) === 20; }, { timeoutMs: (rc.back - W.clock.nowUnix() + 30) * 1000, label: 'fleet home' });
    assert.deepEqual(flyHome(W), FLYABLE, 'every saved ship is home again');
    assert.ok(W.log.events.some((e) => /battle|attack/.test(e.kind) && Math.abs((e.t || 0) - h.arrival) <= 2) || W.clock.nowUnix() > h.arrival, 'impact passed');
    const n = await decisionsFirst(env, 'save');
    assert.ok(n >= 3, 'reads, send and recall all journaled: ' + n);
    await clean(env, 'save');
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('two waves: a second attack after the save moves the recall so the fleet lands after the second impact + 30 s', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': true, 'botcore.dryRun': false, 'botsave.marginPct': 120 }) });
  try {
    const W = env.world;
    const { f: h1 } = await hostile(env, { ships: { 204: 200, 205: 50 }, flightSec: 50 });
    await leader(env);
    const sentEv = await env.waitJournal('botsave:save-sent', { timeoutMs: 90000 });
    const sent = W.log.sent.find((x) => x.fleetId === sentEv.d.fleetId);
    const oneWay = sent.arrival - sent.t;
    const first = await env.waitJournal('botsave:recall-planned', { pred: (e) => e.d && e.d.at });
    const t2 = Math.max(h1.arrival + 5, Math.round(sent.t + 1.6 * oneWay - 30));
    const h2 = W.addHostile({ toBodyId: HOME, mission: 1, ships: { 204: 100 }, ownerId: JON, arrivalUnix: t2, flightSec: t2 - W.clock.nowUnix() });
    await env.game('overview', { cp: HOME });
    const moved = await env.waitJournal('botsave:recall-planned', { pred: (e) => e.d && e.d.at && e.d.gen >= 2, timeoutMs: 60000 });
    assert.ok(moved.d.at > first.d.at, 'recall moved later: ' + first.d.at + ' -> ' + moved.d.at);
    const rd = await env.waitJournal('botsave:recall-done', { timeoutMs: 180000 });
    assert.equal(rd.d.ok, true, JSON.stringify(rd.d));
    const rc = W.log.recalled.find((x) => x.fleetId === sent.fleetId);
    assert.ok(rc, 'recalled');
    assert.ok(rc.t < sent.arrival - 4, 'before the arrival at the destination');
    assert.ok(rc.back >= h2.arrival + 30 - 1, `home ${rc.back - h2.arrival} s after the second wave`);
    assert.equal(W.log.sent.filter((x) => x.originId === HOME).length, 1, 'no second save: nothing left to save');
    await decisionsFirst(env, 'two waves');
    await clean(env, 'two waves');
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('dry-run: the save is planned and journaled with the step-3 form, nothing mutating reaches the server', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': true }) });
  try {
    const W = env.world;
    await hostile(env, { flightSec: 40 });
    await leader(env);
    const planned = await env.waitJournal('botsave:save-planned', { pred: (e) => e.d && e.d.dry === true, timeoutMs: 90000 });
    assert.ok(planned.d.hypothesis, 'planned hypothesis: ' + JSON.stringify(planned.d));
    const dry = await env.waitJournal('botcore:action-dry', { pred: (e) => e.d && e.d.type === 'fleet.send' && e.d.module === 'botsave' });
    const s3 = (dry.d.requests || []).find((r) => r.page === 'fleetStep3');
    assert.ok(s3 && s3.method === 'POST' && s3.form && s3.form.mission === 4, 'step-3 form in the dry entry: ' + JSON.stringify(dry.d.requests));
    assert.equal(s3.cp, HOME, 'cp of the attacked planet');
    assert.deepEqual(env.mutating().map((r) => r.method + ' ' + r.url), [], 'no POST / paid request at all in dry-run');
    assert.equal(W.log.sent.length, 0); assert.equal(W.log.recalled.length, 0);
    const ev = await env.journal({ kind: 'botsave:recall-planned' });
    assert.equal(ev.length, 0, 'no recall planned for a fleet that was not sent');
    await decisionsFirst(env, 'dry');
    await clean(env, 'dry');
  } finally { await env.close(); }
}, { timeout: 180000 });

T.test('ignored threats: espionage only, whitelisted player, weak attack with weakIgnore on (live, nothing sent)', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': true, 'botcore.dryRun': false, 'botsave.weakIgnore': true, 'botsave.whitelist': [String(TXEMIN)] }) });
  try {
    const W = env.world;
    W.addHostile({ toBodyId: HOME, mission: 6, ships: { 210: 5 }, ownerId: JON, flightSec: 300 });
    W.addHostile({ toBodyId: HOME, mission: 1, ships: { 204: 300, 207: 50 }, ownerId: TXEMIN, flightSec: 320 });
    await hostile(env, { mission: 1, ships: { 204: 10 }, ownerId: SEVERIAN, flightSec: 340 });
    await leader(env);
    await env.until(async () => (await env.journal({ kind: 'botsave:threat-ignored' })).length >= 3, { timeoutMs: 60000, label: '3 ignored' });
    const ign = await env.journal({ kind: 'botsave:threat-ignored' });
    const by = Object.fromEntries(ign.map((e) => [e.d.filter, e.d]));
    assert.ok(by.probes && by.probes.ownerId === JON, 'espionage ignored: ' + JSON.stringify(ign.map((e) => e.d)));
    assert.ok(by.whitelist && by.whitelist.ownerId === TXEMIN, 'whitelisted owner ignored');
    assert.ok(by.weak && by.weak.ownerId === SEVERIAN, 'weak attack ignored');
    assert.equal((await env.journal({ kind: 'botsave:save-planned' })).length, 0, 'no save planned');
    // the module's panel section (drawn by botpanel inside the «Бот: сейв» tab) lists the threats with the decision
    const pageNow = await env.page();
    await env.until(async () => (await env.evalOgx(pageNow, () => { const d = document.createElement('div'); OGX.bot._panelSection('botsave')(d); return d.querySelectorAll('[data-ogx-botsave="threat"]').length; })) === 3, { timeoutMs: 10000, label: 'panel threats' });
    const panel = await env.evalOgx(pageNow, () => { const d = document.createElement('div'); OGX.bot._panelSection('botsave')(d); return d.textContent; });
    assert.ok(/Угрозы/.test(panel) && /без реакции/.test(panel) && /только шпионаж/.test(panel), panel);
    assert.equal(W.log.sent.length, 0);
    assert.deepEqual(env.mutating().map((r) => r.method + ' ' + r.url), [], 'only free reads');
    await decisionsFirst(env, 'ignored');
    await clean(env, 'ignored');
  } finally { await env.close(); }
}, { timeout: 180000 });

T.test('missile attack: interceptors ordered by the silo math (silo 3 -> 30, used 10 + 2*5, free 10 of 15 needed), no fleet save', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': true, 'botcore.dryRun': false }) });
  try {
    const W = env.world;
    await hostile(env, { mission: 10, ships: { 503: 15 }, flightSec: 150 });
    await leader(env);
    const seen = await env.waitJournal('botsave:threat-seen', { timeoutMs: 40000 });
    assert.equal(seen.d.decision, 'abm', JSON.stringify(seen.d));
    const ab = await env.waitJournal('botsave:abm-ordered', { timeoutMs: 90000 });
    assert.equal(ab.d.ok, true, JSON.stringify(ab.d));
    assert.equal(ab.d.capacity, 30); assert.equal(ab.d.free, 10); assert.equal(ab.d.missiles, 15);
    const orders = W.log.builds.filter((b) => b.accepted && b.accepted[502]);
    const total = orders.reduce((s, b) => s + b.accepted[502], 0);
    assert.equal(total, 10, 'interceptors ordered = free silo room: ' + JSON.stringify(orders));
    assert.equal(ab.d.ordered, 10);
    assert.ok(orders.every((b) => +b.bodyId === HOME || +b.cp === HOME), 'on the attacked planet');
    assert.equal(W.log.sent.length, 0, 'missiles: no fleet save');
    await decisionsFirst(env, 'abm');
    await clean(env, 'abm');
  } finally { await env.close(); }
}, { timeout: 180000 });

T.test('slots: only the reserve slot is free -> the force save uses it; a normal send from the locked body is refused threat, from another body slots', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': true, 'botcore.dryRun': false, 'botsave.saveLeadMinSec': 30, 'botsave.saveLeadMaxSec': 35 }), page: false });
  try {
    const W = env.world;
    W.command('setResearch', { 108: 1 });                       // 2 slots
    const r0 = W.send({ originId: COLONY, ships: { 202: 1 }, target: { galaxy: 2, system: 70, position: 8, type: 1 }, mission: 4, speed: 1 });
    assert.ok(r0.ok, JSON.stringify(r0));
    assert.equal(W.slotsMax() - W.slotsUsed(), 1, 'one free slot = botcore.slotsReserve');
    const { f: h, page } = await hostile(env, { ships: { 204: 200 }, flightSec: 70 });
    await leader(env);
    await env.until(async () => (await env.evalOgx(page, () => Object.keys(OGX.bot.lockedBodies()).length)) > 0, { timeoutMs: 20000, label: 'lock' });
    const r = await runWorker(env, page, 'norm', async (w, a, s) => {
      const locked = s(await w.act({ type: 'fleet.send', bodyId: a.home, why: 'тест: обычная отправка с атакуемой планеты', params: { target: { galaxy: 2, system: 68, position: 6, type: 1 }, ships: { 202: 1 }, mission: 3, speed: 10, cargo: { metal: 100, crystal: 0, deuterium: 0 } } }));
      const other = s(await w.act({ type: 'fleet.send', bodyId: a.col7, why: 'тест: обычная отправка в резервный слот', params: { target: { galaxy: 2, system: 68, position: 6, type: 1 }, ships: { 203: 1 }, mission: 3, speed: 10, cargo: { metal: 100, crystal: 0, deuterium: 0 } } }));
      return { locked, other };
    }, { home: HOME, col7: COL7 });
    assert.equal(r.locked.refused, 'threat', 'locked body: ' + JSON.stringify(r.locked));
    assert.equal(r.other.refused, 'slots', 'normal class keeps the reserve: ' + JSON.stringify(r.other));
    const sentEv = await env.waitJournal('botsave:save-sent', { timeoutMs: 120000 });
    const sent = W.log.sent.find((x) => x.fleetId === sentEv.d.fleetId);
    assert.ok(sent && sent.originId === HOME, 'force save used the reserve slot: ' + JSON.stringify(W.log.sent));
    assert.ok(sent.t < h.arrival, 'before the impact');
    assert.equal(W.slotsUsed(), 2);
    await decisionsFirst(env, 'slots');
    await clean(env, 'slots');
  } finally { await env.close(); }
}, { timeout: 240000 });

T.test('logout during the save: the bot stops, nothing is sent', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': true, 'botcore.dryRun': false }) });
  try {
    const W = env.world;
    await hostile(env, { flightSec: 75 });
    await leader(env);
    await env.waitJournal('botsave:save-planned', { timeoutMs: 40000 });
    W.logout();
    await env.until(async () => { const s = await env.botStatus(); return s && s.state === 'stopped'; }, { timeoutMs: 90000, label: 'stopped' });
    const st = await env.botStatus();
    assert.equal(st.stopReason, 'logout');
    assert.equal(W.log.sent.length, 0, 'nothing sent');
    await env.waitJournal('botcore:logout');
    await decisionsFirst(env, 'logout');
    await clean(env, 'logout');
  } finally { await env.close(); }
}, { timeout: 180000 });

T.test('sleep save: at the sleep boundary every body with ships is saved until the wake-up (recall planned so the fleet lands after it)', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': true, 'botcore.dryRun': false, 'botsave.sleepSave': true, 'botsave.sleepSaveOnlyMoons': false }) });
  try {
    const W = env.world;
    const page = env.firstPage;
    await leader(env);
    // window: started 5 min ago (boundary shift +40..140 s keeps it in the past), wakes in 12 min
    const hm = await env.evalOgx(page, () => { const t = OGX.time.serverNow(); return [OGX.fmt.time(t - 300000).slice(0, 5), OGX.fmt.time(t + 720000).slice(0, 5)]; });
    await env.setSettings({ 'botcore.sleepOn': true, 'botcore.sleepFrom': hm[0], 'botcore.sleepTo': hm[1] });
    await env.waitJournal('botcore:sleep', { pred: (e) => /спит/.test(e.w || ''), timeoutMs: 30000 });
    const start = await env.waitJournal('botsave:sleep-save', { pred: (e) => e.d && Array.isArray(e.d.bodies), timeoutMs: 60000 });
    const wakeAt = start.d.wakeAt;
    await env.until(async () => (await env.journal({ kind: 'botsave:sleep-save' })).filter((e) => e.d && e.d.fleetId).length >= 4, { timeoutMs: 150000, label: '4 night saves' });
    const origins = W.log.sent.map((x) => x.originId).sort();
    assert.deepEqual(origins, [254102, 254103, 254104, 254106].sort(), 'every body with ships (254105 has none, the moon has none): ' + JSON.stringify(W.log.sent));
    for (const x of W.log.sent) assert.ok([3, 4].includes(x.mission), 'deploy or a self-returning transport: ' + x.mission);
    const plans = (await env.journal({ kind: 'botsave:recall-planned' })).filter((e) => e.d && e.d.at);
    assert.ok(plans.length >= 1, 'recalls planned for the night saves');
    for (const p of plans) assert.ok(p.d.homeAt >= p.d.horizon - 1000 && p.d.horizon === wakeAt, 'home after the wake-up: ' + JSON.stringify(p.d));
    await decisionsFirst(env, 'sleep');
    await clean(env, 'sleep');
  } finally { await env.close(); }
}, { timeout: 240000 });

T.test('master switch off: botsave does nothing at all', async () => {
  const env = await B.launchBot({ world: 'botsave-save', settings: settings({ 'botcore.master': false, 'botcore.dryRun': false }) });
  try {
    const W = env.world;
    const { page } = await hostile(env, { flightSec: 40 });
    await new Promise((r) => setTimeout(r, 25000));
    const ev = await env.journal({ kind: /^botsave:/ });
    assert.deepEqual(ev.map((e) => e.k), [], 'no botsave events');
    assert.deepEqual(env.mutating().map((r) => r.method + ' ' + r.url), []);
    assert.equal(W.log.sent.length, 0);
    const st = await env.evalOgx(page, () => OGX.bot.status().state);
    assert.equal(st, 'off');
    await clean(env, 'off');
  } finally { await env.close(); }
}, { timeout: 120000 });

T.test('save without Battle Transporters: the fleet flees, resources stay (only 217 carry resources on a save), journaled', async () => {
  const spec = JSON.parse(JSON.stringify(GW.loadScenario('botsave-save')));
  delete spec.bodies.find((b) => +b.id === HOME).ships[217];
  const env = await B.launchBot({ world: spec, settings: settings({ 'botcore.master': true, 'botcore.dryRun': false, 'botsave.weakIgnore': false }) });
  try {
    const W = env.world;
    await hostile(env, { ships: { 204: 10 }, flightSec: 50 });
    await leader(env);
    const warn = await env.waitJournal('botsave:save-planned', { pred: (e) => e.d && e.d.warning === 'noTransport', timeoutMs: 90000 });
    assert.match(warn.w, /нет Ул\. трансп\./);
    await env.waitJournal('botsave:save-sent', { timeoutMs: 90000 });
    const sent = W.log.sent.find((x) => x.originId === HOME);
    assert.ok(sent, 'the fleet was saved: ' + JSON.stringify(W.log.sent));
    assert.ok(!sent.ships[217] && sent.ships[203] === 100 && sent.ships[202] === 200, JSON.stringify(sent.ships));
    assert.deepEqual({ metal: sent.cargo.metal, crystal: sent.cargo.crystal, deuterium: sent.cargo.deuterium }, { metal: 0, crystal: 0, deuterium: 0 }, '202/203/combat holds carry no resources');
    await clean(env, 'no 217');
  } finally { await env.close(); }
}, { timeout: 300000 });
