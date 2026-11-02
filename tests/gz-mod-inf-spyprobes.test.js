'use strict';
// Probes per spy on GALAXYZ (ogamex.eu/Aeternum) through the GALAXYZ mock (tests/gz-server.js).
// Facts [UPSTREAM 2Moons ShowFleetAjaxPage / ShowSettingsPage]: every one-click spy is GET page=fleetAjax&mission=6&planetID and the
// server sends min(account spycount, probes on the planet); shipCount is ignored. spycount is a field of page=settings.
//  - setting spy.probes (default 1100) is what the add-on wants; it is passed as shipCount;
//  - page=settings (DERIVED: REAL overview chrome + a settings_default.tpl-shaped form, gz-server settingsForm) opened by the user
//    -> spycount stored (server scope 'gz.spycount'), journal 'spy' 'spycount:mismatch', a warning in the spy tab; never posted;
//  - «Проверить» in the spy tab: one read-only GET page=settings on the click only;
//  - a mini-fleet spy answering fewer probes than wanted -> journal 'spy' 'probes:short' every time, one toast per session;
//    probes left on the planet prove the account setting: spycount learned from the answer.
//   node tests/gz-mod-inf-spyprobes.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

const OFF = { 'mail.enabled': false, 'missiles.enabled': false, 'targets.enabled': false, 'stalk.enabled': false };
const WARN_1 = 'В настройках игры стоит 1 зонд на шпионаж, а нужно 1100 — один клик шпионажа отправит 1';
const gameReqs = (env) => env.server.requests.filter((r) => r.page != null).map((r) => r.method + ' ' + r.url.replace(/^\/Aeternum\/game\.php/, ''));
const openTab = (env, page, tab) => env.evalOgx(page, async (t) => {
  const sp = OGX.dom.sidePanel('infinity');
  sp.open(); sp.selectTab(t);
  await new Promise((r) => setTimeout(r, 400));
  return !!document.querySelector('.ogx-i-' + t + '-root') || !!document.querySelector('.ogx-i-' + t + '-probes');
}, tab);
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.ogx-toast')].map((t) => t.textContent));

T.test('parse.gz.settingsPage: spycount and the form fields in submit order (unchecked boxes left out)', async () => {
  const env = await G.launch({ settings: OFF });
  try {
    env.server.state.spycount = 7;
    const p = await env.game('settings');
    const r = await env.evalOgx(p, () => OGX.parse.gz.settingsPage(document));
    assert.equal(r.spycount, 7);
    assert.equal(r.form.method, 'post');
    assert.match(r.form.action, /page=settings/);
    const names = r.form.fields.map((f) => f[0]);
    assert.deepEqual(names, ['mode', 'username', 'language', 'timezone', 'planetSort', 'spycount', 'fleetActions', 'galaxySpy']);
    assert.deepEqual(r.form.fields.find((f) => f[0] === 'language'), ['language', 'ru']);
    assert.ok(!names.includes('vacation') && !names.includes('delete'), 'unchecked vacation/delete are not part of the submit');
    assert.equal(await env.evalOgx(p, () => OGX.parse.gz.settingsPage('<div>no form</div>')), null);
  } finally { await env.close(); }
});

