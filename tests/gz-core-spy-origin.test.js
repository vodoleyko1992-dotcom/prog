'use strict';
// One-click spy on GALAXYZ (tests/gz-server.js mock):
//  S1  fleetAjax codes -> readable Russian text (611 = no probes on the planet [UPSTREAM 2Moons fa_no_spios]); unknown -> «код N»,
//      never "undefined"
//  S2  api.pickSpyOrigin: the nearest own body with cached probes (galaxy, then system, then position); none known -> current
//  S3  sendMiniFleet(6) sends from that body: fleetAjax carries cp=<origin>, the current planet is restored after; shipCount is
//      spy.probes capped at the origin's probes; the sent probes leave the cached origin
//   node tests/gz-core-spy-origin.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

T.test('S1 fleetAjax codes: every 2Moons code readable, 611 by mission, unknown -> «код N»; refusal message is never undefined', async () => {
  const env = await G.launch();
  const o = await env.game('overview');
  const r = await env.evalOgx(o, () => {
    const t = OGX.api.fleetAjaxText;
    return {
      all: [600, 601, 602, 603, 604, 605, 610, 612, 613, 614, 615, 616, 618, 619, 620, 699].map((c) => [c, t(c, 6)]),
      n611: [t(611, 6), t(611, 8), t(611, 1)], n610: t(610, 6), unknown: t(617, 6), none: t(undefined, 6),
    };
  });
  for (const [c, s] of r.all) assert.ok(typeof s === 'string' && s && !/undefined|^код /.test(s), c + ': ' + s);
  assert.deepEqual(r.n611, ['на планете нет шпионских зондов', 'на планете нет переработчиков', 'на планете нет нужных кораблей']);
  assert.ok(/зонд/.test(r.n610), r.n610);
  assert.equal(r.unknown, 'код 617');
  assert.equal(r.none, null);

  // the live case: code 611 without a usable mess
  env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({ slots: 1, code: 611 }));
  const s = await env.evalOgx(o, () => OGX.api.sendMiniFleet({ mission: 6, planetId: 301180, galaxy: 2, system: 68, position: 9 }));
  assert.deepEqual([s.success, s.code, s.message, s.shipsSent, s.serverMessage], [false, 611, 'на планете нет шпионских зондов', 0, null]);
  env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({ slots: 1, code: 642, mess: '' }));
  const u = await env.evalOgx(o, () => OGX.api.sendMiniFleet({ mission: 6, planetId: 301180, galaxy: 2, system: 68, position: 9 }));
  assert.deepEqual([u.success, u.message], [false, 'код 642']);
  env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({ slots: 1 }));
  const n = await env.evalOgx(o, () => OGX.api.sendMiniFleet({ mission: 6, planetId: 301180, galaxy: 2, system: 68, position: 9 }));
  assert.equal(n.success, false);
  assert.ok(n.message && !/undefined/.test(n.message), n.message);
  assert.deepEqual(env.ogxErrors(), []);
  await env.close();
});

