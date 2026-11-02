'use strict';
// botbuild v2 (John's build-up tactic) in a browser against the WORLD mode of the GALAXYZ mock, scenario botbuild-tactic.json:
// main 254102 [2:68:5] 45/40/39 with lab 22, colony 254103 [2:68:6] 28/23/22 with storages 10 (26.8M: smaller than the price of
// its next foundation step, nanites 6 = 32M metal -> that store first; John 2026-11-01 «сначала шахты»), fresh colony 254104
// [2:68:7], no 217 research.
//   (a) dry-run (the default) with master + botbuild on: the stage and the next orders (storage on the colony, foundation on the fresh
//       colony, the 217 unlock research, the main planet's own step: planets never idle for each other) are journaled, nothing
//       mutating reaches the server.
//   (b) bot off: the botbuild tab shows «План застройки» from the stored state (the player opened page=imperium) with zero requests.
//   node tests/gz-bot-buildplan.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const MAIN = 254102; const COL_A = 254103; const COL_B = 254104;
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botexpo'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botcore.maxBuildsPerHour': 200 };
const settings = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), FAST, extra);
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}

T.test('(a) dry-run: the tactic journals the stage and the next orders (colony storage, fresh colony foundation, 217 unlock research); no mutating request', async () => {
  const env = await B.launchBot({ world: 'botbuild-tactic', settings: settings({ 'botcore.master': true, 'botbuild.on': true }) });
  try {
    await env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 30000, label: 'leader' });
    const st = await env.waitJournal('botbuild:stage', { timeoutMs: 60000 });
    assert.equal(st.d.stage, 'S1', 'colonies catch up to the main: ' + st.w);
    const dryOf = async (pred, label) => {
      await env.until(async () => (await env.journal({ kind: 'botcore:action-dry' })).some((e) => e.d && e.d.module === 'botbuild' && pred(e.d)), { timeoutMs: 60000, label });
      return (await env.journal({ kind: 'botcore:action-dry' })).find((e) => e.d && e.d.module === 'botbuild' && pred(e.d));
    };
    const a = await dryOf((d) => d.type === 'build.building' && +d.requests[0].cp === COL_A, 'colony A order');
    assert.ok([22, 23, 24].includes(+a.d.requests[0].form.building), 'colony A: a storage first: ' + JSON.stringify(a.d.requests[0].form));
    const b = await dryOf((d) => d.type === 'build.building' && +d.requests[0].cp === COL_B, 'fresh colony order');
    assert.deepEqual(b.d.requests[0].form, { cmd: 'insert', building: 14 }, 'fresh colony: robots (foundation)');
    const r = await dryOf((d) => d.type === 'build.research', 'research order');
    assert.ok([110, 111, 114, 117].includes(+r.d.requests[0].form.tech), '217 unlock research: ' + JSON.stringify(r.d.requests[0].form));
    assert.equal(+r.d.requests[0].cp, MAIN, 'research on the lab planet');
    const ch = await env.journal({ kind: 'botbuild:choose' });
    const reasons = ch.map((e) => e.d && e.d.reason);
    assert.ok(reasons.includes('rule:foundation') && reasons.includes('rule:unlock'), JSON.stringify(reasons));
    // colony A: the store comes from a storage rule (full / below the next mine price) or from «price above the capacity»
    const colStore = ch.filter((e) => e.d && e.d.step && +e.d.step.bodyId === COL_A && [22, 23, 24].includes(+e.d.step.id));
    assert.ok(colStore.some((e) => /^rule:storage(Full|Need|Hours)$/.test(e.d.reason) || (e.d.why || []).some((x) => /цена больше хранилища/.test(x))),
      JSON.stringify(ch.map((e) => [e.d && e.d.reason, e.d && e.d.why])));
    assert.ok((await env.journal({ kind: 'botbuild:build-start' })).some((e) => e.d && e.d.dry === true), 'dry build-start journaled');
    // John 2026-11-01 «планеты не ждут друг друга»: the main planet's free queue starts its own step from its own stock in the same
    // run (a higher mine than the colonies' only when the main pays it now: never a wait / delivery request for it)
    const m = await dryOf((d) => d.type === 'build.building' && +d.requests[0].cp === MAIN, 'main planet order');
    assert.ok(m, 'the main planet is not idle');
    const mainMine = ch.concat(await env.journal({ kind: 'botbuild:choose' })).find((e) => e.d && e.d.step && +e.d.step.bodyId === MAIN && e.d.reason === 'rule:mine');
    if (mainMine) assert.ok((mainMine.d.why || []).some((x) => /не ждём шахту другой планеты/.test(x)), JSON.stringify(mainMine.d.why));
    assert.ok(!(await env.journal({ kind: 'botbuild:wait' })).some((e) => e.d && e.d.cand && +e.d.cand.bodyId === MAIN && e.d.cand.rule === 'mine'), 'no wait for a higher mine on the main');
    await new Promise((res) => setTimeout(res, 2000));
    assert.deepEqual(env.mutating().map((x) => x.method + ' ' + x.url), [], 'no POST in dry-run');
    assert.equal(env.world.log.builds.length, 0, 'the world built nothing');
    await clean(env, 'dry');
  } finally { await env.close(); }
}, { timeout: 180000 });

