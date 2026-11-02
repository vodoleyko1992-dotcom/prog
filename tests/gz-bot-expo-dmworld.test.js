'use strict';
// botexpo 1.1 end to end against the WORLD mock: DM search with collectors (mission 11 to the own moon, collectors split over
// the free places, result from the return message) and the learn mode of expeditions (untried candidates first, keepProbes respected).
//   node tests/gz-bot-expo-dmworld.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;   // [2:68:5]
const MOON = 254190;
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botbuild'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0 };
const LIVE = { 'botcore.master': true, 'botcore.dryRun': false, 'botexpo.on': true };
const QUICK = { 'botexpo.probeBuild': false, 'botexpo.betweenMinSec': 1, 'botexpo.betweenMaxSec': 2, 'botexpo.afterReturnMinSec': 1, 'botexpo.afterReturnMaxSec': 3 };
const settings = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), FAST, QUICK, extra);
const leader = (env) => env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 30000, label: 'leader' });

const num0 = (v) => (Number.isFinite(+v) ? +v : 0);

function withMoon(collectors) {
  const s = JSON.parse(JSON.stringify(W.loadScenario('botexpo-dm')));
  s.universe.dmStayHours = 0.01;
  const home = s.bodies.find((b) => b.id === HOME);
  home.ships[220] = collectors;
  s.bodies.push({ id: MOON, type: 'moon', name: 'Луна', coords: home.coords, planetId: HOME, fieldsMax: 1, res: { metal: 0, crystal: 0, deuterium: 0 }, levels: {}, ships: {} });
  return s;
}

T.test('DM search: 10 collectors, limit 5 (assumed, not shown) -> five mission-11 fleets of 2×220 to the own moon (type 3), DM read from the return message, scrapped collectors re-ordered up to dmStock', async () => {
  const env = await B.launchBot({ world: withMoon(10), settings: settings(Object.assign({}, LIVE, { 'botexpo.expeditions': false, 'botexpo.dmStock': 10 })) });
  try {
    await leader(env);
    const dmSends = () => env.world.log.sent.filter((x) => x.mission === 11);
    await env.until(() => dmSends().length >= 5, { timeoutMs: 150000, label: 'five DM fleets' });
    const s = dmSends().slice(0, 5);
    for (const x of s) {
      assert.equal(x.originId, HOME, 'launched from the planet below the moon');
      assert.equal(x.to, '2:68:5'); assert.equal(x.type, 3, 'target = own moon');
      assert.deepEqual(x.ships, { 220: 2 }, 'collectors split evenly: ' + JSON.stringify(x.ships));
    }
    assert.equal(env.world.log.builds.filter((b) => b.accepted && b.accepted[220]).length, 0, 'no order while home + in flight = dmStock');
    const res = await env.waitJournal('botexpo:dm-result', { pred: (e) => e.d && e.d.found > 0, timeoutMs: 150000 });
    assert.ok(res.d.found >= 100 && res.d.found <= 300, 'mock finds 100..300 DM: ' + JSON.stringify(res.d));
    assert.equal(res.d.n, 2, 'the scrapped fleet had 2 collectors');
    await env.until(() => env.world.log.builds.some((b) => b.accepted && b.accepted[220] > 0), { timeoutMs: 120000, label: 'collectors re-ordered' });
    assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
  } finally { await env.close(); }
}, { timeout: 360000 });

