'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OGX.page: detection (isOgx) on every fixture, routing (nameFor / info) on every served page, and the
// safety rules: nothing happens on non-OgameX pages, on gameforge hosts; works on any other domain.
//   node tests/legacy-ogamex/core-detect.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const FIX = path.join(__dirname, '..', '..', 'fixtures');

T.test('isOgx: true on every full game page fixture, false on fragments and on gameforge hosts', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const files = fs.readdirSync(FIX).filter((f) => f.endsWith('.html'));
  const input = Object.fromEntries(files.map((f) => [f, T.fixture(f)]));
  const got = await env.evalOgx(page, (I) => {
    const out = {};
    for (const [f, html] of Object.entries(I)) {
      const d = new DOMParser().parseFromString(html, 'text/html');
      out[f] = { ogx: OGX.page.isOgx(d, { hostname: 'localhost' }), gf: OGX.page.isOgx(d, { hostname: 's123-en.ogame.gameforge.com' }), any: OGX.page.isOgx(d, { hostname: 'ogame.example.org' }) };
    }
    out.__null = OGX.page.isOgx(null, { hostname: 'localhost' });
    out.__noComment = (() => {
      // OGame metas + #planetList but neither the OGameX head comment nor the github footer link
      const d = new DOMParser().parseFromString(I['layout-overview-planet.html'], 'text/html');
      [...d.head.childNodes].filter((n) => n.nodeType === 8).forEach((n) => n.remove());
      d.querySelectorAll('#siteFooter a.homeLink').forEach((a) => a.remove());
      return OGX.page.isOgx(d, { hostname: 'localhost' });
    })();
    out.__footerOnly = (() => {
      const d = new DOMParser().parseFromString(I['layout-overview-planet.html'], 'text/html');
      [...d.head.childNodes].filter((n) => n.nodeType === 8).forEach((n) => n.remove());
      return OGX.page.isOgx(d, { hostname: 'localhost' });
    })();
    return out;
  }, input);
  let full = 0;
  for (const f of files) {
    const html = input[f];
    const isPage = /^\s*(<!doctype|<html)/i.test(html.slice(0, 300));
    if (isPage) full++;
    assert.equal(got[f].ogx, isPage, f);
    assert.equal(got[f].any, isPage, f + ' (any domain)');
    assert.equal(got[f].gf, false, f + ' (gameforge host)');
  }
  assert.ok(full >= 25, 'full page fixtures: ' + full);
  assert.equal(got.__null, false);
  assert.equal(got.__noComment, false);
  assert.equal(got.__footerOnly, true);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('nameFor: every route of layout.md §10, prefixes, trailing slashes, unknown paths', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const table = {
    '/': 'overview', '': 'overview', '/overview': 'overview', '/overview/': 'overview', '/OVERVIEW': 'overview',
    '/resources': 'resources', '/resources/settings': 'resourceSettings', '/facilities': 'facilities', '/research': 'research',
    '/shipyard': 'shipyard', '/defense': 'defense', '/fleet': 'fleet', '/fleet/movement': 'movement', '/galaxy': 'galaxy',
    '/messages': 'messages', '/highscore': 'highscore', '/buddies': 'buddies', '/merchant': 'merchant', '/merchant/resource-market': 'merchant',
    '/alliance': 'alliance', '/alliance/info/12': 'alliance', '/premium': 'premium', '/shop': 'shop', '/rewards': 'rewards',
    '/characterclass': 'characterclass', '/chat': 'chat', '/options': 'options', '/admin': 'admin', '/admin/developer-shortcuts': 'admin',
    '/planet-move': 'planetMove', '/fleet/templates': 'other', '/resources/downgrade': 'other', '/ajax/galaxy': 'other', '/login': 'other', '/fleetx': 'other',
  };
  const got = await env.evalOgx(page, (paths) => Object.fromEntries(paths.map((p) => [p, OGX.page.nameFor(p)])), Object.keys(table));
  assert.deepEqual(got, table);
  const info = await env.evalOgx(page, () => {
    const i = OGX.page.info();
    return { name: i.name, path: i.path, bodyId: i.bodyId, isAdmin: i.isAdmin, origin: i.origin, is: OGX.page.is('galaxy', 'overview'), isNot: OGX.page.is('galaxy'),
      url: OGX.page.url('/fleet', { galaxy: 1, system: 42, position: null }) };
  });
  assert.deepEqual(info, { name: 'overview', path: '/overview', bodyId: 'overview', isAdmin: false, origin: env.origin, is: true, isNot: false, url: env.origin + '/fleet?galaxy=1&system=42' });
});

