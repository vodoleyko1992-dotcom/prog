'use strict';
// botexpo scheduling (no browser): the expedition worker must not re-read «Экспедиции: слоты и корабли на …» (read.fleetTable) every
// few seconds. Field report: 33 reads in 6 min, in dry-run and live — every bot:fleet-returned (botfarm raids) woke the worker and
// every run re-read the slots; a run that sent nothing was retried after 5-15 s; dry-run started a new round on every wake.
// The module runs in a vm sandbox with a fake OGX.bot / wctx; the worker is called every 5 s (worst case: a fleet returns that often).
//   node tests/gz-bot-expo-schedule.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'ogamex-bot', 'modules', 'botexpo', 'botexpo.js');
const SIM = require(path.join(ROOT, 'ogamex-bot', 'modules', 'botsim', 'botsim.js'));
const CAT = SIM.loadCatalog(path.join(ROOT, 'shared', 'core', '08-catalog-data.js'));
const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);

/** world: { slots: { fleet:[used,max], exp:[used,max] }, ships, flights, messages: { cat: [{ id, ts, outcome | kind, resources, dm }] },
 *  pageAt (ServerMs of the last full-page request botcore saw) } — mutated by live sends; a fleetTable read is a full-page request. */
async function boot({ world, cfg = {}, core = {}, dryRun = false, worker = 'botexpo' }) {
  const clock = { t: T0 };
  const defs = [];
  const mods = [];
  const store = new Map();
  const bodies = { p1: { id: 1, key: 'p1', coords: '2:68:5', order: 1, type: 'planet', ships: world.ships } };
  const OGX = {
    module: (d) => mods.push(d), botSim: SIM, catalog: CAT,
    time: { serverNow: () => clock.t },
    fmt: { short: (n) => String(Math.round(n)), time: (t) => new Date(t).toISOString().slice(11, 19) },
    state: { research: async () => ({ levels: { 109: 1, 110: 1, 111: 1 } }), combatBonus: async () => null },
    storage: { get: async (k, d) => d },
    log: { rec() {} },
    messages: { parse: {
      list: (doc) => ((world.messages || {})[doc.cat] || []).map((m) => ({ id: m.id, ts: m.ts, li: m, kind: m.kind })),
      expedition: (li) => ({ outcome: li.outcome || null }),
      fleetMessage: (li) => ({ kind: li.kind || 'return_expedition', resources: li.resources || {}, gz: { resources: { 921: li.dm || 0 } } }),
    } },
    bot: {
      ready: Promise.resolve(), INTERVALS: { m6: [240000, 360000], m16: [840000, 960000], m35: [1500000, 2100000] },
      randMs: ([a, b]) => Math.round((a + b) / 2), isActive: () => true, isDryRun: () => dryRun, cfg: () => undefined,
      flightTime: () => ({ duration: 600, fuel: 10, distance: 1000 }),
      register: (d) => { defs.push(d); return {}; }, panelSection: () => {}, status: () => ({ leader: true, limitsHit: world.limitsHit || [] }),
      lastPageAt: () => world.pageAt || 0,
    },
  };
  const window = { OGX };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { window, setTimeout, clearTimeout, console }, { filename: FILE });
  const ctx = { store: { get: async (k, d) => (store.has(k) ? JSON.parse(store.get(k)) : d), set: async (k, v) => { store.set(k, JSON.stringify(v)); }, subscribe: () => {} }, log: { warn() {} } };
  await mods[0].init(ctx);
  const run = defs.find((d) => d.id === worker).run;
  const log = { reads: 0, sends: [], dry: 0, journal: [], msgReads: [], pageReads: 0 };
  const settings = Object.assign({ mode: 'dm', probeBuild: false, expoProbes: 1, keepProbes: 0, stayHours: 1, betweenMinSec: 5, betweenMaxSec: 15, afterReturnMinSec: 30, afterReturnMaxSec: 300 }, cfg);
  const coreSettings = Object.assign({ slotsReserve: 1, readMessages: false }, core);
  const wctx = {
    get dryRun() { return dryRun; },
    now: () => clock.t,
    cfg: (k) => settings[k],
    core: (k) => coreSettings[k],
    rec: (ev, what, d) => log.journal.push({ t: clock.t, ev, what, d }),
    decide: () => {},
    flights: () => world.cacheFlights || [],
    bodies: async () => bodies,
    locked: () => null,
    canSend: async () => ({ ok: true, held: 0 }),
    available: () => ({ metal: 1e6, crystal: 1e6, deuterium: 1e6 }),
    reserve: () => 'r1', release: () => {},
    sleepCheck: () => ({ ok: true }),
    async act(a) {
      if (a.type === 'read.fleetTable') {
        assert.ok(/^Экспедиции: слоты и корабли на /.test(a.why));
        log.reads++;
        world.pageAt = clock.t;   // a full-page GET: the server's fleet handler ran (botcore.lastPageAt)
        const s = world.slots;
        return { ok: true, data: { fleetTable: { slots: { used: s.fleet[0], max: s.fleet[1] }, expeditions: { used: s.exp[0], max: s.exp[1] },
          ships: Object.entries(world.ships).map(([id, count]) => ({ id: +id, count })), flights: world.flights || [] } } };
      }
      if (a.type === 'read.messages') { log.msgReads.push({ t: clock.t, cat: a.params.cat, fresh: !!a.fresh }); return { ok: true, at: clock.t, data: { doc: { cat: a.params.cat } } }; }
      if (a.type === 'read.page') { log.pageReads++; return { ok: true, at: clock.t, data: { doc: {} } }; }
      if (a.type === 'probe.target') return { ok: true, data: { missions: [15, 11], stayOptions: [{ value: 1, hours: 1 }] } };
      if (a.type === 'fleet.send') {
        if (dryRun) { log.dry++; return { ok: true, dry: true, refused: 'dryRun' }; }
        world.slots.fleet[0]++; world.slots.exp[0]++;
        for (const [id, n] of Object.entries(a.params.ships)) world.ships[id] -= n;
        log.sends.push(clock.t);
        return { ok: true, verified: true, at: clock.t, data: { fleetId: 100 + log.sends.length, arrival: clock.t + 600000, back: clock.t + 2 * 3600000 } };
      }
      return { ok: false, refused: 'unknown' };
    },
  };
  return { run: () => run(wctx), clock, log, world, bodies, setDry: (v) => { dryRun = v; }, M: OGX.botExpo._M, L: OGX.botExpo._lib };
}
/** Calls the worker every `stepMs` (a wake each time) and also at the times it asked for, for `ms` of server time. */
async function drive(env, ms, stepMs = 5000) {
  const end = env.clock.t + ms;
  let next = env.clock.t;
  const outs = [];
  while (env.clock.t <= end) {
    const out = await env.run();
    outs.push(Object.assign({ at: env.clock.t }, out));
    next = out.nextAt;
    env.clock.t = Math.min(env.clock.t + stepMs, Math.max(next, env.clock.t + 500));
  }
  return outs;
}

