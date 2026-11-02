'use strict';
// Infinity module «missiles» (interplanetary missiles against defence) on GALAXYZ (ogamex.eu/Aeternum) through the GALAXYZ mock.
//  - math: OGX.missiles.math.impact == the UPSTREAM 2Moons calculateMIPAttack + MissionCaseMIP interceptor branch, run by PHP
//    (specs/galaxyz/tools/missiles/mip_cases.php -> mip_cases.json); plan(): needAll is the smallest count that clears all.
//  - REAL messages-spy: the two real reports (no defence revealed) get a badge «оборона не раскрыта», nothing is requested.
//  - UPSTREAM spy rows (specs/galaxyz/fixtures/messages-upstream-view-cat0.html, Kovacs Prime [2:70:4] with defence, interceptors
//    and research) inserted into the real page like the game's category AJAX: badge with the PHP-derived count.
//  - Launch: calculator from the badge; «Отмена» in the confirmation -> no request; «Запустить» -> exactly one
//    POST page=fleetMissile (galaxy, system, planet, type, SendMI, Target) with cp of the source planet; result stored.
//  - Galaxy (derived foreign system 2:68): 🚀 only on foreign rows, no request.
//   node tests/gz-mod-inf-missiles.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G0 = require('./gz-lib');
// The «mail» module replaces the native messages page; the badge tests check the native reports, so it is kept off here
// (with mail on, the same plan is shown in mail's «МПР» column via OGX.missiles.plan).
const G = Object.assign({}, G0, { launch: (o = {}) => G0.launch(Object.assign({}, o, { settings: Object.assign({ 'mail.replace': false }, o.settings || {}) })) });
const { assert } = T;

const ROOT = path.join(__dirname, '..');
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs/galaxyz/tools/missiles/mip_cases.json'), 'utf8'));
const UPSTREAM_SPY = fs.readFileSync(path.join(ROOT, 'specs/galaxyz/fixtures/messages-upstream-view-cat0.html'), 'utf8');
const SYNTH_GALAXY = fs.readFileSync(path.join(ROOT, 'specs/galaxyz/fixtures/galaxy-live-synthetic-system.html'), 'utf8');

// Kovacs Prime [2:70:4] of the upstream fixture: im[] of its Simulate link (defence + research)
const KOVACS = { 401: 1500, 402: 900, 403: 120, 404: 12, 407: 1, 408: 1, 502: 20, weapons: 14, shield: 13 };
// PHP case 2/3 use exactly these units: needAll is checked against PHP below (71 with weapons 14 / shield 13)
const PHP_NEED = 71;

const NOW = Date.now();
const SEED = {
  '{ns}|research': { levels: { 109: 14, 110: 10, 111: 10, 117: 9 }, t: NOW, queue: null },
  '{ns}|bodies': {
    p254102: { key: 'p254102', id: 254102, type: 'planet', planetId: 254102, name: 'Главная планета', coords: '2:68:5', levels: { 44: 6 }, levelsT: {},
      ships: {}, shipsT: null, defense: { 503: 100 }, defenseT: NOW, percents: {}, queues: { building: null, unit: null, t: null }, order: 0 },
  },
};

const upstreamRowsInto = (page, html) => page.evaluate((src) => {
  const d = new DOMParser().parseFromString(src, 'text/html');
  const tb = document.querySelector('#messagestable tbody') || document.querySelector('#messagestable');
  const first = tb.querySelector('tr.message_head');
  for (const tr of [...d.querySelectorAll('#messagestable tr.message_head, #messagestable tr.messages_body, tr.message_head, tr.messages_body')]) {
    if (document.getElementById(tr.id) && tr.id) continue;
    tb.insertBefore(document.importNode(tr, true), first);
  }
  return tb.querySelectorAll('tr.message_head').length;
}, html);
const answerModal = (page, yes) => page.evaluate((ok) => {
  const ov = [...document.querySelectorAll('.ogx-modal-overlay')].pop();
  const b = ov && [...ov.querySelectorAll('.ogx-modal-buttons button')].find((x) => (ok ? x.dataset.role === 'ok' : x.dataset.role === 'cancel'));
  if (!b) return null;
  const text = ov.textContent;
  b.click();
  return text;
}, yes);
/** Storage value once it is there (writes are flushed asynchronously). */
async function stored(env, key, pred = (v) => v !== undefined && v !== null, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    const v = await env.get(key);
    if (pred(v) || Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}
const OUT = path.join(__dirname, 'out');
const shot = async (page, name) => { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'gz-missiles-' + name + '.png') }); };
const nonPage = (env) => env.server.requests.filter((x) => !(x.method === 'GET' && ['messages', 'galaxy'].includes(x.page)));

