'use strict';
// botbuild: fewer reads and no idling (John 2026-11-01) in a browser against the WORLD mode of the GALAXYZ mock, scenario
// botbuild-payback (two planets 254102 [2:68:5] / 254103 [2:68:6]) with 6 s build times:
//   - 0.3.2: no page=buildings read before an order — the answer page of an order is the fresh view; a planet's page is read
//     once (first data) and again only after a failed order / an arrival / 10 min; no page=research with research off;
//   - the wake follows the queue end (1-2 s after it), so the next order of a planet comes seconds after its build ends.
// (a) runs with botbuild.queueDepth 1 (one building per queue). (b) the default depth 5: the next step is appended to a busy
// queue (2Moons pays a queued item when it starts), the answer page of an order is the fresh view for the next one (no read
// between two orders of a planet), and no queued item is dropped for missing resources at its start.
//   node tests/gz-bot-build-reads.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;
const COLONY = 254103;
const BUILD_SEC = 6;
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botexpo'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botcore.maxBuildsPerHour': 200 };
const settings = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), FAST, extra);

T.test('(a) queue depth 1 — cached views: page=buildings only for the first data, no read before each order; the next order follows the queue end within seconds', async () => {
  const s = JSON.parse(JSON.stringify(W.loadScenario('botbuild-payback')));
  s.universe.buildTimeSec = BUILD_SEC;
  const env = await B.launchBot({ world: s, settings: settings({ 'botcore.master': true, 'botcore.dryRun': false, 'botbuild.on': true, 'botbuild.policy': 'dis_exp90', 'botbuild.research': false, 'botbuild.queueDepth': 1 }) });
  try {
    await env.until(async () => { const st = await env.botStatus(); return st && st.leader; }, { timeoutMs: 30000, label: 'leader' });
    const reqs = () => env.server.requests.filter((r) => r.t >= env.launchedAt);
    const posts = () => reqs().filter((r) => r.method === 'POST' && /^buildings$/i.test(r.page || ''));
    await env.until(() => posts().filter((r) => +r.cp === HOME).length >= 3 && posts().filter((r) => +r.cp === COLONY).length >= 2, { timeoutMs: 150000, label: 'several orders on both planets' });
    const all = reqs();
    const P = posts();
    // the bot's page reads carry cp (the GET without cp after a POST is the executor's answer page)
    const gets = all.filter((r) => r.method === 'GET' && /^buildings$/i.test(r.page || '') && +r.cp > 0);
    // 0.3.2: orders go on the cached view (the answer page of each order is the next fresh view): page=buildings is read
    // once per planet (first data), not before every order
    assert.ok(gets.length <= 2 + 2, `page=buildings reads ${gets.length} for ${P.length} orders: ` + gets.map((g) => g.cp).join(','));
    assert.equal(all.filter((r) => r.method === 'GET' && /^research$/i.test(r.page || '')).length, 0, 'research off: no page=research');
    // the wake follows the queue end: the next order of a planet within seconds of its build end (not the 10-20 min fallback)
    for (const cp of [HOME, COLONY]) {
      const mine = P.filter((x) => +x.cp === cp);
      for (let i = 1; i < mine.length; i++) {
        const gap = (mine[i].t - mine[i - 1].t) / 1000 - BUILD_SEC;
        assert.ok(gap < 10, `planet ${cp}: order ${i + 1} ${Math.round(gap)} s after the queue end`);
      }
    }
    const fails = await env.journal({ kind: 'botcore:action-verify-fail' });
    assert.deepEqual(fails.map((e) => e.w), [], 'no failed verification');
    assert.deepEqual(env.ogxErrors().map((e) => e.text), [], 'no [OGX errors');
  } finally { await env.close(); }
}, { timeout: 240000 });

T.test('(b) queue depth 5 — the next step goes into the busy queue at once, the answer page replaces the read, nothing is dropped at its start', async () => {
  const s = JSON.parse(JSON.stringify(W.loadScenario('botbuild-payback')));
  s.universe.buildTimeSec = 60;
  const env = await B.launchBot({ world: s, settings: settings({ 'botcore.master': true, 'botcore.dryRun': false, 'botbuild.on': true, 'botbuild.policy': 'dis_exp90', 'botbuild.research': false }) });
  try {
    await env.until(async () => { const st = await env.botStatus(); return st && st.leader; }, { timeoutMs: 30000, label: 'leader' });
    const reqs = () => env.server.requests.filter((r) => r.t >= env.launchedAt);
    const posts = () => reqs().filter((r) => r.method === 'POST' && /^buildings$/i.test(r.page || ''));
    const queued = () => env.world.bodies.map((b) => b.buildQueue.length);
    await env.until(() => queued().some((n) => n >= 3), { timeoutMs: 120000, label: 'three buildings queued on one planet' });
    const P = posts();
    const gets = reqs().filter((r) => r.method === 'GET' && /^buildings$/i.test(r.page || '') && +r.cp > 0);
    // two orders of one planet with no page read between them: the first answer page was the fresh view
    const back = P.some((p, i) => { const prev = P.slice(0, i).filter((x) => +x.cp === +p.cp).pop(); return prev && !gets.some((g) => +g.cp === +p.cp && g.t > prev.t && g.t < p.t); });
    assert.ok(back, 'an order follows the previous one on that planet without a read: ' + P.map((p) => p.cp + ':' + (p.form && p.form.building)).join(','));
    // all within 60 s builds: the queue was appended to, not waited for
    const first = P[0]; const third = P.filter((x) => +x.cp === +first.cp)[2];
    if (third) assert.ok(third.t - first.t < 60000, 'three orders on a planet inside one build time');
    assert.deepEqual(env.world.log.refusals.filter((x) => x.kind === 'build'), [], 'no build refused / dropped by the game');
    const fails = await env.journal({ kind: 'botcore:action-verify-fail' });
    assert.deepEqual(fails.map((e) => e.w), [], 'no failed verification');
    assert.deepEqual(env.ogxErrors().map((e) => e.text), [], 'no [OGX errors');
  } finally { await env.close(); }
}, { timeout: 240000 });
