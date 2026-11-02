'use strict';
// Regression tests for core review fixes on the real GALAXYZ pages (tests/gz-server.js mock):
//  - fleet speed: before any fleetStep1 visit, estimates use the Aeternum game speed 7 (not 1), gameSpeedKnown false
//  - time: a fresh install whose first page has no fleet countdown guesses the zone from the local clock (no future T)
//  - diag: a /game.php on a foreign site (no generator meta) writes nothing to its sessionStorage and nothing to the journal
//   node tests/gz-core-fixes.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

const H = 3600000;

T.test('fleet speed: estimate uses game speed 7 before fleetStep1 was seen, the stored value after', async () => {
  const env = await G.launch();
  const est = (page) => env.evalOgx(page, async () => {
    const s = await OGX.state.server();
    const e = await OGX.fleet.estimate({ from: '2:68:5', to: '2:68:9', ships: { 208: 1 }, mission: 7 });
    return { fleetSpeed: s.fleetSpeed, war: s.fleetSpeedWar, known: s.fleetSpeedKnown, factor: OGX.calc.missionSpeedFactor(7, s),
      e: [e.duration, e.speedFactor, e.fuelBudget, e.gameSpeedKnown] };
  });
  await env.game('research');   // drive levels -> the colony ship's real speed (6000)
  const a = await est(await env.game('overview'));
  // real fleetStep3.html: 2:68:5 -> 2:68:9 with one colony ship arrives after 653 s, 118 deuterium
  assert.deepEqual(a, { fleetSpeed: 7, war: 7, known: false, factor: 7, e: [653, 7, 118, false] });
  await env.openSaved('fleetStep1');
  const b = await est(await env.game('overview'));
  assert.deepEqual(b, { fleetSpeed: 7, war: 7, known: true, factor: 7, e: [653, 7, 118, true] });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('ship speeds without page=research: drive levels from the fleetTable «Bonus» table (same 653 s as the real send)', async () => {
  const env = await G.launch();
  await env.game('fleetTable');   // «Bonus»: combustion 120 %, impulse 140 %, hyperspace 120 % -> levels 12 / 7 / 4
  const page = await env.game('overview');
  const r = await env.evalOgx(page, async () => {
    const rs = await OGX.state.research();
    const st = await OGX.state.shipStats();
    const e = await OGX.fleet.estimate({ from: '2:68:5', to: '2:68:9', ships: { 208: 1 }, mission: 7 });
    const bot = OGX.bot && OGX.bot.flightTime ? OGX.bot.flightTime({ from: '2:68:5', to: '2:68:9', ships: { 208: 1 }, speed: 10 }) : null;
    return { research115: (rs.levels || {})[115] === undefined ? null : rs.levels[115], speed208: Math.round(st[208].speed), speed210: Math.round(st[210].speed), duration: e.duration, fuel: e.fuelBudget, bot: bot ? Math.round(bot.duration) : null };
  });
  assert.equal(r.research115, null, 'research page never seen');
  assert.equal(r.speed208, 6000, 'colony ship 2500 x (1 + 0.2 x impulse 7) as the fleetTable tooltip');
  assert.equal(r.speed210, 220000000, 'spy probe 100M x (1 + 0.1 x combustion 12)');
  assert.equal(r.duration, 653, 'real fleetStep3: 653 s');
  assert.equal(r.fuel, 118);
  if (r.bot !== null) assert.equal(r.bot, 653, 'OGX.bot.flightTime agrees');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('time: first page without a fleet countdown guesses the zone, stores nothing future-dated, countdown calibrates', async () => {
  const env = await G.launch();
  // the real overview without its countdowns, its serverTime set to the server wall clock now (UTC+2)
  const wall = new Date(Date.now() + 2 * H);
  const st = `serverTime \t= new Date(${wall.getUTCFullYear()}, ${wall.getUTCMonth()}, ${wall.getUTCDate()}, ${wall.getUTCHours()}, ${wall.getUTCMinutes()}, ${wall.getUTCSeconds()});`;
  env.server.route('GET', 'overview', (req, res, ctx) => ctx.sendPage('overview', (html) => html
    .replace(/\sdata-fleet-(?:end-)?time="\d+"/g, '')
    .replace(/serverTime\s*=\s*new Date\([^)]*\);/, st)));
  const page = await env.game('overview');
  const r = await env.evalOgx(page, async () => {
    await OGX.time.ready;
    await OGX.storage.flush();
    const raw = await OGX.storage.get('server', null, { scope: 'server' });
    const cur = OGX.state.snapshot().current.planetId;
    const b = Object.values(await OGX.state.bodies()).find((x) => x.planetId === cur) || {};
    const pl = await OGX.state.player();
    return { tz: OGX.time.tzOffsetMs, calibrated: OGX.time.calibrated, renderLag: OGX.time.renderMs - Date.now(),
      storedTz: raw ? raw.tzOffsetMs : undefined, resT: b.res && b.res.t, playerT: pl && pl.t, now: Date.now() };
  });
  assert.equal(r.tz, 2 * H, 'zone guessed from the local clock');
  assert.equal(r.calibrated, false, 'a guess is not a calibration');
  assert.equal(r.storedTz, undefined, 'a guess is not stored');
  assert.ok(Math.abs(r.renderLag) < 60000, 'renderMs about now: ' + r.renderLag);
  for (const [k, t] of [['res.t', r.resT], ['player.t', r.playerT]]) {
    if (t != null) assert.ok(t <= r.now + 60000, `${k} not in the future: ${new Date(t).toISOString()}`);
  }
  // a page with a countdown calibrates and stores the true zone (real officier.html: UTC+2)
  const off = await env.openSaved('officier');
  const c = await env.evalOgx(off, async () => {
    await OGX.storage.flush();
    return { tz: OGX.time.tzOffsetMs, calibrated: OGX.time.calibrated, stored: (await OGX.storage.get('server', null, { scope: 'server' })).tzOffsetMs };
  });
  assert.deepEqual(c, { tz: 2 * H, calibrated: true, stored: 2 * H });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('time: guess follows wall - local clock in 15-min steps; a stored zone wins; implausible guesses fall back to 0', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  const r = await env.evalOgx(page, async () => {
    const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const out = {};
    const save = { tz: OGX.time.tzOffsetMs, cal: OGX.time.calibrated };
    const now = Date.now();
    const run = async (wallMs) => {
      OGX.time.calibrated = false;
      OGX.time.init({ serverTimeString: fmt(wallMs), parsedAtMs: now });
      const sync = OGX.time.tzOffsetMs;
      await OGX.time.ready;
      return [sync, OGX.time.tzOffsetMs, OGX.time.calibrated];
    };
    out.minus3 = await run(now - 3 * 3600000 + 4000);
    out.plus545 = await run(now + 5.75 * 3600000 - 3000);
    out.far = await run(now + 3 * 86400000);
    Object.assign(OGX.time, { tzOffsetMs: save.tz, calibrated: save.cal });
    out.stored = (await OGX.storage.get('server', null, { scope: 'server' })).tzOffsetMs;
    return out;
  });
  // the stored zone (calibrated by this real overview's countdown) replaces the guess once storage answers
  assert.deepEqual(r, { stored: 2 * H, minus3: [-3 * H, 2 * H, true], plus545: [5.75 * H, 2 * H, true], far: [0, 2 * H, true] });
});

T.test('diag: a /game.php without generator meta on another site leaves no trace; a refused GALAXYZ page is journaled once', async () => {
  const env = await G.launch({ gameJs: false });
  const other = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Other game</title></head><body><h1>other</h1></body></html>';
  env.server.route('GET', '/othergame/game.php', (req, res, ctx) => ctx.send(200, other));
  // a GALAXYZ page the gate refuses (no serverTime in <head>, e.g. a login/error page)
  env.server.route('GET', 'overview', (req, res, ctx) => ctx.sendPage('overview', (html) => html.replace(/serverTime\s*=\s*new Date\([^)]*\);/, '')));
  const sess = (page) => page.evaluate(() => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) o[sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i)); return o; });
  const gated = async () => {
    const w = env.worker('suite');
    if (!w) return null;
    return w.evaluate(async () => { const s = await self.OGXDiagLib.openStore({ name: 'ogx-diag' }); const r = await s.query({}); return r.events.filter((e) => e.k === 'gated').map((e) => e.d.reason); });
  };
  const p1 = await env.open('/othergame/game.php?page=overview', { waitReady: false });
  await p1.waitForTimeout(1200);
  assert.deepEqual(await sess(p1), {});
  if (env.mode === 'extension') assert.deepEqual(await gated(), []);
  for (let i = 0; i < 2; i++) {
    const p = await env.game('overview', { waitReady: false });
    await p.waitForTimeout(1200);
    assert.deepEqual(await sess(p), {}, 'the game page sessionStorage is not touched either');
  }
  if (env.mode === 'extension') assert.deepEqual(await gated(), ['galaxyz: no serverTime in <head> (login or error page)'], 'one journal line for two visits');
});

