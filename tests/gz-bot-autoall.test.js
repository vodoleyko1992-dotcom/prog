'use strict';
// «Всё на авто» (0.3.2, John 2026-11-02: «все функции бота на АВТО ВКЛ, максимальная автономность бота»): every bot function is
// on by default, and an install that already ran an older version gets its stored switches turned on ONCE.
//   (a) upgrade (botcore.status from an earlier run, switches stored off): all switched on, dry-run off, galaxy views 300,
//       journaled once (still once in the stored journal after two reloads); a switch the user turns off afterwards stays off
//       after a reload
//   (b) fresh install (no earlier run): stored values untouched, the flag is set
//   (c) packaged defaults (no stored switches): everything on
//   node tests/gz-bot-autoall.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const MODS = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo', 'botmissiles'];
// the modules stay out of the way (their own .enabled switch is not part of «всё на авто»)
const quiet = (extra = {}) => Object.assign(Object.fromEntries(MODS.map((m) => [m + '.enabled', false])), extra);
const AUTO_ON = ['botcore.master', 'botcore.autoLogin', 'botbuild.on', 'botbuild.moons', 'botbuild.defense',
  'botsave.on', 'botsave.spyAttacker', 'botsave.sleepSave', 'botexpo.on', 'botexpo.colonize', 'botexpo.buildColonizers',
  'botdebris.on', 'botdebris.logistics', 'botdebris.repatriate', 'botfarm.on', 'botfarm.scanGalaxy', 'botfarm.buildShips',
  'botfarm.useFleetAjax', 'botfarm.deleteReports', 'botmissiles.on', 'botmissiles.buildMissiles', 'botmissiles.buildSilo'];
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
  AUTO_ON.concat(['botcore.dryRun', 'botcore.galaxyViewsPerHour', 'botcore.sleepOn', 'botsave.weakIgnore', 'botcore.maxFleetSendsPerHour', 'botcore.maxBuildsPerHour']));

