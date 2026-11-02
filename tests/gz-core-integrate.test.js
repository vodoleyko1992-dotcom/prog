'use strict';
// Core additions made while integrating the module ports (real GALAXYZ pages, tests/gz-server.js mock):
//  - state: page=galaxy header fleet slots stored next to the fleetTable ones; combatBonus; fieldsT; refreshBodies 'empire' without cp
//  - page.bodyUrl, dom.anchors leftColumn/menuEnd, flights.cached, galaxy.isOwnRow
//  - fleet.gz.state step 2: fleetPoints + the ships of step 1 (same token); fillCargo reset
//  - messages: espionageFull simHref
//   node tests/gz-core-integrate.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

T.test('state: galaxy header slots keep the fleetTable expedition slots; combatBonus; fields follow fieldsT', async () => {
  const env = await G.launch();
  try {
    const ft = await env.game('fleetTable');
    const a = await env.evalOgx(ft, async () => { await OGX.storage.flush(); return { slots: await OGX.state.slots(), bonus: await OGX.state.combatBonus() }; });
    // real fleetTable.html: "Fleet 1 / 13", "0 / 2 expedition", Bonus table
    assert.deepEqual([a.slots.fleet, a.slots.expedition, a.slots.fleetSrc, a.slots.expeditionSrc], [{ used: 1, max: 13 }, { used: 0, max: 2 }, 'fleetTable', 'fleetTable']);
    assert.ok(a.bonus && Number.isFinite(a.bonus.attack) && Number.isFinite(a.bonus.shield) && a.bonus.t > 0, JSON.stringify(a.bonus));
    // a later galaxy header (fleet only) replaces the fleet kind and keeps the expedition kind with its own time
    const b = await env.evalOgx(ft, async (t0) => {
      await OGX.state.merge({ engine: 'galaxyz', galaxySlots: { used: 2, max: 13 } }, { t: t0 + 60000 });
      return OGX.state.slots();
    }, a.slots.t);
    assert.deepEqual([b.fleet, b.fleetSrc, b.fleetT, b.expedition, b.expeditionSrc, b.expeditionT], [{ used: 2, max: 13 }, 'galaxy', a.slots.t + 60000, { used: 0, max: 2 }, 'fleetTable', a.slots.t]);
    // the real galaxy page stores its header "1/13 Fleet Slots" on a fresh profile
    const env2 = await G.launch();
    try {
      const gx = await env2.game('galaxy');
      const s = await env2.evalOgx(gx, async () => { await OGX.storage.flush(); return OGX.state.slots(); });
      assert.deepEqual([s.fleet, s.fleetSrc, s.expedition], [{ used: 1, max: 13 }, 'galaxy', null]);
    } finally { await env2.close(); }
    // fieldsUsed/fieldsMax: an older page never overwrites newer values
    const f = await env.evalOgx(ft, async () => {
      const cur = OGX.state.snapshot().current;
      const before = await OGX.state.body(cur.key);
      await OGX.state.merge({ engine: 'galaxyz', page: 'overview', current: cur, overviewInfo: { fieldsUsed: 1, fieldsMax: 2 } }, { t: before.fieldsT - 1000 });
      const older = await OGX.state.body(cur.key);
      await OGX.state.merge({ engine: 'galaxyz', page: 'overview', current: cur, overviewInfo: { fieldsUsed: 3, fieldsMax: 4 } }, { t: before.fieldsT + 1000 });
      const newer = await OGX.state.body(cur.key);
      return { before: [before.fieldsUsed, before.fieldsMax], older: [older.fieldsUsed, older.fieldsMax], newer: [newer.fieldsUsed, newer.fieldsMax, newer.fieldsT - before.fieldsT] };
    });
    assert.ok(f.before[0] > 0 && f.before[1] > 0, JSON.stringify(f));
    assert.deepEqual(f.older, f.before, 'older page ignored');
    assert.deepEqual(f.newer, [3, 4, 1000], 'newer page applied');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('state.refreshBodies include empire: one GET page=imperium without cp, no cp notice needed', async () => {
  const env = await G.launch();
  try {
    const page = await env.game('overview');
    env.server.clearLog();
    const r = await env.evalOgx(page, async () => {
      const confirmed = !!OGX.settings.get('core.cpConfirmed');
      const res = await OGX.state.refreshBodies({ include: ['empire'] });
      return { confirmed, res };
    });
    assert.equal(r.confirmed, false);
    assert.deepEqual(r.res, { done: 1, ok: 1, errors: [], restored: true }, 'no planet switch: nothing to restore');
    assert.deepEqual(env.server.requests.map((x) => [x.method, x.route, x.cp]), [['GET', 'page=imperium', null]]);
    // anything else per body still needs the cp notice
    const r2 = await env.evalOgx(page, () => OGX.state.refreshBodies({ include: ['empire', 'resources'] }));
    assert.deepEqual(r2.errors, [{ key: null, error: 'cpConfirmed' }]);
    assert.equal(env.server.requests.length, 1, 'refused before any request');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('page.bodyUrl, dom.anchors leftColumn/menuEnd, flights.cached, galaxy.isOwnRow', async () => {
  const env = await G.launch();
  try {
    const ov = await env.game('overview');
    const o = await env.evalOgx(ov, async () => {
      const a = OGX.dom.anchors();
      const c = await OGX.flights.cached();
      return { url: OGX.page.bodyUrl(254103).replace(location.origin, ''), left: a.leftColumn && a.leftColumn.id, end: a.menuEnd && a.menuEnd.id,
        endParent: a.menuEnd && a.menuEnd.parentElement.id, cached: c && [Array.isArray(c.flights), c.flights.length > 0, c.t > 0] };
    });
    assert.deepEqual(o, { url: '/Aeternum/game.php?page=overview&cp=254103', left: 'links', end: 'menuTable', endParent: 'links', cached: [true, true, true] });
    assert.deepEqual(env.server.requests.filter((x) => x.route !== 'page=overview').map((x) => x.url), [], 'flights.cached sends nothing');
    const s1 = await env.openSaved('fleetStep1');
    assert.match(await env.evalOgx(s1, () => OGX.page.bodyUrl(254103)), /\?page=fleetTable&cp=254103$/);
    const gx = await env.game('galaxy');
    const g = await env.evalOgx(gx, () => {
      const me = OGX.state.snapshot().player.name;
      return { url: OGX.page.bodyUrl(254104), ownFlag: OGX.galaxy.isOwnRow({ own: true }), byName: OGX.galaxy.isOwnRow({ own: false, playerId: null, playerName: me }),
        other: OGX.galaxy.isOwnRow({ own: false, playerId: null, playerName: me + 'x' }), byMe: OGX.galaxy.isOwnRow({ own: false, playerId: 77 }, { id: 77 }) };
    });
    assert.match(g.url, /\?page=overview&cp=254104$/, 'galaxy views cost deuterium: switch on the overview');
    assert.deepEqual([g.ownFlag, g.byName, g.other, g.byMe], [true, true, false, true]);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('fleet.gz.state step 2: fleetPoints and the ships of step 1 (same token); fillCargo reset', async () => {
  const env = await G.launch();
  try {
    const s1 = await env.openSaved('fleetStep1');
    const a = await env.evalOgx(s1, () => { const st = OGX.fleet.gz.state(); return { token: st.token, ships: st.ships }; });
    assert.deepEqual(a.ships, { 208: 1 }, 'real fleetStep1: one colony ship');
    const s2 = await env.openSaved('fleetStep2');
    const b = await env.evalOgx(s2, () => {
      const st = OGX.fleet.gz.state();
      return { token: st.token, fleetPoints: st.fleetPoints, ships: st.ships, src: st.shipsSrc, calc: OGX.calc.expeditionPoints(st.ships) };
    });
    assert.equal(b.token, a.token, 'both steps carry the same token');
    // real fleetStep2.html "Fleet points: 150" = 30 000 M+C x 5 / 1000
    assert.deepEqual([b.fleetPoints, b.ships, b.src, b.calc], [150, { 208: 1 }, 'fleetStep1', 150]);
    const c = await env.evalOgx(s2, () => {
      const G2 = OGX.fleet.gz;
      G2.fillCargo({ metal: 5000 }, { clamp: false });
      const r = G2.fillCargo({ crystal: 100 }, { reset: true });
      return { ok: r.ok, cargo: r.cargo };
    });
    assert.deepEqual(c, { ok: true, cargo: { metal: 0, crystal: 100, deuterium: 0 } });
    // a step 2 whose token step 1 never showed: no ships
    const d = await env.evalOgx(s2, () => { localStorage.removeItem('ogx:gzFleetShips'); const st = OGX.fleet.gz.state(); return [st.ships, st.shipsSrc, st.fleetPoints]; });
    assert.deepEqual(d, [{}, null, 150]);
    assert.deepEqual(env.server.requests.filter((x) => x.method === 'POST').map((x) => x.url), [], 'nothing submitted');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('messages: espionageFull carries the report simulator link (im[] raw floats)', async () => {
  const env = await G.launch();
  try {
    const page = await env.openSaved('messages-spy');
    const r = await env.evalOgx(page, () => {
      const row = document.querySelector('tr.message_head');
      const f = OGX.messages.parse.espionageFull(row);
      return { id: f.id, sim: f.simHref };
    });
    // real messages-spy.html, first report (2:81:10): the Simulate link of the footer
    assert.match(r.sim, /page=battleSimulator&im\[901\]=2684939750000&im\[902\]=1700557697522\.1&im\[903\]=675144412229\.63&im\[911\]=356568/);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

