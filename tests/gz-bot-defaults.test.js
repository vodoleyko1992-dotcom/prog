'use strict';
// John's install as packaged: the 0.3.2 defaults (botDefaults: 'auto' = no test baseline, every switch as shipped, NO limit
// overrides) against the WORLD mode of the GALAXYZ mock, scenario fixtures/galaxyz/bot-scenarios/aeternum-day.json — a world like
// Aeternum: three planets + a moon, ~1e12 stock on the main, 33000 probes, seven inactive targets in range (45–90M each), an own
// debris field, Jon Snow attacking the rich colony at noon. The only override is pacing (botcore.userIdleSec 0: a Playwright page
// has no user whose 20 s of idleness the bot could wait for).
// The morning is compressed by the world itself (gamespeed 40: raids ≈ 62 s one way, probes 5 s; expedition hold 1 h / haltSpeed
// 100 = 36 s; buildings 60 s, units 1 s). The browser clock is real, so the whole morning falls into ONE rolling hour of the
// botcore limits (they count by OGX.time.serverNow) — exactly John's first hour after the install.
//   (a) every module acts: botbuild orders, botfarm spies (1100 probes = the account's spycount = spy.probes) and raids, botexpo
//       expeditions (5000 probes each) and DM searches, botdebris recyclers and a transport (repatriation / logistics), botsave
//       saves the attacked colony; every world fleet comes from a journaled bot action; the world's probe accounting closes;
//       page=settings shows spycount 1100 and the suite records no mismatch
//   (c) botfarm spies and raids a known target within the morning. EXPECTED RED on the packaged 0.3.2: the first pass scans 40
//       galaxy systems before planning any target (see the test).
//   (b) no «limit» refusal in that morning. On the packaged 0.3.2 it passes only because the farm never sends in the morning
//       ((c), 16 sends by the other modules); with the farm working it goes RED: botcore.maxFleetSendsPerHour defaults to 30 and
//       John's morning needs more than that within one hour (the farm alone: spy + raid + escort per target, plus expeditions,
//       DM searches, recyclers, transports). The botcore scope raises the default to 500 (and maxBuildsPerHour to 5000); this
//       test states the behaviour John needs and turns green with that change.
//   node tests/gz-bot-defaults.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const B = require('./gz-bot-lib');
const GW = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;      // [2:68:5] everything starts here (+ its moon 254110 for the DM searches and the saves)
const COL_RICH = 254103;  // [2:68:7] 750M in stock, 20 x 217 (repatriation), 100 LF (saved at noon)
const JON = 3843;
const MODS = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'];
const SPYCOUNT = 1100;    // the account's probes per spy click (page=settings) = the suite default spy.probes
const EXPO_PROBES = 5000; // botexpo.expoProbes default (mode 'dm')
const PACING = { 'botcore.userIdleSec': 0 };
const MORNING_MS = 280000;   // the morning runs this long whatever happens (the limits count per real hour: this is one window)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const live = (e) => e.d && !e.d.dry;

/** Results of (a) that (b) judges (one launch for both: the morning takes ~5 min). */
let DAY = null;

async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}

