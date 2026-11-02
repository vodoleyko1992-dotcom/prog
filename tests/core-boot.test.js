'use strict';
// OGX.boot lifecycle: module isolation (throwing init, broken file, page filter, disabled, unknown), ctx API,
// ready attribute and bus event, tick + ctx.every + countdowns, snapshot taken before Tipped can strip titles,
// MAIN-world bridge (commands through a fleetDispatcher stub, XHR relay).
//   node tests/core-boot.test.js
const T = require('./lib');
const { assert } = T;
const { coreExt } = require('./core-ext');
const fs = require('fs');
const path = require('path');

const MODULES = {
  a: `OGX.module({ name: 'a', title: 'A', pages: '*', init(ctx) { (window.__order = window.__order || []).push('a'); throw new Error('a exploded'); } });`,
  broken: `(window.__order = window.__order || []).push('broken-file'); throw new Error('file broken at load');`,
  b: `OGX.module({ name: 'b', pages: ['overview', 'fleet'], init(ctx) {
        (window.__order = window.__order || []).push('b');
        window.__ticks = 0; window.__every = 0; window.__bad = 0;
        ctx.bus.on('tick', () => { window.__ticks++; });
        ctx.every(500, () => { window.__every++; });
        ctx.every(0, () => { window.__bad++; throw new Error('every failed'); });
        window.__ctx = { ext: ctx.ext, name: ctx.name, page: ctx.page.name, hasState: !!ctx.state, hasLog: typeof ctx.log.info };
      } });`,
  c: `OGX.module({ name: 'c', pages: ['galaxy'], init() { (window.__order = window.__order || []).push('c'); } });`,
  d: `OGX.module({ name: 'd', async init() { (window.__order = window.__order || []).push('d'); await new Promise((r) => setTimeout(r, 50)); throw new Error('d async failure'); } });`,
  e: `OGX.module({ name: 'e', init() { (window.__order = window.__order || []).push('e'); } });`,
  f: `OGX.module({ name: 'f', settings: { limit: { type: 'int', default: 7, min: 1, max: 9, label: 'Лимит' } }, async init(ctx) {
        (window.__order = window.__order || []).push('f');
        await ctx.store.set('k', { v: 1 });
        await ctx.settings.set('limit', 50);
        window.__f = { limit: ctx.settings.get('limit'), all: ctx.settings.all(), stored: await ctx.store.get('k'), css: !!ctx.css('.ogx-f-x{color:red}') };
      } });`,
};
const boot = `window.__readyEvents = 0; OGX.bus.on('ready', () => { window.__readyEvents++; });
OGX.boot({ ext: 'live', modules: ['a', 'b', 'c', 'd', 'e', 'missing', 'f'] });\n`;

