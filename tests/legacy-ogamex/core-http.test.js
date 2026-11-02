'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OGX.http / OGX.api: CSRF header + _token, 419 refresh-and-retry, newAjaxToken, logged-out detection,
// same-origin guard, withPlanet (?cp= + restore order + cross-tab lock), background queue gap, confirm gates.
//   node tests/legacy-ogamex/core-http.test.js
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const VEGA = 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e';

T.test('CSRF: X-CSRF-TOKEN header on every request, _token in every form body; nothing leaves the origin', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  env.clearRequests();
  const r = await env.evalOgx(page, async () => {
    const s = await OGX.api.search('Vega', 2);
    const g = await OGX.http.get('/ajax/fleet/eventbox/fetch');
    const x = await OGX.http.get('http://example.com/steal');
    const y = await OGX.http.post('//example.com/x', { a: 1 });
    return { csrf: OGX.http.csrf(), search: Array.isArray(s) || typeof s === 'object', sErr: s.error || null, g: [g.ok, g.status, typeof g.json], x: [x.ok, x.status, /cross-origin/.test(x.error)], y: [y.ok, /cross-origin/.test(y.error)] };
  });
  assert.equal(r.csrf, VEGA);
  assert.equal(r.sErr, null);
  assert.deepEqual(r.g, [true, 200, 'object']);
  assert.deepEqual(r.x, [false, 0, true]);
  assert.deepEqual(r.y, [false, true]);
  const reqs = env.requests();
  assert.deepEqual(reqs.map((q) => q.method + ' ' + q.path), ['POST /ajax/search', 'GET /ajax/fleet/eventbox/fetch']);
  const [post, get] = reqs;
  assert.equal(post.headers['x-csrf-token'], VEGA);
  assert.equal(post.form._token, VEGA);
  assert.deepEqual([post.form.searchtext, post.form.category], ['Vega', '2']);
  assert.equal(post.headers['x-requested-with'], 'XMLHttpRequest');
  assert.match(post.headers['content-type'], /application\/x-www-form-urlencoded/);
  assert.equal(get.headers['x-csrf-token'], VEGA);
  assert.equal(get.raw || '', '');
  assert.equal(post.csrf, true);
  assert.deepEqual(env.server.unhandled, []);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('419: token refreshed from /overview and the request retried once; a second 419 reports csrf', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  env.clearRequests();
  const r = await env.evalOgx(page, async () => {
    OGX.http._setCsrf('expired-token-000000000000');
    const res = await OGX.http.post('/ajax/search', { searchtext: 'a', category: 2 }, { expect: 'json' });
    return { ok: res.ok, status: res.status, token: OGX.http.csrf() };
  });
  assert.deepEqual(r, { ok: true, status: 200, token: VEGA });
  assert.deepEqual(env.requests().map((q) => `${q.method} ${q.path} ${q.form._token || q.headers['x-csrf-token'] || ''}`.trim()),
    ['POST /ajax/search expired-token-000000000000', 'GET /overview', 'POST /ajax/search ' + VEGA]);
  // the server keeps answering 419
  let n = 0;
  env.server.route('POST', '/ajax/highscore', (req, res, ctx) => { n++; return ctx.jsonBody({ message: 'CSRF token mismatch.' }, 419); });
  env.clearRequests();
  const r2 = await env.evalOgx(page, async () => { const x = await OGX.http.post('/ajax/highscore', { category: 1, type: 0 }); return { ok: x.ok, status: x.status, error: x.error, loggedOut: x.loggedOut }; });
  assert.deepEqual(r2, { ok: false, status: 419, error: 'csrf', loggedOut: true });
  assert.equal(n, 2, 'exactly one retry');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('JSON answers: newAjaxToken adopted (junk constant ignored); logged-out redirect and 401', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const fresh = 'Nn1Nn2Nn3Nn4Nn5Nn6Nn7Nn8Nn9Nn0Nn1Nn2Nn3';
  let seq = 0;
  env.server.route('GET', '/ajax/test-token', (req, res, ctx) => {
    seq++;
    return ctx.jsonBody(seq === 1 ? { newAjaxToken: fresh } : { newAjaxToken: '91cf2833548771ba423894d1f3dddb3c' });
  });
  env.server.route('GET', '/ajax/test-logout', (req, res, ctx) => ctx.send(302, '', 'text/html', { Location: '/login' }));
  env.server.route('GET', '/ajax/test-401', (req, res, ctx) => ctx.jsonBody({}, 401));
  const r = await env.evalOgx(page, async () => {
    await OGX.http.get('/ajax/test-token');
    const a = OGX.http.csrf();
    await OGX.http.get('/ajax/test-token');
    const b = OGX.http.csrf();
    OGX.http._setCsrf(null);
    const lo = await OGX.http.get('/ajax/test-logout');
    const u = await OGX.http.get('/ajax/test-401');
    const m = await OGX.api.galaxy(1, 99);
    return { a, b, reset: OGX.http.csrf(), lo: [lo.ok, lo.loggedOut, lo.error], u: [u.ok, u.loggedOut], gx: m.json && m.json.system && m.json.system.system };
  });
  assert.deepEqual(r, { a: fresh, b: fresh, reset: VEGA, lo: [false, true, 'logged out'], u: [false, true], gx: 99 });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('withPlanet: every request gets ?cp=, galaxy never does, then GET /overview?cp=<original>; lock serialises tabs', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const a = await env.open('/overview');
  const b = await env.open('/overview', { newPage: true });
  env.clearRequests();
  const r = await env.evalOgx(a, async () => {
    const inside = await OGX.http.withPlanet(3, async () => {
      await OGX.http.get('/ajax/fleet/eventbox/fetch');
      await OGX.api.galaxy(1, 42);
      return OGX.http._activeCp();
    });
    return { inside, after: OGX.http._activeCp() };
  });
  assert.deepEqual(r, { inside: 3, after: null });
  assert.deepEqual(env.requests().map((q) => q.method + ' ' + q.url), ['GET /ajax/fleet/eventbox/fetch?cp=3', 'POST /ajax/galaxy', 'GET /overview?cp=1']);
  assert.equal(env.server.state.currentBodyId, 1);
  assert.equal(await env.get('lock.cp'), undefined, 'lock released');
  // restoreTo, and an exception inside still restores
  env.clearRequests();
  const thrown = await env.evalOgx(a, async () => {
    try { await OGX.http.withPlanet(5, async () => { await OGX.http.get('/ajax/fleet/eventbox/fetch'); throw new Error('boom'); }, { restoreTo: 3 }); } catch (e) { return e.message; }
    return null;
  });
  assert.equal(thrown, 'boom');
  assert.deepEqual(env.requests().map((q) => q.url), ['/ajax/fleet/eventbox/fetch?cp=5', '/overview?cp=3']);
  assert.equal(env.server.state.currentBodyId, 3);
  // two tabs: B waits for A's restore
  env.setState({ currentBodyId: 1 });
  env.clearRequests();
  env.setState({ latencyMs: 150 });
  const pa = env.evalOgx(a, () => OGX.http.withPlanet(3, async () => { await OGX.http.get('/ajax/fleet/eventbox/fetch', { query: { tab: 'A' } }); await new Promise((r) => setTimeout(r, 400)); return true; }, { restoreTo: 1 }));
  await a.waitForTimeout(100);
  const pb = env.evalOgx(b, () => OGX.http.withPlanet(5, async () => { await OGX.http.get('/ajax/fleet/eventbox/fetch', { query: { tab: 'B' } }); return true; }, { restoreTo: 1 }));
  await Promise.all([pa, pb]);
  env.setState({ latencyMs: 0 });
  assert.deepEqual(env.requests().map((q) => q.url), ['/ajax/fleet/eventbox/fetch?tab=A&cp=3', '/overview?cp=1', '/ajax/fleet/eventbox/fetch?tab=B&cp=5', '/overview?cp=1']);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('background queue: requests spaced by core.httpGapMs; foreground requests are not queued', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega', settings: { 'core.httpGapMs': 500 } });
  const page = await env.open('/overview');
  env.clearRequests();
  const r = await env.evalOgx(page, async () => {
    const ps = [1, 2, 3, 4].map((i) => OGX.http.get('/ajax/fleet/eventbox/fetch', { background: true, query: { n: i } }));
    const ql = OGX.http.queueLength();
    const t0 = Date.now();
    const fg = await OGX.http.get('/ajax/fleet/eventbox/fetch', { query: { n: 'fg' } });
    const fgMs = Date.now() - t0;
    const all = await Promise.all(ps);
    return { ql, fgMs, fgOk: fg.ok, ok: all.map((x) => x.ok), left: OGX.http.queueLength() };
  });
  assert.ok(r.ql >= 3, 'queued: ' + r.ql);
  assert.ok(r.fgMs < 400, 'foreground not delayed: ' + r.fgMs);
  assert.deepEqual([r.fgOk, r.ok, r.left], [true, [true, true, true, true], 0]);
  const bg = env.requests('GET', '/ajax/fleet/eventbox/fetch').filter((q) => q.query.n !== 'fg');
  assert.deepEqual(bg.map((q) => q.query.n), ['1', '2', '3', '4'], 'FIFO');
  for (let i = 1; i < bg.length; i++) assert.ok(bg[i].t - bg[i - 1].t >= 450, `gap ${i}: ${bg[i].t - bg[i - 1].t} ms`);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('state-changing wrappers ask first: deleteMessage / addBuild need the click on "Да"', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'orion' });
  const page = await env.open('/resources');
  env.clearRequests();
  await env.evalOgx(page, () => { window.__p = OGX.api.deleteMessage(2047); return true; });
  await env.waitFor(page, '.ogx-modal [data-role="cancel"]');
  assert.match(await page.textContent('.ogx-modal'), /Удалить сообщение\?/);
  await page.click('.ogx-modal [data-role="cancel"]');
  assert.equal(await env.evalOgx(page, () => window.__p), false);
  assert.deepEqual(env.requests('POST'), [], 'cancel: nothing sent');
  await env.evalOgx(page, () => { window.__p = OGX.api.addBuild('resources', 1); return true; });
  await env.waitFor(page, '.ogx-modal [data-role="ok"]');
  assert.match(await page.textContent('.ogx-modal'), /Построить: .+\?/);
  await page.click('.ogx-modal [data-role="ok"]');
  const res = await env.evalOgx(page, () => window.__p);
  assert.equal(res.ok, true);
  const posts = env.requests('POST');
  assert.deepEqual(posts.map((q) => q.path), ['/resources/add-buildrequest']);
  assert.deepEqual([posts[0].form.technologyId, posts[0].form.amount, posts[0].form.mode, !!posts[0].form._token], ['1', '1', '1', true]);
  // defense posts to the shipyard endpoint; {confirm:false} after the module's own dialog
  env.clearRequests();
  const d = await env.evalOgx(page, () => OGX.api.addBuild('defense', 401, { amount: 10, confirm: false }));
  assert.equal(d.ok, true);
  assert.deepEqual(env.requests('POST').map((q) => q.path + ' ' + q.form.amount), ['/shipyard/add-buildrequest 10']);
  const del = await env.evalOgx(page, () => OGX.api.deleteMessage(2047, { confirm: false }));
  assert.equal(del, true);
  assert.equal(await page.$$eval('.ogx-modal', (e) => e.length), 0);
  assert.deepEqual(env.ogxErrors(), []);
});