T.test('math: impact() equals the upstream 2Moons calculateMIPAttack (PHP) on every case; plan() is the smallest full clear', async () => {
  const env = await G.launch();
  try {
    const p = await env.game('overview');
    const got = await env.evalOgx(p, (cases) => cases.map(({ case: c }) => {
      const M = OGX.missiles.math;
      const base = { abm: c.def[502] || 0, defense: c.def, primary: c.target, weapons: c.weapons, defTech: c.shield };
      const r = M.impact(Object.assign({ missiles: c.n }, base));
      const pl = M.plan(base);
      return { r, need: pl.needAll, at: M.impact(Object.assign({ missiles: pl.needAll }, base)).all, below: pl.needAll > 0 && M.impact(Object.assign({ missiles: pl.needAll - 1 }, base)).all };
    }), CASES);
    CASES.forEach(({ case: c, php }, i) => {
      const want = Object.fromEntries(Object.entries(php.destroyed).filter(([, v]) => v > 0).map(([k, v]) => [k, v]));
      assert.deepEqual(got[i].r.destroyed, want, 'destroyed, case ' + i + ' ' + JSON.stringify(c));
      assert.equal(got[i].r.intercepted, php.intercepted, 'intercepted, case ' + i);
      assert.equal(got[i].r.abmLeft, php.abmLeft, 'interceptors left, case ' + i);
      assert.equal(got[i].at, true, 'needAll clears everything, case ' + i + ' need ' + got[i].need + ' ' + JSON.stringify(got[i].r));
      assert.equal(got[i].below, false, 'needAll - 1 does not, case ' + i);
    });
    assert.equal(got[1].need, PHP_NEED);
    const misc = await env.evalOgx(p, () => {
      const M = OGX.missiles.math;
      return { range9: M.missileRange(9), range0: M.missileRange(0), f: M.flightSecs(68, 70, 7), f0: M.flightSecs(68, 68, 7),
        ok: M.launchResult('<b>71</b> Missles Deployed. Targeted: All defenses'), ru: M.launchResult('71 межпланетных ракет запущено. Главная цель: Всё'),
        err: M.launchResult('Silo Level 4 Required! ') };
    });
    assert.equal(misc.range9, 44);
    assert.equal(misc.range0, 0);
    assert.equal(misc.f, Math.round((30 + 120) / 7), 'GetMIPDuration 2 systems at fleet speed x7');
    assert.equal(misc.f0, 5, 'MIN_FLEET_TIME');
    assert.equal(misc.ok.ok, true); assert.equal(misc.ok.count, 71);
    assert.equal(misc.ru.ok, true); assert.equal(misc.ru.count, 71);
    assert.equal(misc.err.ok, false);
  } finally { await env.close(); }
});

T.test('REAL messages-spy: badge in each report body, defence not revealed, nothing requested', async () => {
  const env = await G.launch({ storage: SEED });
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-mip-badge');
    await p.waitForTimeout(500);
    const b = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-mip-badge')].map((x) => ({ inBody: !!x.closest('tr.messages_body > td'), text: x.textContent })));
    assert.equal(b.length, 2);
    for (const x of b) { assert.ok(x.inBody, 'badge inside the body cell'); assert.match(x.text, /оборона не раскрыта/); }
    const rs = (await stored(env, 'missiles.reports', (v) => v && Object.keys(v.items).length >= 2)).items;
    assert.equal(Object.keys(rs).length, 2);
    assert.deepEqual(nonPage(env).map((x) => x.method + ' ' + x.url), [], 'no request');
  } finally { await env.close(); }
});