T.test('idle back-off: 60 s doubling to 10 min; the gate skips early wakes unless an expedition returned or settings changed', async () => {
  const { L } = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: {} } });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(L.idleDelay), [60000, 120000, 240000, 480000, 600000, 600000, 600000]);
  assert.equal(L.expoGate(null, { now: 5, cfgSig: 'a' }).run, true);
  assert.equal(L.expoGate({ nextAt: 4, cfgSig: 'a' }, { now: 5, cfgSig: 'a' }).run, true, 'planned time came');
  const g = L.expoGate({ nextAt: 100, cfgSig: 'a', reason: 'x' }, { now: 5, cfgSig: 'a', returned: false });
  assert.equal(g.run, false); assert.equal(g.nextAt, 100);
  assert.equal(L.expoGate({ nextAt: 100, cfgSig: 'a' }, { now: 5, cfgSig: 'b' }).run, true, 'settings changed');
  assert.equal(L.expoGate({ nextAt: 100, cfgSig: 'a' }, { now: 5, cfgSig: 'a', returned: true }).run, true, 'expedition returned');
  assert.equal(L.expoGate({ at: 2, nextAt: 100, cfgSig: 'a' }, { now: 5, cfgSig: 'a', settingsAt: 3 }).run, true, 'a botcore/botexpo setting changed after the last step');
  assert.equal(L.expoGate({ at: 4, nextAt: 100, cfgSig: 'a' }, { now: 5, cfgSig: 'a', settingsAt: 3 }).run, false, 'an older change does not open the gate');
});