T.test('page=settings opened by the user -> spycount stored, journal mismatch, spy tab warning; nothing posted', async () => {
  const env = await G.launch({ settings: OFF });
  try {
    env.server.state.spycount = 1;
    const p = await env.game('settings');
    let stored = null;
    for (let i = 0; i < 30 && !stored; i++) { stored = await env.get('gz.spycount', { scope: 'server' }); if (!stored) await p.waitForTimeout(150); }
    assert.ok(stored, 'spycount stored');
    assert.deepEqual([stored.value, stored.source], [1, 'settings']);
    const ev = await env.evalOgx(p, () => OGX.diag.recent({ k: 'spy' }).map((e) => ({ w: e.w, d: e.d })));
    const mm = ev.find((e) => e.w === 'spycount:mismatch');
    assert.ok(mm, 'journal mismatch: ' + JSON.stringify(ev));
    assert.deepEqual([mm.d.value, mm.d.want], [1, 1100]);
    assert.equal(mm.d.text, WARN_1);
    assert.ok(await openTab(env, p, 'spy'));
    const box = await p.evaluate(() => { const b = document.querySelector('.ogx-i-spy-probes'); return b && { cls: b.className, text: b.textContent }; });
    assert.ok(box && /probes-warn/.test(box.cls), 'warning box: ' + JSON.stringify(box));
    assert.ok(box.text.includes(WARN_1), box.text);
    assert.deepEqual(env.server.find('POST', 'settings'), [], 'the settings form is never posted');

    // the setting changed to match the game -> no warning
    await env.evalOgx(p, () => OGX.settings.set('spy.probes', 1));
    await p.waitForFunction(() => { const b = document.querySelector('.ogx-i-spy-probes'); return b && /probes-ok/.test(b.className); });
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('spy tab: spycount unknown -> hint, no request; «Проверить» = one read-only GET page=settings on the click', async () => {
  const env = await G.launch({ settings: OFF });
  try {
    env.server.state.spycount = 1100;
    const p = await env.game('overview');
    env.server.clearLog();
    assert.ok(await openTab(env, p, 'spy'));
    const box = await p.evaluate(() => { const b = document.querySelector('.ogx-i-spy-probes'); return b && { cls: b.className, text: b.textContent }; });
    assert.ok(box && /probes-unknown/.test(box.cls), JSON.stringify(box));
    assert.match(box.text, /Зондов на шпионаж: 1\s?100/);
    assert.deepEqual(gameReqs(env), [], 'opening the tab sends nothing');
    await p.click('.ogx-i-spy-check-settings');
    await p.waitForFunction(() => { const b = document.querySelector('.ogx-i-spy-probes'); return b && /probes-ok/.test(b.className); });
    const reqs = gameReqs(env);
    assert.deepEqual(reqs, ['GET ?page=settings'], 'exactly one GET: ' + reqs);
    assert.equal((await env.get('gz.spycount', { scope: 'server' })).value, 1100);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mini-fleet spy: fewer probes than spy.probes -> journal every time, one toast per session; spycount learned when probes are left', async () => {
  const env = await G.launch({ settings: OFF });
  try {
    env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({ slots: 3, ships: { 210: 1099 }, code: 600, mess: 'Send 1 Spy Probe to 2:68:2 ...' }));
    const p = await env.game('overview');
    env.server.clearLog();
    const r1 = await env.evalOgx(p, () => OGX.api.sendMiniFleet({ mission: 6, galaxy: 2, system: 68, position: 2, type: 1, planetId: 301140 }));
    assert.equal(r1.success, true);
    assert.equal(r1.shipsSent, 1);
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-toast')].some((t) => /из 1100/.test(t.textContent)));
    const t1 = (await toasts(p)).filter((t) => /из 1100/.test(t));
    assert.equal(t1.length, 1);
    assert.match(t1[0], /Отправлено 1 зонд из 1100: в настройках игры .* стоит 1/);
    const sc = await env.get('gz.spycount', { scope: 'server' });
    assert.deepEqual([sc.value, sc.source], [1, 'fleetAjax'], 'probes left on the planet: the account setting limited the send');
    // second spy: journal again, no second toast
    await env.evalOgx(p, () => OGX.api.sendMiniFleet({ mission: 6, galaxy: 2, system: 68, position: 2, type: 1, planetId: 301140 }));
    await p.waitForTimeout(400);
    assert.equal((await toasts(p)).filter((t) => /из 1100/.test(t)).length, 1, 'one toast per session');
    const short = await env.evalOgx(p, () => OGX.diag.recent({ k: 'spy' }).filter((e) => e.w === 'probes:short').map((e) => e.d));
    assert.equal(short.length, 2);
    assert.deepEqual([short[0].sent, short[0].want, short[0].why], [1, 1100, 'setting']);
    // the planet ran out (no probes left): reason 'planet', spycount not overwritten
    env.server.route('GET', 'fleetAjax', (req, res, ctx) => ctx.json({ slots: 2, ships: { 210: 0 }, code: 600, mess: 'Send 5 Spy Probe to 2:68:2 ...' }));
    const cr = await env.evalOgx(p, () => OGX.api.checkSpySent({ success: true, shipsSent: 5, shipsLeft: { 210: 0 } }));
    assert.deepEqual([cr.why, cr.toast], ['planet', false]);
    assert.equal((await env.get('gz.spycount', { scope: 'server' })).value, 1);
    // enough probes / recycle mission -> no check
    assert.equal(await env.evalOgx(p, () => OGX.api.checkSpySent({ success: true, shipsSent: 1100, shipsLeft: { 210: 5 } })), null);
    const fa = env.server.find('GET', 'fleetAjax');
    assert.equal(fa.length, 2);
    assert.deepEqual(fa.map((r) => r.query.mission), ['6', '6']);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});