T.test('UPSTREAM report with defence: badge count = PHP; calculator; cancel = no request; confirm = one POST fleetMissile', async () => {
  const env = await G.launch({ storage: SEED });
  try {
    env.server.route('POST', 'fleetMissile', (req, res, ctx) => ctx.info('<b>' + ctx.form.SendMI + '</b> Missles Deployed. Targeted: All defenses'));
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-mip-badge');
    await upstreamRowsInto(p, UPSTREAM_SPY);
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-i-mip-badge')].some((x) => /Снос обороны/.test(x.textContent)), null, { timeout: 5000 });
    // shield tech 13 is in the report (research revealed): needAll with weapons 14 / shield 13 = PHP case
    const badge = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-mip-badge')].map((x) => x.textContent).find((t) => /Снос обороны/.test(t)));
    assert.match(badge, new RegExp('Снос обороны: ' + PHP_NEED + ' МПР'));
    assert.match(badge, /перехв\. 20/);
    assert.match(badge, /щит 13/);
    // public API for other modules (mail): plan(parse.espionageFull row).need
    const api = await env.evalOgx(p, () => {
      const tr = [...document.querySelectorAll('tr.message_head')].find((x) => x.nextElementSibling && /Kovacs Prime/.test(x.nextElementSibling.textContent));
      const f = OGX.messages.parse.espionageFull(tr);
      return { need: OGX.missiles.plan(f).need, open: typeof OGX.missiles.openLaunch };
    });
    assert.equal(api.need, PHP_NEED);
    assert.equal(api.open, 'function');

    await p.evaluate(() => [...document.querySelectorAll('.ogx-i-mip-badge')].find((x) => /Снос обороны/.test(x.textContent)).scrollIntoView({ block: 'center' }));
    await shot(p, 'badge');
    // open the calculator from that badge
    await p.evaluate(() => [...document.querySelectorAll('.ogx-i-mip-badge')].find((x) => /Снос обороны/.test(x.textContent)).querySelector('button').click());
    await p.waitForSelector('.ogx-i-mip-calc');
    await shot(p, 'calc');
    const calc = await p.evaluate(() => document.querySelector('.ogx-i-mip-calc').textContent);
    assert.match(calc, /\[2:70:4\]/);
    assert.match(calc, new RegExp('Снести всю оборону: ' + PHP_NEED + ' МПР'));
    assert.match(calc, /сбито 20, долетит 51, оборона снесена полностью/);
    assert.match(calc, /Главная планета \[2:68:5\]: 100 МПР; полёт/);
    const btn = await p.evaluate(() => { const b = document.querySelector('.ogx-i-mip-launch'); return { d: b.disabled, t: b.textContent }; });
    assert.equal(btn.d, false);
    assert.equal(btn.t, 'Запустить ' + PHP_NEED + ' МПР');

    // cancel -> nothing
    await p.click('.ogx-i-mip-launch');
    await p.waitForFunction(() => document.querySelectorAll('.ogx-modal-overlay').length >= 2);
    const ask = await answerModal(p, false);
    assert.match(ask, /Запустить 71 межпланетных ракет с «Главная планета» \[2:68:5\] на планета \[2:70:4\]/);
    assert.match(ask, /отменить запуск нельзя/);
    await p.waitForTimeout(400);
    assert.equal(env.server.find('POST', 'fleetMissile').length, 0, 'cancelled: no launch');

    // confirm -> exactly one POST
    await p.click('.ogx-i-mip-launch');
    await p.waitForFunction(() => document.querySelectorAll('.ogx-modal-overlay').length >= 2);
    await answerModal(p, true);
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-toast')].some((t) => /Запущено/.test(t.textContent)), null, { timeout: 8000 });
    const posts = env.server.find('POST', 'fleetMissile');
    assert.equal(posts.length, 1, 'one launch');
    assert.deepEqual(Object.assign({}, posts[0].form), { galaxy: '2', system: '70', planet: '4', type: '1', SendMI: String(PHP_NEED), Target: '0' });
    assert.equal(posts[0].cp, 254102, 'from the source planet');
    const launches = (await stored(env, 'missiles.launches')).items;
    assert.equal(launches.length, 1);
    assert.equal(launches[0].ok, true);
    assert.equal(launches[0].count, PHP_NEED);
    const rep = (await stored(env, 'missiles.reports', (v) => v && v.items['2:70:4:1'] && v.items['2:70:4:1'].predicted)).items['2:70:4:1'];
    assert.ok(rep.predicted, 'prediction after the strike stored');
    assert.equal(rep.predicted.abm, 0);
    assert.ok(Object.values(rep.predicted.defense).every((n) => !n), 'all destroyed by prediction');
    // other requests: only the planet restore (withPlanet) besides the launch
    const others = nonPage(env).filter((x) => !(x.method === 'POST' && x.page === 'fleetMissile') && !(x.method === 'GET' && x.page === 'overview'));
    assert.deepEqual(others.map((x) => x.method + ' ' + x.url), []);
  } finally { await env.close(); }
});

