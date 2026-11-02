'use strict';
// botfarm + botdebris together against the WORLD mock (scenario botdebris-battle, residual field 1 000 at 2:68:10): the recyclers
// are slower than the attack, so botfarm places the battle at least (recycler flight + 150 s) ahead (slower attack / delayed
// departure) and botdebris pre-sends them to arrive 1-2 s after the battle. keepResidual: ceil recyclers + metal ballast so
// exactly the residual stays (2Moons storage = recyclers' capacity - cargo on board).
//   node tests/gz-bot-farmdebris.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

T.test('farm + debris: recyclers slower than the attack still arrive 1-2 s after the battle; residual kept with ballast; journal reasons', async () => {
  const s = JSON.parse(JSON.stringify(W.loadScenario('botdebris-battle')));
  s.gamespeed = 200;
  const home = s.bodies.find((b) => b.id === 254102);
  Object.assign(home.ships, { 204: 400, 206: 60, 210: 20 });
  // one 219 (20 M) for a ~50 k field needs ~20 M metal ballast: 254103 (nearer, 10 x 219) holds only 5 M and the moon 254110 none
  // (its stock is unknown to the bot, the server would min() the load to 0), so the 219 fly from 254102 (50 M metal) here
  delete s.bodies.find((b) => b.id === 254103).ships[219];
  delete s.bodies.find((b) => b.id === 254110).ships[219];
  const tgt = s.others.find((o) => o.name === 'Txemin').planets[0];
  tgt.ships = { 204: 30, 202: 10 }; tgt.res = { metal: 4000000, crystal: 2000000, deuterium: 500000 };
  const settings = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botsave.enabled': false, 'botbuild.enabled': false,
    'botexpo.enabled': false, 'botdebris.ownDf': false, 'botfarm.minLoot': 100000, 'botfarm.escort': false, 'botfarm.origins': [254102],
    'botdebris.minBattleDf': 0 };   // this battle leaves ~50 k: below the default pre-send minimum (1 M), the timing is under test here
  const env = await B.launchBot({ world: s, settings });
  try {
    const Wd = env.world;
    assert.ok((Wd.debris.get('2:68:10') || {}).metal > 0, 'residual field before the attack');
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    await env.setSettings({ 'botcore.master': true, 'botcore.dryRun': false, 'botfarm.on': true, 'botdebris.on': true });
    await env.until(async () => { const st = await env.botStatus(); return st && st.leader; }, { timeoutMs: 30000, label: 'leader' });
    await sleep(2600);
    await env.evalOgx(await env.page(), () => OGX.bus.emit('bot:fleet-returned', { fleetId: 0, mission: 0, bodyKey: null, at: OGX.time.serverNow() }));
    await env.until(() => Wd.log.sent.some((x) => x.mission === 8 && x.to === '2:68:10'), { timeoutMs: 420000, stepMs: 2000, label: 'recyclers sent' });
    const att = Wd.log.sent.find((x) => x.mission === 1 && x.to === '2:68:10');
    const rec = Wd.log.sent.find((x) => x.mission === 8 && x.to === '2:68:10');
    assert.ok(att, 'attack sent');
    const after = rec.arrival - att.arrival;
    assert.ok(after >= 1 && after <= 2, `recyclers arrive ${after} s after the battle`);
    // the farm journals why the attack is slower / later
    const dec = (await env.journal({ kind: 'botfarm:decision' })).find((e) => /^Атака \[2:68:10\]/.test(e.w));
    assert.ok(dec && /переработчикам с .* нужно \d+ с \+ 150 с подготовки/.test(dec.d.why), 'farm decision names the recycler timing: ' + (dec && dec.d.why));
    const planned = (await env.journal({ kind: 'botfarm:attack-planned' })).find((e) => e.d.key === '2:68:10:1');
    assert.ok(planned.d.recyclers && planned.d.recyclers.needSec > 0, JSON.stringify(planned.d.recyclers));
    assert.ok(att.arrival - att.t >= planned.d.recyclers.needSec - 5 || planned.d.delayMs > 0, 'battle far enough ahead');
    // debris: pre-send, ceil recyclers + ballast
    const rp = (await env.journal({ kind: 'botdebris:recyclers-planned' })).find((e) => e.d.mode === 'pre');
    assert.ok(rp, 'pre-send planned');
    const field = rp.d.field.metal + rp.d.field.crystal;
    assert.equal(rp.d.n, Math.ceil((field - 1000) / 20000000), 'ceil((field - residual) / cap of 219 = 20 M)');
    assert.equal(rp.d.ballast, rp.d.n * 20000000 - (field - 1000), 'ballast fills the surplus capacity');
    assert.deepEqual(rec.ships, { 219: rp.d.n }, 'Battle Recyclers 219 only (the 300 x 209 at home stay)');
    assert.ok(Object.keys(att.ships).every((id) => ![202, 203].includes(+id)) && att.ships[217] > 0, 'loot in Battle Transporters 217 only: ' + JSON.stringify(att.ships));
    assert.equal(rec.cargo.metal, rp.d.ballast, 'ballast on board');
    // after the harvest the field keeps the predicted residual (the battle debris equals the p50 prediction only roughly)
    await env.until(() => Wd.log.events.some((e) => e.kind === 'recycle' && e.fleetId === rec.fleetId), { timeoutMs: 120000, stepMs: 1000, label: 'recycle' });
    const ev = Wd.log.events.find((e) => e.kind === 'recycle' && e.fleetId === rec.fleetId);
    const battle = Wd.log.events.find((e) => e.kind === 'battle' && e.coords === '2:68:10');
    const real = battle && battle.debris ? battle.debris.metal + battle.debris.crystal : null;
    const left = ev.left.metal + ev.left.crystal;
    assert.ok(left > 0, 'the field is not emptied: ' + JSON.stringify(ev.left) + ' (battle debris ' + real + ', predicted ' + field + ')');
    assert.deepEqual(env.ogxErrors().map((e) => e.text), [], 'no [OGX errors');
  } finally { await env.close(); }
}, { timeout: 600000 });
