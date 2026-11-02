'use strict';
// Regression: switching a bot module off (master on, dry-run off) drops that module's queued and prepared actions.
// 1) a precise fleet.send already prepared (state 'pre', steps 1-2 posted) is disarmed: step 3 is never posted;
// 2) a plain fleet.send queued for later (at = +20 s) is refused, not sent;
// 3) a new act() of the switched-off module is refused at once.
const path = require('path');
const T = require(path.join(__dirname, 'lib'));
const G = require(path.join(__dirname, 'gz-lib'));
const { assert } = T;
const HOME = 254102;
const OTHER = ['botsave', 'botfarm', 'botbuild', 'botexpo', 'botmissiles'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeoutMs = 30000, what = 'cond' } = {}) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error('timeout ' + what); await sleep(250); } }
const SEND = (over = {}) => Object.assign({ type: 'fleet.send', bodyId: HOME, why: 'module-off test', params: { target: { galaxy: 2, system: 68, position: 9, type: 1 }, ships: { 208: 1 }, mission: 7, speed: 10, cargo: { metal: 0, crystal: 0, deuterium: 0 } } }, over);
const settingsFor = () => Object.assign(Object.fromEntries(OTHER.map((m) => [m + '.enabled', false])), { 'botcore.master': true, 'botcore.dryRun': false, 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500,
  'botdebris.on': true, 'botdebris.checkMinMin': 1440, 'botdebris.checkMaxMin': 1440, 'botdebris.followBattles': false });

async function withWorker(spec, fn) {
  const env = await G.launch({ settings: settingsFor() });
  try {
    const page = await env.game('overview');
    await until(async () => (await env.evalOgx(page, () => OGX.bot.status())).leader, { what: 'leader' });
    await env.evalOgx(page, ({ spec }) => {
      OGX.__t = { done: false, results: [] };
      OGX.bot.register({ id: 'botdebris:moduleoff', module: 'botdebris', prio: 'fleet', startJitter: [0, 50], async run(w) {
        if (OGX.__t.started) return { nextInMs: 3600000 }; OGX.__t.started = true;
        const s = Object.assign({}, spec);
        if (s.precise) s.precise = { at: w.now() + 60000, tolMs: 1500 };
        if (s.at) s.at = w.now() + 20000;
        const r = await w.act(s); OGX.__t.results.push({ ok: r.ok, refused: r.refused || null, message: r.message || null });
        const r2 = await w.act(Object.assign({}, spec, { precise: undefined, at: undefined, dedupeKey: 'again' }));
        OGX.__t.results.push({ ok: r2.ok, refused: r2.refused || null, message: r2.message || null });
        OGX.__t.done = true; return { nextInMs: 3600000 };
      } });
    }, { spec });
    await fn(env, page);
  } finally { await env.close(); }
}

T.test('module off: a prepared precise send is disarmed before step 3', async () => {
  await withWorker(SEND({ module: 'botdebris', cls: 'force', prio: 'deadline', precise: true }), async (env, page) => {
    await until(async () => (await env.evalOgx(page, () => OGX.bot.status())).queue.some((q) => q.state === 'pre'), { what: 'pre', timeoutMs: 60000 });
    await env.evalOgx(page, () => OGX.settings.set('botdebris.on', false));
    const r = await until(async () => env.evalOgx(page, () => (OGX.__t.done ? OGX.__t.results : null)), { timeoutMs: 120000, what: 'result' });
    const step3 = env.server.requests.filter((x) => x.page === 'fleetStep3').length;
    assert.equal(step3, 0, 'step 3 must not be posted after botdebris is off');
    assert.equal(r[0].ok, false); assert.equal(r[0].refused, 'stopped'); assert.ok(/выключен/.test(r[0].message), r[0].message);
    assert.equal(r[1].refused, 'stopped', 'a new act() of an off module is refused');
    const q = (await env.evalOgx(page, () => OGX.bot.status())).queue;
    assert.equal(q.length, 0, 'queue empty');
  });
}, { timeout: 240000 });

T.test('module off: a queued (at = +20 s) send is dropped, not sent', async () => {
  await withWorker(SEND({ module: 'botdebris', at: true }), async (env, page) => {
    await until(async () => (await env.evalOgx(page, () => OGX.bot.status())).queue.some((q) => q.type === 'fleet.send'), { what: 'queued', timeoutMs: 60000 });
    await env.evalOgx(page, () => OGX.settings.set('botdebris.on', false));
    const r = await until(async () => env.evalOgx(page, () => (OGX.__t.done ? OGX.__t.results : null)), { timeoutMs: 60000, what: 'result' });
    await sleep(1000);
    const steps = env.server.requests.filter((x) => /^fleetStep/.test(x.page)).length;
    assert.equal(steps, 0, 'no fleet step posted');
    assert.equal(r[0].refused, 'stopped');
  });
}, { timeout: 240000 });