T.test('live, both expedition slots busy, a fleet returns every 5 s: at most 2 slot reads in 6 min (was one per wake)', async () => {
  const env = await boot({ world: { slots: { fleet: [4, 10], exp: [2, 2] }, ships: { 210: 5 } } });
  await drive(env, 6 * 60000);
  assert.ok(env.log.reads >= 1 && env.log.reads <= 2, 'reads ' + env.log.reads);
});

T.test('live, a free slot but nothing to send: reads back off 60 s doubling to 10 min (not every 5-15 s)', async () => {
  const env = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: {} } });
  await drive(env, 6 * 60000);
  assert.ok(env.log.reads <= 4, 'reads in 6 min ' + env.log.reads);
  const outs = await drive(env, 30 * 60000);
  const gaps = env.M.meta.idle;
  assert.ok(gaps.streak >= 4, 'idle streak grows ' + JSON.stringify(gaps));
  assert.ok(outs[outs.length - 1].nextAt - outs[outs.length - 1].at <= 10 * 60000 + 1, 'capped at 10 min');
  assert.equal(env.log.sends.length, 0);
});

T.test('live, 2 free slots: two sends betweenMin..Max apart, then the next read waits for the return (not every wake)', async () => {
  const env = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: { 210: 5 } } });
  const outs = await drive(env, 6 * 60000);
  assert.equal(env.log.sends.length, 2, 'two expeditions');
  const gap = env.log.sends[1] - env.log.sends[0];
  assert.ok(gap >= 5000 && gap <= 15000, 'pause between the fleets ' + gap);
  assert.ok(env.log.reads <= 3, 'reads ' + env.log.reads);
  const last = outs[outs.length - 1];
  assert.ok(last.nextAt >= T0 + 2 * 3600000, 'next round after the first return: ' + (last.nextAt - T0));
});

T.test('dry-run, 2 free slots, wakes every 5 s: the plan is journaled once per round, a new round at most every 5 min', async () => {
  const env = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: { 210: 5 } }, dryRun: true });
  await drive(env, 6 * 60000);
  assert.ok(env.log.dry >= 1 && env.log.dry <= 2, 'dry sends in 6 min: ' + env.log.dry);
  assert.ok(env.log.reads <= 3, 'reads in 6 min: ' + env.log.reads);
  const env2 = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: { 210: 5 } }, dryRun: true });
  await drive(env2, 60 * 60000);
  assert.ok(env2.log.reads <= 12, 'reads in 1 h: ' + env2.log.reads);
  assert.ok(env2.log.dry <= 6, 'dry sends in 1 h: ' + env2.log.dry);
});

T.test('dry-run switched on mid live round: dry sends use up the round (no endless 5-15 s loop)', async () => {
  const env = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 3] }, ships: { 210: 5 } } });
  await env.run();
  assert.equal(env.log.sends.length, 1);
  env.setDry(true);
  env.clock.t += 10000;
  await drive(env, 6 * 60000);
  assert.ok(env.log.dry <= 2, 'dry sends ' + env.log.dry);
  assert.ok(env.log.reads <= 5, 'reads ' + env.log.reads);
});