T.test('(a) packaged defaults, a morning with everything on: every module acts, spies send the account\'s 1100 probes, expeditions 5000', async () => {
  const spec = JSON.parse(JSON.stringify(GW.loadScenario('aeternum-day')));
  const env = await B.launchBot({ world: spec, botDefaults: 'auto', settings: PACING });
  const W = env.world;
  const start = Date.now();
  const since = () => `+${Math.round((Date.now() - start) / 1000)} s`;
  // the whole journal of the morning (the diag store keeps the last events only): collected while it runs
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
  const limits = () => J.filter((e) => e.k === 'botcore:limit' || (e.k === 'botcore:action-refused' && e.d && e.d.refused === 'limit'));
  // noon: Jon Snow attacks the rich colony once the repatriation transport has left it (60 s at the earliest, 100 s at the latest)
  let hostile = null;
  const director = () => {
    const el = Date.now() - start;
    if (!hostile && ((find('botdebris:transport-sent') && el > 60000) || el > 100000)) {
      hostile = W.addHostile({ toBodyId: COL_RICH, mission: 1, ships: { 204: 1500, 205: 300 }, ownerId: JON, flightSec: 150 });
      console.log(`    [${since()}] noon: Jon Snow attacks 2:68:7, impact in 150 s`);
    }
  };
  // what John sees in the first hour: one action of every function
  const WANT = {
    'botbuild: a build order': () => find('botcore:action-done', (e) => e.d && e.d.module === 'botbuild' && /^build\./.test(e.d.type) && e.d.ok && !e.d.dry),
    'botfarm: espionage': () => find('botfarm:spy-sent', live),
    'botfarm: raid': () => find('botfarm:attack-sent', live),
    'botexpo: expedition': () => find('botexpo:expo-sent', live),
    'botexpo: DM search': () => find('botexpo:dm-sent', live),
    'botdebris: recyclers (own field or a battle)': () => find('botdebris:recyclers-sent', live) || find('botdebris:harvest-own', (e) => e.d && e.d.kind === 'own-sent' && !e.d.dry),
    'botdebris: transport (repatriation or logistics)': () => find('botdebris:transport-sent', live),
    'botsave: save': () => find('botsave:save-sent', live),
  };
  // botfarm is judged by (c): its first pass spends the 40 galaxy views (botfarm.scanPerCycle) of a ±30-system area before it spies
  // a single target the cache already knows, so on a fresh install no spy leaves within the morning
  const FARM = ['botfarm: espionage', 'botfarm: raid'];
  const missing = () => Object.keys(WANT).filter((k) => !FARM.includes(k) && !WANT[k]());
  try {
    // the user looks at the home system once (the galaxy cache knows the inactives there), then leaves the bot alone
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    const page = await env.page();
    const KEYS = ['botcore.master', 'botcore.dryRun', 'botcore.maxFleetSendsPerHour', 'botcore.maxBuildsPerHour', 'botcore.maxActionsPerHour', 'botcore.galaxyViewsPerHour',
      'spy.probes', 'botexpo.expoProbes', 'botexpo.keepProbes', 'botexpo.mode', 'botfarm.useFleetAjax', 'botfarm.minLoot'].concat(MODS.map((m) => m + '.on'));
    const cfg = await env.evalOgx(page, (keys) => Object.fromEntries(keys.map((k) => [k, OGX.settings.get(k)])), KEYS);
    assert.equal(cfg['botcore.master'], true, 'packaged: master on'); assert.equal(cfg['botcore.dryRun'], false, 'packaged: dry-run off');
    for (const m of MODS) assert.equal(cfg[m + '.on'], true, 'packaged: ' + m + '.on');
    assert.equal(cfg['spy.probes'], SPYCOUNT); assert.equal(cfg['botexpo.expoProbes'], EXPO_PROBES); assert.equal(cfg['botexpo.mode'], 'dm'); assert.equal(cfg['botfarm.useFleetAjax'], true);
    console.log(`    packaged limits: fleet sends/h ${cfg['botcore.maxFleetSendsPerHour']}, builds/h ${cfg['botcore.maxBuildsPerHour']}, actions/h ${cfg['botcore.maxActionsPerHour']}, galaxy views/h ${cfg['botcore.galaxyViewsPerHour']}`);
    await env.until(async () => { const s = await env.botStatus(); return s && s.leader && s.state !== 'off'; }, { timeoutMs: 30000, label: 'leader' });
    // the workers start 5..50 s after the start: wake them now (as a returning fleet would)
    await env.evalOgx(page, () => { OGX.bus.emit('bot:fleet-returned', { fleetId: 0, mission: 0, bodyKey: null, at: OGX.time.serverNow(), why: 'test: morning' }); });

    // ---------------------------------------------------------------- the morning (a fixed stretch of real time)
    const done = new Set();
    const end = Date.now() + MORNING_MS;
    let limSeen = 0;
    for (;;) {
      await pull();
      director();
      for (const k of Object.keys(WANT)) { const hit = !done.has(k) && WANT[k](); if (hit) { done.add(k); console.log(`    [${since()}] ${k}: ${hit.w || JSON.stringify(hit.d || {}).slice(0, 120)}`); } }
      const lim0 = limits();
      if (lim0.length && !limSeen) { limSeen = 1; console.log(`    [${since()}] LIMIT: ${lim0[0].w || JSON.stringify(lim0[0].d)} (after ${W.log.sent.length} fleet sends)`); }
      if (Date.now() > end) break;
      await sleep(1500);
    }
    await pull();
    const lim = limits();
    const tail = J.filter((e) => /^bot/.test(e.k)).slice(-30).map((e) => `${e.k} ${e.w || ''}`).join('\n  ');
    assert.deepEqual(missing(), [], `every module acted in the morning (${W.log.sent.length} fleets sent by the world, limit refusals ${lim.length}${lim.length ? ' — first: ' + lim[0].w : ''}); last events:\n  ${tail}`);

    // ---------------------------------------------------------------- probes: the account's spycount, the expedition size
    const spies = J.filter((e) => e.k === 'botfarm:spy-sent' && live(e));
    for (const s of spies) assert.equal(s.d.probes, SPYCOUNT, `[${s.d.key}] ${s.d.probes} probes per spy (account spycount ${SPYCOUNT} = spy.probes)`);
    const wSpy = W.log.sent.filter((x) => x.mission === 6);
    for (const x of wSpy.filter((s) => s.originId === HOME)) assert.equal(x.ships[210], SPYCOUNT, `world: spy fleet ${x.fleetId} to ${x.to} via ${x.via}: ${JSON.stringify(x.ships)}`);
    const wExpo = W.log.sent.filter((x) => x.mission === 15);
    assert.ok(wExpo.length >= 1, 'expeditions in the world');
    for (const x of wExpo) assert.deepEqual(x.ships, { 210: EXPO_PROBES }, `expedition ${x.fleetId}: ${JSON.stringify(x.ships)} (mode dm: ${EXPO_PROBES} probes)`);
    const wDm = W.log.sent.filter((x) => x.mission === 11);
    assert.ok(wDm.length >= 1 && wDm.every((x) => x.type === 3 && x.to === '2:68:5' && Object.keys(x.ships).join() === '220'), 'DM searches: collectors only, to the own moon: ' + JSON.stringify(wDm.map((x) => [x.to, x.type, x.ships])));
    // the world's probe accounting closes: home + flying + lost (black hole, counter-espionage) = initial + built
    const sent210 = new Map(W.log.sent.map((x) => [x.fleetId, x.ships[210] || 0]));
    const mine = W.fleets.filter((f) => f.owner === 'me');
    const flying = mine.filter((f) => f.state !== 'done').reduce((s, f) => s + (f.ships[210] || 0), 0);
    const lost = mine.filter((f) => f.state === 'done' && !/^(returned|deployed)$/.test(f.endReason || '')).reduce((s, f) => s + (sent210.get(f.id) || 0), 0);
    const built = W.log.events.filter((e) => e.kind === 'units-done' && e.id === 210).reduce((s, e) => s + e.count, 0)
      + W.bodies.reduce((s, b) => s + b.shipyardQueue.filter((q) => q.id === 210).reduce((s2, q) => s2 + q.done, 0), 0);
    const home = W.bodies.reduce((s, b) => s + (b.ships[210] || 0), 0);
    const initial = spec.bodies.reduce((s, b) => s + ((b.ships || {})[210] || 0), 0);
    assert.equal(home + flying + lost, initial + built, `probe accounting: home ${home} + flying ${flying} + lost ${lost} = initial ${initial} + built ${built}`);

    // ---------------------------------------------------------------- every world fleet comes from a journaled bot action
    // (a one-click spy, fleet.ajax, answers without a fleet id: the farm journals it in spy-sent once the fleetTable showed it)
    const byFleet = new Map();
    for (const e of J) if ((e.k === 'botcore:action-done' || e.k === 'botcore:action-verify-fail') && e.d && /^fleet\.(send|ajax)$/.test(e.d.type) && e.d.data && e.d.data.fleetId != null) byFleet.set(+e.d.data.fleetId, e.d.module);
    for (const e of J) if (/^botfarm:(spy-sent|escort-spy)$/.test(e.k) && e.d && e.d.fleetId != null && !byFleet.has(+e.d.fleetId)) byFleet.set(+e.d.fleetId, 'botfarm');
    const sends = W.log.sent.map((x) => Object.assign({}, x, { module: byFleet.get(+x.fleetId) || (x.via === 'fleetAjax' && x.mission === 6 ? 'botfarm?' : 'unknown') }));
    assert.deepEqual(sends.filter((x) => x.module === 'unknown').map((x) => x.fleetId + ' ' + x.mission + ' ' + x.to), [], 'every world fleet was sent by a journaled bot action');
    const ajaxDone = J.filter((e) => e.k === 'botcore:action-done' && e.d && e.d.type === 'fleet.ajax' && e.d.ok && !e.d.dry).length;
    assert.equal(sends.filter((x) => x.via === 'fleetAjax').length, ajaxDone, 'one-click spies of the world = journaled fleet.ajax actions');
    for (const m of ['botsave', 'botdebris', 'botexpo']) assert.ok(sends.some((x) => x.module === m), m + ' sent fleets');
    assert.deepEqual(W.log.refusals.filter((r) => r.kind === 'fleet' && /slot/i.test(r.why || '')), [], 'no slot refusal at step 3');
    // the bot obeys its own limit: at most maxFleetSendsPerHour sends by the limited modules in this hour (botsave's defense sends bypass it)
    const limited = sends.filter((x) => x.module !== 'botsave');
    assert.ok(limited.length <= cfg['botcore.maxFleetSendsPerHour'], `the bot never exceeds its own maxFleetSendsPerHour: ${limited.length} <= ${cfg['botcore.maxFleetSendsPerHour']}`);

    // ---------------------------------------------------------------- the account setting: page=settings, the suite's record
    await env.game('settings');
    const p2 = await env.page();
    let sp = null;
    await env.until(async () => { sp = await env.evalOgx(p2, async () => ({ page: (OGX.parse.gz.settingsPage(document) || {}).spycount, stored: await OGX.api.gzSpyCount() })); return sp.stored; }, { timeoutMs: 15000, label: 'spycount read' });
    assert.equal(sp.page, SPYCOUNT, 'page=settings shows the account spycount');
    assert.equal(sp.stored && sp.stored.value, SPYCOUNT, 'the suite learnt the account spycount: ' + JSON.stringify(sp.stored));
    await pull();
    assert.deepEqual(J.filter((e) => e.k === 'spy:spycount:mismatch').map((e) => e.w || JSON.stringify(e.d)), [], 'account spycount = spy.probes: no mismatch warning');

    const refused = J.filter((e) => e.k === 'botcore:action-refused' && e.d && e.d.refused === 'limit');
    const scans = J.filter((e) => e.k === 'botfarm:decision' && /^Просмотр галактики/.test(e.w || '')).length;
    DAY = { spies: spies.length, raids: J.filter((e) => e.k === 'botfarm:attack-sent' && live(e)).length, scans, sent: W.log.sent.length, refused, limits: lim.concat(limits().filter((e) => !lim.includes(e))), cfg, at: Date.now() - start };
    console.log(`    morning done in ${since()}: ${DAY.sent} fleets sent, ${refused.length} actions refused by a limit, ${W.log.builds.length} orders`);
    await clean(env, '(a)');
  } finally {
    try {
      await pull();
      fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, 'out', 'defaults-day.json'), JSON.stringify({ journal: J.filter((e) => /^(bot|spy)/.test(e.k)), world: W.log }, null, 1));
    } catch (e) { /* diagnostics only */ }
    await env.close();
  }
}, { timeout: 540000 });

