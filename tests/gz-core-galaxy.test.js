'use strict';
// Core API gaps for the GALAXYZ module port (core-galaxy work list), on the REAL saved pages (tests/gz-server.js mock):
//  M8  galaxy.fetch / galaxy.scan never spend deuterium without userStarted (stoppedBy 'cost'), confirm -> 'cancel'
//  M9  galaxy:system / galaxy:render replay for late subscribers (onSystem/onRender), galaxy.rows(), pageSystem, async ownId
//  M10 GALAXYZ page without a player name: boot refused read-only (no namespace '0'), reason journaled
//  M12 page.url id paths (/alliance/info/ID ...), page.gzRoute().shared for /resources + /facilities, page.urlFor('empire')
//  M18 side panel keeps the focus on tab clicks (Esc still closes), settings box of the journal titled «Журнал событий»
//   node tests/gz-core-galaxy.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

T.test('M9 galaxy page: late subscribers get the last galaxy:system / galaxy:render, rows(), pageSystem, own id from storage', async () => {
  const env = await G.launch();
  // tournament teaches the numeric id of the own player (state.player stores it by name)
  await env.game('tournament');
  const page = await env.game('galaxy');
  const r = await env.evalOgx(page, async () => {
    const got = {};
    const offS = OGX.galaxy.onSystem((ev) => { got.sys = [ev.source, ev.replay === true, ev.system.galaxy, ev.system.system, ev.system.positions.length]; });
    const offR = OGX.galaxy.onRender((ev) => { got.render = [ev.galaxy, ev.system, ev.rows.size, ev.replay === true, ev.rows.get(5) && ev.rows.get(5).tagName]; });
    const noReplay = [];
    const offN = OGX.galaxy.onSystem(() => noReplay.push(1), { replay: false });
    await new Promise((res) => setTimeout(res, 50));
    offS(); offR(); offN();
    const ps = await OGX.galaxy.pageSystem;
    const rows = OGX.galaxy.rows();
    return { got, noReplay: noReplay.length, rows: rows.size, row1: rows.get(1).tagName, last: OGX.galaxy.last().source, lastRender: !!OGX.galaxy.last('render'),
      ownId: await OGX.galaxy._ownId(), psMe: ps && ps.me.playerId, own5: ps && ps.positions.find((p) => p.position === 5).playerId };
  });
  assert.deepEqual(r.got.sys, ['page', true, 2, 68, 4]);
  assert.deepEqual(r.got.render, [2, 68, 15, true, 'TR']);
  assert.equal(r.noReplay, 0, 'replay: false = plain bus.on');
  assert.deepEqual([r.rows, r.row1, r.last, r.lastRender], [15, 'TR', 'page', true]);
  assert.equal(r.ownId, 4377, 'ownId awaits state.player() (the id learned on page=tournament)');
  assert.deepEqual([r.psMe, r.own5], [4377, 4377], 'own rows carry the numeric id');
  // other pages: no rows, pageSystem null
  const ov = await env.game('overview');
  const o = await env.evalOgx(ov, async () => ({ rows: OGX.galaxy.rows().size, ps: await OGX.galaxy.pageSystem, last: OGX.galaxy.last() }));
  assert.deepEqual(o, { rows: 0, ps: null, last: null });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M8 deuterium guard: fetch/scan send nothing without userStarted; confirm cancel; userStarted fetch goes out without cp', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  env.server.clearLog();
  const r = await env.evalOgx(page, async () => {
    const out = {};
    out.costs = OGX.galaxy.viewCostsDeuterium();
    out.fetch = await OGX.galaxy.fetch(2, 70);
    out.fetchBg = await OGX.galaxy.fetch(2, 70, { background: true, userStarted: 'yes' });
    out.scan = await OGX.galaxy.scan([[2, 70], [2, 71]], { delayMs: 0, jitterMs: 0 });
    // confirm: the dialog names the cost; "Отмена" -> cancel, nothing sent
    const p = OGX.galaxy.scan([[2, 70], [2, 71], [2, 72]], { delayMs: 0, jitterMs: 0, userStarted: true, confirm: true });
    await new Promise((res) => setTimeout(res, 100));
    const modal = Array.from(document.querySelectorAll('.ogx-modal')).pop();
    out.text = modal ? modal.textContent : null;
    const cancel = modal && Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Отмена');
    if (cancel) cancel.click();
    out.cancel = await p;
    return out;
  });
  assert.equal(r.costs, true);
  assert.deepEqual([r.fetch.stoppedBy, r.fetch.costsDeuterium, /userStarted/.test(r.fetch.error)], ['cost', true, true]);
  assert.equal(r.fetchBg.stoppedBy, 'cost', 'only userStarted === true counts');
  assert.deepEqual(r.scan, { done: 0, stoppedBy: 'cost' });
  assert.ok(r.text && /3 систем/.test(r.text) && /дейтерий/.test(r.text), 'confirm text: ' + r.text);
  assert.deepEqual(r.cancel, { done: 0, stoppedBy: 'cancel' });
  assert.deepEqual(env.server.find('GET', 'galaxy'), [], 'no galaxy view was requested');
  // a user-started fetch: one GET page=galaxy without cp, parsed + stored, scan event
  const f = await env.evalOgx(page, async () => {
    let ev = null;
    const off = OGX.galaxy.onSystem((e) => { ev = [e.source, e.replay === true]; }, { replay: false });
    const sys = await OGX.galaxy.fetch(2, 68, { background: false, userStarted: true });
    off();
    return { ok: !sys.error, n: sys.positions && sys.positions.length, ev, last: OGX.galaxy.last().source };
  });
  assert.deepEqual(f, { ok: true, n: 4, ev: ['scan', false], last: 'scan' });
  const views = env.server.find('GET', 'galaxy');
  assert.equal(views.length, 1);
  assert.ok(!/[?&]cp=/.test(views[0].url) && /galaxy=2/.test(views[0].url) && /system=68/.test(views[0].url), views[0].url);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('M10 identity: a GALAXYZ page without the player name is refused read-only (no namespace 0), reason journaled', async () => {
  const env = await G.launch();
  env.server.route('GET', 'overview', (req, res, ctx) => ctx.sendPage('overview', (html) => html.replace(/<div id="playerName"[\s\S]*?<\/div>/, '<div id="playerNameGone"></div>')));
  const page = await env.game('overview', { waitReady: false });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ogx-suite') === 'refused', null, { timeout: 10000 });
  const r = await env.evalOgx(page, () => ({ refused: OGX.refused && OGX.refused.reason, ns: OGX.storage.ns || null, modules: OGX._ctxs.length }));
  assert.ok(/player name not found/.test(r.refused), r.refused);
  assert.equal(r.ns, null, 'storage never initialised');
  assert.equal(r.modules, 0);
  await page.waitForTimeout(500);
  const all = await env.storage('suite');
  assert.deepEqual(Object.keys(all).filter((k) => /\|0\|/.test(k)), [], 'nothing under player namespace 0');
  if (env.mode === 'extension') {
    const w = env.worker('suite');
    const reasons = w ? await w.evaluate(async () => { const s = await self.OGXDiagLib.openStore({ name: 'ogx-diag' }); const q = await s.query({}); return q.events.filter((e) => e.k === 'gated').map((e) => e.w + ' ' + e.d.reason); }) : [];
    assert.ok(reasons.some((x) => /no-player/.test(x)), reasons.join('\n'));
  }
  // the same page with the name boots normally, namespace n:<name>
  const ok = await env.game('research');
  assert.equal(await env.evalOgx(ok, () => OGX.storage.ns.playerId), 'n:vodoleyko1992');
});

T.test('M12 page.url on GALAXYZ: id paths, shared /resources + /facilities, urlFor by PageName', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  const r = await env.evalOgx(page, () => {
    const rel = (u) => u.replace(/^https?:\/\/[^/]+/, '');
    return {
      ally: rel(OGX.page.url('/alliance/info/' + 7)),
      apply: rel(OGX.page.url('/alliance/apply/12')),
      player: rel(OGX.page.url('/player/4377')),
      raport: rel(OGX.page.url('/raport/abc123')),
      res: OGX.page.gzRoute('/resources'), fac: OGX.page.gzRoute('/facilities').shared, unknown: OGX.page.gzRoute('/nope'),
      empire: rel(OGX.page.urlFor('empire')), fleet: rel(OGX.page.urlFor('fleet', { galaxy: 2, position: 9 })), none: OGX.page.urlFor('nope'),
      galaxy: rel(OGX.page.url('/galaxy', { galaxy: 2, system: 70, position: 4 })),
    };
  });
  assert.equal(r.ally, '/Aeternum/game.php?page=alliance&mode=info&id=7');
  assert.equal(r.apply, '/Aeternum/game.php?page=alliance&mode=apply&id=12');
  assert.equal(r.player, '/Aeternum/game.php?page=playerCard&id=4377');
  assert.equal(r.raport, '/Aeternum/game.php?page=raport&raport=abc123');
  assert.deepEqual(r.res, { page: 'buildings', query: {}, rename: null, shared: ['/resources', '/facilities'] });
  assert.deepEqual(r.fac, ['/resources', '/facilities']);
  assert.equal(r.unknown, null);
  assert.equal(r.empire, '/Aeternum/game.php?page=imperium');
  assert.equal(r.fleet, '/Aeternum/game.php?page=fleetTable&galaxy=2&planet=9');
  assert.equal(r.none, null);
  assert.equal(r.galaxy, '/Aeternum/game.php?page=galaxy&galaxy=2&system=70&planet=4');
});

T.test('M18 side panel: tab clicks keep the focus in the panel (Esc closes); journal settings titled «Журнал событий»', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  await env.evalOgx(page, () => {
    const p = OGX.dom.sidePanel('cgtest', { title: 'T' });
    p.addTab({ id: 'a', label: 'AAA', render: (c) => { c.textContent = 'a'; } });
    p.addTab({ id: 'b', label: 'BBB', render: (c) => { c.textContent = 'b'; } });
    p.open();
    window.__cgPanel = p;
  });
  await page.click('#ogx-panel-cgtest button.ogx-tab[data-tab="b"]');
  const st = await env.evalOgx(page, () => ({ cur: window.__cgPanel.currentTab(), inPanel: document.getElementById('ogx-panel-cgtest').contains(document.activeElement) }));
  assert.deepEqual(st, { cur: 'b', inPanel: true });
  await page.keyboard.press('Escape');
  assert.equal(await env.evalOgx(page, () => window.__cgPanel.isOpen()), false, 'Esc closes the panel after a tab click');
  const legend = await env.evalOgx(page, () => { const f = OGX.dom.settingsForm(['diag']); const l = f.querySelector('legend'); return l ? l.textContent : null; });
  assert.equal(legend, 'Журнал событий');
  assert.deepEqual(env.ogxErrors(), []);
});

