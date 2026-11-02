'use strict';
// «Всё на авто» (0.3.2, John 2026-11-02: «все функции бота на АВТО ВКЛ, максимальная автономность бота»): every bot function is
// on by default, and an install that already ran an older version gets its stored switches turned on ONCE.
//   (a) upgrade (botcore.status from an earlier run, switches stored off): all switched on, dry-run off, galaxy views 300,
//       journaled once; a switch the user turns off afterwards stays off after a reload
//   (b) fresh install (no earlier run): stored values untouched, the flag is set
//   (c) packaged defaults (no stored switches): everything on
//   node tests/gz-bot-autoall.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const MODS = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'];
// the modules stay out of the way (their own .enabled switch is not part of «всё на авто»)
const quiet = (extra = {}) => Object.assign(Object.fromEntries(MODS.map((m) => [m + '.enabled', false])), extra);
const AUTO_ON = ['botcore.master', 'botcore.autoLogin', 'botbuild.on', 'botbuild.moons', 'botbuild.defense',
  'botsave.on', 'botsave.spyAttacker', 'botsave.sleepSave', 'botexpo.on', 'botexpo.colonize', 'botexpo.buildColonizers',
  'botdebris.on', 'botdebris.logistics', 'botdebris.repatriate', 'botfarm.on', 'botfarm.scanGalaxy', 'botfarm.buildShips',
  'botfarm.useFleetAjax', 'botfarm.deleteReports'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeoutMs = 20000, stepMs = 200, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for ' + what);
    await sleep(stepMs);
  }
}
const read = (env, page) => env.evalOgx(page, (keys) => Object.fromEntries(keys.map((k) => [k, OGX.settings.get(k)])),
  AUTO_ON.concat(['botcore.dryRun', 'botcore.galaxyViewsPerHour', 'botcore.sleepOn', 'botsave.weakIgnore']));

T.test('(a) upgrade from 0.3.1: every switch on once (dry-run off, galaxy views 300), journaled; a later «off» stays off', async () => {
  const env = await G.launch({ settings: quiet({ 'botfarm.scanGalaxy': false, 'botcore.galaxyViewsPerHour': 0 }),
    storage: { '{ns}|botcore.status': { state: 'off', t: Date.now() - 3600000 } } });
  try {
    const page = await env.game('overview');
    await until(async () => (await env.get('botcore.autoAll')) === 1, { what: 'autoAll flag' });
    const s = await read(env, page);
    for (const k of AUTO_ON) assert.equal(s[k], true, k);
    assert.equal(s['botcore.dryRun'], false, 'dry-run off');
    assert.equal(s['botcore.galaxyViewsPerHour'], 300, 'galaxy views per hour');
    assert.equal(s['botcore.sleepOn'], false, 'sleep mode is not a function: stays off');
    assert.equal(s['botsave.weakIgnore'], false, '«не сейвить при слабой атаке» stays off');
    const j = await env.evalOgx(page, () => (OGX.diag.recent({ s: 'B' }) || []).filter((e) => e.k === 'botcore:settings').map((e) => e.w));
    assert.equal(j.length, 1, 'journaled once: ' + JSON.stringify(j));
    assert.match(j[0], /Все функции бота включены/);
    // the user switches the galaxy scan off: it stays off after a reload
    await env.evalOgx(page, () => OGX.settings.set('botfarm.scanGalaxy', false));
    const p2 = await env.game('overview');
    await sleep(1500);
    const s2 = await read(env, p2);
    assert.equal(s2['botfarm.scanGalaxy'], false, 'a later «off» is kept');
    assert.equal(s2['botcore.master'], true);
  } finally { await env.close(); }
}, { timeout: 120000 });

T.test('(b) fresh install (no earlier run): stored switches untouched, flag set', async () => {
  const env = await G.launch({ settings: quiet() });
  try {
    const page = await env.game('overview');
    await until(async () => (await env.get('botcore.autoAll')) === 1, { what: 'autoAll flag' });
    const s = await read(env, page);
    assert.equal(s['botcore.master'], false, 'test baseline kept');
    assert.equal(s['botcore.dryRun'], true, 'test baseline kept');
    assert.equal(s['botfarm.scanGalaxy'], false, 'test baseline kept');
  } finally { await env.close(); }
}, { timeout: 120000 });

T.test('(c) packaged defaults: every function on, dry-run off, galaxy views 300', async () => {
  const env = await G.launch({ botDefaults: 'auto', settings: quiet() });
  try {
    const page = await env.game('overview');
    const s = await read(env, page);
    for (const k of AUTO_ON) assert.equal(s[k], true, k);
    assert.equal(s['botcore.dryRun'], false, 'dry-run off');
    assert.equal(s['botcore.galaxyViewsPerHour'], 300);
  } finally { await env.close(); }
}, { timeout: 120000 });

