'use strict';
// A compressed bot "day" with EVERY bot module on (botsave, botfarm, botdebris, botbuild, botexpo), live (dry-run off), against the
// WORLD mode of the GALAXYZ mock (tests/gz-world.js, combat through botsim), scenario fixtures/galaxyz/bot-scenarios/day.json.
// The clock is accelerated by the world itself: fleet speed 40 (≈ 6x the Aeternum 7), expedition hold 0.01 h = 36 s (haltSpeed 100),
// build/research 120 s, units 1 s, and the night (sleep window) is a few minutes long — so a morning of farming, an attack at noon and
// a night fit into ~10 real minutes. The browser clock is real (the runtime's precise timers are what is tested).
//
// The "day":
//   morning   farming: probes to three inactives, reports, attacks (cargo-only and simulated); expeditions; build orders
//   noon      Jon Snow attacks 254104 [2:68:7] while the farm fleets fly -> threat lock, botsave saves the fleet, recall after impact
//             the empty target 2:68:14 grows 50 heavy fighters after our attack left -> escort report -> auto-recall, battle cancelled
//             the defended target 2:68:13 is beaten -> botdebris sends recyclers timed to the battle (never before it)
//   night     sleep window: only botsave may act; nothing sent earlier returns inside the window
//   morning 2 the bot wakes up and works again
// Cross-module invariants checked over the whole day (world logs + journal):
//   - one queue / one executor: the world never refused a send for slots; normal sends never ate the reserve slot; expedition
//     slots never exceeded; no two fleets of different modules attacked / recycled the same target at the same time (runtime claims;
//     a direct second recycle send to the field is refused 'duplicate'); nothing but botsave left the threatened body during the lock;
//     the vacation target was never touched; every module action has a decision of the same worker run before it; no [OGX errors.
//   node tests/gz-bot-scenario.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;     // [2:68:5] farm fleet + probes
const MOON = 254110;     // moon of 254102: 3 Battle Recyclers 219 (+ 60 x 209 the bot never uses)
const COL7 = 254104;     // [2:68:7] 100 light fighters, attacked at noon
const JON = 3843;
const GROWER = 3903;     // empty inactive [2:68:14] that grows a defense fleet after our attack left
const MODS = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo', 'botmissiles'];
const SLOTS_MAX = 8;     // 1 + research 108 (7) at the start; botbuild may research 108 during the day (maxAt below)
const EXPO_MAX = 2;      // floor(sqrt(124 = 4))
const RESERVE = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** server wall clock 'HH:MM' (UTC+2) of a unix second */
const wall = (unix) => new Date((unix + 7200) * 1000).toISOString().slice(11, 16);

function settings() {
  return Object.assign({
    'botcore.master': true, 'botcore.dryRun': false, 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0,
    'botcore.maxActionsPerHour': 2000, 'botcore.maxFleetSendsPerHour': 300, 'botcore.maxBuildsPerHour': 200, 'botcore.slotsReserve': RESERVE,
    'botcore.sleepOn': false, 'botcore.sleepPreventIfFleets': false,
    'botfarm.minLoot': 100000, 'botfarm.escortLeadSec': 40,
    // botmissiles on: day.json has no silo 4 anywhere, so it plans and journals only; no silo request (the day's build plan stays as is)
    'botmissiles.buildSilo': false,
    // probes per spy (suite setting, default 1100): the world has 60 probes at home — 1100 would send them all at once and
    // leave none for the escort spy
    'spy.probes': 5,
    'botsave.saveLeadMinSec': 15, 'botsave.saveLeadMaxSec': 20, 'botsave.recallJitterMinSec': 1, 'botsave.recallJitterMaxSec': 3,
    'botexpo.mode': 'dm', 'botexpo.expoProbes': 1, 'botexpo.keepProbes': 0, 'botexpo.probeBuild': false, 'botexpo.dmHunt': false, 'botexpo.stayHours': 0.01, 'botexpo.betweenMinSec': 1, 'botexpo.betweenMaxSec': 2, 'botexpo.afterReturnMinSec': 1, 'botexpo.afterReturnMaxSec': 3,
  }, Object.fromEntries(MODS.map((m) => [m + '.on', true])));
}