T.test('DM search: the server allows 3 -> the 4th fleet is refused, the bot learns 3 and does not try a 4th again', async () => {
  const w = withMoon(10);
  w.universe.maxDmMissions = 3;
  w.universe.dmStayHours = 0.05;
  const env = await B.launchBot({ world: w, settings: settings(Object.assign({}, LIVE, { 'botexpo.expeditions': false, 'botexpo.dmBuild': false })) });
  try {
    await leader(env);
    const lim = await env.waitJournal('botexpo:dm-limit', { timeoutMs: 150000 });
    assert.equal(lim.d.limit, 3, JSON.stringify(lim.d));
    const meta = await env.evalOgx(await env.page(), async () => OGX.botExpo._M.meta.dmLimit);
    assert.equal(meta, 3);
    assert.equal(env.world.log.sent.filter((x) => x.mission === 11).length, 3, 'three accepted');
    assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('mode dm (default): expoProbes probes per expedition, the last keepProbes stay home, DM per hour table keyed by the fleet', async () => {
  const s = JSON.parse(JSON.stringify(W.loadScenario('botexpo-dm')));
  const env = await B.launchBot({ world: s, settings: settings(Object.assign({}, LIVE, { 'botexpo.dmHunt': false, 'botexpo.expoProbes': 30, 'botexpo.keepProbes': 10 })) });
  try {
    await leader(env);
    const ex = () => env.world.log.sent.filter((x) => x.mission === 15);
    await env.until(() => ex().length >= 2, { timeoutMs: 150000, label: 'two expeditions' });
    const sizes = ex().slice(0, 2).map((x) => x.ships[210]);
    assert.deepEqual(sizes, [30, 10], '50 probes: 30, then 50 - 30 - keep 10 = 10: ' + JSON.stringify(sizes));
    const ev = await env.waitJournal('botexpo:expo-ev', { timeoutMs: 5000 });
    assert.equal(ev.d.chosen, 'dm');
    const keys = await env.evalOgx(await env.page(), async () => Object.values(OGX.botExpo._M.trips || {}).map((t) => t.learnKey));
    assert.ok(keys.includes('30x210@1h'), 'trip keyed for the DM per hour table: ' + JSON.stringify(keys));
    assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('probes re-built: below the stock (2 x slots x probes per slot + keep) the origin orders the missing probes, at most every 3 min', async () => {
  const s = JSON.parse(JSON.stringify(W.loadScenario('botexpo-dm')));
  const home = s.bodies.find((b) => b.id === HOME);
  home.res.crystal = Math.max(num0(home.res.crystal), 10000000);
  const env = await B.launchBot({ world: s, settings: settings(Object.assign({}, LIVE, { 'botexpo.dmHunt': false, 'botexpo.probeBuild': true, 'botexpo.expoProbes': 30, 'botexpo.keepProbes': 10 })) });
  try {
    await leader(env);
    const e = await env.waitJournal('botexpo:probe-build', { timeoutMs: 150000 });
    assert.equal(e.d.body, HOME);
    assert.ok(e.d.ok, JSON.stringify(e.d));
    assert.equal(e.d.target % 60, 10, '2 x slots x 30 + keep 10: ' + e.d.target);
    assert.equal(e.d.n, e.d.target - e.d.home - e.d.flying, 'orders exactly the missing probes: ' + JSON.stringify(e.d));
    assert.ok(e.d.n > 0);
    const orders = env.world.log.builds.filter((b) => b.accepted && b.accepted[210] > 0);
    assert.equal(orders.length, 1, 'one order (next one not before 3 min)');
    assert.equal(orders[0].accepted[210], e.d.n);
    assert.deepEqual(env.ogxErrors().map((x) => x.text), []);
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('learn mode: every candidate that fits above keepProbes is tried; 100×210 does not fit 50 probes', async () => {
  const s = JSON.parse(JSON.stringify(W.loadScenario('botexpo-dm')));
  const env = await B.launchBot({ world: s, settings: settings(Object.assign({}, LIVE, { 'botexpo.dmHunt': false, 'botexpo.mode': 'learn', 'botexpo.keepProbes': 10,
    'botexpo.learnFleets': [{ ships: { 210: 1 } }, { ships: { 210: 20 } }, { ships: { 210: 100 } }], 'botexpo.learnMinTrips': 3 })) });
  try {
    await leader(env);
    const ex = () => env.world.log.sent.filter((x) => x.mission === 15);
    await env.until(() => ex().length >= 2, { timeoutMs: 150000, label: 'two expeditions' });
    const sizes = ex().slice(0, 2).map((x) => x.ships[210]).sort((a, b) => a - b);
    assert.deepEqual(sizes, [1, 20], 'fewest-tried first, then the next candidate: ' + JSON.stringify(sizes));
    assert.ok(ex().every((x) => x.ships[210] !== 100), 'never the candidate that does not fit');
    const ev = await env.waitJournal('botexpo:expo-ev', { timeoutMs: 5000 });
    assert.equal(ev.d.chosen, 'learn');
    assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
  } finally { await env.close(); }
}, { timeout: 300000 });