T.test('(a) upgrade from 0.3.1: every switch on once (dry-run off, galaxy views 300), journaled; a later «off» stays off; old default limits 30/1000 raised to 500/5000 once', async () => {
  const env = await G.launch({ settings: quiet({ 'botfarm.scanGalaxy': false, 'botcore.galaxyViewsPerHour': 0, 'botcore.maxFleetSendsPerHour': 30, 'botcore.maxBuildsPerHour': 1000 }),
    storage: { '{ns}|botcore.status': { state: 'off', t: Date.now() - 3600000 } } });
  try {
    const page = await env.game('overview');
    await until(async () => (await env.get('botcore.autoAll')) === 1 && (await env.get('botcore.autoLimits')) === 1, { what: 'autoAll + autoLimits flags' });
    const s = await read(env, page);
    for (const k of AUTO_ON) assert.equal(s[k], true, k);
    assert.equal(s['botcore.dryRun'], false, 'dry-run off');
    assert.equal(s['botcore.galaxyViewsPerHour'], 300, 'galaxy views per hour');
    assert.ok(s['botcore.maxFleetSendsPerHour'] >= 300, 'the old 30 fleet sends per hour lifted to 300: ' + s['botcore.maxFleetSendsPerHour']);
    assert.equal(s['botcore.sleepOn'], false, 'sleep mode is not a function: stays off');
    assert.equal(s['botsave.weakIgnore'], false, '«не сейвить при слабой атаке» stays off');
    // the stored old defaults (30 sends / 1000 orders per hour) are the new defaults now (audit K6)
    assert.equal(s['botcore.maxFleetSendsPerHour'], 500, 'stored old default 30 -> 500');
    assert.equal(s['botcore.maxBuildsPerHour'], 5000, 'stored old default 1000 -> 5000');
    const j = await env.evalOgx(page, () => (OGX.diag.recent({ s: 'B' }) || []).filter((e) => e.k === 'botcore:settings').map((e) => e.w));
    assert.equal(j.filter((w) => /Все функции бота включены/.test(w)).length, 1, 'journaled once: ' + JSON.stringify(j));
    assert.equal(j.filter((w) => /Лимиты подняты под «всё на авто».*maxFleetSendsPerHour=500.*maxBuildsPerHour=5000/.test(w)).length, 1, 'limits journaled once: ' + JSON.stringify(j));
    // the user switches the galaxy scan off: it stays off after a reload
    await env.evalOgx(page, () => OGX.settings.set('botfarm.scanGalaxy', false));
    const p2 = await env.game('overview');
    await sleep(1500);
    const s2 = await read(env, p2);
    assert.equal(s2['botfarm.scanGalaxy'], false, 'a later «off» is kept');
    assert.equal(s2['botcore.master'], true);
    // tests-mock-19: the migration runs once per profile, not once per page load — after a second reload the whole stored
    // journal still holds one «Все функции бота включены»
    const p3 = await env.game('overview');
    await sleep(1500);
    const all = await env.evalOgx(p3, async () => {
      const D = OGX.diag; const out = [];
      try { if (D.flush) await D.flush(); } catch (e) { /* ignore */ }
      const b = D.store ? await D.store() : null;
      if (b && b.query) { const r = await b.query({ last: 3000 }); for (const e of (r && r.events) || []) out.push(e); }
      for (const e of (D.recent ? D.recent() : [])) out.push(e);
      const seen = new Set();
      return out.filter((e) => e.k === 'botcore:settings' && /Все функции бота включены/.test(e.w || ''))
        .filter((e) => { const k = e.t + '|' + e.w; if (seen.has(k)) return false; seen.add(k); return true; }).length;
    });
    assert.equal(all, 1, 'one migration line in the stored journal after two reloads');
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
    await until(async () => (await env.get('botcore.autoLimits')) === 1, { what: 'autoLimits flag' });
    assert.equal(s['botcore.maxFleetSendsPerHour'], 500, 'packaged default (nothing stored)');
  } finally { await env.close(); }
}, { timeout: 120000 });

T.test('(c) packaged defaults: every function on, dry-run off, galaxy views 300, fleet sends 500/h, builds 5000/h', async () => {
  const env = await G.launch({ botDefaults: 'auto', settings: quiet() });
  try {
    const page = await env.game('overview');
    const s = await read(env, page);
    for (const k of AUTO_ON) assert.equal(s[k], true, k);
    assert.equal(s['botcore.dryRun'], false, 'dry-run off');
    assert.equal(s['botcore.galaxyViewsPerHour'], 300);
    assert.equal(s['botcore.maxFleetSendsPerHour'], 500);
    assert.equal(s['botcore.maxBuildsPerHour'], 5000);
  } finally { await env.close(); }
}, { timeout: 120000 });

T.test('(d) limits the user typed himself (120 sends, 2000 orders) are never changed by the one-shot migration', async () => {
  const env = await G.launch({ settings: quiet({ 'botcore.maxFleetSendsPerHour': 120, 'botcore.maxBuildsPerHour': 2000 }),
    storage: { '{ns}|botcore.status': { state: 'off', t: Date.now() - 3600000 } } });
  try {
    const page = await env.game('overview');
    await until(async () => (await env.get('botcore.autoLimits')) === 1, { what: 'autoLimits flag' });
    const s = await read(env, page);
    assert.equal(s['botcore.maxFleetSendsPerHour'], 120, 'typed value kept');
    assert.equal(s['botcore.maxBuildsPerHour'], 2000, 'typed value kept');
    const j = await env.evalOgx(page, () => (OGX.diag.recent({ s: 'B' }) || []).filter((e) => e.k === 'botcore:settings' && /Лимиты подняты/.test(e.w)).length);
    assert.equal(j, 0, 'nothing to journal');
  } finally { await env.close(); }
}, { timeout: 120000 });

