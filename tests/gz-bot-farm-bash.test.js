'use strict';
// botfarm against the server's bash rule in the WORLD mode of the GALAXYZ mock (scenario botfarm-three, lang 'ru'):
// GALAXYZ refuses the 7th attack (missions 1/2/9) on one target within 24 h at fleet step 3 with
// «Превышен лимит количества атак в сутки на данный пункт назначения.» [UPSTREAM CheckBash, fl_bash_protection]; here
// universe.bashCount 1, so the second raid on a target is the refused one:
//   - botcore maps the step-3 text to the refusal «attackLimit» (no action failure, no error streak, the bot keeps running);
//   - botfarm pauses that target 24 h (state attackLimit, journaled once), learns 1 attack per day and plans nothing for it meanwhile;
//   - the other target is raided (its own first raid is accepted);
//   - a day later (world clock) the pause is over and the server's window has slid: the target is raided again.
// (Split from gz-bot-farm.test.js, which is close to the 15 min per-file budget.)
//   node tests/gz-bot-farm-bash.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const GW = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;
const OTHER_BOT = ['botsave', 'botdebris', 'botbuild', 'botexpo'];
const BASE = Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])),
  { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botfarm.minLoot': 100000, 'botfarm.escortLeadSec': 40,
    'spy.probes': 5, 'botfarm.escort': false });
const LIVE = { 'botcore.master': true, 'botcore.dryRun': false, 'botfarm.on': true };
const TARGETS = ['2:68:10:1', '2:68:13:1'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kick(env) {
  await sleep(2600);
  const p = await env.page();
  await env.evalOgx(p, () => { OGX.bus.emit('bot:fleet-returned', { fleetId: 0, mission: 0, bodyKey: null, at: OGX.time.serverNow(), why: 'test kick' }); });
}
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}

T.test('bash rule: the raid after the limit is refused «attackLimit» (ru text), 24 h pause without retries, no error streak, the other target is raided, a day later raided again', async () => {
  const spec = JSON.parse(JSON.stringify(GW.loadScenario('botfarm-three')));
  spec.lang = 'ru';                 // John's UI
  spec.universe.bashCount = 1;      // GALAXYZ: 6 per 24 h; one here, so the second raid on a target hits the rule
  const env = await B.launchBot({ world: spec, settings: BASE });
  try {
    const W = env.world;
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    await env.setSettings(LIVE);
    await env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 25000, label: 'leader' });
    await kick(env);
    // the first raid returns, the farm spies again (lastAttackAt rule) and plans the next raid on that target: refused at step 3
    const ref = await env.waitJournal('botcore:action-refused', { pred: (e) => e.d && e.d.module === 'botfarm' && e.d.refused === 'attackLimit', timeoutMs: 400000, stepMs: 1000 });
    assert.match(String(ref.d.message || ref.w), /лимит количества атак в сутки/, 'the server text reaches the journal');
    const wr = W.log.refusals.filter((r) => r.code === 'bash');
    assert.ok(wr.length >= 1, 'the world refused a raid with the bash rule: ' + JSON.stringify(W.log.refusals.map((r) => r.code)));
    const pos = wr[0].req.target.position;
    const key = `2:68:${pos}:1`;
    const other = TARGETS.find((k) => k !== key);
    assert.ok(TARGETS.includes(key), 'refused target ' + key);
    assert.equal(W.log.sent.filter((x) => x.mission === 1 && x.to === `2:68:${pos}`).length, 1, 'one raid reached ' + key);
    const first = (await env.journal({ kind: 'botfarm:attack-sent' })).find((e) => e.d && e.d.key === key);
    assert.ok(first && first.t < ref.t, 'refused after the first raid on ' + key);
    // the target: state attackLimit, pause 24 h, journaled once; the farm learnt the limit from its own raids of the day (1)
    const cool = await env.waitJournal('botfarm:cooldown', { pred: (e) => e.d && e.d.key === key && e.d.state === 'attackLimit', timeoutMs: 30000, stepMs: 700 });
    assert.ok(Math.abs(cool.d.until - (cool.t + 24 * 3600000)) <= 60000, 'pause 24 h: ' + JSON.stringify(cool.d));
    assert.match(cool.w, /лимит атак в сутки/);
    const st = (await env.journal({ kind: 'botfarm:state' })).find((e) => e.d.key === key && e.d.to === 'attackLimit');
    assert.ok(st, 'state -> attackLimit');
    const cal = await env.evalOgx(await env.page(), (k) => ({ limit: OGX.botFarm._M.cal.attackLimit, T: (({ state, cooldownUntil }) => ({ state, cooldownUntil }))(OGX.botFarm._M.targets[k]) }), key);
    assert.equal(cal.limit, 1, 'learnt: 1 attack per day per target: ' + JSON.stringify(cal));
    assert.equal(cal.T.state, 'attackLimit');
    // a game rule, not a bot error: no action failure, no error streak, the bot keeps running
    const fails = (await env.journal({ kind: /^botcore:(action-fail|pause)$/ })).filter((e) => !e.d || !e.d.module || e.d.module === 'botfarm');
    assert.deepEqual(fails.map((e) => e.k + ' ' + e.w), [], 'no action failure / pause');
    const status = await env.botStatus();
    assert.ok(status && status.master && !status.paused, 'bot running: ' + JSON.stringify({ paused: status && status.paused, state: status && status.state }));
    // the other target is raided too (its first raid is accepted by the server)
    await env.waitJournal('botfarm:attack-sent', { pred: (e) => e.d && e.d.key === other, timeoutMs: 200000, stepMs: 1000 });
    assert.ok(W.log.sent.some((x) => x.mission === 1 && x.to === other.split(':').slice(0, 3).join(':')), 'the world accepted the raid on ' + other);
    // no retry on the paused target (the farm runs a few more cycles meanwhile)
    await sleep(20000);
    const after = (await env.journal({ kind: /^botfarm:(spy-sent|attack-planned|attack-sent)$/ })).filter((e) => e.d && e.d.key === key && e.t > ref.t);
    assert.deepEqual(after.map((e) => e.k + ' ' + e.w), [], 'nothing planned for the paused target');
    assert.equal(W.log.refusals.filter((r) => r.code === 'bash' && r.req.target.position === pos).length, 1, 'no second attempt at the server');
    // a day later (world clock; the core recalibrates its server time from the next page): the pause is over, the target is
    // «new» again and the server's window has slid -> spied and raided again
    W.clock.advance(24 * 3600 + 120);
    // the raid on the defended 2:68:13 may have cost Battle Transporters (hull for the battle): restock the carriers for the next day
    W.body(HOME).ships[217] = Math.max(10, W.body(HOME).ships[217] || 0);
    await env.game('overview', { cp: HOME });
    await kick(env);
    const renew = await env.waitJournal('botfarm:state', { pred: (e) => e.d && e.d.key === key && e.d.from === 'attackLimit' && e.d.to === 'new', timeoutMs: 180000, stepMs: 1000 });
    assert.ok(renew.t > ref.t);
    await env.waitJournal('botfarm:attack-sent', { pred: (e) => e.d && e.d.key === key && e.t > renew.t, timeoutMs: 240000, stepMs: 1000 });
    assert.equal(W.log.sent.filter((x) => x.mission === 1 && x.to === `2:68:${pos}`).length, 2, 'the raid of the next day was accepted');
    await clean(env, 'bash');
  } finally { await env.close(); }
}, { timeout: 840000 });