T.test('S2/S3 spy origin: nearest body with probes, cp on fleetAjax, current planet restored, count capped, probes leave the cache', async () => {
  const env = await G.launch();
  const o = await env.game('overview');
  // cached bodies: the current one without probes, two others with probes (2:70 is nearer to 2:72 than 2:10), one in galaxy 3
  const cur = await env.evalOgx(o, async () => {
    const curId = OGX.state.current().id;
    await OGX.storage.update('bodies', (old) => {
      const b = Object.assign({}, old || {});
      for (const k of Object.keys(b)) b[k] = Object.assign({}, b[k], { ships: Object.assign({}, b[k].ships, { 210: 0 }) });
      const mk = (id, coords, n, type) => ({ key: (type === 'moon' ? 'm' : 'p') + id, id, type: type || 'planet', name: 'P' + id, coords, ships: { 210: n }, shipsT: Date.now() });
      b.p900001 = mk(900001, '2:10:4', 5000);
      b.p900002 = mk(900002, '2:70:8', 300);
      b.m900003 = mk(900003, '3:72:9', 9000, 'moon');
      b.p900004 = mk(900004, '1:72:9', 0);
      return b;
    }, {});
    return curId;
  });
  const pick = await env.evalOgx(o, async () => [await OGX.api.pickSpyOrigin({ galaxy: 2, system: 72, position: 9 }), await OGX.api.pickSpyOrigin('3:80:1'),
    await OGX.api.pickSpyOrigin({ galaxy: 2, system: 69, position: 1 })]);
  assert.deepEqual(pick[0], { id: 900002, coords: '2:70:8', name: 'P900002', probes: 300, current: false, source: 'nearest' });
  assert.equal(pick[1].id, 900003);
  assert.equal(pick[2].id, 900002);

  env.server.clearLog();
  env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({ slots: 2, ships: { 210: 0 }, code: 600, mess: 'Send 300 Spy Probe to 2:72:9 ...' }));
  const s = await env.evalOgx(o, () => OGX.api.sendMiniFleet({ mission: 6, planetId: 301180, galaxy: 2, system: 72, position: 9, shipCount: 1100 }));
  assert.deepEqual([s.success, s.shipsSent, s.shipCount, s.origin.id, s.origin.current], [true, 300, 300, 900002, false]);
  const fa = env.server.find('GET', 'fleetAjax');
  assert.equal(fa.length, 1);
  assert.deepEqual([fa[0].query.cp, fa[0].query.mission, fa[0].query.planetID], ['900002', '6', '301180']);
  // the selected planet is sticky server-side: it is switched back to the current one after the send
  const after = env.server.requests.slice(env.server.requests.indexOf(fa[0]) + 1);
  assert.ok(after.some((x) => x.query && String(x.query.cp) === String(cur)), 'restored to ' + cur + ': ' + JSON.stringify(after.map((x) => x.url || x.query)));
  const left = await env.evalOgx(o, async () => (await OGX.state.bodies()).p900002.ships[210]);
  assert.equal(left, 0);

  // the nearer planet is now empty -> next spy goes from 2:10:4; an explicit cp wins over the pick
  env.server.clearLog();
  const s2 = await env.evalOgx(o, () => OGX.api.sendMiniFleet({ mission: 6, planetId: 301180, galaxy: 2, system: 72, position: 9 }));
  assert.equal(s2.origin.id, 900001);
  assert.equal(env.server.find('GET', 'fleetAjax')[0].query.cp, '900001');
  env.server.clearLog();
  const s3 = await env.evalOgx(o, (c) => OGX.api.sendMiniFleet({ mission: 6, planetId: 301180, galaxy: 2, system: 72, position: 9 }, { cp: c }), cur);
  assert.equal(s3.origin, undefined);
  assert.equal(env.server.find('GET', 'fleetAjax')[0].query.cp, String(cur));

  // no probe count known anywhere -> the current planet, no cp switch
  await env.evalOgx(o, () => OGX.storage.update('bodies', (old) => {
    const b = {};
    for (const [k, v] of Object.entries(old || {})) if (!/^[pm]9000/.test(k)) b[k] = Object.assign({}, v, { ships: {} });
    return b;
  }, {}));
  env.server.clearLog();
  const s4 = await env.evalOgx(o, () => OGX.api.sendMiniFleet({ mission: 6, planetId: 301180, galaxy: 2, system: 72, position: 9 }));
  assert.deepEqual([s4.origin.source, s4.origin.current, s4.origin.probes, s4.shipCount], ['current', true, null, 1100]);
  assert.equal(env.server.find('GET', 'fleetAjax')[0].query.cp, undefined);
  assert.equal(env.server.find('GET', /overview/).length, 0, 'no planet switch, nothing to restore');
  assert.deepEqual(env.ogxErrors(), []);
  await env.close();
});