T.test('results (GALAXYZ ajax lag): no messages read until a full-page request followed the stay end (after 45 s one of our own), one cat-15 read serves the round, retries 30 s x n, six reads then the trip is closed as unread (never flying forever)', async () => {
  const env = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: { 210: 5 }, messages: {}, pageAt: 0 }, core: { readMessages: true }, cfg: { betweenMinSec: 5, betweenMaxSec: 5 } });
  await drive(env, 20000);
  assert.equal(env.log.sends.length, 2, 'the round: two sends');
  assert.equal(env.log.reads, 1, 'one slot read for the round (the view serves the second fleet)');
  const trips = Object.values(env.M.trips).sort((a, b) => a.stayEnd - b.stayEnd);
  const E = trips[0].stayEnd;
  env.world.pageAt = T0 + 1000;                    // the last full-page request: the step's fleetTable GET, before the stay end
  env.clock.t = E - 10000;
  await drive(env, 50000);                         // a wake every 5 s until E + 40 s
  assert.equal(env.log.msgReads.length, 0, 'no read while no full-page request followed the stay end: ' + JSON.stringify(env.log.msgReads));
  const reads0 = env.log.reads;
  await drive(env, 20000);                         // E + 60 s
  assert.equal(env.log.reads, reads0 + 1, 'one page request of our own 45 s after the event');
  assert.equal(env.log.msgReads.filter((r) => r.cat === 15).length, 1, 'then one cat-15 read for both trips');
  assert.ok(env.log.msgReads[0].t >= env.world.pageAt, 'read after the page request');
  await drive(env, 600000);
  const r15 = env.log.msgReads.filter((r) => r.cat === 15);
  assert.equal(r15.length, 6, 'six reads, then no more: ' + JSON.stringify(r15.map((r) => (r.t - E) / 1000)));
  const gaps = r15.slice(1).map((r, i) => r.t - r15[i].t);
  assert.ok(gaps.every((g, i) => g >= 30000 * (i + 1) && g <= 30000 * (i + 1) + 5500), 'retries 30 s x n apart: ' + JSON.stringify(gaps));
  assert.ok(trips.every((x) => x.done && x.unread15), 'both trips closed as unread: ' + JSON.stringify(trips.map((x) => [x.done, x.unread15, x.tries15])));
  assert.equal(env.M.stats.unread15, 2);
  assert.ok(env.log.journal.some((j) => j.ev === 'expo-result' && /не найден/.test(j.what)), 'journaled');
  assert.equal(env.log.msgReads.filter((r) => r.cat === 4).length, 0, 'no return read for a closed trip');
});

T.test('results: report (cat 15) and return (cat 4) matched by their date; «сдвиг времени» moves the return one stay later (upstream formula), no cat-4 read before it, the trip keeps its amounts; a wake storm costs no reads', async () => {
  const env = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: { 210: 5 }, messages: {}, pageAt: 0 }, core: { readMessages: true }, cfg: { betweenMinSec: 5, betweenMaxSec: 5 } });
  await drive(env, 20000);
  const [a, b] = Object.values(env.M.trips).sort((x, y) => x.stayEnd - y.stayEnd);
  env.world.messages[15] = [{ id: 'rA', ts: a.stayEnd, outcome: 'delay' }, { id: 'rB', ts: b.stayEnd, outcome: 'nothing' }];
  env.clock.t = b.stayEnd + 1000;
  env.world.pageAt = env.clock.t;                  // a page request of another module after both stay ends
  await drive(env, 30000);
  assert.equal(a.outcome, 'time'); assert.equal(b.outcome, 'nothing');
  assert.equal(env.log.msgReads.filter((r) => r.cat === 15).length, 1, 'one read for both trips');
  const stay = a.stayEnd - a.arrival;
  assert.equal(a.back, a.backPlanned + stay + 2000, 'delay: planned back + stay + 2 s');
  assert.equal(a.returnSeen, false);
  assert.ok(env.log.journal.some((j) => j.ev === 'decision' && /задержка/.test(j.what)));
  // B returns: its message; A's is not there yet and must not be taken
  env.world.messages[4] = [{ id: 'mB', ts: b.back, kind: 'return_expedition', resources: { metal: 0, crystal: 0, deuterium: 0 }, dm: 0 }];
  env.clock.t = b.back + 1000; env.world.pageAt = env.clock.t;
  await drive(env, 60000);
  assert.equal(b.done, true); assert.deepEqual(JSON.parse(JSON.stringify(b.amounts)), { metal: 0, crystal: 0, deuterium: 0, darkMatter: 0 });
  assert.equal(a.amounts, null, 'A is not matched to B\'s message');
  // wakes every 5 s across A's corrected return: no cat-4 read before it
  env.world.messages[4].push({ id: 'mA', ts: a.back, kind: 'return_expedition', resources: { metal: 0, crystal: 0, deuterium: 0 }, dm: 120 });
  env.clock.t = a.back - 60000;
  const n4 = env.log.msgReads.filter((r) => r.cat === 4).length;
  await drive(env, 55000);
  assert.equal(env.log.msgReads.filter((r) => r.cat === 4).length, n4, 'no cat-4 read before the corrected return');
  env.world.pageAt = a.back + 2000;
  await drive(env, 60000);
  assert.equal(a.done, true); assert.equal(a.amounts && a.amounts.darkMatter, 120);
  assert.equal(env.M.stats.dm, 120);
  assert.equal(env.M.stats.outcomes.time, 1); assert.equal(env.M.stats.outcomes.nothing, 1);
});