T.test('player merge: an officier page older than the stored header fields still stores the officers (per-field times)', async () => {
  const env = await G.launch();
  const off = async (name) => {
    const p = await env.openSaved(name);
    return env.evalOgx(p, async () => { const p = await OGX.state.player(); return { t: p.t, offT: p.officersT || null, n: p.officers ? Object.keys(p.officers).length : null, dm: p.darkMatter ?? null }; });
  };
  const a = await off('messages-spy');   // saved 10:16
  assert.equal(a.n, null, 'no officers before page=officier');
  const b = await off('officier');       // saved 10:05: older than the header fields
  assert.equal(b.n, 15, 'officers stored from the older officier page');
  assert.equal(b.t, a.t, 'header fields keep their newer time');
  assert.ok(b.offT < b.t, 'officers carry their own time');
  const c = await off('overview');
  assert.equal(c.n, 15, 'a later page without officers keeps them');
  const d = await off('officier');
  assert.equal(d.n, 15, 'same officier page again: unchanged');
  assert.deepEqual(env.ogxErrors(), []);
});

// review fixes (low): fmt.short has «трлн»/«квадрлн» (economy x22000 values) with grouped integers; the OgameX-only galaxy
// repair setting is not offered on GALAXYZ (no effect there).
T.test('fmt.short: трлн / квадрлн units, grouped past the last unit; settings form hides OgameX-only galaxyRepair on GALAXYZ', async () => {
  const env = await G.launch();
  const p = await env.game('overview');
  const r = await env.evalOgx(p, () => ({
    short: [9999, 12345, 1.8e9, 2530320929876, 3621000000000, 999.9e9, 3.6e15, 3621e15, -2530320929876].map((n) => OGX.fmt.short(n).replace(/[  ]/g, ' ')),
    keys: [...OGX.dom.settingsForm(['core']).querySelectorAll('[name], [data-key]')].map((e) => e.getAttribute('name') || e.dataset.key).join(' '),
    text: OGX.dom.settingsForm(['core']).textContent,
    stored: OGX.settings.get('core.galaxyRepair'),
  }));
  assert.deepEqual(r.short, ['9 999', '12,3 тыс.', '1,8 млрд', '2,53 трлн', '3,62 трлн', '999 млрд', '3,6 квадрлн', '3 621 квадрлн', '-2,53 трлн']);
  assert.ok(!/зависание галактики/.test(r.text), 'galaxyRepair not offered on GALAXYZ');
  assert.ok(/Пауза между фоновыми запросами/.test(r.text), 'other core settings still shown');
  assert.equal(r.stored, true, 'the value itself is unchanged');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('panel: after a reload the saved tab survives a fallback tab added first, and is selected when it arrives', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  const r = await env.evalOgx(page, async () => {
    const p = OGX.dom.sidePanel('tabtest');
    p.setGroups([{ id: 'infinity', label: 'Infinity' }, { id: 'live', label: 'Live' }], { defaultGroup: 'infinity' });
    await OGX.settings.set('core.panel.tabtest.tab', 'late');   // the user's choice before the reload
    p.addTab({ id: 'live', label: 'Обзор', group: 'live', order: 1, render: () => {} });
    p.open();
    const before = [p.currentTab(), OGX.settings.get('core.panel.tabtest.tab')];
    p.addTab({ id: 'inf1', label: 'Планеты', group: 'infinity', order: 5, render: () => {} });
    p.addTab({ id: 'late', label: 'Цели', group: 'infinity', order: 9, render: () => {} });
    const after = [p.currentTab(), OGX.settings.get('core.panel.tabtest.tab')];
    await OGX.settings.set('core.panel.tabtest.tab', '');
    const p2 = OGX.dom.sidePanel('tabtest2');
    p2.setGroups([{ id: 'infinity', label: 'Infinity' }, { id: 'live', label: 'Live' }], { defaultGroup: 'infinity' });
    p2.addTab({ id: 'live', label: 'Обзор', group: 'live', order: 1, render: () => {} });
    p2.addTab({ id: 'inf1', label: 'Планеты', group: 'infinity', order: 5, render: () => {} });
    p2.open();
    return { before, after, fresh: p2.currentTab() };
  });
  // the fallback is shown but not saved; the saved tab wins once added; with nothing saved the default group (Infinity) opens
  assert.deepEqual(r, { before: ['live', 'late'], after: ['late', 'late'], fresh: 'inf1' });
  assert.deepEqual(env.ogxErrors(), []);
});