T.test('launch refused by the server: error toast, nothing predicted', async () => {
  const env = await G.launch({ storage: SEED });
  try {
    env.server.route('POST', 'fleetMissile', (req, res, ctx) => ctx.info('Silo Level 4 Required! '));
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-mip-badge');
    await upstreamRowsInto(p, UPSTREAM_SPY);
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-i-mip-badge')].some((x) => /Снос обороны/.test(x.textContent)), null, { timeout: 5000 });
    await p.evaluate(() => [...document.querySelectorAll('.ogx-i-mip-badge')].find((x) => /Снос обороны/.test(x.textContent)).querySelector('button').click());
    await p.waitForSelector('.ogx-i-mip-launch');
    await p.click('.ogx-i-mip-launch');
    await p.waitForFunction(() => document.querySelectorAll('.ogx-modal-overlay').length >= 2);
    await answerModal(p, true);
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-toast')].some((t) => /не запущены: Silo Level 4/.test(t.textContent)), null, { timeout: 8000 });
    const launches = (await stored(env, 'missiles.launches')).items;
    assert.equal(launches[0].ok, false);
    assert.equal(((await env.get('missiles.reports')).items['2:70:4:1'] || {}).predicted, null);
  } finally { await env.close(); }
});

T.test('galaxy (derived foreign system): 🚀 on foreign rows only, calculator opens, no request', async () => {
  const env = await G.launch({ storage: SEED });
  try {
    env.server.route('GET', 'galaxy', (req, res, ctx) => ctx.send(200, ctx.rewrite(SYNTH_GALAXY)));
    const p = await env.game('galaxy');
    await p.waitForSelector('.ogx-i-mip-gx');
    await p.waitForTimeout(400);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#galaxytableHead > tbody > tr.row')].map((tr, i) => ({ pos: i + 1, n: tr.querySelectorAll('.ogx-i-mip-gx').length })));
    const withBtn = rows.filter((r) => r.n > 0).map((r) => r.pos);
    assert.deepEqual(withBtn, [1, 2, 3, 4, 9, 10, 11], 'foreign rows of the derived system');
    for (const own of [5, 6, 7, 8]) assert.equal(rows[own - 1].n, 0, 'no button on own row ' + own);
    await shot(p, 'galaxy');
    await p.evaluate(() => document.querySelector('.ogx-i-mip-gx').click());
    await p.waitForSelector('.ogx-i-mip-calc');
    const t = await p.evaluate(() => document.querySelector('.ogx-i-mip-calc').textContent);
    assert.match(t, /доклада нет/);
    assert.deepEqual(env.server.requests.filter((x) => !(x.method === 'GET' && x.page === 'galaxy')).map((x) => x.method + ' ' + x.url), [], 'no request');
  } finally { await env.close(); }
});