T.test('DM hunt without a moon: one «нужна своя луна» line per 6 h and no page read on the wakes (every 5 s); a new moon runs the step within a minute; all places taken -> no fleetTable read until the first return', async () => {
  const env = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: {} }, worker: 'botexpo:dm' });
  await drive(env, 10 * 60000);
  assert.equal(env.log.journal.filter((j) => j.ev === 'skip' && /луны/.test(j.what)).length, 1, 'one skip line');
  assert.equal(env.log.reads, 0, 'no fleetTable read');
  assert.equal(env.M.dmState, 'нужна своя луна');
  env.bodies.m1 = { id: 2, key: 'm1', coords: '2:68:5', order: 2, type: 'moon', ships: {} };
  await drive(env, 60000);
  assert.equal(env.log.reads, 1, 'the moon (bodies changed) opened the gate: one read');
  assert.equal(env.log.journal.filter((j) => j.ev === 'skip' && /луны/.test(j.what)).length, 1);
  // five searches of ours in flight (the assumed limit): nothing to read until the first comes back
  const t = env.clock.t;
  env.M.dm = {};
  for (let i = 0; i < 5; i++) env.M.dm['d' + i] = { id: 'd' + i, fleetId: 500 + i, origin: 1, originCoords: '2:68:5', n: 2, sentAt: t, arrival: t + 600000, back: t + 3600000 + i * 1000, done: false };
  env.M.meta.dmGate = null;
  const outs = await drive(env, 20 * 60000);
  assert.equal(env.log.reads, 1, 'no read while all places are taken');
  assert.ok(outs[outs.length - 1].nextAt >= t + 3600000, 'waits for the first return: ' + (outs[outs.length - 1].nextAt - t));
});

T.test('colonize with an empty target list: no overview read on the wakes (every 5 s for 10 min), one skip line per 6 h; a colonizer in flight is checked around its arrival only', async () => {
  const env = await boot({ world: { slots: { fleet: [0, 10], exp: [0, 2] }, ships: {} }, worker: 'botexpo:colonize', cfg: { colonize: true, colonizeTargets: [] } });
  await drive(env, 10 * 60000);
  assert.equal(env.log.pageReads, 0, 'no overview read');
  assert.equal(env.log.journal.filter((j) => j.ev === 'skip' && /целей пуст/.test(j.what)).length, 1, 'one skip line');
  const arr = env.clock.t + 5 * 60000;
  env.M.colo = { c1: { key: 'c1', fleetId: 9, coords: '2:68:9', position: 9, origin: 1, originCoords: '2:68:5', cargo: { metal: 0, crystal: 0 }, sentAt: env.clock.t, arrival: arr, done: false } };
  env.M.meta.colGate = null;
  await drive(env, 4 * 60000);
  assert.equal(env.log.pageReads, 1, 'one overview read, then the step waits for the arrival');
  await drive(env, 3 * 60000);
  assert.ok(env.log.pageReads >= 2 && env.log.pageReads <= 5, 'reads around the arrival only: ' + env.log.pageReads);
  assert.equal(env.M.colo.c1.done, true, 'the colonizer is settled (no colony seen: failure journaled)');
});