T.test('(b) no «limit» refusal in John\'s morning: the packaged maxFleetSendsPerHour must not stop the bot (botcore must ship 500: 30 is exceeded once the farm spies and raids, see (c))', async () => {
  assert.ok(DAY, '(a) ran first (one launch for both tests)');
  const sendsRefused = DAY.refused.filter((e) => /^fleet\.(send|ajax)$/.test(e.d.type || ''));
  const needed = DAY.sent + sendsRefused.length;
  // The behaviour John needs: the first hour of a 3-planet account with inactives in range takes `needed` fleet sends. With the
  // packaged default (botcore.maxFleetSendsPerHour 30) the limit closes after 30 of them and every module but botsave (defense
  // priority) stands still for the rest of the hour. BOTCORE (not this harness): SETTINGS.maxFleetSendsPerHour.default 30 -> 500
  // and maxBuildsPerHour.default 1000 -> 5000 (autoAllOnce must lift a stored 30 as well). This assertion is RED with 30 as soon as
  // the farm spies + raids in the morning ((c) fixed): each target costs a spy, a raid and often an escort spy.
  console.log(`    the morning needed ${needed} fleet sends within one hour: ${DAY.sent} done, ${sendsRefused.length} refused (packaged maxFleetSendsPerHour ${DAY.cfg['botcore.maxFleetSendsPerHour']})`);
  assert.deepEqual(DAY.limits.slice(0, 5).map((e) => e.k + ' ' + (e.w || '')), [],
    `no limit refusal in the morning: it needed ${needed} fleet sends within one hour (${DAY.sent} done, ${sendsRefused.length} refused; packaged maxFleetSendsPerHour ${DAY.cfg['botcore.maxFleetSendsPerHour']} — botcore must ship 500, maxBuildsPerHour 5000)`);
});

T.test('(c) botfarm spies a target the galaxy cache already knows within John\'s morning (RED until botfarm plans cached targets before its galaxy scan)', async () => {
  assert.ok(DAY, '(a) ran first (one launch for both tests)');
  // The behaviour John needs: seven inactives sit in the cache around his home after one look at 2:68; the farm should spy (1100
  // probes) and raid them in its first pass. 0.3.2 botfarm.cycle runs scanSystems first: up to scanPerCycle (40) uncached systems,
  // each a queued read.galaxy behind every other module's actions (~3-8 s each), and plans targets only after that. BOTFARM (not
  // this harness): plan / spy the cached targets first and scan in the background (or a few systems per pass).
  console.log(`    morning: ${DAY.scans} galaxy views by the farm, ${DAY.spies} spies, ${DAY.raids} raids`);
  assert.ok(DAY.spies >= 3, `several known targets spied in the morning: ${DAY.spies} spies after ${DAY.scans} galaxy views`);
  assert.ok(DAY.raids >= 1, `a raid in the morning: ${DAY.raids}`);
});