async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
/** One-shot worker (module botcore) running fn(wctx) in the leader; returns its JSON result. */
async function runWorker(env, tag, fnSrc, arg) {
  const page = await env.page();
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
        try { const r = await fn(w, arg); OGX.__t[tag].value = JSON.parse(JSON.stringify(Object.assign({}, r, { data: r && r.data ? Object.assign({}, r.data, { doc: undefined, html: undefined }) : undefined }))); }
        catch (e) { OGX.__t[tag].error = String(e && e.stack || e); }
        OGX.__t[tag].done = true;
        return { nextInMs: 3600000, reason: 'test done' };
      },
    });
  }, { tag, fnSrc: fnSrc.toString(), arg });
  let out = null;
  await env.until(async () => { out = await env.evalOgx(page, (t) => (OGX.__t && OGX.__t[t] && OGX.__t[t].done ? OGX.__t[t] : null), tag); return !!out; }, { timeoutMs: 90000, stepMs: 400, label: 'worker ' + tag });
  if (out.error) throw new Error('worker ' + tag + ': ' + out.error);
  return out.value;
}

T.test('a compressed day with every bot module on: farming, an attack at noon, auto-recall, debris timing, night, morning', async () => {
  const spec = JSON.parse(JSON.stringify(W.loadScenario('day')));
  const start = Math.floor(Date.now() / 1000);
  spec.startUnix = start;
  const env = await B.launchBot({ world: spec, clock: 'spec', settings: settings() });
  const Wd = env.world;
  // the whole journal of the day (the diag store keeps the last events only): collected while the day runs
  const J = []; const seen = new Set();
  const pull = async () => {
    for (const e of await env.journal()) {
      const k = [e.t, e.k, e.w, e.tab, e.id].join('|');
      if (!seen.has(k)) { seen.add(k); J.push(e); }
    }
    J.sort((a, b) => a.t - b.t);
    return J;
  };
  const find = (kind, pred) => J.find((e) => e.k === kind && (!pred || pred(e)));
  /** Polls the journal (and runs `step` each round, the "director" of the day) until `kind` + pred shows up. */
  const waitEv = async (kind, pred, { timeoutMs = 240000, step } = {}) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      await pull();
      if (step) await step();
      const hit = find(kind, pred);
      if (hit) { console.log(`    [+${Math.round(Date.now() / 1000 - start)} s] ${kind}: ${hit.w || ''}`); return hit; }
      if (Date.now() > end) {
        const tail = J.filter((e) => /^bot/.test(e.k)).slice(-40).map((e) => `${e.k} ${e.w || ''}`).join('\n  ');
        throw new Error(`waitEv(${kind}) timed out after ${timeoutMs} ms; last events:\n  ${tail}`);
      }
      await sleep(1500);
    }
  };
  // the noon events, triggered when the farming reached the right point
  let grown = false; let hostile = null;
  const director = async () => {
    if (!grown && find('botfarm:attack-sent', (e) => e.d && e.d.key === '2:68:14:1')) {
      grown = Wd.command('setOther', { id: GROWER, planet: { coords: '2:68:14', ships: { 205: 50 } } }) === true;
    }
    if (!hostile && find('botfarm:attack-sent')) {
      hostile = Wd.addHostile({ toBodyId: COL7, mission: 1, ships: { 204: 300, 205: 50 }, ownerId: JON, flightSec: 150 });
    }
  };
  try {
    // morning: the user looks at the home system once (the galaxy cache knows the inactives), then leaves the bot alone
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    await env.until(async () => { const s = await env.botStatus(); return s && s.leader && s.state !== 'off'; }, { timeoutMs: 30000, label: 'leader' });
    // the workers start 5..50 s after the start: wake them now (as a returning fleet would)
    await env.evalOgx(await env.page(), () => { OGX.bus.emit('bot:fleet-returned', { fleetId: 0, mission: 0, bodyKey: null, at: OGX.time.serverNow(), why: 'test: morning' }); });

    // ---------------------------------------------------------------- morning + noon
    const spy = await waitEv('botfarm:spy-sent', null, { step: director });
    assert.ok(spy.d.probes >= 1);
    await waitEv('botfarm:attack-sent', (e) => e.d && e.d.key === '2:68:14:1', { step: director });
    await waitEv('botfarm:attack-sent', (e) => e.d && e.d.key === '2:68:13:1', { step: director, timeoutMs: 300000 });
    await director();
    assert.ok(grown && hostile, 'noon events triggered');

    // the threat is seen (from the event box of the bot's own page reads), the body locked, the fleet saved before the impact
    const th = await waitEv('botcore:threat', (e) => e.d && e.d.threat && e.d.threat.to === '2:68:7', { step: director });
    assert.equal(th.d.threat.ownerName, 'Jon Snow', 'full attacker name (names with spaces)');
    await waitEv('botcore:lock', (e) => e.d && e.d.bodyKey === 'p' + COL7);
    const saved = await waitEv('botsave:save-sent', (e) => e.d && e.d.bodyKey === 'p' + COL7, { timeoutMs: 240000 });
    const wSave = Wd.log.sent.find((x) => x.originId === COL7 && x.t < hostile.arrival);
    assert.ok(wSave, 'world: the fleet of 254104 left before the impact: ' + JSON.stringify(Wd.log.sent.filter((x) => x.originId === COL7)));
    assert.equal(wSave.ships[204], 100, 'every light fighter saved');
    assert.ok(hostile.arrival - wSave.t <= 60 && hostile.arrival - wSave.t >= 5, `save ${hostile.arrival - wSave.t} s before the impact (lead window)`);
    assert.ok(saved);

    // the grower: escort report shows the change -> attack recalled before arrival, battle cancelled, no battle there
    const esc = await waitEv('botfarm:escort-report', (e) => e.d && /2:68:14/.test(e.d.battle || '') && e.d.changed === true, { timeoutMs: 240000 });
    const rc = await waitEv('botfarm:attack-recalled', (e) => e.d && e.d.battle === esc.d.battle, { timeoutMs: 120000 });
    assert.equal(rc.d.ok, true, JSON.stringify(rc.d));
    const wGrowAttack = Wd.log.sent.find((x) => x.mission === 1 && x.to === '2:68:14');
    assert.ok(Wd.log.recalled.some((r) => r.fleetId === wGrowAttack.fleetId && r.t < wGrowAttack.arrival), 'recalled in the world before arrival');

    // debris: the defended target is beaten, recyclers are sent so that they never arrive before the battle
    const recSent = await waitEv('botdebris:recyclers-sent', (e) => e.d && /2:68:13/.test(e.d.battle || ''), { timeoutMs: 300000 });
    const battle = Wd.log.events.find((e) => e.kind === 'battle' && e.coords === '2:68:13');
    const wAttack13 = Wd.log.sent.find((x) => x.mission === 1 && x.to === '2:68:13');
    const wRec = Wd.log.sent.find((x) => x.mission === 8 && x.to === '2:68:13' && x.type === 2);
    assert.ok(wRec, 'world: recyclers to the debris field of 2:68:13');
    assert.equal(wRec.fleetId, recSent.d.fleetId, 'verified fleet id');
    assert.deepEqual(Object.keys(wRec.ships).map(Number), [219], 'debris only in Battle Recyclers 219 (the 60 x 209 stay): ' + JSON.stringify(wRec.ships));
    assert.ok(Wd.log.sent.filter((x) => x.mission === 1).every((x) => !x.ships[202] && !x.ships[203]), 'farm loot only in Battle Transporters 217');
    assert.ok(wRec.arrival > wAttack13.arrival, `recyclers arrive after the battle (+${wRec.arrival - wAttack13.arrival} s)`);
    if (recSent.d.mode === 'pre') assert.ok(wRec.arrival - wAttack13.arrival >= 1 && wRec.arrival - wAttack13.arrival <= 2, 'pre-send: battle + 1..2 s');
    else assert.ok(wRec.t >= wAttack13.arrival + 1 && wRec.t <= wAttack13.arrival + 30, `post-battle send at battle + ${wRec.t - wAttack13.arrival} s`);
    assert.ok(!battle || battle.won === 'a', 'the defended target was beaten');

    // runtime claims: while those recyclers fly, another module's recycle send to the same field is refused (no double send)
    const dup = await runWorker(env, 'dupRecycle', async (w, a) => w.act({ type: 'fleet.send', bodyId: a.moon, prio: 'deadline', cls: 'force',
      params: { target: { galaxy: 2, system: 68, position: 13, type: 2 }, ships: { 219: 1 }, mission: 8, speed: 10 }, why: 'тест: второй сбор того же поля' }), { moon: MOON });
    assert.equal(dup.refused, 'duplicate', JSON.stringify(dup));
    assert.equal(Wd.log.sent.filter((x) => x.mission === 8 && x.to === '2:68:13').length, 1, 'one recycle fleet to that field');

    // harvest in the world, report read by botdebris
    await env.until(() => { Wd.process(Wd.clock.nowUnix()); return Wd.log.events.some((e) => e.kind === 'recycle' && e.fleetId === wRec.fleetId); }, { timeoutMs: 240000, stepMs: 1000, label: 'harvest' });
    const got = Wd.log.events.find((e) => e.kind === 'recycle' && e.fleetId === wRec.fleetId).got;
    assert.ok(got.metal + got.crystal > 0, 'debris collected: ' + JSON.stringify(got));

    // the attack hit 254104 after the save left; the saved fleet is recalled and lands after the impact
    await env.until(() => { Wd.process(Wd.clock.nowUnix()); return Wd.log.events.some((e) => e.kind === 'hostile-arrive' && e.fleetId === hostile.id); }, { timeoutMs: 240000, stepMs: 1000, label: 'impact' });
    await waitEv('botsave:recall-done', (e) => e.d && e.d.fleetId === wSave.fleetId, { timeoutMs: 240000 });
    await env.until(() => { Wd.process(Wd.clock.nowUnix()); return Wd.log.events.some((e) => e.kind === 'return' && e.fleetId === wSave.fleetId); }, { timeoutMs: 240000, stepMs: 1000, label: 'save home' });
    const back = Wd.log.events.find((e) => e.kind === 'return' && e.fleetId === wSave.fleetId);
    assert.ok(back.t > hostile.arrival, `saved fleet home ${back.t - hostile.arrival} s after the impact`);
    assert.equal(Wd.body(COL7).ships[204], 100, 'no light fighter lost');

    // ---------------------------------------------------------------- night
    // the user sets the night now: from the next full minute (+ the runtime's 40 s shift, pinned here), two minutes long
    const nightSetAt = Wd.clock.nowUnix();
    const from = Math.ceil((nightSetAt + 20) / 60) * 60;
    await env.evalOgx(await env.page(), (key) => { OGX.bot._R.sleepPlan[key] = { a: 40000, b: 40000, postponedUntil: null }; },
      new Date((from + 7200) * 1000).toISOString().slice(0, 10));
    await env.setSettings({ 'botcore.sleepOn': true, 'botcore.sleepFrom': wall(from), 'botcore.sleepTo': wall(from + 120) });
    const asleep = await waitEv('botcore:sleep', (e) => e.d && e.d.window && /спит/.test(e.w), { timeoutMs: 300000 });
    assert.ok(Math.abs(asleep.d.window.from - (from + 40) * 1000) <= 1000, 'night from the set minute + 40 s: ' + JSON.stringify(asleep.d.window));
    const win = { from: asleep.d.window.from, to: asleep.d.window.to };
    const woke = await waitEv('botcore:wake', (e) => e.t > asleep.t, { timeoutMs: 420000 });
    const nightFrom = Math.floor(asleep.t / 1000); const nightTo = Math.ceil(woke.t / 1000);

    // ---------------------------------------------------------------- morning 2: the bot works again
    const act2 = await waitEv('botcore:action-done', (e) => e.t > woke.t && e.d && e.d.module !== 'botsave' && /^(fleet\.send|build\.)/.test(e.d.type), { timeoutMs: 240000 });
    assert.ok(act2);
    await pull();

    // ---------------------------------------------------------------- invariants of the whole day
    // world send -> module (from the executor's journal)
    const byFleet = new Map();
    for (const e of J) if ((e.k === 'botcore:action-done' || e.k === 'botcore:action-verify-fail') && e.d && e.d.type === 'fleet.send' && e.d.data && e.d.data.fleetId != null) byFleet.set(+e.d.data.fleetId, e.d.module);
    const sends = Wd.log.sent.map((x) => Object.assign({}, x, { module: byFleet.get(+x.fleetId) || 'unknown' }));
    assert.deepEqual(sends.filter((x) => x.module === 'unknown').map((x) => x.fleetId + ' ' + x.mission + ' ' + x.to), [], 'every world fleet was sent by a journaled bot action');
    for (const m of ['botfarm', 'botsave', 'botdebris', 'botexpo']) assert.ok(sends.some((x) => x.module === m), m + ' sent fleets during the day');
    assert.ok(Wd.log.builds.some((b) => b.accepted || b.ok !== false), 'botbuild ordered something: ' + JSON.stringify(Wd.log.builds).slice(0, 300));

    // slots: the world never refused for slots; a normal (farm / expo) send never used the reserve; expedition slots respected
    assert.deepEqual(Wd.log.refusals.filter((r) => r.kind === 'fleet' && /slot/i.test(r.why || '')), [], 'no slot refusal at step 3');
    // a fleet's slot is free again at its return, a Deploy's arrival, or the last event of a fleet that ended out there
    // (expedition black hole, destroyed in battle)
    const ends = new Map();
    for (const e of Wd.log.events) if (e.kind === 'return' || (e.kind === 'arrive' && e.mission === 4)) ends.set(e.fleetId, e.t);
    for (const f of Wd.fleets) if (f.owner === 'me' && f.state === 'done' && f.ended && !ends.has(f.id)) ends.set(f.id, f.ended);
    const inFlight = (t, pred = () => true) => sends.filter((x) => x.t < t && (ends.has(x.fleetId) ? ends.get(x.fleetId) > t : true) && pred(x)).length;
    // the slot maximum grows during the day when botbuild finishes Computer Technology (108): take the largest fleetTable
    // reading of the bot (botcore:slots, read right before every send) up to the send, the start value otherwise
    const slotReads = J.filter((e) => e.k === 'botcore:slots' && e.d && e.d.slots && e.d.slots.fleet).map((e) => ({ t: e.t / 1000, max: +e.d.slots.fleet.max }));
    const maxAt = (t) => slotReads.reduce((m, r) => (r.t <= t && r.max > m ? r.max : m), SLOTS_MAX);
    for (const x of sends.filter((s) => s.module === 'botfarm' || s.module === 'botexpo')) {
      const used = inFlight(x.t);
      const max = maxAt(x.t);
      assert.ok(used <= max - RESERVE - 1, `${x.module} ${x.mission}->${x.to} at ${x.t}: ${used} fleets already out (max ${max}, reserve ${RESERVE})`);
    }
    for (const x of sends.filter((s) => s.mission === 15)) assert.ok(inFlight(x.t, (y) => y.mission === 15) <= EXPO_MAX - 1, 'expedition slots at ' + x.t);

    // one module per target: no overlapping attack / recycle / colonize fleets to the same coordinates
    for (const m of [1, 7, 8]) {
      const list = sends.filter((x) => x.mission === m);
      for (const a of list) for (const b of list) {
        if (a === b || a.to !== b.to || a.type !== b.type || b.t < a.t) continue;
        const aEnd = Math.min(a.arrival, ends.get(a.fleetId) || Infinity);
        assert.ok(b.t >= aEnd || Wd.log.recalled.some((r) => r.fleetId === a.fleetId && r.t <= b.t), `mission ${m} to ${a.to}: fleet ${b.fleetId} (${b.module}) sent while ${a.fleetId} (${a.module}) was on its way`);
      }
    }
    // threat lock: only botsave left 254104 between the lock and the impact (+60 s)
    const lock = find('botcore:lock', (e) => e.d && e.d.bodyKey === 'p' + COL7);
    const lockFrom = Math.floor(lock.t / 1000);
    assert.deepEqual(sends.filter((x) => x.originId === COL7 && x.t >= lockFrom && x.t <= hostile.arrival + 60 && x.module !== 'botsave').map((x) => x.module + ' ' + x.mission),
      [], 'nothing but the save left the threatened body');
    // vacation target never touched
    assert.equal(sends.filter((x) => x.to === '2:68:12').length, 0, 'vacation target 2:68:12 never touched');
    // night: only botsave acted; nothing sent before returned inside the window (unless recalled)
    assert.deepEqual(sends.filter((x) => x.t >= nightFrom && x.t < nightTo && x.module !== 'botsave').map((x) => x.module + ' ' + x.mission + '->' + x.to + ' @' + x.t),
      [], 'no fleet sent at night except saves');
    assert.deepEqual(Wd.log.builds.filter((b) => b.t >= nightFrom && b.t < nightTo).map((b) => b.kind + ' ' + b.bodyId), [], 'no build order at night');
    const recalled = new Set(Wd.log.recalled.map((r) => r.fleetId));
    const intoNight = sends.filter((x) => x.module !== 'botsave' && x.t >= nightSetAt && x.t * 1000 < win.from && !recalled.has(x.fleetId) && x.back && x.back * 1000 >= win.from && x.back * 1000 < win.to);
    assert.deepEqual(intoNight.map((x) => x.module + ' ' + x.mission + '->' + x.to + ' back ' + x.back), [], 'no fleet returns inside the sleep window');

    // explainability: every module action has a decision of the same run before it
    const queued = J.filter((e) => e.k === 'botcore:action-queued' && e.d && MODS.includes(e.d.module) && e.d.run);
    assert.ok(queued.length > 20, 'a busy day: ' + queued.length + ' actions');
    const missing = [];
    for (const a of queued) {
      if (a.d.type === 'read.fleetTable' && /^Слоты флота$/.test(a.d.why || '')) continue;   // the runtime's own slot read (wctx.slots)
      if (!J.some((e) => e.k === a.d.module + ':decision' && e.d && e.d.run === a.d.run && e.t <= a.t)) missing.push(a.d.module + ' ' + a.d.type + ' ' + (a.d.why || ''));
    }
    assert.deepEqual(missing, [], 'a decision before every action');
    // botmissiles: no silo 4 in day.json -> never a launch or a 503 order
    assert.equal(Wd.log.sent.filter((x) => x.mission === 10).length, 0, 'no missile launched (no silo 4)');
    assert.equal(Wd.log.builds.filter((b) => b.accepted && b.accepted[503]).length, 0, 'no IPM ordered');
    await clean(env, 'day');
  } finally {
    try {
      await pull();
      require('fs').writeFileSync(require('path').join(__dirname, 'out', 'scenario-day.json'), JSON.stringify({ journal: J.filter((e) => /^bot/.test(e.k)), world: Wd.log }, null, 1));
    } catch (e) { /* diagnostics only */ }
    await env.close();
  }
}, { timeout: 840000 });