T.test('page names and ready state on every page the mock serves (vega + orion)', async () => {
  const pages = {
    vega: { '/overview': 'overview', '/overview?cp=5': 'overview', '/fleet': 'fleet', '/fleet?galaxy=1&system=45&position=6&type=1&mission=1': 'fleet', '/fleet/movement': 'movement',
      '/galaxy': 'galaxy', '/galaxy?galaxy=1&system=45': 'galaxy', '/messages': 'messages', '/highscore': 'highscore', '/buddies': 'buddies', '/': 'overview' },
    orion: { '/overview': 'overview', '/resources': 'resources', '/resources?cp=7': 'resources', '/resources?cp=9': 'resources', '/facilities': 'facilities',
      '/research': 'research', '/shipyard': 'shipyard', '/defense': 'defense', '/resources/settings': 'resourceSettings', '/overview?cp=9': 'overview' },
  };
  for (const [scenario, list] of Object.entries(pages)) {
    const env = await T.launch({ ext: coreExt(), scenario });
    for (const [p, name] of Object.entries(list)) {
      const page = await env.open(p);
      const r = await env.evalOgx(page, () => ({ name: OGX.page.info().name, active: OGX.active, ext: OGX.ext, mark: document.documentElement.dataset.ogxLive, errors: OGX.errors.map((e) => e.where + ': ' + e.message) }));
      assert.deepEqual(r, { name, active: true, ext: 'live', mark: 'ready', errors: [] }, `${scenario} ${p}`);
    }
    assert.deepEqual(env.ogxErrors(), [], scenario);
    assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), [], scenario);
    await env.close();
  }
});

T.test('safety: nothing on /not-ogame, /login, /gameforge-like and on gameforge hosts; works on any other domain', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  for (const p of ['/not-ogame', '/login', '/gameforge-like']) {
    env.clearRequests();
    const page = await env.open(p, { waitReady: false });
    await page.waitForTimeout(400);
    assert.equal(await page.$$eval('[class*="ogx-"], [id^="ogx-"]', (e) => e.length), 0, p + ': ogx elements');
    assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false, p + ': data-ogx attribute');
    assert.equal(await page.$$eval('style#ogx-core', (e) => e.length), 0, p + ': style');
    assert.deepEqual(env.requests().map((r) => r.path), [p], p + ': requests');
    const iso = await env.evalOgx(page, () => ({ active: OGX.active, booted: !!OGX._booted, ls: Object.keys(localStorage).filter((k) => k.startsWith('ogx.')).length }));
    assert.deepEqual(iso, { active: false, booted: false, ls: 0 }, p);
  }
  assert.deepEqual(await env.storage(), {}, 'nothing stored');
  // gameforge: the manifest excludes it; the core's own host check would refuse too (tested above)
  env.clearRequests();
  const gf = await env.open(env.urlOn('s1-en.ogame.gameforge.com', '/overview'), { waitReady: false });
  await gf.waitForTimeout(500);
  assert.equal(await gf.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false, 'gameforge: data-ogx');
  assert.equal(await gf.$$eval('[class*="ogx-"], [id^="ogx-"]', (e) => e.length), 0, 'gameforge: ogx elements');
  assert.deepEqual(env.requests().map((r) => r.path), ['/overview'], 'gameforge: requests');
  // the MAIN-world hook marks nothing either
  assert.equal(await gf.evaluate(() => typeof window.__ogxHook), 'undefined');
  // any other domain: ready
  const other = await env.open(env.urlOn('ogame.example.org', '/overview'));
  assert.equal(await other.getAttribute('html', 'data-ogx-live'), 'ready');
  assert.deepEqual(env.ogxErrors(), []);
});