T.test('(b) bot off: «План застройки» renders in the botbuild tab from the stored state, with zero requests and no bot events', async () => {
  const env = await B.launchBot({ world: 'botbuild-tactic', settings: settings({}) });
  try {
    // the player opens the empire overview (fills the core state: levels of every planet, research)
    const page = await env.game('imperium');
    await new Promise((res) => setTimeout(res, 2500));
    const st = await env.botStatus();
    assert.equal(st.master, false, 'bot off by default'); assert.equal(st.state, 'off');
    const before = env.server.requests.length;
    await env.evalOgx(page, () => { OGX.suite.hub.panel.selectGroup('bot'); OGX.suite.hub.panel.selectTab('bot-botbuild'); });
    await page.waitForSelector('.ogx-b-ltp-title', { timeout: 10000 });
    await page.waitForSelector('.ogx-b-ltp-planet', { timeout: 10000 });
    await new Promise((res) => setTimeout(res, 3000));
    assert.equal((await page.textContent('.ogx-b-ltp-title')).trim(), 'План застройки');
    const planets = await page.$$eval('.ogx-b-ltp-planet', (els) => els.map((e) => +e.dataset.body));
    assert.deepEqual(planets.slice().sort(), [MAIN, COL_A, COL_B].sort(), 'one collapsible block per planet');
    const sum = await page.textContent('.ogx-b-ltp-sum');
    assert.match(sum, /Этап S1/);
    const stages = await page.$$eval('.ogx-b-ltp-stage', (els) => els.map((e) => e.dataset.stage));
    assert.deepEqual(stages.slice(0, 5), ['S1', 'S2', 'S3', 'S4', 'S5']);
    // open the colony: its steps start with a storage (nanites 6 do not fit the store: storageNeed)
    await page.click(`.ogx-b-ltp-planet[data-body="${COL_A}"] > summary`);
    await page.waitForSelector(`.ogx-b-ltp-planet[data-body="${COL_A}"][open] .ogx-b-ltp-steps tr[data-rule]`, { timeout: 5000 });
    const firstRule = await page.$eval(`.ogx-b-ltp-planet[data-body="${COL_A}"] .ogx-b-ltp-steps tr[data-rule]`, (e) => e.dataset.rule);
    assert.match(firstRule, /^storage(Full|Need|Hours)$/);
    const research = await page.textContent('.ogx-b-ltp-rinfo');
    assert.match(research, /Улучшенный транспорт.*не хватает/);
    assert.equal(env.server.requests.length, before, 'zero requests while the plan renders: ' + env.server.requests.slice(before).map((r) => r.url).join(', '));
    assert.deepEqual(env.mutating().map((x) => x.method + ' ' + x.url), []);
    assert.deepEqual((await env.journal({ kind: /^botbuild:/ })).map((e) => e.k), [], 'the bot did nothing');
    await clean(env, 'panel');
  } finally { await env.close(); }
}, { timeout: 120000 });