T.test('modules are isolated: a throwing init, a broken file, an async failure do not stop the others', async () => {
  const env = await T.launch({ ext: coreExt({ modules: MODULES, boot }), scenario: 'vega', settings: { 'e.enabled': false, 'core.tickMs': 250 } });
  const page = await env.open('/overview');
  await page.waitForTimeout(1300);
  const r = await env.evalOgx(page, () => ({
    order: window.__order, ctx: window.__ctx, f: window.__f, ready: window.__readyEvents, modules: Object.keys(OGX.modules).sort(),
    errors: OGX.errors.map((e) => e.where + ': ' + e.message), ticks: window.__ticks, every: window.__every, bad: window.__bad,
    css: !!document.getElementById('ogx-l-f'), coreCss: !!document.getElementById('ogx-core'),
  }));
  assert.deepEqual(r.order, ['broken-file', 'a', 'b', 'd', 'f'], 'load + init order (c: other page, e: disabled)');
  assert.deepEqual(r.modules, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(r.ctx, { ext: 'live', name: 'b', page: 'overview', hasState: true, hasLog: 'function' });
  assert.deepEqual(r.f.stored, { v: 1 });
  assert.equal(r.f.limit, 9, 'clamped to max');
  assert.equal(r.f.all.limit, 9);
  assert.equal(r.f.all.enabled, true);
  assert.ok(r.f.css && r.css && r.coreCss);
  assert.equal(r.ready, 1);
  assert.ok(r.errors.some((e) => /^a: .*a exploded/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /^d: .*d async failure/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /^b:every: .*every failed/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /not registered/.test(e)) === false, 'unknown module is a warning, not an error');
  // tick every 250 ms, ctx.every(500), a throwing every() keeps firing
  assert.ok(r.ticks >= 3, 'ticks ' + r.ticks);
  assert.ok(r.every >= 1 && r.every <= r.ticks, 'every ' + r.every);
  assert.ok(r.bad >= 3, 'bad every still called ' + r.bad);
  assert.equal(await page.getAttribute('html', 'data-ogx-live'), 'ready');
  // module storage and settings land in the namespaced keys
  await env.evalOgx(page, () => OGX.storage.flush());
  assert.deepEqual(await env.get('f.k'), { v: 1 });
  assert.equal((await env.get('settings')).f.limit, 9);
  // console errors carry the [OGX Live/<module>] prefix
  const texts = env.ogxErrors().map((l) => l.text);
  assert.ok(texts.some((t) => t.startsWith('[OGX Live/a]')), texts.join('\n'));
  // the page filter: c runs on the galaxy page
  const g = await env.open('/galaxy');
  assert.ok((await env.evalOgx(g, () => window.__order)).includes('c'));
});

T.test('diagnostic journal: report() lists module errors, warnings persist across pages, clear() empties it', async () => {
  const env = await T.launch({ ext: coreExt({ modules: MODULES, boot }), scenario: 'vega' });
  const page = await env.open('/overview');
  const r1 = await env.evalOgx(page, async () => {
    OGX.log.create('probe').warn('probe warning 42');
    const report = await OGX.log.report();
    return { report, entries: OGX.log.entries('warn').map((e) => e.tag + ':' + e.lvl) };
  });
  assert.ok(/=== OGX diagnostic report ===/.test(r1.report));
  assert.ok(/a exploded/.test(r1.report), 'module error in report');
  assert.ok(/probe warning 42/.test(r1.report));
  assert.ok(r1.entries.includes('probe:warn') && r1.entries.includes('a:error'), r1.entries.join(','));
  const page2 = await env.open('/galaxy');
  const r2 = await env.evalOgx(page2, async () => {
    const saved = (await OGX.log.persisted()).map((e) => e.msg);
    await OGX.log.clear();
    return { saved, after: (await OGX.log.persisted()).length, ring: OGX.log.entries().length };
  });
  assert.ok(r2.saved.some((m) => /probe warning 42/.test(m)), 'warning persisted from the previous page');
  assert.equal(r2.after, 0);
  assert.equal(r2.ring, 0);
});

T.test('tick drives countdowns; pagehide flushes pending storage writes', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega', settings: { 'core.tickMs': 250 } });
  const page = await env.open('/overview');
  await env.evalOgx(page, () => {
    const el = OGX.dom.countdown(OGX.time.serverNow() + 1500, { doneText: 'Готово' });
    el.id = 'ogx-test-cd';
    document.body.appendChild(el);
    return true;
  });
  const t1 = await page.textContent('#ogx-test-cd');
  await page.waitForTimeout(2200);
  const t2 = await page.textContent('#ogx-test-cd');
  assert.notEqual(t1, t2);
  assert.equal(t2, 'Готово');
  assert.ok(await page.$$eval('#ogx-test-cd.ogx-done', (e) => e.length) === 1);
  // a pending write is flushed on pagehide (navigation)
  await env.evalOgx(page, () => { OGX.storage.set('t.pagehide', 42); return true; });
  await env.open('/fleet');
  // inject mode: the harness' storage shim is a CDP binding that does not survive the unload, real Chrome does
  if (env.mode === 'extension') assert.equal(await env.get('t.pagehide'), 42);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('snapshot is taken synchronously at boot: tooltips and titles survive Tipped stripping the title attributes', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega', gameJs: true });
  const page = await env.open('/fleet');
  // In Chrome the document_end snapshot runs before the game scripts; with a later start (inject mode) the core
  // repairs the snapshot when the game puts the titles back. Either way the data is there before the strip below.
  await page.waitForFunction(() => document.documentElement.dataset.ogxLive === 'ready');
  const first = await env.evalOgx(page, () => !!OGX.state.snapshot().tooltips.metal);
  if (env.mode === 'extension') assert.equal(first, true, 'document_end snapshot already complete');
  for (let i = 0; i < 30 && !(await env.evalOgx(page, () => !!OGX.state.snapshot().tooltips.metal)); i++) await page.waitForTimeout(100);
  // what Tipped does to every tooltip element once it is initialised
  await page.hover('#metal_box').catch(() => {});
  await page.evaluate(() => document.querySelectorAll('[title]').forEach((el) => { el.setAttribute('data-stripped', '1'); el.removeAttribute('title'); }));
  const r = await env.evalOgx(page, async () => {
    const s = OGX.state.snapshot();
    return {
      liveNow: OGX.parse.resourceTooltips(document), titlesNow: Object.keys(OGX.parse.titles(document)).length,
      tooltips: s.tooltips, planets: s.planets.map((p) => [p.planetId, p.diameter, p.tempMin, p.tempMax, p.fieldsMax]),
      titles: OGX.state.titlesSync(), stored: await OGX.state.titles(), body: (await OGX.state.body('p1')) || null,
    };
  });
  assert.equal(r.titlesNow, 15, 'ship titles come from aria-label, which Tipped leaves alone');
  assert.ok(!r.liveNow.metal || !r.liveNow.metal.storage, 'live tooltips are gone');
  assert.deepEqual(r.tooltips.metal, { amount: 152347, storage: 255000, perHour: 4128 });
  assert.deepEqual(r.tooltips.energy, { available: 106, production: 2860, consumption: -2754 });
  assert.deepEqual(r.planets[0], [1, 12800, 12, 52, 163]);
  assert.equal(r.titles['Small Cargo'], 202);
  assert.equal(r.titles['Espionage Probe'], 210);
  assert.equal(r.stored['Large Cargo'], 203);
  assert.ok(r.body, 'body p1 stored');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('bridge: commands reach fleetDispatcher in the MAIN world; replies, unknown methods, ping', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/fleet');
  await env.pageStub(page, 'fleetDispatcher', { shipsToSend: [{ id: 202, number: 3 }], mission: 3, currentPage: 'fleet1', fleetHelper: { shipsData: { 202: { speed: 10000 } } } });
  const r = await env.evalOgx(page, async () => {
    const B = OGX.bridge;
    const out = { available: await B.available(), ping: await B.call('ping') };
    out.sel = await B.call('fleet.selectShips', { 202: 5, 203: 0, 210: 1.7 });
    out.tgt = await B.call('fleet.setTarget', { galaxy: 1, system: 45, position: 6, type: 3 });
    out.mis = await B.call('fleet.selectMission', 4);
    out.cargo = await B.call('fleet.setCargo', { metal: 100.9, crystal: -5, deuterium: 3 });
    out.speed = await B.call('fleet.setSpeed', 7);
    out.step = await B.call('fleet.goStep', 2);
    out.state = await B.call('fleet.state');
    try { await B.call('nope.method'); } catch (e) { out.unknown = e.message; }
    return out;
  });
  assert.equal(r.available, true);
  // the hook version is the one in shared/main/page-hook.js (bumped with every bridge API change)
  const hookVersion = (/const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'shared', 'main', 'page-hook.js'), 'utf8')) || [])[1];
  assert.ok(hookVersion, 'VERSION in page-hook.js');
  assert.deepEqual(r.ping, { ok: true, version: hookVersion });
  for (const k of ['sel', 'tgt', 'mis', 'cargo', 'speed', 'step']) assert.deepEqual(r[k], { ok: true }, k);
  assert.deepEqual(r.state.targetPlanet, { galaxy: 1, system: 45, position: 6, type: 3 });
  assert.deepEqual([r.state.cargoMetal, r.state.cargoCrystal, r.state.cargoDeuterium], [100, 0, 3]);
  assert.deepEqual(r.state.shipsData, { 202: { speed: 10000 } });
  assert.equal(r.unknown, 'unknown method nope.method');
  const calls = (await env.stubCalls(page)).map((c) => c.method + JSON.stringify(c.args));
  assert.deepEqual(calls, ['resetShips[]', 'selectShips[{"202":5,"210":1}]', 'refresh[]', 'setTargetType[3]', 'refreshTarget[]', 'updateTarget[]',
    'selectMission[4]', 'updateCargo[]', 'refresh[]', 'setFleetPercent[7]', 'switchToPage["fleet2"]']);
  // no fleet was sent: submit was never called and nothing went to the server
  assert.equal(env.requests('POST').length, 0);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('bridge: game XHRs on whitelisted paths are relayed with form + json; others are not', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/galaxy');
  env.clearRequests();
  await env.evalOgx(page, () => {
    window.__x = [];
    OGX.bus.on('xhr', (x) => window.__x.push({ path: x.path, method: x.method, status: x.status, form: x.form, query: x.query, jsonKeys: x.json ? Object.keys(x.json).length : 0 }));
    window.__sys = [];
    OGX.bus.on('galaxy:system', (e) => window.__sys.push([e.system.galaxy, e.system.system, e.source]));
    return true;
  });
  await page.evaluate(async (token) => {
    const xhr = (method, url, body) => new Promise((res) => { const x = new XMLHttpRequest(); x.open(method, url); x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded'); x.setRequestHeader('X-CSRF-TOKEN', token); x.onloadend = res; x.send(body); });
    await xhr('POST', '/ajax/galaxy', 'galaxy=1&system=42&_token=' + token);
    await xhr('GET', '/ajax/techtree?tab=2&object_id=203');
    await xhr('GET', '/ajax/fleet/eventbox/fetch?x=1');
  }, 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e');
  await page.waitForTimeout(400);
  const r = await env.evalOgx(page, async () => { await OGX.storage.flush(); return { x: window.__x, sys: window.__sys, cached: !!(await OGX.galaxy.cached(1, 42)) }; });
  assert.deepEqual(r.x.map((x) => x.method + ' ' + x.path), ['POST /ajax/galaxy', 'GET /ajax/fleet/eventbox/fetch']);
  assert.deepEqual(r.x[0].form, { galaxy: '1', system: '42', _token: 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e' });
  assert.ok(r.x[0].jsonKeys > 3 && r.x[0].status === 200);
  assert.deepEqual(r.x[1].query, { x: '1' });
  assert.deepEqual(r.sys, [[1, 42, 'page']]);
  assert.equal(r.cached, true, 'galaxy system cached from the relayed answer');
  // no extra request from the extension: it only listened
  assert.deepEqual(env.requests().map((q) => q.path), ['/ajax/galaxy', '/ajax/techtree', '/ajax/fleet/eventbox/fetch']);
  assert.deepEqual(env.ogxErrors(), []);
});
