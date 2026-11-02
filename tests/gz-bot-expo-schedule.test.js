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

/** world: { slots: { fleet:[used,max], exp:[used,max] }, ships, flights } — mutated by live sends. */
async function boot({ world, cfg = {}, dryRun = false }) {
  const clock = { t: T0 };
  const defs = [];
  const mods = [];
  const store = new Map();
  const OGX = {
    module: (d) => mods.push(d), botSim: SIM, catalog: CAT,
    time: { serverNow: () => clock.t },
    fmt: { short: (n) => String(Math.round(n)), time: (t) => new Date(t).toISOString().slice(11, 19) },
    state: { research: async () => ({ levels: { 109: 1, 110: 1, 111: 1 } }), combatBonus: async () => null },
    storage: { get: async (k, d) => d },
    bot: {
      ready: Promise.resolve(), INTERVALS: { m6: [240000, 360000], m16: [840000, 960000], m35: [1500000, 2100000] },
      randMs: ([a, b]) => Math.round((a + b) / 2), isActive: () => true, isDryRun: () => dryRun, cfg: () => undefined,
      flightTime: () => ({ duration: 600, fuel: 10, distance: 1000 }),
      register: (d) => { defs.push(d); return {}; }, panelSection: () => {}, status: () => ({ leader: true }),
    },
  };
  const window = { OGX };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { window, setTimeout, clearTimeout, console }, { filename: FILE });
  const ctx = { store: { get: async (k, d) => (store.has(k) ? JSON.parse(store.get(k)) : d), set: async (k, v) => { store.set(k, JSON.stringify(v)); }, subscribe: () => {} }, log: { warn() {} } };
  await mods[0].init(ctx);
  const run = defs.find((d) => d.id === 'botexpo').run;
  const log = { reads: 0, sends: [], dry: 0, journal: [] };
  const settings = Object.assign({ mode: 'dm', probeBuild: false, stayHours: 1, betweenMinSec: 5, betweenMaxSec: 15, afterReturnMinSec: 30, afterReturnMaxSec: 300 }, cfg);
  const wctx = {
    get dryRun() { return dryRun; },
    now: () => clock.t,
    cfg: (k) => settings[k],
    core: (k) => ({ slotsReserve: 1, readMessages: false }[k]),
    rec: (ev, what) => log.journal.push({ t: clock.t, ev, what }),
    decide: () => {},
    flights: () => [],
    bodies: async () => ({ p1: { id: 1, key: 'p1', coords: '2:68:5', order: 1, type: 'planet', ships: world.ships } }),
    locked: () => null,
    canSend: async () => ({ ok: true, held: 0 }),
    available: () => ({ metal: 1e6, crystal: 1e6, deuterium: 1e6 }),
    sleepCheck: () => ({ ok: true }),
    async act(a) {
      if (a.type === 'read.fleetTable') {
        assert.ok(/^Экспедиции: слоты и корабли на /.test(a.why));
        log.reads++;
        const s = world.slots;
        return { ok: true, data: { fleetTable: { slots: { used: s.fleet[0], max: s.fleet[1] }, expeditions: { used: s.exp[0], max: s.exp[1] },
          ships: Object.entries(world.ships).map(([id, count]) => ({ id: +id, count })), flights: world.flights || [] } } };
      }
      if (a.type === 'probe.target') return { ok: true, data: { missions: [15], stayOptions: [{ value: 1, hours: 1 }] } };
      if (a.type === 'fleet.send') {
        if (dryRun) { log.dry++; return { ok: true, dry: true, refused: 'dryRun' }; }
        world.slots.fleet[0]++; world.slots.exp[0]++;
        for (const [id, n] of Object.entries(a.params.ships)) world.ships[id] -= n;
        log.sends.push(clock.t);
        return { ok: true, verified: true, data: { fleetId: 100 + log.sends.length, arrival: clock.t + 600000, back: clock.t + 2 * 3600000 } };
      }
      return { ok: false, refused: 'unknown' };
    },
  };
  return { run: () => run(wctx), clock, log, world, setDry: (v) => { dryRun = v; }, M: OGX.botExpo._M, L: OGX.botExpo._lib };
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


