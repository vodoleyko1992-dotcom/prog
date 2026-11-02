'use strict';
// Core on the REAL saved GALAXYZ pages of ogamex.eu/Aeternum (fixtures/galaxyz/pages) through the GALAXYZ mock
// (tests/gz-server.js) and the harness (tests/gz-lib.js): the suite extension with every module loads on every page,
// detects GALAXYZ, routes to the right PageName, parses the header resources exactly as the page source says, and
// throws nothing. Also: the mock's own endpoints (fleetStep1/2/3, details AJAX, recall, messages) and the core's http
// calls against them, non-game pages, inject mode.
//   node tests/gz-core.test.js
//   OGX_TEST_FILTER=inject node tests/gz-core.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;
const fs = require('fs');
const path = require('path');
const { startGzServer, pageNames, readAccount, PAGES: PAGE_DIR } = require('./gz-server');

const PAGES = pageNames();
const ACCOUNT = readAccount();
const savedHtml = (name) => fs.readFileSync(path.join(PAGE_DIR, name + '.html'), 'utf8');

/** Header values straight from the page source (resourceTicker config, #current_darkmatter, the energy cell's t="free / produced"). */
function expectedHeader(html) {
  const out = {};
  const re = /resourceTicker\(\{\s*available:\s*\(?(-?[\d.eE+]+)\)?,\s*limit:\s*\[0,\s*"?(\d+)"?\],\s*production:\s*(-?[\d.eE+]+),\s*valueElem:\s*"current_(\w+)"/g;
  let m;
  while ((m = re.exec(html))) out[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
  const dm = /id="current_darkmatter" data-real="(\d+)"/.exec(html);
  out.darkmatter = dm ? +dm[1] : null;
  const en = /class="res_current[^"]*Imperium[^"]*" t="([\d.]+)\s*\/\s*([\d.]+)"/.exec(html);
  out.energy = en ? { available: +en[1].replace(/\./g, ''), production: +en[2].replace(/\./g, '') } : null;
  return out;
}

async function fetchText(srv, path, init) {
  const r = await fetch(srv.origin + path, Object.assign({ redirect: 'manual' }, init));
  return { status: r.status, location: r.headers.get('location'), type: r.headers.get('content-type'), text: await r.text() };
}
const post = (srv, path, body) => fetchText(srv, path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

T.test('gz-server: real pages, assets and endpoints', async () => {
  const srv = await startGzServer();
  try {
    assert.ok(PAGES.length >= 20, 'saved pages: ' + PAGES.length);
    assert.equal(ACCOUNT.player, 'vodoleyko1992');
    assert.deepEqual(ACCOUNT.bodies.map((b) => b.id), [254102, 254103, 254104, 254105]);
    for (const name of PAGES) {
      const r = await fetchText(srv, srv.pathFor(name));
      assert.equal(r.status, 200, name);
      assert.match(r.text, /<meta name="generator" content="GALAXYZ 1\.8\.git">/, name);
      assert.ok(!r.text.includes('https://ogamex.eu'), name + ': live origin rewritten');
      assert.ok(!/http-equiv="refresh"/.test(r.text), name + ': no refresh');
    }
    assert.deepEqual(srv.unhandled, []);
    // cp is recorded and sticky
    await fetchText(srv, srv.gamePath({ page: 'overview', cp: 254103 }));
    assert.equal(srv.state.cp, 254103);
    assert.equal(srv.find('GET', 'overview').slice(-1)[0].cp, 254103);

    // assets: live JS, upstream JS, stubs, gif fallback
    const jq = await fetchText(srv, '/Aeternum/1_files/jquery.js');
    assert.ok(jq.text.length > 200000 && /javascript/.test(jq.type));
    assert.match((await fetchText(srv, '/Aeternum/whatever_files/flotten.js')).text, /function/);       // [UPSTREAM]
    assert.match((await fetchText(srv, '/Aeternum/scripts/game/notify.js')).text, /not captured/);
    assert.equal((await fetchText(srv, '/Aeternum/styles/images/atm.gif')).status, 200);
    assert.equal(srv.find(null, /notify\.js/).length, 0, 'assets are not in the request log');

    // details AJAX: JSON text {target, content}
    const det = await fetchText(srv, srv.gamePath({ page: 'TechnologyDetailsAjax', technology: 1 }));
    const dj = JSON.parse(det.text);
    assert.equal(dj.target, 'technologydetails');
    assert.match(dj.content[dj.target], /data-tech="1"/);
    // build orders: redirect like upstream, recorded; error -> info page
    const b = await post(srv, srv.gamePath('buildings'), { cmd: 'insert', building: 1 });
    assert.equal(b.status, 302);
    assert.match(b.location, /\/Aeternum\/game\.php\?page=buildings$/);
    const s = await post(srv, srv.gamePath({ page: 'shipyard', mode: 'defense' }), { 'fmenge[401]': 5 });
    assert.equal(s.status, 200);
    assert.match(s.text, /var queryString\s*=\s*"page=shipyard&mode=defense"/);
    assert.deepEqual(srv.state.builds.map((x) => [x.page, x.cmd, x.id, x.amount]), [['buildings', 'insert', 1, 1], ['shipyard', 'insert', 401, 5]]);
    srv.state.buildError = 'You need Admiral officier at level 10!!';
    const be = await post(srv, srv.gamePath('research'), { cmd: 'insert', tech: 106 });
    assert.match(be.text, /<div class="mainRS">\s*<table class="table519">[^]*You need Admiral/);
    srv.state.buildError = null;

    // fleet: checkTarget, 3 steps with a session token, recall
    assert.equal(JSON.parse((await fetchText(srv, srv.gamePath({ page: 'fleetStep1', mode: 'checkTarget', galaxy: 2, system: 68, planet: 9, planet_type: 1 }))).text), 'OK');
    const noShips = await post(srv, srv.gamePath('fleetStep1'), { galaxy: 2, system: 68, planet: 9, type: 1 });
    assert.equal(noShips.status, 302);
    const s1 = await post(srv, srv.gamePath('fleetStep1'), { galaxy: 2, system: 70, planet: 9, type: 1, target_mission: 0, ship208: 1 });
    const token = (/name="token" value="([0-9a-f]{32})"/.exec(s1.text) || [])[1];
    assert.equal(token, srv.state.token);
    assert.match(s1.text, /id="system" name="system"[^>]*value="70"/);
    srv.state.missions = [3, 4, 7];
    const s2 = await post(srv, srv.gamePath('fleetStep2'), { token, fleet_group: 0, target_mission: 0, galaxy: 2, system: 70, planet: 9, type: 1, speed: 10 });
    assert.deepEqual([...s2.text.matchAll(/name="mission" value="(\d+)"/g)].map((m) => +m[1]), [3, 4, 7]);
    const bad = await post(srv, srv.gamePath('fleetStep3'), { token: 'x', mission: 7 });
    assert.equal(bad.status, 302);
    const s3 = await post(srv, srv.gamePath('fleetStep3'), { token, mission: 7, metal: 10, crystal: 0, deuterium: 0 });
    assert.match(s3.text, /Fleet sent/);
    assert.deepEqual(srv.state.sent.map((x) => [x.mission, x.ships, x.target]), [[7, { 208: 1 }, { galaxy: 2, system: 70, planet: 9, type: 1 }]]);
    assert.equal(srv.state.token, null, 'token used up');
    const ft = await fetchText(srv, srv.gamePath('fleetTable'));
    assert.match(ft.text, /name="fleetID" value="396900"/);
    const rc = await post(srv, srv.gamePath({ page: 'fleetTable', action: 'sendfleetback' }), { fleetID: 396900 });
    assert.ok(!/name="fleetID" value="396900"/.test(rc.text), 'recall form gone');
    assert.deepEqual(srv.state.recalled, [396900]);
    const fa = JSON.parse((await fetchText(srv, srv.gamePath({ page: 'fleetAjax', ajax: 1, mission: 6, planetID: 1 }))).text);
    assert.equal(fa.code, 600);

    // messages: AJAX fragments (0/100 cut from the real pages, others upstream)
    const m0 = await fetchText(srv, srv.gamePath({ page: 'messages', mode: 'view', messcat: 0, site: 1, ajax: 1 }));
    assert.match(m0.text, /^<form[^]*id="messagestable"[^]*spyRaport[^]*<\/form>$/);
    const m3 = await fetchText(srv, srv.gamePath({ page: 'messages', mode: 'view', messcat: 3, site: 1, ajax: 1 }));
    assert.match(m3.text, /messagestable/);
    assert.equal((await post(srv, srv.gamePath('messages'), { mode: 'action', ajax: 1, messcat: 0, side: 1, 'messageID[1]': 1, actionTop: 'deletemarked' })).status, 302);

    // not game pages / unknown
    assert.doesNotMatch((await fetchText(srv, '/Aeternum/index.php')).text, /generator/);
    assert.equal((await fetchText(srv, srv.gamePath('nosuchpage'))).status, 404);
    assert.equal(srv.unhandled.length, 1);
    srv.reset();
    assert.equal(srv.requests.length, 0);
    assert.equal(srv.state.sent.length, 0);
  } finally {
    await srv.close();
  }
});

T.test('gz core: every real page is detected, routed and parsed (all modules, no errors)', async (t) => {
  const env = await G.launch();
  t.log('mode', env.mode, 'host', env.host);
  const failures = [];
  for (const name of PAGES) {
    const exp = G.EXPECTED_ROUTES[name];
    assert.ok(exp, 'no expected route for ' + name);
    env.clearLogs();
    const page = await env.openSaved(name, { readyTimeout: 15000 });
    const got = await env.evalOgx(page, () => {
      const det = OGX.page.detect(document, location);
      const info = OGX.page.info();
      const s = OGX.state.snapshot() || OGX.state.snapshotSync(document);
      const r = s.inline || {};
      const pick = (k) => (r[k] ? { amount: r[k].amount, storage: r[k].storage, perHour: r[k].perHour } : null);
      return {
        det: { ok: det.ok, engine: det.engine, version: det.version },
        engine: OGX.page.engine,
        info: { name: info.name, aliases: info.aliases, step: info.step, mode: info.mode, universe: info.universe },
        res: { metal: pick('metal'), crystal: pick('crystal'), deuterium: pick('deuterium'), darkmatter: r.darkmatter ?? null },
        energy: s.tooltips && s.tooltips.energy ? { available: s.tooltips.energy.available, production: s.tooltips.energy.production } : null,
        player: s.player && s.player.name,
        current: s.current && s.current.planetId,
        errors: (OGX.errors || []).map((e) => e.where + ': ' + e.message),
        ns: OGX.storage.ns && OGX.storage.ns.host + '|' + OGX.storage.ns.playerId,
      };
    });
    const check = (label, fn) => { try { fn(); } catch (e) { failures.push(`${name}: ${label}: got ${JSON.stringify(e.actual)}, want ${JSON.stringify(e.expected)}`); } };
    check('detect', () => assert.deepEqual(got.det, { ok: true, engine: 'galaxyz', version: '1.8.git' }));
    check('engine', () => assert.equal(got.engine, 'galaxyz'));
    check('route', () => assert.equal(got.info.name, exp.name));
    if (exp.aliases) check('aliases', () => assert.deepEqual(got.info.aliases, exp.aliases));
    if (exp.step) check('step', () => assert.equal(got.info.step, exp.step));
    if (exp.mode) check('mode', () => assert.equal(got.info.mode, exp.mode));
    check('universe', () => assert.equal(got.info.universe, 'Aeternum'));
    const html = savedHtml(name);
    const want = expectedHeader(html);
    for (const k of ['metal', 'crystal', 'deuterium']) check('resources ' + k, () => assert.deepEqual(got.res[k], want[k]));
    check('darkmatter', () => assert.equal(got.res.darkmatter, want.darkmatter));
    check('energy', () => assert.deepEqual(got.energy, want.energy));
    check('player', () => assert.equal(got.player, ACCOUNT.player));
    check('current body', () => assert.ok(ACCOUNT.bodies.some((b) => b.id === got.current), String(got.current)));
    check('storage ns', () => assert.equal(got.ns, env.gzHost + '|' + env.pid));
    check('OGX.errors', () => assert.deepEqual(got.errors, []));
    check('ogx errors', () => assert.deepEqual(env.ogxErrors().map((x) => x.text.slice(0, 200)), []));
    const mark = await page.getAttribute('html', 'data-ogx-suite');
    check('ready mark', () => assert.equal(mark, 'ready'));
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.url), []);
});

T.test('gz core: Russian overview (live snapshot #56): «км» diameter and fields, temperature words, planet-list tooltip, construction boxes', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'galaxyz', 'live', 'overview-ru.html'), 'utf8');
  const r = await env.evalOgx(page, (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ov = OGX.parse.gz.overview(doc);
    const en = OGX.parse.gz.overview(document);
    const pick = (o) => ({ planetName: o.planetName, diameter: o.diameter, fieldsUsed: o.fieldsUsed, fieldsMax: o.fieldsMax, tempMin: o.tempMin, tempMax: o.tempMax, coords: o.coords, points: o.points, rank: o.rank, players: o.players, onlinePlayers: o.onlinePlayers });
    return {
      ov: pick(ov), boxes: ov.constructions.map((b) => [b.title, b.idle, b.restSec]), shipyardBox: ov.constructions[2].box, enBoxes: en.constructions.map((b) => [b.idle, b.restSec]),
      tip: OGX.parse.gz.bodies(doc).list.find((b) => b.id === 254102).tip,
      tips: [OGX.parse.gz.tooltip('32°C до 72°C<br>20.000 км (288 / 405)'), OGX.parse.gz.tooltip('-12°C to 28°C<br>12.750 km (163 / 188)'), OGX.parse.gz.tooltip('Главная планета [2:68:5]')],
      en: [en.diameter, en.fieldsUsed, en.fieldsMax, en.tempMin, en.tempMax],
    };
  }, html);
  assert.deepEqual(r.ov, { planetName: 'Планета', diameter: 18027, fieldsUsed: 112, fieldsMax: 325, tempMin: -39, tempMax: 1, coords: '2:68:11', points: 426961, rank: 107, players: 547, onlinePlayers: 6 });
  assert.deepEqual(r.boxes, [['Постройки', false, 1], ['Исследования', false, 2819], ['Верфь', true, null]], 'remaining seconds from #progressbar / #progressbars data-time');
  assert.deepEqual(r.enBoxes, [[true, null], [true, null], [true, null]]);
  assert.equal(r.shipyardBox, 'shipyard');
  const tip = { tempMin: 32, tempMax: 72, diameter: 20000, fieldsUsed: 288, fieldsMax: 405 };
  assert.deepEqual(r.tip, tip, 'planet-list title «20.000 км (288 / 405)»');
  assert.deepEqual(r.tips, [tip, { tempMin: -12, tempMax: 28, diameter: 12750, fieldsUsed: 163, fieldsMax: 188 }, null]);
  assert.deepEqual(r.en, [20000, 259, 405, 32, 72], 'the English page reads the same as before');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('gz core: non-game pages stay untouched', async () => {
  const env = await G.launch();
  for (const p of ['/other', '/Aeternum/index.php']) {
    const page = await env.open(p, { waitReady: false });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false, p);
    assert.equal(await page.$$eval('[class*="ogx-"],[id^="ogx-"]', (e) => e.length), 0, p);
  }
  // a game page under another host name works too (identity follows location.host)
  const page = await env.open(env.urlOn('ogamex.test', '/Aeternum/game.php?page=overview'));
  assert.equal(await page.getAttribute('html', 'data-ogx-suite'), 'ready');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('gz core: http calls against the mock (details, checkTarget, 3-step send, recall)', async () => {
  const env = await G.launch();
  const page = await env.game('fleetTable');
  const r = await env.evalOgx(page, async () => {
    const out = {};
    const d = await OGX.api.techDetails(1);
    out.details = { id: d.id, hasHtml: !!d.html, error: d.error || null };
    out.check = await OGX.api.checkTarget({ galaxy: 2, system: 68, position: 9, type: 1 });
    out.send = await OGX.api.sendFleet({ galaxy: 2, system: 68, position: 9, type: 1, mission: 7, speed: 10, ships: { 208: 1 }, cargo: { metal: 5 } });
    out.recall = await OGX.api.recall(396900);
    return JSON.parse(JSON.stringify(out));
  });
  assert.equal(r.details.id, 1);
  assert.equal(r.details.hasHtml, true);
  assert.deepEqual(r.check, { ok: true, message: '' });
  assert.equal(r.send.success, true, JSON.stringify(r.send));
  assert.equal(r.send.step, 3);
  assert.deepEqual(r.recall.success, true);
  const st = env.server.state;
  assert.deepEqual(st.sent.map((x) => [x.mission, x.ships, x.cargo.metal]), [[7, { 208: 1 }, 5]]);
  assert.deepEqual(env.requests('POST').map((x) => x.route), ['page=fleetStep1', 'page=fleetStep2', 'page=fleetStep3', 'page=fleetTable']);
  assert.ok(env.requests('GET', 'TechnologyDetailsAjax').length === 1);
  assert.deepEqual(env.server.unhandled.map((x) => x.url), []);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('gz core: inject mode loads the suite on GALAXYZ too', async () => {
  const env = await G.launch({ mode: 'inject' });
  assert.equal(env.mode, 'inject');
  const page = await env.game('overview');
  const got = await env.evalOgx(page, () => ({ engine: OGX.page.engine, name: OGX.page.info().name, metal: OGX.state.snapshot().inline.metal.amount }));
  assert.deepEqual(got, { engine: 'galaxyz', name: 'overview', metal: expectedHeader(savedHtml('overview')).metal.amount });
  await env.setStorage({ [env.key('probe')]: 1 });
  assert.equal(await env.get('probe'), 1);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('gz core: a background request waits at most hiddenTimeoutMs while the tab is hidden; a direct flights.get never joins it (core-fleet-11)', async () => {
  const env = await G.launch();
  const page = await env.game('overview');
  await page.waitForTimeout(500);
  env.server.clearLog();
  const r = await env.evalOgx(page, async () => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    const t0 = Date.now();
    const bg = OGX.http.get('overview', { background: true, hiddenTimeoutMs: 800 });
    const fbg = OGX.flights.get({ force: true, background: true });   // default 60 s: still waiting below
    const direct = await OGX.flights.get({ force: true });             // direct: its own request now
    const tDirect = Date.now() - t0;
    const res = await bg;
    const tBg = Date.now() - t0;
    const queued = OGX.http.queueLength();
    // a runtime that paces its own requests may let the queue run hidden
    OGX.http.allowHidden(true);
    const f = await fbg;
    OGX.http.allowHidden(false);
    delete document.hidden;
    return { direct: Array.isArray(direct.flights), tDirect, res: { ok: res.ok, error: res.error }, tBg, queued, fbg: Array.isArray(f.flights) };
  });
  assert.equal(r.direct, true);
  assert.ok(r.tDirect < 3000, 'direct get does not wait for the hidden queue: ' + r.tDirect);
  assert.deepEqual(r.res, { ok: false, error: 'hidden' });
  assert.ok(r.tBg >= 750 && r.tBg < 3000, 'timed out after ~0.8 s: ' + r.tBg);
  assert.equal(r.queued, 1, 'the background flights fetch still waits');
  assert.equal(r.fbg, true, 'allowHidden lets it run');
  assert.equal(env.requests('GET', 'overview').length, 0, 'the timed-out request never reached the server');
  assert.deepEqual(env.ogxErrors(), []);
});
