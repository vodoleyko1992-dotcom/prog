'use strict';
// Bot runtime (ogamex-bot/modules/botcore + botpanel) through the suite extension against the static GALAXYZ mock
// (tests/gz-server.js, the REAL saved pages of ogamex.eu/Aeternum) with per-test srv.route() answers.
// Contract: specs/bot/BOT_CONTRACT.md C2/C3/C5/C6. Test workers are registered from the test through OGX.bot.register
// (module 'botcore', which is active whenever the master switch is on) and enqueue actions with wctx.act().
//   (a) defaults: nothing mutating for 20 s on three pages, panel «Бот выключен»
//   (b) master on (panel «Старт» + confirm) + dry-run: action-dry events with the full request, zero mutating requests
//   (c) dry-run off (panel confirm): fleet.send = GET fleetTable + 3 POSTs with cp, verified; recall; build; cp restore
//   (d) limits -> 'limit'          (e) slots reserve: normal refused, force sent
//   (f) leader election in two tabs, takeover after the leader tab closes, the queued action survives
//   (g) precise send: steps 1-2 early, step 3 at the requested second
//   (h) stop on logout and on a captcha page      (i) backoff after errors, then pause('errors')
//   (i2) error streaks per module; defense passes pause/backoff/limits/start pause; pause('errors') ends by the probe read
//   (j) threat lock from a hostile event in the event box refuses a normal send from that body
//   (k) every test: no [OGX errors, no console errors from the bot
//   (m) a prepared precise send (state pre) is disarmed by dry-run on / pause / a new lock (review fix)
//   (n) a lost step-3 answer is checked on the fleetTable; both lost -> error uncertain, target stays claimed (review fix)
//   node tests/gz-bot-core.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;      // Главная планета [2:68:5]
const COLONY = 254103;    // Colony [2:68:6]
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500 };
const isolate = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Requests that change game state or cost something: POST, fleetAjax, galaxy view, messages listing (marks read). */
function mutating(env) {
  return env.server.requests.filter((r) => r.method === 'POST' || /^fleetajax$/i.test(r.page || '') || (/^galaxy$/i.test(r.page || '') && r.method === 'GET')
    || (/^messages$/i.test(r.page || '') && /^view$/i.test(r.mode || '')));
}
async function journal(env, page, kind) {
  const re = kind instanceof RegExp ? kind : new RegExp('^' + String(kind).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  const all = await env.evalOgx(page, () => (OGX.diag.recent({ s: 'B' }) || []).map((e) => ({ id: e.id, t: e.t, k: e.k, w: e.w, d: e.d })));
  return all.filter((e) => re.test(e.k));
}
async function waitJournal(env, page, kind, { pred = () => true, timeoutMs = 40000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const hit = (await journal(env, page, kind)).find(pred);
    if (hit) return hit;
    if (Date.now() - t0 > timeoutMs) {
      const last = (await journal(env, page, /^bot/)).slice(-30).map((e) => e.k + ' ' + e.w);
      throw new Error('journal ' + kind + ' not seen in ' + timeoutMs + ' ms; last:\n  ' + last.join('\n  '));
    }
    await sleep(300);
  }
}
const status = (env, page) => env.evalOgx(page, () => OGX.bot.status());
async function until(fn, { timeoutMs = 30000, stepMs = 250, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for ' + what);
    await sleep(stepMs);
  }
}
/** Registers a one-shot test worker that runs the specs in order with wctx.act(); results land in OGX.__t[tag]. Spec extras:
 *  atIn (ms from now -> at), preciseIn + tolMs (-> precise), deadlineIn. module/prio = the worker's own (default botcore/fleet). */
async function runActions(env, page, specs, { tag = 'r', id = 'botcore:test', module = 'botcore', prio = 'fleet' } = {}) {
  await env.evalOgx(page, ({ specs, tag, id, module, prio }) => {
    OGX.__t = OGX.__t || {};
    OGX.__t[tag] = { done: false, results: [] };
    OGX.bot.register({
      id, module, prio, startJitter: [0, 50],
      async run(w) {
        if (OGX.__t[tag].started) return { nextInMs: 3600000 };
        OGX.__t[tag].started = true;
        for (const s0 of specs) {
          const s = Object.assign({}, s0);
          if (s.atIn !== undefined) { s.at = w.now() + s.atIn; delete s.atIn; }
          if (s.preciseIn !== undefined) { s.precise = { at: w.now() + s.preciseIn, tolMs: s.tolMs || 1500 }; delete s.preciseIn; delete s.tolMs; }
          if (s.deadlineIn !== undefined) { s.deadline = w.now() + s.deadlineIn; delete s.deadlineIn; }
          w.decide('Тест: ' + s.type, { why: s.why, inputs: s.params, chosen: s.type, alternatives: [] });
          const r = await w.act(s);
          const slim = JSON.parse(JSON.stringify(Object.assign({}, r, { data: r.data ? Object.assign({}, r.data, { doc: undefined, html: undefined }) : r.data, spec: s })));
          OGX.__t[tag].results.push(slim);
        }
        OGX.__t[tag].done = true;
        return { nextInMs: 3600000, reason: 'test done' };
      },
    });
  }, { specs, tag, id, module, prio });
}
async function results(env, page, tag = 'r', timeoutMs = 60000) {
  return until(async () => {
    const r = await env.evalOgx(page, (tag) => (OGX.__t && OGX.__t[tag] && OGX.__t[tag].done ? OGX.__t[tag].results : null), tag);
    return r;
  }, { timeoutMs, stepMs: 400, what: 'test worker results' });
}
async function mandatory(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
async function openBotPanel(env, page) {
  await env.evalOgx(page, () => { OGX.suite.hub.panel.selectGroup('bot'); OGX.suite.hub.panel.selectTab('bot'); });
  await page.waitForSelector('.ogx-b-bot-state', { timeout: 8000 });
}
async function confirmModal(page, okText) {
  await page.waitForSelector('.ogx-modal-overlay', { timeout: 8000 });
  const btn = page.locator('.ogx-modal-overlay .ogx-modal-buttons button', { hasText: okText });
  await btn.click();
  await page.waitForSelector('.ogx-modal-overlay', { state: 'detached', timeout: 8000 });
}
/** A trusted key press on the game page (not in our UI): the user is active (markUserBusy 'click'). */
async function userInput(page) {
  await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  await page.keyboard.press('Shift');
}
const SEND = (over = {}) => Object.assign({ type: 'fleet.send', bodyId: HOME, why: 'тест: колонизатор на [2:68:9]',
  params: { target: { galaxy: 2, system: 68, position: 9, type: 1 }, ships: { 208: 1 }, mission: 7, speed: 10, cargo: { metal: 0, crystal: 0, deuterium: 0 } } }, over);
/** fleetStep2 offers [7] by default on the static mock; ships 208 x2 on the saved fleetTable (Fleet 1 / 13, 0 / 2 expedition) */

// ------------------------------------------------------------------ (a) defaults
T.test('(a) defaults: master off, nothing mutating for 20 s on overview/fleetTable/buildings, panel «Бот выключен»', async () => {
  const env = await G.launch({ settings: isolate() });
  const pages = ['overview', 'fleetTable', 'buildings'];
  let page;
  for (const p of pages) { page = await env.game(p); await sleep(7000); }
  const st = await status(env, page);
  assert.equal(st.master, false, 'master off by default');
  assert.equal(st.dryRun, true, 'dry-run on by default');
  assert.equal(st.state, 'off');
  assert.equal(st.leader, false);
  const defaults = await env.evalOgx(page, () => ['master', 'dryRun', 'maxActionsPerHour', 'maxFleetSendsPerHour', 'galaxyViewsPerHour', 'slotsReserve', 'readMessages', 'sleepFrom', 'deutReserve', 'minGapMs', 'maxGapMs', 'autoLogin']
    .map((k) => [k, OGX.settings.get('botcore.' + k)]));
  assert.deepEqual(Object.fromEntries(defaults), { master: false, dryRun: true, maxActionsPerHour: 5000, maxFleetSendsPerHour: 500, galaxyViewsPerHour: 0, slotsReserve: 1, readMessages: true, sleepFrom: '01:30', deutReserve: 0,
    minGapMs: 300, maxGapMs: 600, autoLogin: false });
  assert.equal(await env.evalOgx(page, () => OGX.settings.schema('botcore').botcore.maxActionsPerHour.max), 20000, 'maxActionsPerHour up to 20000');
  // limits sized for «всё на авто» (audit K6/K1): fleet sends 500 (max 2000), builds 5000 (max 20000), galaxy views max 3600
  const lim = await env.evalOgx(page, () => { const s = OGX.settings.schema('botcore').botcore; return { f: [s.maxFleetSendsPerHour.default, s.maxFleetSendsPerHour.max], b: [s.maxBuildsPerHour.default, s.maxBuildsPerHour.max], g: [s.galaxyViewsPerHour.default, s.galaxyViewsPerHour.max] }; });
  assert.deepEqual(lim, { f: [500, 2000], b: [5000, 20000], g: [300, 3600] });
  // a value typed above the max is stored clamped (John typed 10000 galaxy views)
  await env.evalOgx(page, () => OGX.settings.set('botcore.galaxyViewsPerHour', 10000));
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('botcore.galaxyViewsPerHour')), 3600, 'clamped to the max');
  await env.evalOgx(page, () => OGX.settings.set('botcore.galaxyViewsPerHour', 0));
  // max < min: the core uses max = min
  await env.evalOgx(page, () => OGX.settings.set('botcore.maxGapMs', 400).then(() => OGX.settings.set('botcore.minGapMs', 2000)));
  const gr = await env.evalOgx(page, () => OGX.bot.gapRange());
  assert.deepEqual(gr, { min: 2000, max: 2000, setMax: 400, clamped: true });
  await env.evalOgx(page, () => OGX.settings.set('botcore.minGapMs', 300).then(() => OGX.settings.set('botcore.maxGapMs', 600)));
  assert.deepEqual(await env.evalOgx(page, () => OGX.bot.gapRange()), { min: 300, max: 600, setMax: 600, clamped: false });
  assert.deepEqual(mutating(env).map((r) => r.method + ' ' + r.url), [], 'no POST / fleetAjax / galaxy / messages view');
  assert.deepEqual(env.server.requests.filter((r) => !/^(overview|fleetTable|buildings)$/i.test(r.page || '')).map((r) => r.url), [], 'only the navigations');
  const lock = await env.get('lock.bot.leader');
  assert.equal(lock, undefined, 'no leader lock while off');
  await openBotPanel(env, page);
  const txt = await page.textContent('.ogx-b-bot-state');
  assert.equal(txt.trim(), 'Бот выключен — Пробный режим: ничего не отправляется');
  const btn = await page.textContent('.ogx-b-bot-master');
  assert.equal(btn.trim(), 'Старт');
  assert.equal(await page.isChecked('.ogx-b-bot-dry'), true, 'dry-run box checked');
  assert.equal(await page.$('.ogx-b-bot-live-banner'), null, 'no red banner while dry-run is on');
  const explainer = await page.textContent('.ogx-b-bot-explainer');
  assert.match(explainer, /Бот работает, пока открыта вкладка с игрой/);
  // module tabs exist in the group «Бот»
  const tabs = await page.$$eval('#ogx-panel-infinity .ogx-tab[data-tab^="bot"]', (els) => els.map((e) => e.dataset.tab));
  for (const t of ['bot', 'bot-common', 'bot-botsave', 'bot-botfarm', 'bot-botdebris', 'bot-botbuild', 'bot-botexpo', 'bot-botmissiles', 'bot-log']) assert.ok(tabs.includes(t), 'tab ' + t);
  await mandatory(env, '(a)');
}, { timeout: 120000 });

// ------------------------------------------------------------------ (b) dry-run
T.test('(b) panel «Старт» (confirm) + dry-run: action-dry with the full request for fleet.send/build/galaxy, nothing mutating', async () => {
  const env = await G.launch({ settings: isolate(FAST) });
  const page = await env.game('overview');
  await openBotPanel(env, page);
  await page.click('.ogx-b-bot-master');
  await confirmModal(page, 'Запустить');
  await until(async () => (await status(env, page)).leader, { what: 'leader after start', timeoutMs: 15000 });
  const ui = await journal(env, page, 'botpanel:ui');
  assert.ok(ui.some((e) => /Старт подтверждён/.test(e.w)), 'botpanel:ui journaled');
  // no bot module is on: started anyway, with a clear warning in the panel and in the journal; dry-run said on the state line
  assert.ok(ui.some((e) => /Ни один модуль не включён — бот ничего делать не будет\. Включите нужные модули ниже\./.test(e.w)), 'no-modules warning journaled');
  await page.waitForSelector('.ogx-b-bot-no-modules', { timeout: 8000 });
  assert.match(await page.textContent('.ogx-b-bot-no-modules'), /Ни один модуль не включён/);
  await page.waitForFunction(() => /Пробный режим: ничего не отправляется/.test((document.querySelector('.ogx-b-bot-state') || {}).textContent || ''), null, { timeout: 8000 });
  await waitJournal(env, page, 'botcore:start');
  const st0 = await status(env, page);
  assert.equal(st0.master, true); assert.equal(st0.dryRun, true);
  await runActions(env, page, [
    SEND(),
    { type: 'build.building', bodyId: COLONY, why: 'тест: рудник', params: { id: 1, cmd: 'insert' }, prio: 'build' },
    { type: 'read.galaxy', why: 'тест: галактика', params: { galaxy: 2, system: 70 } },
    { type: 'fleet.ajax', bodyId: HOME, why: 'тест: зонд', params: { mission: 6, planetId: 999 } },
    { type: 'messages.delete', why: 'тест: удалить', params: { ids: [5, 6], cat: 0 } },
  ]);
  const res = await results(env, page);
  assert.equal(res.length, 5);
  for (const r of res) { assert.equal(r.dry, true, r.spec.type + ' dry'); assert.equal(r.refused, 'dryRun'); }
  assert.equal(res[0].ok, true, 'the send plan is valid');
  const dry = await journal(env, page, 'botcore:action-dry');
  assert.equal(dry.length, 5);
  const send = dry.find((e) => e.d.type === 'fleet.send');
  const reqs = send.d.requests;
  assert.deepEqual(reqs.map((q) => q.method + ' ' + q.page), ['GET fleetTable', 'POST fleetStep1', 'POST fleetStep2', 'POST fleetStep3']);
  for (const q of reqs) assert.equal(q.cp, HOME, 'cp on every request of the send');
  assert.deepEqual(reqs[1].form, { galaxy: 2, system: 68, planet: 9, type: 1, target_mission: 7, ship208: 1 });
  assert.equal(reqs[2].form.speed, 10);
  assert.equal(reqs[3].form.mission, 7);
  const build = dry.find((e) => e.d.type === 'build.building');
  assert.deepEqual(build.d.requests, [{ method: 'POST', url: 'game.php?page=buildings&cp=' + COLONY, page: 'buildings', form: { cmd: 'insert', building: 1 }, cp: COLONY }]);
  const gal = dry.find((e) => e.d.type === 'read.galaxy');
  assert.equal(gal.d.requests[0].url, 'game.php?page=galaxy&galaxy=2&system=70', 'galaxy view never carries cp');
  assert.equal(gal.d.requests[0].cp, null);
  const del = dry.find((e) => e.d.type === 'messages.delete');
  assert.equal(del.d.requests[0].form['messageID[5]'], 1);
  // a decision precedes every action
  const all = await journal(env, page, /^botcore:(decision|action-queued)$/);
  assert.equal(all[0].k, 'botcore:decision');
  assert.deepEqual(mutating(env).map((r) => r.method + ' ' + r.url), [], 'dry-run sends nothing');
  // panel shows the actions as «пробно»
  await page.waitForFunction(() => document.querySelectorAll('.ogx-b-bot-actions tr').length >= 5, null, { timeout: 8000 });
  assert.equal(await page.$('.ogx-b-bot-live-banner'), null);
  await mandatory(env, '(b)');
}, { timeout: 120000 });

// ------------------------------------------------------------------ (c) live: send, recall, build, cp restore
T.test('(c) dry-run off (panel confirm): fleet.send = fleetTable GET + 3 POSTs with cp, verified; recall POST; build POST verified; cp restored', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true }, FAST)) });
  // buildings answer after an order: a non-empty queue box naming the building [UPSTREAM markup guess]
  env.server.route('GET', 'buildings', (req, res, ctx) => ctx.sendPage('buildings', (html) => html.replace('<div class="largebox">',
    '<div class="largebox"><table><tr><td class="queue-item">1.: Metal Mine 32</td><td><form action="game.php?page=buildings" method="post"><input type="hidden" name="cmd" value="cancel"><input type="hidden" name="listid" value="1"></form></td></tr></table>')));
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  await openBotPanel(env, page);
  await page.click('.ogx-b-bot-dry');          // uncheck -> confirm
  await confirmModal(page, 'Выключить пробный режим');
  await until(async () => (await status(env, page)).dryRun === false, { what: 'dry-run off' });
  await page.waitForSelector('.ogx-b-bot-live-banner', { timeout: 8000 });
  env.server.clearLog();
  await runActions(env, page, [
    SEND(),
    { type: 'fleet.recall', bodyId: HOME, why: 'тест: отзыв', params: { fleetId: 396900 } },
    { type: 'build.building', bodyId: COLONY, why: 'тест: рудник', params: { id: 1, cmd: 'insert' }, prio: 'build' },
  ]);
  const res = await results(env, page, 'r', 90000);
  const [send, recall, build] = res;
  assert.equal(send.ok, true, 'send ok: ' + JSON.stringify(send));
  assert.equal(send.dry, false);
  assert.equal(send.verified, true, 'verified on the step-3 page (th.success + own event in the box)');
  assert.equal(send.data.fleetId, 396901, 'fleet id from the event box of the result page');
  assert.ok(send.data.arrival > 0 && send.data.back > send.data.arrival);
  const reqs = env.server.requests.filter((r) => /^(fleetTable|fleetStep1|fleetStep2|fleetStep3)$/i.test(r.page)).slice(0, 4);
  assert.deepEqual(reqs.map((r) => r.method + ' ' + r.page + ' cp=' + r.cp), ['GET fleetTable cp=' + HOME, 'POST fleetStep1 cp=' + HOME, 'POST fleetStep2 cp=' + HOME, 'POST fleetStep3 cp=' + HOME]);
  assert.equal(reqs[1].form.ship208, '1'); assert.equal(reqs[1].form.planet, '9');
  assert.equal(reqs[2].form.token, reqs[3].form.token, 'one token through the steps');
  assert.equal(reqs[3].form.mission, '7');
  assert.equal(env.server.state.sent.length, 1, 'the mock accepted one fleet');
  // the user gap (minGapMs..maxGapMs = 300..500 here) separates actions, never the steps of one send
  const stepGap = Math.min(reqs[2].t - reqs[1].t, reqs[3].t - reqs[2].t);
  assert.ok(stepGap < 290, 'no random pause between the steps of one send (' + stepGap + ' ms)');
  // recall
  assert.equal(recall.ok, true); assert.equal(recall.verified, true, 'recall form gone');
  const rc = env.server.requests.find((r) => r.method === 'POST' && /fleettable/i.test(r.page));
  assert.equal(rc.query.action, 'sendfleetback'); assert.equal(rc.form.fleetID, '396900');
  // build
  assert.equal(build.ok, true); assert.equal(build.verified, true, 'queue box names the building: ' + JSON.stringify(build));
  const bp = env.server.requests.find((r) => r.method === 'POST' && r.page === 'buildings');
  assert.equal(bp.cp, COLONY); assert.equal(bp.form.cmd, 'insert'); assert.equal(bp.form.building, '1');
  // journal: start/done for every action, verified
  const done = await journal(env, page, 'botcore:action-done');
  assert.deepEqual(done.map((e) => e.d.type), ['fleet.send', 'fleet.recall', 'build.building']);
  // cp restore: the last action used the colony, the user is on the home planet (and active: restores wait for a user)
  await userInput(page);
  const restore = await waitJournal(env, page, 'botcore:cp-restore', { timeoutMs: 15000 });
  assert.equal(restore.d.cp, HOME);
  const g = env.server.requests.filter((r) => r.method === 'GET' && r.page === 'overview' && r.cp === HOME);
  assert.ok(g.length >= 1, 'GET page=overview&cp=' + HOME);
  assert.ok(!g.some((r) => r.query.ajax), 'never ajax=1');
  const st = await status(env, page);
  assert.equal(st.limits.fleetSends.used, 1);
  assert.equal(st.limits.builds.used, 1);
  assert.equal(st.consecutiveErrors, 0);
  await mandatory(env, '(c)');
}, { timeout: 150000 });

// ------------------------------------------------------------------ (d) limits
T.test('(d) limits: second fleet send refused "limit", galaxy budget 0 refuses the view, nothing sent for them', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false, 'botcore.maxFleetSendsPerHour': 1 }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  env.server.clearLog();
  await runActions(env, page, [SEND(), SEND({ why: 'вторая' }), { type: 'read.galaxy', why: 'тест: галактика', params: { galaxy: 2, system: 70 } }]);
  const [a, b, c] = await results(env, page, 'r', 90000);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false); assert.equal(b.refused, 'limit');
  assert.equal(c.ok, false); assert.equal(c.refused, 'limit', 'galaxyViewsPerHour 0 = never');
  assert.equal(env.server.requests.filter((r) => r.page === 'fleetStep3').length, 1, 'one step 3 only');
  assert.equal(env.server.requests.filter((r) => /^galaxy$/i.test(r.page)).length, 0, 'no galaxy view');
  const lim = await journal(env, page, 'botcore:limit');
  assert.ok(lim.some((e) => e.d.limit === 'fleetSends'));
  assert.ok(lim.some((e) => e.d.limit === 'galaxyViews'));
  const st = await status(env, page);
  assert.deepEqual(st.limits.fleetSends, { used: 1, max: 1 });
  assert.equal(st.consecutiveErrors, 0, 'refusals are no errors');
  // the status says the limit is used up (not just «ожидает»); galaxyViews 0 = «never» is not a used-up limit
  assert.equal(st.pauseReason, 'limit');
  assert.deepEqual((st.limitsHit || []).map((x) => x.limit), ['fleetSends']);
  // OGX.bot.limits.remaining(kind): the allowance left in the rolling hour (0 for a limit set to 0 = off)
  const left = await env.evalOgx(page, () => ['fleetSends', 'galaxyViews', 'builds', 'nope'].map((k) => OGX.bot.limits.remaining(k)));
  assert.deepEqual(left, [0, 0, 5000, 0], 'remaining: ' + JSON.stringify(left));
  await openBotPanel(env, page);
  const txt = await page.textContent('.ogx-b-bot-state');
  assert.ok(/лимит исчерпан/.test(txt), 'panel state line: ' + txt);
  // user-facing names, never internal codes (review fix): refusal reason, module column, journal kinds, timer
  const acts = await page.textContent('.ogx-b-bot-actions');
  assert.match(acts, /отказ: лимит в час/, acts);
  assert.doesNotMatch(acts, /отказ: limit|\bbotcore\b/, acts);
  assert.match(acts, /Ядро/);
  const info = await page.textContent('.ogx-b-bot-info');
  assert.match(info, /Таймер\s*(точный|обычный)/, info);
  assert.doesNotMatch(info, /\bWorker\b|setTimeout|Следующий запуск\s*bot/, info);
  await mandatory(env, '(d)');
}, { timeout: 120000 });

T.test('(d2) actions limit counts every request and is never overshot: a fleet.send needs 4, refused when used + 4 > max', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false, 'botcore.maxActionsPerHour': 6 }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  env.server.clearLog();
  await runActions(env, page, [SEND(), SEND({ why: 'вторая' })]);
  const [a, b] = await results(env, page, 'r', 90000);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.ok, false); assert.equal(b.refused, 'limit', JSON.stringify(b));
  const st = await status(env, page);
  assert.ok(st.limits.actions.used <= 6, 'never above the max: ' + JSON.stringify(st.limits.actions));
  assert.equal(st.pauseReason, 'limit');
  await mandatory(env, '(d2)');
}, { timeout: 120000 });

// ------------------------------------------------------------------ (e) slots reserve
T.test('(e) slots reserve: "normal" refused when free <= reserve, "force" sent; wctx.canSend agrees', async () => {
  // saved fleetTable «Fleet 1 / 13» rewritten to «Fleet 10 / 13» -> free 3
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false, 'botcore.slotsReserve': 2 }, FAST)) });
  env.server.route('GET', 'fleetTable', (req, res, ctx) => ctx.sendPage('fleetTable', (html) => html.replace('>Fleet 1 /', '>Fleet 10 /')));
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  await runActions(env, page, [{ type: 'read.fleetTable', bodyId: HOME, why: 'слоты', params: {} }], { tag: 'pre', id: 'botcore:pre' });
  await results(env, page, 'pre');
  const cs = await env.evalOgx(page, () => new Promise((resolve) => {
    OGX.bot.register({ id: 'botcore:cs', module: 'botcore', startJitter: [0, 10], async run(w) { resolve({ n: await w.canSend('normal'), f: await w.canSend('force'), s: await w.slots() }); return { nextInMs: 3600000 }; } });
  }));
  assert.deepEqual(cs.n, { ok: true, free: 3, reserve: 2, held: 0, reason: null });
  assert.deepEqual(cs.f, { ok: true, free: 3, reserve: 2, held: 0, reason: null });
  assert.deepEqual(cs.s.fleet, { used: 10, max: 13 }); assert.deepEqual(cs.s.expedition, { used: 0, max: 2 }); assert.equal(cs.s.src, 'fleetTable');
  await env.evalOgx(page, () => OGX.settings.set('botcore.slotsReserve', 3));
  const cs2 = await env.evalOgx(page, () => new Promise((resolve) => {
    OGX.bot.register({ id: 'botcore:cs2', module: 'botcore', startJitter: [0, 10], async run(w) { resolve({ n: await w.canSend('normal'), f: await w.canSend('force') }); return { nextInMs: 3600000 }; } });
  }));
  assert.deepEqual(cs2.n, { ok: false, free: 3, reserve: 3, held: 0, reason: 'reserve' });
  assert.equal(cs2.f.ok, true);
  env.server.clearLog();
  await runActions(env, page, [SEND({ why: 'normal' }), SEND({ why: 'force', cls: 'force' })]);
  const [n, f] = await results(env, page, 'r', 90000);
  assert.equal(n.ok, false); assert.equal(n.refused, 'slots', JSON.stringify(n));
  assert.equal(f.ok, true, 'force: free 3 > 0: ' + JSON.stringify(f));
  const st1 = env.server.requests.filter((r) => r.page === 'fleetStep1');
  assert.equal(st1.length, 1, 'only the force send reached step 1');
  await mandatory(env, '(e)');
}, { timeout: 120000 });

// ------------------------------------------------------------------ (f) leader election
T.test('(f) two tabs: one leader/executor; after the leader tab closes the other takes over and runs the queued action', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true }, FAST)) });
  const a = await env.game('overview');
  await until(async () => (await status(env, a)).leader, { what: 'tab A leader', timeoutMs: 15000 });
  const b = await env.game('buildings', { newPage: true });
  await sleep(6000);
  const [sa, sb] = [await status(env, a), await status(env, b)];
  assert.equal(sa.leader, true); assert.equal(sb.leader, false, 'one leader only');
  assert.equal(sb.leaderTab, sa.leaderTab, 'B sees A as the leader');
  assert.equal(sb.state === 'idle' || sb.state === 'running', true, 'B mirrors the running state: ' + sb.state);
  // queue an action in A for later (read.page runs in dry-run too)
  env.server.clearLog();
  await runActions(env, a, [{ type: 'read.page', bodyId: HOME, why: 'тест: очередь переживает смену вкладки', params: { page: 'resources' }, atIn: 25000 }]);
  const q = await until(async () => { const s = await status(env, a); return s.queue.length ? s.queue : null; }, { what: 'queued in A' });
  const id = q[0].id;
  const persisted = await until(async () => { const v = await env.get('botcore.queue'); return v && v.some((e) => e.id === id) ? v : null; }, { what: 'queue persisted' });
  assert.ok(persisted.length >= 1);
  await a.close();
  await until(async () => (await status(env, b)).leader, { what: 'B takes over', timeoutMs: 30000 });
  await waitJournal(env, b, 'botcore:leader');
  const done = await waitJournal(env, b, 'botcore:action-done', { pred: (e) => e.d.action === id, timeoutMs: 40000 });
  assert.equal(done.d.type, 'read.page');
  const gets = env.server.requests.filter((r) => r.page === 'resources');
  assert.equal(gets.length, 1, 'executed exactly once');
  assert.equal(gets[0].cp, HOME);
  await mandatory(env, '(f)');
}, { timeout: 150000 });

// ------------------------------------------------------------------ (g) precise
T.test('(g) precise send: steps 1-2 posted early, step 3 reaches the server at the requested second', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  env.server.clearLog();
  const offset = await env.evalOgx(page, () => OGX.time.serverNow() - Date.now());
  await runActions(env, page, [SEND({ preciseIn: 40000, tolMs: 1500, why: 'точная отправка' })]);
  const target = await until(async () => { const s = await status(env, page); return s.queue.length && s.queue[0].at ? s.queue[0].at : null; }, { what: 'precise queued' });
  const [r] = await results(env, page, 'r', 90000);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.verified, true);
  assert.ok(r.lateMs !== undefined, 'lateMs reported');
  const s2 = env.server.requests.find((x) => x.page === 'fleetStep2');
  const s3 = env.server.requests.find((x) => x.page === 'fleetStep3');
  assert.ok(s2 && s3);
  const s3Server = s3.t + offset;
  assert.ok(s2.t + offset < target - 5000, 'steps 1-2 early (' + Math.round((target - s2.t - offset) / 1000) + ' s before)');
  assert.ok(Math.abs(s3Server - target) < 1000, 'step 3 at the requested time: off by ' + (s3Server - target) + ' ms');
  const armed = await journal(env, page, 'botcore:timer-armed');
  assert.ok(armed.some((e) => e.d.action), 'precise step 3 armed');
  await mandatory(env, '(g)');
}, { timeout: 150000 });

// ------------------------------------------------------------------ (h) stops
T.test('(h) stop on logout (302 to index.php) and on a captcha page: stopped, queue cancelled, master off, «Старт» needed', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  env.server.route('GET', 'resources', (req, res, ctx) => ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/index.php?code=3' }));
  await runActions(env, page, [
    { type: 'read.page', bodyId: HOME, why: 'logout', params: { page: 'resources' } },
    { type: 'read.page', bodyId: HOME, why: 'не выполнится', params: { page: 'research' } },
  ]);
  const [a, b] = await results(env, page);
  assert.equal(a.ok, false);
  assert.equal(b.refused, 'stopped', 'later actions refused');
  await waitJournal(env, page, 'botcore:logout');
  let st = await status(env, page);
  assert.equal(st.state, 'stopped'); assert.equal(st.stopReason, 'logout'); assert.equal(st.master, false);
  assert.equal(env.server.requests.filter((r) => r.page === 'research').length, 0);
  await page.waitForSelector('.ogx-toast-error', { timeout: 5000 });
  // captcha: start again
  env.server.reset();
  env.server.route('GET', 'research', (req, res, ctx) => ctx.sendPage('overview', (html) => html.replace('<div id="inhalt">', '<div id="inhalt"><form id="captchaForm" action="game.php?page=captcha" method="post"><div class="g-recaptcha" data-sitekey="x"></div><input name="captcha"></form>')));
  await env.evalOgx(page, () => OGX.bot.start());
  await until(async () => (await status(env, page)).leader, { what: 'leader again', timeoutMs: 20000 });
  await runActions(env, page, [{ type: 'read.page', bodyId: HOME, why: 'captcha', params: { page: 'research' } }], { tag: 'c', id: 'botcore:c' });
  await results(env, page, 'c');
  await waitJournal(env, page, 'botcore:captcha');
  st = await status(env, page);
  assert.equal(st.state, 'stopped'); assert.equal(st.stopReason, 'captcha');
  await openBotPanel(env, page);
  assert.match(await page.textContent('.ogx-b-bot-state'), /Бот остановлен: капча/);
  await mandatory(env, '(h)');
}, { timeout: 150000 });

// ------------------------------------------------------------------ (i) backoff
T.test('(i) consecutive errors: backoff 5–15 s, then pause("errors") after botcore.maxErrors; «Продолжить» resumes', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.maxErrors': 2 }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  env.server.route('GET', 'resources', (req, res, ctx) => ctx.send(500, 'boom', 'text/plain'));
  await runActions(env, page, [
    { type: 'read.page', bodyId: HOME, why: 'ошибка 1', params: { page: 'resources' } },
    { type: 'read.page', bodyId: HOME, why: 'ошибка 2', params: { page: 'resources' } },
  ]);
  const [a, b] = await results(env, page, 'r', 60000);
  assert.equal(a.ok, false); assert.equal(b.ok, false);
  const bo = await waitJournal(env, page, 'botcore:backoff');
  assert.ok(bo.d.ms >= 5000 && bo.d.ms <= 15000, 'first step of the ladder: ' + bo.d.ms);
  const gets = env.server.requests.filter((r) => r.page === 'resources');
  assert.ok(gets[1].t - gets[0].t >= 5000 - 100, 'second try after the backoff (' + (gets[1].t - gets[0].t) + ' ms)');
  await waitJournal(env, page, 'botcore:pause', { pred: (e) => e.d.reason === 'errors' });
  let st = await status(env, page);
  assert.equal(st.state, 'paused'); assert.equal(st.pauseReason, 'errors'); assert.equal(st.consecutiveErrors, 2);
  assert.equal(st.errors.botcore.n, 2, 'the streak is botcore\'s: ' + JSON.stringify(st.errors));
  const sNow = await env.evalOgx(page, () => OGX.time.serverNow());   // probeAt is server time (the mock's clock, not the host's)
  assert.ok(st.pauseProbeAt - sNow > 25 * 60000 && st.pauseProbeAt - sNow < 65 * 60000, 'the probe is due in 30-60 min: ' + (st.pauseProbeAt - sNow) + ' ms');
  await openBotPanel(env, page);
  assert.match(await page.locator('.ogx-b-bot-state').textContent(), /много ошибок подряд, сам проверит игру в \d/);
  await page.click('.ogx-b-bot-pause');   // «Продолжить»
  await until(async () => (await status(env, page)).state !== 'paused', { what: 'resumed' });
  st = await status(env, page);
  assert.equal(st.consecutiveErrors, 0); assert.deepEqual(st.errors, {}); assert.equal(st.pauseProbeAt, null);
  await waitJournal(env, page, 'botcore:resume');
  await mandatory(env, '(i)');
}, { timeout: 120000 });

T.test('(i2) error streaks per module; defense passes pause/backoff/limits/start pause; pause("errors") ends by the probe read', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.maxErrors': 2, 'botsave.enabled': true, 'botsave.on': true }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  env.server.route('GET', 'resources', (req, res, ctx) => ctx.send(500, 'boom', 'text/plain'));
  // 1. one botcore error: botcore backs off 5-15 s; a botsave worker and its read run at once (streak and backoff keyed by module)
  await runActions(env, page, [{ type: 'read.page', bodyId: HOME, why: 'ошибка 1', params: { page: 'resources' } }], { tag: 'e1', id: 'botcore:e1' });
  const bo = await waitJournal(env, page, 'botcore:backoff');
  assert.equal(bo.d.module, 'botcore', JSON.stringify(bo.d));
  const t1 = Date.now();
  await runActions(env, page, [{ type: 'read.page', bodyId: HOME, why: 'чтение другого модуля в откате botcore', params: { page: 'overview' } }], { tag: 's1', id: 'botsave:s1', module: 'botsave' });
  const [s1] = await results(env, page, 's1', 20000);
  assert.equal(s1.ok, true, 'the botsave read ran: ' + JSON.stringify(s1));
  assert.ok(Date.now() - t1 < 4500, 'ran during the botcore backoff (' + (Date.now() - t1) + ' ms)');
  let st = await status(env, page);
  assert.equal(st.consecutiveErrors, 1); assert.equal(st.errors.botcore.n, 1); assert.equal(st.errors.botsave, undefined, JSON.stringify(st.errors));
  // 2. the second botcore error (after its backoff) pauses the bot for errors; the record carries the probe time
  await runActions(env, page, [{ type: 'read.page', bodyId: HOME, why: 'ошибка 2', params: { page: 'resources' } }], { tag: 'e2', id: 'botcore:e2' });
  const pa = await waitJournal(env, page, 'botcore:pause', { pred: (e) => e.d.reason === 'errors' });
  assert.equal(pa.d.module, 'botcore');
  const sNow = await env.evalOgx(page, () => OGX.time.serverNow());
  assert.ok(pa.d.probeAt - sNow > 25 * 60000 && pa.d.probeAt - sNow < 65 * 60000, 'the probe in 30-60 min (server clock): ' + (pa.d.probeAt - sNow) + ' ms');
  st = await status(env, page);
  assert.equal(st.state, 'paused'); assert.equal(st.pauseProbeAt, pa.d.probeAt);
  // 3. under the pause: a normal read of botsave waits (its worker runs: defense prio), a defense read runs
  await runActions(env, page, [{ type: 'read.page', prio: 'read', bodyId: HOME, why: 'обычное чтение на паузе', params: { page: 'buildings' } }], { tag: 'n1', id: 'botsave:n1', module: 'botsave', prio: 'defense' });
  await runActions(env, page, [{ type: 'read.fleetTable', prio: 'defense', bodyId: HOME, why: 'защита на паузе', params: {} }], { tag: 'd1', id: 'botsave:d1', module: 'botsave', prio: 'defense' });
  const [d1] = await results(env, page, 'd1', 20000);
  assert.equal(d1.ok, true, 'the defense read ran under the pause: ' + JSON.stringify(d1));
  await sleep(3000);
  st = await status(env, page);
  assert.equal(st.state, 'paused', 'still paused');
  assert.ok(st.queue.some((q) => q.module === 'botsave' && q.prio === 'read' && q.state === 'queued'), 'the normal read waits: ' + JSON.stringify(st.queue));
  assert.equal(await env.evalOgx(page, () => !!(OGX.__t.n1 && OGX.__t.n1.done)), false);
  // 4. the probe (moved to now): one fresh read.page overview, then the automatic resume; the waiting read runs
  const overviews = () => env.server.requests.filter((r) => r.page === 'overview').length;
  const n0 = overviews();
  await env.evalOgx(page, () => { OGX.bot._R.paused.probeAt = OGX.time.serverNow(); });
  await waitJournal(env, page, 'botcore:probe', { timeoutMs: 20000 });
  const rs = await waitJournal(env, page, 'botcore:resume', { pred: (e) => e.d && e.d.auto === true, timeoutMs: 20000 });
  assert.equal(rs.d.was, 'errors');
  const [n1] = await results(env, page, 'n1', 20000);
  assert.equal(n1.ok, true, JSON.stringify(n1));
  st = await status(env, page);
  assert.notEqual(st.state, 'paused'); assert.equal(st.consecutiveErrors, 0); assert.deepEqual(st.errors, {}); assert.equal(st.pauseProbeAt, null);
  assert.ok(overviews() > n0, 'the probe read the overview');
  // 5. limits: an actions limit of 1 (used up) refuses a normal read, a defense read passes; the start pause of a new leader likewise
  await env.evalOgx(page, () => OGX.settings.set('botcore.maxActionsPerHour', 1));
  await runActions(env, page, [{ type: 'read.page', prio: 'read', fresh: true, bodyId: HOME, why: 'обычное чтение при лимите', params: { page: 'research' } }], { tag: 'l1', id: 'botcore:l1' });
  await runActions(env, page, [{ type: 'read.fleetTable', prio: 'defense', bodyId: HOME, why: 'защита при лимите', params: {} }], { tag: 'l2', id: 'botsave:l2', module: 'botsave', prio: 'defense' });
  const [l1] = await results(env, page, 'l1', 20000); const [l2] = await results(env, page, 'l2', 20000);
  assert.equal(l1.refused, 'limit', JSON.stringify(l1)); assert.equal(l2.ok, true, JSON.stringify(l2));
  await env.evalOgx(page, () => OGX.settings.set('botcore.maxActionsPerHour', 5000));
  await env.evalOgx(page, () => { OGX.bot._R.startPauseUntil = OGX.time.serverNow() + 30000; });
  await runActions(env, page, [{ type: 'read.page', prio: 'read', fresh: true, bodyId: HOME, why: 'обычное чтение в стартовой паузе', params: { page: 'research' } }], { tag: 'p1', id: 'botcore:p1' });
  await runActions(env, page, [{ type: 'read.fleetTable', prio: 'defense', bodyId: HOME, why: 'защита в стартовой паузе', params: {} }], { tag: 'p2', id: 'botsave:p2', module: 'botsave', prio: 'defense' });
  const [p2] = await results(env, page, 'p2', 20000);
  assert.equal(p2.ok, true, JSON.stringify(p2));
  await sleep(2000);
  assert.equal(await env.evalOgx(page, () => !!(OGX.__t.p1 && OGX.__t.p1.done)), false, 'the normal read waits for the start pause');
  await env.evalOgx(page, () => { OGX.bot._R.startPauseUntil = 0; });
  const [p1] = await results(env, page, 'p1', 20000);
  assert.equal(p1.ok, true, JSON.stringify(p1));
  await mandatory(env, '(i2)');
}, { timeout: 240000 });

// ------------------------------------------------------------------ (j) threat lock
T.test('(j) hostile attack in the event box locks [2:68:5]: a normal send from it is refused "threat", nothing posted', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false }, FAST)) });
  // saved overview: render instant = 1793348429 - 1012; a foreign attack (no 'own' prefix) arriving in 30 min [UPSTREAM markup]
  const render = 1793348429 - 1012;
  const end = render + 1800;
  const hostile = `<div id="OvfleetEvents" class="OvfleetEvents_" style="padding:5px 10px;background-color:#000">
                <span id="fleettime_${end}777001" class="fleets" data-fleet-end-time="${end}" data-fleet-time="1800">00:30:00</span>
				<span class="fleet_static_time" data-fleet-end-time="10:33:37">10:33:37</span>
				<span><span class="flight attack">A hostile <a href="#" data-tooltip-content="x" class="tooltip attack">Fleet</a><span class="textForBlind"> (500 Light Fighter; 20 Battleship)</span> of player Raider <a href="#" onclick="return Dialog.PM(4242)">msg</a> from planet <a href="https://ogamex.eu/Aeternum/game.php?page=galaxy&amp;galaxy=2&amp;system=70" class="attack">[2:70:4]</a> is heading to planet Главная планета <a href="https://ogamex.eu/Aeternum/game.php?page=galaxy&amp;galaxy=2&amp;system=68" class="attack">[2:68:5]</a>. Mission: Attack</span></span>
            </div>`;
  env.server.route('GET', 'overview', (req, res, ctx) => ctx.sendPage('overview', (html) => html.replace('<div class="allFleetsEvent">', hostile + '<div class="allFleetsEvent">')));
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  const th = await env.evalOgx(page, () => ({ threats: OGX.bot.threats(), locked: OGX.bot.lockedBodies() }));
  assert.equal(th.threats.length, 1, JSON.stringify(th));
  const t = th.threats[0];
  assert.equal(t.fleetId, 777001); assert.equal(t.mission, 1); assert.equal(t.to, '2:68:5'); assert.equal(t.from, '2:70:4');
  assert.equal(t.bodyKey, 'p' + HOME); assert.equal(t.ownerId, 4242); assert.equal(t.probesOnly, false); assert.equal(t.arrival, end * 1000);
  assert.equal(t.key, '777001:' + end);
  assert.ok(th.locked['p' + HOME], 'home planet locked');
  await waitJournal(env, page, 'botcore:threat');
  env.server.clearLog();
  await runActions(env, page, [SEND({ why: 'с атакуемой планеты' }), SEND({ why: 'с колонии', bodyId: COLONY, params: Object.assign({}, SEND().params, { ships: { 210: 1 }, mission: 7 }) })]);
  const [r, other] = await results(env, page, 'r', 90000);
  assert.equal(r.ok, false); assert.equal(r.refused, 'threat');
  assert.notEqual(other.refused, 'threat', 'other bodies are not locked: ' + JSON.stringify(other));
  const fromHome = env.server.requests.filter((x) => x.cp === HOME && (x.method === 'POST' || x.page === 'fleetTable'));
  assert.deepEqual(fromHome.map((x) => x.method + ' ' + x.url), [], 'nothing requested for the locked body');
  // panel lists the threat with a countdown. Only the overview route carries the hostile event: a fleetTable/step page read by
  // the colony send has a complete event box WITHOUT it and clears the threat (as the live server would); the cp restore
  // (GET overview) brings it back — wait for that before looking at the panel.
  await userInput(page);
  await until(async () => (await env.evalOgx(page, () => OGX.bot.threats().length)) === 1, { what: 'threat back after the cp restore', timeoutMs: 30000 });
  await openBotPanel(env, page);
  await page.waitForSelector('.ogx-b-bot-threats tr .ogx-countdown', { timeout: 5000 });
  await mandatory(env, '(j)');
}, { timeout: 120000 });

// ------------------------------------------------------------------ (l) timers, registries, user first, sleep check, notify
T.test('(l) OGX.bot.at/onTimer survive a reload, registries + reservations, user-first holds non-defense actions, sleepCheck, notify', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.userIdleSec': 60 }, FAST)) });
  let page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  // a labelled timer armed 12 s ahead, then the page reloads: the new page calls the handler registered by label
  await env.evalOgx(page, () => { OGX.bot.at(OGX.time.serverNow() + 12000, null, { label: 'test:ping', payload: { n: 7 } }); });
  await until(async () => { const v = await env.get('botcore.timers'); return v && v.some((t) => t.label === 'test:ping') ? v : null; }, { what: 'timer persisted' });
  page = await env.game('overview');
  await env.evalOgx(page, () => { OGX.__fired = null; OGX.bot.onTimer('test:ping', (p) => { OGX.__fired = p; }); });
  await until(async () => (await status(env, page)).leader, { what: 'leader after reload', timeoutMs: 20000 });
  const fired = await until(() => env.evalOgx(page, () => OGX.__fired), { what: 'timer fired', timeoutMs: 25000 });
  assert.equal(fired.n, 7);
  await waitJournal(env, page, 'botcore:timer-fired', { pred: (e) => e.d.label === 'test:ping' });
  // registries
  const reg = await env.evalOgx(page, () => new Promise((resolve) => {
    const seen = [];
    OGX.bus.on('bot:battle-planned', (b) => seen.push('planned:' + b.id));
    OGX.bus.on('bot:battle-cancelled', (b) => seen.push('cancelled:' + b.id + ':' + b.reason));
    OGX.bus.on('bot:needs', (n) => seen.push('needs:' + n.owner + ':' + n.needs.length));
    const id = 'farm:2:70:4:1:1793350000';
    OGX.bot.battles.put({ id, owner: 'botfarm', target: { galaxy: 2, system: 70, position: 4, type: 1 }, arrival: 1793350000000, fleetId: null, status: 'planned',
      debris: { metal: 1, crystal: 2, p10: { metal: 0, crystal: 0 }, p50: { metal: 1, crystal: 2 } }, existingDebris: null, sim: {} });
    const got = OGX.bot.battles.get(id);
    OGX.bot.battles.remove(id, 'test');
    OGX.bot.needs.set('botbuild', [{ id: 'n1', bodyKey: 'p254102', res: { metal: 5, crystal: 0, deuterium: 0 }, forItem: { id: 1, level: 32 }, wantedBy: 0, priority: 1 }]);
    OGX.bot.intel.put('2:70:4:1', { reportId: 1, ts: 1, res: { metal: 1, crystal: 0, deuterium: 0 }, ships: null, defense: null, buildings: null, research: null, known: {}, probesSent: 1, probesLost: null });
    OGX.bot.register({ id: 'botcore:res', module: 'botcore', startJitter: [0, 10], async run(w) {
      const before = w.available('p254102');
      const rid = w.reserve('p254102', { metal: 1000 }, { ttlMs: 60000, label: 'test' });
      const list = OGX.bot.reservations.list();
      w.release(rid);
      resolve({ seen, got: !!got, needs: OGX.bot.needs.list().length, intel: OGX.bot.intel.get('2:70:4:1').res.metal, before, list, after: OGX.bot.reservations.list().length,
        sleep: w.sleepCheck(w.now() + 3600000), msu: OGX.bot.msu({ metal: 1, crystal: 2, deuterium: 3 }), key: OGX.bot.coordsKey({ galaxy: 2, system: 70, position: 4, type: 3 }),
        ft: OGX.bot.flightTime({ from: '2:68:5', to: '2:68:9', ships: { 208: 1 }, speed: 10, data: { fleetroom: 7500, gamespeed: 7, fleetspeedfactor: 1, maxspeed: 6000.000000000001, ships: { 208: { consumption: 1000, speed: 6000.000000000001, amount: 1 } }, fleetMinDuration: 5 } }) });
      return { nextInMs: 3600000 };
    } });
  }));
  assert.deepEqual(reg.seen, ['planned:farm:2:70:4:1:1793350000', 'cancelled:farm:2:70:4:1:1793350000:test', 'needs:botbuild:1']);
  assert.equal(reg.got, true); assert.equal(reg.needs, 1); assert.equal(reg.intel, 1);
  assert.equal(reg.list.length, 1); assert.equal(reg.list[0].module, 'botcore'); assert.equal(reg.after, 0);
  assert.ok(reg.before.metal > 0, 'projected stock of the home planet');
  assert.deepEqual(reg.sleep, { ok: true, reason: null }, 'sleep off -> always ok');
  assert.equal(reg.msu, 1 + 2 * 1.5 + 3 * 3);
  assert.equal(reg.key, '2:70:4:3');
  assert.deepEqual(reg.ft, { duration: 653, fuel: 118, distance: 1020 }, 'fleet.md §4 real numbers');
  // user first: a trusted click in the game holds normal actions, a defense action passes
  await page.mouse.click(700, 300);
  await until(async () => { const v = await env.get('botcore.userBusy'); return v && v.why === 'click' ? v : null; }, { what: 'userBusy written' });
  env.server.clearLog();
  // workers run one at a time, so one worker submits both actions without waiting on the first
  await env.evalOgx(page, (HOME) => {
    OGX.__u = {};
    OGX.bot.register({ id: 'botcore:user', module: 'botcore', startJitter: [0, 50], run(w) {
      w.act({ type: 'read.page', bodyId: HOME, why: 'обычное чтение', params: { page: 'research' }, prio: 'read' }).then((r) => { OGX.__u.n = { ok: r.ok }; });
      w.act({ type: 'read.page', bodyId: HOME, why: 'защита', params: { page: 'resources' }, prio: 'defense' }).then((r) => { OGX.__u.d = { ok: r.ok }; });
      return { nextInMs: 3600000 };
    } });
  }, HOME);
  const d = await until(() => env.evalOgx(page, () => OGX.__u.d), { what: 'defense result', timeoutMs: 40000 });
  assert.equal(d.ok, true, 'defense passes while the user is busy');
  assert.equal(await env.evalOgx(page, () => OGX.__u.n || null), null, 'normal action still queued');
  assert.equal(env.server.requests.filter((r) => r.page === 'research').length, 0);
  await env.evalOgx(page, () => OGX.settings.set('botcore.userIdleSec', 0));
  const n = await until(() => env.evalOgx(page, () => OGX.__u.n), { what: 'normal result', timeoutMs: 40000 });
  assert.equal(n.ok, true, 'runs once the user is idle');
  // notify reaches another tab
  const other = await env.game('buildings', { newPage: true });
  await sleep(1500);
  await env.evalOgx(page, () => OGX.bot.notify('Проверка уведомления', { level: 'warn' }));
  await other.waitForSelector('.ogx-toast-warn', { timeout: 8000 });
  assert.match(await other.textContent('.ogx-toast-warn'), /Проверка уведомления/);
  await mandatory(env, '(l)');
}, { timeout: 150000 });

// ------------------------------------------------------------------ (m) precise send already prepared ('pre'): gates again before step 3
T.test('(m) a prepared precise send is not sent when dry-run is turned on, the bot is paused or its body gets locked', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  const render = 1793348429 - 1012;
  const end = render + 1800;
  const hostile = `<div id="OvfleetEvents" class="OvfleetEvents_" style="padding:5px 10px;background-color:#000">
                <span id="fleettime_${end}777001" class="fleets" data-fleet-end-time="${end}" data-fleet-time="1800">00:30:00</span>
				<span class="fleet_static_time" data-fleet-end-time="10:33:37">10:33:37</span>
				<span><span class="flight attack">A hostile <a href="#" data-tooltip-content="x" class="tooltip attack">Fleet</a><span class="textForBlind"> (500 Light Fighter; 20 Battleship)</span> of player Raider <a href="#" onclick="return Dialog.PM(4242)">msg</a> from planet <a href="https://ogamex.eu/Aeternum/game.php?page=galaxy&amp;galaxy=2&amp;system=70" class="attack">[2:70:4]</a> is heading to planet Главная планета <a href="https://ogamex.eu/Aeternum/game.php?page=galaxy&amp;galaxy=2&amp;system=68" class="attack">[2:68:5]</a>. Mission: Attack</span></span>
            </div>`;
  const cases = [
    ['dry', () => env.evalOgx(page, () => OGX.settings.set('botcore.dryRun', true)), (r) => { assert.equal(r.dry, true, JSON.stringify(r)); assert.equal(r.refused, 'dryRun'); },
      () => env.evalOgx(page, () => OGX.settings.set('botcore.dryRun', false))],
    ['pause', () => env.evalOgx(page, () => OGX.bot.pause('user')), (r) => { assert.equal(r.ok, false); assert.equal(r.refused, 'stopped', JSON.stringify(r)); assert.match(r.message, /пауза/); },
      () => env.evalOgx(page, () => OGX.bot.resume())],
    ['threat', async () => {
      env.server.route('GET', 'overview', (req, res, ctx) => ctx.sendPage('overview', (html) => html.replace('<div class="allFleetsEvent">', hostile + '<div class="allFleetsEvent">')));
      await env.game('overview', { newPage: true });
    }, (r) => { assert.equal(r.ok, false); assert.equal(r.refused, 'threat', JSON.stringify(r)); }, null],
  ];
  for (const [tag, toggle, check, undo] of cases) {
    await sleep(2500);   // settings debounce of the previous case
    env.server.clearLog();
    await runActions(env, page, [SEND({ preciseIn: 60000, tolMs: 1500, why: 'точная отправка ' + tag })], { tag, id: 'botcore:test-' + tag });
    await until(async () => (await status(env, page)).queue.some((q) => q.state === 'pre'), { what: tag + ': pre', timeoutMs: 40000 });
    assert.ok(env.server.requests.some((x) => x.page === 'fleetStep2'), tag + ': steps 1-2 posted');
    await toggle();
    const [r] = await results(env, page, tag, 40000);
    check(r);
    assert.equal(env.server.requests.filter((x) => x.page === 'fleetStep3').length, 0, tag + ': step 3 never posted');
    assert.equal((await status(env, page)).queue.length, 0, tag + ': nothing left armed');
    if (undo) await undo();
  }
  await sleep(3000);
  assert.equal(env.server.requests.filter((x) => x.page === 'fleetStep3').length, 0, 'no late step 3');
  await mandatory(env, '(m)');
}, { timeout: 200000 });

// ------------------------------------------------------------------ (n) lost step-3 answer: verified on the fleetTable, never a blind second send
T.test('(n) step 3 processed but the answer lost (503): fleetTable check finds the fleet; check also lost -> "uncertain", target stays claimed', async () => {
  const B = require('./gz-bot-lib');
  const settings = Object.assign(isolate(), { 'botcore.master': true, 'botcore.dryRun': false }, FAST);
  const env = await B.launchBot({ world: 'basic', settings });
  try {
    const page = env.firstPage;
    let mode = 'pass';   // 'lost' = forward step 3, answer 503 ; 'lostAll' = also the next fleetTable read answers 503
    let failFt = false;
    await page.context().route(/page=(fleetStep3|fleetTable)/, async (route) => {
      const url = route.request().url();
      const isStep3 = /page=fleetStep3/.test(url);
      if (!isStep3 && failFt && route.request().method() === 'GET') { failFt = false; return route.fulfill({ status: 503, body: '<!doctype html><title>503</title>' }); }
      if (!isStep3 || mode === 'pass') return route.continue();
      const resp = await route.fetch({ url: url.replace('//ogamex.eu:', '//127.0.0.1:') });
      if (mode === 'lostAll') failFt = true;
      mode = 'pass';
      void resp;
      return route.fulfill({ status: 503, body: '<!doctype html><title>503</title><h1>Service Unavailable</h1>' });
    });
    await until(async () => (await env.evalOgx(page, () => OGX.bot.status())).leader, { what: 'leader', timeoutMs: 20000 });
    const ATT = (pos, g = 2, s = 68) => ({ type: 'fleet.send', bodyId: HOME, why: 'тест: атака', params: { target: { galaxy: g, system: s, position: pos, type: 1 }, ships: { 202: 20 }, mission: 1, speed: 10 } });
    // A: the answer is lost, the fleetTable read shows the new fleet -> ok, verified, the fleet id of the world
    mode = 'lost';
    await runActions(env, page, [ATT(10)], { tag: 'a', id: 'botcore:test-a' });
    const [a] = await results(env, page, 'a', 90000);
    const fa = env.world.fleets.filter((f) => f.owner === 'me' && f.to.coords === '2:68:10');
    assert.equal(fa.length, 1, 'one fleet in the world');
    assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.verified, true);
    assert.equal(a.data.fleetId, fa[0].id); assert.equal(a.data.uncertain, true);
    await env.waitJournal('botcore:action-uncertain');
    // B: answer and check both lost -> error 'uncertain' (no blind retry), the claim stays: the same module's second send is refused
    mode = 'lostAll';
    await runActions(env, page, [ATT(4, 2, 69), ATT(4, 2, 69)], { tag: 'b', id: 'botcore:test-b' });
    const [b1, b2] = await results(env, page, 'b', 120000);
    assert.equal(b1.ok, false); assert.equal(b1.error, 'uncertain', JSON.stringify(b1));
    assert.equal(b2.refused, 'duplicate', JSON.stringify(b2));
    assert.equal(env.world.fleets.filter((f) => f.owner === 'me' && f.to.coords === '2:69:4').length, 1, 'exactly one fleet to 2:69:4');
    const claims = await env.evalOgx(page, () => OGX.bot.claims());
    assert.ok(claims.some((c) => c.key === '1:2:69:4:1' && c.state === 'uncertain'), JSON.stringify(claims));
  } finally { await env.close(); }
}, { timeout: 300000 });

// ------------------------------------------------------------------ (o) shared read cache, read gap, writes before reads, panel line
T.test('(o) read cache: identical reads within readCacheSec answered from memory (same format), fresh:true reads, a build drops the planet; reads use readGapMs, writes jump queued reads; panel «Запросов: …»', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.dryRun': false, 'botcore.minGapMs': 1000, 'botcore.maxGapMs': 1100, 'botcore.maxBuildsPerHour': 50 }) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  const defaults = await env.evalOgx(page, () => ({ g: OGX.settings.get('botcore.readGapMs'), c: OGX.settings.get('botcore.readCacheSec'), rg: OGX.bot.readGapMs(),
    min: OGX.settings.schema('botcore').botcore.readGapMs.min, ttl: ['read.page', 'read.fleetTable', 'read.galaxy'].map((t) => OGX.bot._readCache.ttl(t)) }));
  assert.deepEqual(defaults, { g: 150, c: 10, rg: 150, min: 100, ttl: [10000, 30000, 60000] });
  env.server.clearLog();
  await env.evalOgx(page, ({ HOME, COLONY }) => {
    OGX.__t = { o: { done: false } };
    const slim = (r) => JSON.parse(JSON.stringify(Object.assign({}, r, { data: r.data ? Object.assign({}, r.data, { doc: undefined, html: undefined, keys: Object.keys(r.data).sort(), docOk: !!(r.data.doc && r.data.doc.querySelector) }) : r.data })));
    OGX.bot.register({
      id: 'botcore:test-o', module: 'botcore', prio: 'fleet', startJitter: [0, 50],
      async run(w) {
        if (OGX.__t.o.started) return { nextInMs: 3600000 };
        OGX.__t.o.started = true;
        const out = OGX.__t.o;
        const FT = { type: 'read.fleetTable', bodyId: HOME, prio: 'read', params: {}, why: 'тест: флот' };
        const BL = { type: 'read.page', bodyId: COLONY, prio: 'read', params: { page: 'buildings' }, why: 'тест: постройки колонии' };
        out.ft1 = slim(await w.act(FT));
        out.ft2 = slim(await w.act(FT));                                        // cached
        out.ft3 = slim(await w.act(Object.assign({ fresh: true }, FT)));        // a read right before an order: always the server
        const [b1, b2] = await Promise.all([w.act(BL), w.act(BL)]);            // the second joins the queued first
        out.b1 = slim(b1); out.b2 = slim(b2);
        out.b3 = slim(await w.act(BL));                                         // cached
        out.build = slim(await w.act({ type: 'build.building', bodyId: COLONY, prio: 'build', params: { id: 1, cmd: 'insert' }, why: 'тест: рудник' }));
        out.b4 = slim(await w.act(BL));                                         // the build dropped the colony's pages
        out.ft4 = slim(await w.act(FT));                                        // other planet: still cached
        // writes before reads queued earlier
        const reads = [w.act({ type: 'read.page', bodyId: HOME, prio: 'read', params: { page: 'research' }, why: 'тест: р1' }),
          w.act({ type: 'read.page', bodyId: HOME, prio: 'read', params: { page: 'shipyard', mode: 'fleet' }, why: 'тест: р2' })];
        const bld = w.act({ type: 'build.building', bodyId: HOME, prio: 'build', params: { id: 2, cmd: 'insert' }, why: 'тест: кристалл' });
        await Promise.all(reads.concat([bld]));
        out.eff = OGX.bot.efficiency();
        out.done = true;
        return { nextInMs: 3600000, reason: 'test done' };
      },
    });
  }, { HOME, COLONY });
  const o = await until(() => env.evalOgx(page, () => (OGX.__t.o.done ? OGX.__t.o : null)), { timeoutMs: 120000, stepMs: 400, what: 'test worker (o)' });
  for (const k of ['ft1', 'ft2', 'ft3', 'b1', 'b2', 'b3', 'build', 'b4', 'ft4']) assert.equal(o[k].ok, true, k + ': ' + JSON.stringify(o[k]).slice(0, 300));
  // the cached answer has the format of a real read (its own parsed doc, the parsed fleetTable) and the time of that read
  assert.deepEqual(Object.keys(o.ft2).sort(), Object.keys(o.ft1).sort());
  assert.deepEqual(o.ft2.data.keys, o.ft1.data.keys); assert.equal(o.ft2.data.docOk, true);
  assert.deepEqual(o.ft2.data.fleetTable, o.ft1.data.fleetTable);
  assert.equal(o.ft2.at, o.ft1.at, 'cached: the original read time');
  assert.ok(o.ft3.at > o.ft1.at, 'fresh: a new read');
  assert.equal(o.b2.at, o.b1.at, 'joined the queued identical read'); assert.equal(o.b2.data.docOk, true);
  assert.equal(o.b3.at, o.b1.at, 'cached');
  assert.ok(o.b4.at > o.build.at - 1, 'read again after the build on that planet');
  assert.equal(o.ft4.at, o.ft3.at, 'a build on the colony keeps the home fleetTable cached');
  const R = env.server.requests;
  const ftGets = R.filter((r) => r.method === 'GET' && /^fleettable$/i.test(r.page) && r.cp === HOME);
  assert.equal(ftGets.length, 2, 'fleetTable: read + fresh read, the rest from the cache');
  const blGets = R.filter((r) => r.method === 'GET' && r.page === 'buildings' && r.cp === COLONY && !Object.keys(r.form || {}).length);
  const postB = R.find((r) => r.method === 'POST' && r.page === 'buildings' && r.cp === COLONY);
  assert.equal(blGets.filter((r) => r.t < postB.t).length, 1, 'three reads of the colony buildings before the build -> one request');
  // gaps: reads 150 ms, writes minGapMs..maxGapMs (1000-1100 here)
  const i3 = R.indexOf(ftGets[1]);
  const next = R[i3 + 1];
  assert.ok(next && next.t - ftGets[1].t < 900, 'a read follows a read after readGapMs, not minGapMs: ' + (next && next.t - ftGets[1].t) + ' ms');
  const prev = R[R.indexOf(postB) - 1];
  assert.ok(postB.t - prev.t >= 950, 'a write waits minGapMs: ' + (postB.t - prev.t) + ' ms');
  // the build queued after two reads ran first
  const starts = (await journal(env, page, 'botcore:action-start')).filter((e) => /тест: (р1|р2|кристалл)/.test(e.d.why || '')).map((e) => e.d.why);
  assert.equal(starts[0], 'тест: кристалл', 'the build jumps the queued reads: ' + starts.join(', '));
  // efficiency of the last hour + no journal line per cache hit
  assert.equal(o.eff.cached, 4, JSON.stringify(o.eff));
  assert.equal(o.eff.builds, 2); assert.equal(o.eff.sends, 0);
  assert.ok(o.eff.reads >= 6 && o.eff.requests >= o.eff.reads, JSON.stringify(o.eff));
  const done = await journal(env, page, 'botcore:action-done');
  assert.equal(done.filter((e) => e.d.why === 'тест: флот').length, 2, 'cache hits are not journaled as actions');
  await openBotPanel(env, page);
  const eff = await page.textContent('.ogx-b-bot-eff');
  assert.match(eff, /^Запросов: \d+ \(чтений \d+, из кэша \d+\), построек 2, отправок 0$/, eff);
  // memory (audit botcore-6): entries keep the html, never the parsed Document; expired entries are swept without a new read
  const mem = await env.evalOgx(page, () => ({ n: OGX.bot._readCache.size(), docs: [...OGX.bot._R.readCache.values()].filter((c) => c.r && c.r.data && c.r.data.doc).length,
    html: [...OGX.bot._R.readCache.values()].every((c) => typeof c.r.data.html === 'string'), bytes: OGX.bot._readCache.bytes() }));
  assert.ok(mem.n > 0, JSON.stringify(mem)); assert.equal(mem.docs, 0, 'no Document kept'); assert.equal(mem.html, true); assert.ok(mem.bytes > 0);
  await env.evalOgx(page, () => OGX.settings.set('botcore.readCacheSec', 0));   // ttl 0: every entry is expired
  assert.equal(await env.evalOgx(page, () => { OGX.bot._readCache.sweep(); return OGX.bot._readCache.size(); }), 0, 'expired entries swept');
  assert.equal(await env.evalOgx(page, () => OGX.bot._readCache.bytes()), 0);
  await mandatory(env, '(o)');
  await env.close();
}, { timeout: 200000 });

// ------------------------------------------------------------------ (p) game facts are refusals, not errors (audit core-fleet-2/-3)
T.test('(p) game facts: fleetAjax 601/605, step-3 bash limit / admin texts, build info pages -> refusals with the server text, no backoff, no streak', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false, 'botcore.maxErrors': 2 }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  const S = env.server.state;
  const AJ = { type: 'fleet.ajax', bodyId: HOME, why: 'тест: шпионаж', params: { mission: 6, planetId: 999001 } };
  // 1. fleetAjax answers that describe the target
  S.fleetAjax = { code: 601, mess: 'Fault, planet does not exist', slots: 1 };
  await runActions(env, page, [AJ], { tag: 'a1', id: 'botcore:a1' });
  const [a1] = await results(env, page, 'a1', 30000);
  assert.equal(a1.refused, 'target', JSON.stringify(a1)); assert.equal(a1.code, 601); assert.match(a1.message, /does not exist/);
  S.fleetAjax = { code: 605, mess: 'Player is in vacation mode', slots: 1 };
  await runActions(env, page, [AJ], { tag: 'a2', id: 'botcore:a2' });
  const [a2] = await results(env, page, 'a2', 30000);
  assert.equal(a2.refused, 'vacation', JSON.stringify(a2));
  S.fleetAjax = null;
  // 2. step-3 info pages that are game facts (bash protection, admin) -> refusals with the text
  S.fleetError = 'Превышен лимит количества атак в сутки на данный пункт назначения.';
  await runActions(env, page, [SEND({ why: 'тест: лимит атак' })], { tag: 's1', id: 'botcore:s1' });
  const [s1] = await results(env, page, 's1', 40000);
  assert.equal(s1.refused, 'attackLimit', JSON.stringify(s1)); assert.match(s1.message, /Превышен лимит/);
  S.fleetError = 'Полёты на администраторов запрещены.';
  await runActions(env, page, [SEND({ why: 'тест: админ' })], { tag: 's2', id: 'botcore:s2' });
  const [s2] = await results(env, page, 's2', 40000);
  assert.equal(s2.refused, 'admin', JSON.stringify(s2));
  S.fleetError = null;
  // 3. build info pages: error 'info' with the kind (the module re-reads and counts its retry), never the backoff ladder
  S.buildError = 'Недостаточно ресурсов';
  await runActions(env, page, [{ type: 'build.building', bodyId: HOME, prio: 'build', params: { id: 1, cmd: 'insert' }, why: 'тест: рудник' }], { tag: 'b1', id: 'botcore:b1' });
  const [b1] = await results(env, page, 'b1', 30000);
  assert.equal(b1.ok, false); assert.equal(b1.error, 'info'); assert.equal(b1.code, 'resources', JSON.stringify(b1)); assert.match(b1.message, /Недостаточно ресурсов/);
  S.buildError = 'Максимальное количество построек в очереди 5.';
  await runActions(env, page, [{ type: 'build.units', bodyId: HOME, prio: 'build', params: { units: { 212: 10 } }, why: 'тест: спутники' }], { tag: 'b2', id: 'botcore:b2' });
  const [b2] = await results(env, page, 'b2', 30000);
  assert.equal(b2.code, 'queueFull', JSON.stringify(b2));
  S.buildError = null;
  // six game facts with maxErrors 2: no backoff, no pause, no streak
  const st = await status(env, page);
  assert.equal(st.state === 'paused', false, 'not paused: ' + st.state);
  assert.equal(st.consecutiveErrors, 0, JSON.stringify(st.errors));
  assert.deepEqual(await journal(env, page, 'botcore:backoff'), [], 'no backoff');
  // 3. fleetAjax 620 (own vacation mode) stops the bot like a vacation page
  S.fleetAjax = { code: 620, mess: 'Vacation mode active', slots: 1 };
  await runActions(env, page, [AJ], { tag: 'a3', id: 'botcore:a3' });
  await waitJournal(env, page, 'botcore:stop', { pred: (e) => e.d.reason === 'vacation' });
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('botcore.master')), false);
  await mandatory(env, '(p)');
  await env.close();
}, { timeout: 200000 });

// ------------------------------------------------------------------ (q) cp-restore only for a user, inside the queue (audit botcore-4/-5/-9)
T.test('(q) cp-restore: none while the tab is hidden or nobody is there, one after user input (queued, no overlap); forms page: cp-changing actions wait 15 s after a click, a deadline one is restored at once', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false }, FAST)) });
  let page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  await env.evalOgx(page, () => { OGX.bot._R.startPauseUntil = 0; });
  const restores = () => env.server.requests.filter((r) => r.method === 'GET' && r.page === 'overview' && r.cp === HOME);
  // 1. hidden tab, no user: an action on the colony is never followed by a restore
  await env.evalOgx(page, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  env.server.clearLog();
  await runActions(env, page, [{ type: 'read.page', bodyId: COLONY, prio: 'read', why: 'тест: колония (скрыто)', params: { page: 'buildings' } }], { tag: 'h1', id: 'botcore:h1' });
  await results(env, page, 'h1', 30000);
  await sleep(6000);
  assert.equal(restores().length, 0, 'no cp-restore while hidden');
  assert.deepEqual(await journal(env, page, 'botcore:cp-restore'), []);
  // 2. visible again, but nobody active on a page without forms (overview): still none
  await env.evalOgx(page, () => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(4000);
  assert.equal(restores().length, 0, 'no cp-restore without a user');
  // 3. the user presses a key: one restore, as a queue entry (journaled), no request overlaps
  await userInput(page);
  const rs = await waitJournal(env, page, 'botcore:cp-restore', { timeoutMs: 10000 });
  assert.equal(rs.d.cp, HOME); assert.equal(rs.d.ok, true);
  assert.equal(restores().length, 1, 'exactly one GET overview&cp=' + HOME);
  assert.ok((await journal(env, page, 'botcore:action-start')).some((e) => /возврат текущей планеты/.test(e.d.why || '')), 'the restore ran through the executor');
  // 4. forms page (buildings): within 15 s of a click a read on the colony waits; a deadline read runs and is restored at once
  page = await env.game('buildings', { cp: HOME });
  await until(async () => (await status(env, page)).leader, { what: 'leader on buildings', timeoutMs: 15000 });
  await env.evalOgx(page, () => { OGX.bot._R.startPauseUntil = 0; });
  await sleep(4000);   // the drain of the navigation
  env.server.clearLog();
  await userInput(page);
  const tClick = Date.now();
  await runActions(env, page, [{ type: 'read.page', bodyId: COLONY, prio: 'deadline', fresh: true, why: 'тест: срочно на колонии', params: { page: 'research' } }], { tag: 'd1', id: 'botcore:d1' });
  await results(env, page, 'd1', 20000);
  await until(() => restores().length >= 1, { what: 'urgent restore', timeoutMs: 8000 });
  const R1 = env.server.requests;
  const iD = R1.findIndex((r) => r.page === 'research' && r.cp === COLONY);
  assert.ok(iD >= 0 && R1[iD + 1] && R1[iD + 1].page === 'overview' && R1[iD + 1].cp === HOME, 'the deadline request is followed by the restore: ' + R1.map((r) => r.page + ':' + r.cp).join(', '));
  await runActions(env, page, [{ type: 'read.page', bodyId: COLONY, prio: 'read', fresh: true, why: 'тест: колония под формой', params: { page: 'resources' } }], { tag: 'n1', id: 'botcore:n1' });
  await results(env, page, 'n1', 40000);
  const nReq = env.server.requests.find((r) => r.page === 'resources' && r.cp === COLONY);
  assert.ok(nReq && Date.now() - tClick >= 13000, 'the colony read waited for the 15-s form window (' + (Date.now() - tClick) + ' ms)');
  await mandatory(env, '(q)');
  await env.close();
}, { timeout: 200000 });

// ------------------------------------------------------------------ (j2) threat target type from the target segment (audit tests-mock-2)
T.test('(j2) threatFromEvent: the type word of the TARGET (ru/en/de, Unicode boundaries), never the origin\'s «Луна»; flights keep the sentence type', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  const r = await env.evalOgx(page, () => {
    const T = OGX.bot._threat;
    const ev = (text, to) => ({ own: false, hostile: true, status: 'flight', endUnix: Math.round(OGX.time.serverNow() / 1000) + 600, key: '1793350000555', fleetId: 555, mission: 1, from: '2:69:4', to, text, shipsText: '50 Light Fighter' });
    return {
      ruFromMoon: T.targetType('Чужой флот игрока Jon Snow летит с Луна Mond [2:69:4] на Планета Главная планета [2:68:5]. Задание: Атака', '2:68:5'),
      ruToMoon: T.targetType('Чужой флот игрока Jon Snow летит с Планета Snow [2:69:4] на Луна Луна [2:68:5]. Задание: Атака', '2:68:5'),
      enFromMoon: T.targetType('A hostile fleet from player Jon Snow from Moon Mond [2:69:4] reached the Planet Moonbase [2:68:5]. Mission: Attack', '2:68:5'),
      enToMoon: T.targetType('A hostile fleet from player Jon Snow from Planet X [2:69:4] reached the Moon Planet [2:68:5]. Mission: Attack', '2:68:5'),
      deToMoon: T.targetType('Eine feindliche Flotte vom Spieler X vom Planet Y [2:69:4] erreicht den Mond Z [2:68:5]. Mission: Angreifen', '2:68:5'),
      debris: T.targetType('... с Планета X [2:69:4] на Поле обломков [2:68:5]. Задание: Атака', '2:68:5'),
      planetWord: T.targetType('... с Планета X [2:69:4] на Планетарий Луноход [2:68:5].', '2:68:5'),
      threat: T.fromEvent(ev('Чужой флот игрока Jon Snow летит с Луна Mond [2:69:4] на Планета Главная планета [2:68:5]. Задание: Атака', '2:68:5')),
    };
  });
  assert.equal(r.ruFromMoon, 1, 'origin moon, target planet (ru)'); assert.equal(r.ruToMoon, 3, 'target moon (ru «Луна»)');
  assert.equal(r.enFromMoon, 1); assert.equal(r.enToMoon, 3); assert.equal(r.deToMoon, 3); assert.equal(r.debris, 2);
  assert.equal(r.planetWord, null, 'no type word inside other words');
  assert.equal(r.threat.toType, 1); assert.equal(r.threat.bodyKey, 'p' + HOME, JSON.stringify(r.threat));
  assert.equal(r.threat.ownerName, 'Jon Snow', 'the name ends at « с» (Unicode)');
  await mandatory(env, '(j2)');
  await env.close();
}, { timeout: 90000 });

// ------------------------------------------------------------------ (h2) captcha only from markup (audit botcore-11)
T.test('(h2) captcha words in player-made text (a planet name, a message subject) do not stop the bot; a page=captcha redirect does', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  env.server.route('GET', 'resources', (req, res, ctx) => ctx.sendPage('overview', (html) => html.replace('<div id="inhalt">', '<div id="inhalt"><table><tr><td>Планета Captcha [2:70:4] игрока reCAPTCHA (hcaptcha)</td></tr></table>')));
  env.server.route('GET', 'messages', (req, res, ctx) => ctx.send(200, '<form action="game.php?page=messages" method="post"><div class="mainRS"><table id="messagestable"><tbody><tr><th colspan="4">Messages</th></tr>'
    + '<tr id="message_1"><td>02.11</td><td>Captcha</td><td>Solve the captcha? reCAPTCHA</td><td></td></tr></tbody></table></div></form>'));
  await runActions(env, page, [
    { type: 'read.page', bodyId: HOME, why: 'тест: имя «Captcha»', params: { page: 'resources' } },
    { type: 'read.messages', why: 'тест: тема «captcha»', params: { cat: 100 } },
  ]);
  const [a, b] = await results(env, page, 'r', 40000);
  assert.equal(a.ok, true, JSON.stringify(a).slice(0, 300)); assert.equal(b.ok, true, JSON.stringify(b).slice(0, 300));
  let st = await status(env, page);
  assert.notEqual(st.state, 'stopped'); assert.equal(st.master, true);
  assert.deepEqual(await journal(env, page, 'botcore:captcha'), []);
  // a redirect to page=captcha (any markup) stops it
  env.server.route('GET', 'research', (req, res, ctx) => ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/game.php?page=captcha' }));
  env.server.route('GET', 'captcha', (req, res, ctx) => ctx.sendPage('overview'));
  await runActions(env, page, [{ type: 'read.page', bodyId: HOME, why: 'тест: капча', params: { page: 'research' } }], { tag: 'c', id: 'botcore:c' });
  await results(env, page, 'c', 30000);
  await waitJournal(env, page, 'botcore:captcha');
  st = await status(env, page);
  assert.equal(st.stopReason, 'captcha');
  await mandatory(env, '(h2)');
  await env.close();
}, { timeout: 120000 });

// ------------------------------------------------------------------ (g2) precise timer in a hidden tab (audit botcore-3)
T.test('(g2) clock.precise in a hidden tab (main-thread timers clamped to 1 s): fires on time via the Worker (never the 1-s clamp)', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  const lates = await env.evalOgx(page, async () => {
    const C = OGX.bot._clock;
    if (C.mode !== 'worker') return { mode: C.mode };
    const real = window.setTimeout;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.setTimeout = (fn, ms, ...a) => real(fn, Math.max(1000, +ms || 0), ...a);   // Chrome's hidden-tab clamping
    const out = [];
    try {
      for (let i = 0; i < 6; i++) {
        const target = Date.now() + 1700 + Math.floor(Math.random() * 400);
        out.push(await new Promise((res) => C.precise(target, () => res(Date.now() - target))));
      }
    } finally { window.setTimeout = real; delete document.hidden; }
    return out;
  });
  assert.ok(Array.isArray(lates), 'worker clock: ' + JSON.stringify(lates));
  // clamped main-thread timers make it >= 500 ms late (spin at target - 1.5 s, then 1-s steps); a loaded box (load 40 on 4 CPUs
  // here) delays a wake by up to ~150 ms
  assert.ok(lates.every((x) => x >= 0 && x < 400), 'late by ' + JSON.stringify(lates) + ' ms');
  await mandatory(env, '(g2)');
  await env.close();
}, { timeout: 90000 });

// ------------------------------------------------------------------ (r) unknown pages, ban page, info page answering a read (audit core-fleet-8 / botcore-12)
T.test('(r) an unknown 200 page is an error with backoff (master stays on), 5 in a row over 10 min stop; a ban page stops; a layout-less info page answering a read is error "info"', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false, 'botcore.maxErrors': 10 }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  await env.evalOgx(page, () => { OGX.bot._R.startPauseUntil = 0; });
  let answer = null;   // null = the saved page
  const MAINT = '<!DOCTYPE html><html><head><title>Технические работы</title></head><body><h1>Сервер на обслуживании</h1><p>Попробуйте позже.</p></body></html>';
  const bare = (text) => '<!DOCTYPE html><html><head><title>Aeternum</title></head><body><div class="headerRS"></div><div class="mainRS"><table class="table519"><tr><th>Info</th></tr><tr><td><p>' + text + '</p></td></tr></table></div></body></html>';
  env.server.route('GET', 'resources', (req, res, ctx) => (answer ? ctx.send(200, answer, 'text/html; charset=utf-8') : ctx.sendPage('resources')));
  const read = async (tag, why) => {
    await env.evalOgx(page, () => { OGX.bot._R.errors = {}; });   // no backoff wait between the steps
    await runActions(env, page, [{ type: 'read.page', bodyId: HOME, fresh: true, why, params: { page: 'resources' } }], { tag, id: 'botcore:' + tag });
    return (await results(env, page, tag, 40000))[0];
  };
  // 1. one maintenance page: error 'unknownPage' + backoff, journaled with title and text, the bot stays on; a good page resets the run
  answer = MAINT;
  const u1 = await read('u1', 'тест: страница обслуживания');
  assert.equal(u1.ok, false); assert.equal(u1.error, 'unknownPage', JSON.stringify(u1)); assert.match(u1.message, /Технические работы/);
  const up = await waitJournal(env, page, 'botcore:unknown-page');
  assert.equal(up.d.n, 1); assert.match(up.d.snippet, /обслуживании/);
  await waitJournal(env, page, 'botcore:backoff');
  let st = await status(env, page);
  assert.notEqual(st.state, 'stopped'); assert.equal(await env.evalOgx(page, () => OGX.settings.get('botcore.master')), true);
  answer = null;
  const ok1 = await read('ok1', 'тест: снова нормальная страница');
  assert.equal(ok1.ok, true, JSON.stringify(ok1));
  assert.equal(await env.evalOgx(page, () => OGX.bot._R.unknownPages), null, 'a good page ends the run');
  // 2. an info page without the game layout (the game closed) answering a read: error 'info' with the text, not ok with an empty view
  answer = bare('Вселенная в данный момент недоступна: обновление');
  const i1 = await read('i1', 'тест: игра закрыта');
  assert.equal(i1.ok, false); assert.equal(i1.error, 'info', JSON.stringify(i1)); assert.match(i1.message, /недоступна/);
  // 3. the 5th unknown page in a row, the first one 11 min ago: stop 'unknownPage'
  await env.evalOgx(page, () => { OGX.bot._R.unknownPages = { n: 4, first: OGX.time.serverNow() - 11 * 60000 }; });
  answer = MAINT;
  await read('u5', 'тест: пятая неизвестная страница');
  await waitJournal(env, page, 'botcore:stop', { pred: (e) => e.d.reason === 'unknownPage' });
  st = await status(env, page);
  assert.equal(st.state, 'stopped'); assert.equal(st.stopReason, 'unknownPage');
  // 4. a ban page (2Moons css_account_banned_message) stops at once
  answer = null;
  await env.evalOgx(page, () => OGX.bot.start());
  await until(async () => (await status(env, page)).leader, { what: 'leader again', timeoutMs: 20000 });
  await env.evalOgx(page, () => { OGX.bot._R.startPauseUntil = 0; });
  answer = bare('Ваш аккаунт заблокирован.<br><br>Вы заблокированы до 03.11.2026 10:00.');
  await runActions(env, page, [{ type: 'read.page', bodyId: HOME, fresh: true, why: 'тест: бан', params: { page: 'resources' } }], { tag: 'b1', id: 'botcore:b1' });
  await waitJournal(env, page, 'botcore:stop', { pred: (e) => e.d.reason === 'banned' });
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('botcore.master')), false);
  await mandatory(env, '(r)');
  await env.close();
}, { timeout: 200000 });

// ------------------------------------------------------------------ (s) small runtime fixes (audit core-fleet-14, botcore-17, botcore-18)
T.test('(s) cached slots apply at init (await state.slots); panel safety text says «всё включено»; clamped settings: stored value journaled + panel hint; a resumed tab that lost the lock gives up the lead', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false }, FAST)) });
  let page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  // 1. core-fleet-14: a fresh fleetTable slots record in storage is the starting R.slots of the next page (src 'cache')
  await env.evalOgx(page, async () => {
    const t = OGX.time.serverNow();
    await OGX.storage.set('slots', { fleet: { used: 3, max: 13 }, fleetSrc: 'fleetTable', expedition: { used: 1, max: 2 }, fleetT: t, t });
    await OGX.storage.flush();
  });
  page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader after reload', timeoutMs: 15000 });
  const sl = await env.evalOgx(page, () => OGX.bot._R.slots);
  assert.ok(sl && sl.src === 'cache' && sl.fleet.used === 3, 'R.slots from storage: ' + JSON.stringify(sl));
  // 2. botcore-17: the explainer under «Бот» matches the 0.3.2 defaults
  await openBotPanel(env, page);
  const expl = await page.locator('.ogx-b-bot-explainer').first().textContent();
  assert.doesNotMatch(expl, /всё выключено/); assert.match(expl, /включены по умолчанию/);
  // 2b. rules-5: a typed value above the max is stored clamped; the journal line carries the stored value, the panel says so
  await env.evalOgx(page, () => { OGX.suite.hub.panel.selectGroup('bot'); OGX.suite.hub.panel.selectTab('bot-common'); });
  const inp = page.locator('#ogx-set-botcore-galaxyViewsPerHour');
  await inp.fill('99999');
  await inp.dispatchEvent('change');
  await page.waitForSelector('.ogx-b-bot-clamp-hint', { timeout: 8000 });
  assert.match(await page.locator('.ogx-b-bot-clamp-hint').textContent(), /Введено 99999 — сохранено 3600 \(макс\. 3600\)/);
  await until(async () => (await inp.inputValue()) === '3600', { what: 'stored value back in the input', timeoutMs: 5000 });
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('botcore.galaxyViewsPerHour')), 3600);
  const sj = await waitJournal(env, page, 'botcore:settings', { pred: (e) => e.d && e.d.values && e.d.values['botcore.galaxyViewsPerHour'] !== undefined, timeoutMs: 8000 });
  assert.equal(sj.d.values['botcore.galaxyViewsPerHour'], 3600); assert.match(sj.w, /galaxyViewsPerHour = 3600/);
  // 3. botcore-18: 'resume' after the lock went to another tab -> leader-lost 'resumed-stale', no worker restart / pump
  await env.evalOgx(page, () => { OGX.bot._R.lock = { refresh: async () => false, release: async () => {} }; document.dispatchEvent(new Event('resume')); });
  const ll = await waitJournal(env, page, 'botcore:leader-lost', { pred: (e) => e.d.why === 'resumed-stale', timeoutMs: 8000 });
  assert.ok(ll);
  await mandatory(env, '(s)');
  await env.close();
}, { timeout: 120000 });

// ------------------------------------------------------------------ (u) worker schedules survive a navigation (audit botcore-13)
T.test('(u) a page navigation keeps each module worker\'s due time (stored schedule) and the start pause is 1-3 s (warm takeover)', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botsave.enabled': true, 'botsave.on': true }, FAST)) });
  let page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  const reg = (p) => env.evalOgx(p, () => {
    OGX.__runs = 0;
    OGX.bot.register({ id: 'botsave:sched', module: 'botsave', prio: 'fleet', startJitter: [0, 50], async run() { OGX.__runs++; return { nextInMs: 40000, reason: 'test' }; } });
  });
  await reg(page);
  await until(() => env.evalOgx(page, () => OGX.__runs >= 1), { what: 'first run', timeoutMs: 20000 });
  const stored = await until(async () => { const v = await env.get('botcore.schedule'); return v && v['botsave:sched'] ? v['botsave:sched'] : null; }, { what: 'schedule stored', timeoutMs: 8000 });
  const s0 = await env.evalOgx(page, () => OGX.time.serverNow());
  assert.ok(stored - s0 > 30000 && stored - s0 <= 40500, 'stored nextAt ~ +40 s: ' + (stored - s0));
  // navigation in the same tab: the new page registers the same worker; it keeps the stored due time, never the 0-50 ms jitter
  page = await env.game('buildings');
  await reg(page);
  await until(async () => (await status(env, page)).leader, { what: 'leader after navigation', timeoutMs: 15000 });
  await sleep(1500);
  const after = await env.evalOgx(page, () => {
    const st = OGX.bot.status(); const w = st.workers.find((x) => x.id === 'botsave:sched');
    return { nextAt: w && w.nextAt, runs: OGX.__runs, warm: OGX.bot._R.warmStart, pause: OGX.bot._R.startPauseUntil - OGX.time.serverNow(), now: OGX.time.serverNow() };
  });
  assert.equal(after.warm, true, 'warm takeover');
  assert.ok(after.pause < 3000, 'start pause 1-3 s: ' + after.pause);
  assert.equal(after.runs, 0, 'not re-run after the navigation');
  assert.ok(Math.abs(after.nextAt - stored) < 1000, 'nextAt kept: ' + (after.nextAt - stored) + ' ms off the stored one');
  const lead = (await journal(env, page, 'botcore:leader')).pop();
  assert.ok(lead, 'leader journaled');
  await mandatory(env, '(u)');
  await env.close();
}, { timeout: 120000 });

// ------------------------------------------------------------------ (t) requests and bookkeeping (audit botcore-7/-10/-14/-15, botbuild-6, new APIs)
T.test('(t) step 0 reuses a fresh fleetTable read, slots follow own sends, refusals keep the cache, verifyUncertain needs a NEW row, verifyBuild matches id+level, lines written once per 2 s, lastPageAt / read.page {after}, limits.remaining', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false, 'botcore.userIdleSec': 0 }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  await env.evalOgx(page, () => { OGX.bot._R.startPauseUntil = 0; });
  // 1. botcore-15: read.fleetTable HOME, then a send from HOME: one GET fleetTable before step 1; a force send reads again
  env.server.clearLog();
  const rem0 = await env.evalOgx(page, () => OGX.bot.limits.remaining('fleetSends'));
  await runActions(env, page, [{ type: 'read.fleetTable', bodyId: HOME, prio: 'read', params: {}, why: 'тест: флот перед отправкой' }, SEND({ why: 'тест: отправка после чтения' })], { tag: 'f1', id: 'botcore:f1' });
  const [ft1, s1] = await results(env, page, 'f1', 60000);
  assert.equal(ft1.ok, true); assert.equal(s1.ok, true, JSON.stringify(s1));
  let R = env.server.requests;
  const iS1 = R.findIndex((r) => r.page === 'fleetStep1');
  assert.equal(R.slice(0, iS1).filter((r) => r.page === 'fleetTable' && r.method === 'GET').length, 1, 'one fleetTable GET before step 1: ' + R.map((r) => r.method + ' ' + r.page).join(', '));
  // 2. botcore-14: the cached slots follow the send without a read; limits.remaining dropped by one
  const sl = await env.evalOgx(page, () => OGX.bot._R.slots);
  assert.equal(sl.src, 'adjusted', JSON.stringify(sl)); assert.equal(sl.fleet.used, ft1.data.slots.fleet.used + 1, JSON.stringify(sl));
  assert.equal(await env.evalOgx(page, () => OGX.bot.limits.remaining('fleetSends')), rem0 - 1);
  // a refusal before any request (limit) keeps every cached page
  await runActions(env, page, [{ type: 'read.fleetTable', bodyId: COLONY, prio: 'read', params: {}, why: 'тест: флот колонии' }], { tag: 'f2', id: 'botcore:f2' });
  await results(env, page, 'f2', 30000);
  const size0 = await env.evalOgx(page, () => OGX.bot._readCache.size());
  await env.evalOgx(page, () => OGX.settings.set('botcore.maxFleetSendsPerHour', 1));
  await runActions(env, page, [SEND({ why: 'тест: отказ лимита' })], { tag: 'f3', id: 'botcore:f3' });
  const [f3] = await results(env, page, 'f3', 30000);
  assert.equal(f3.refused, 'limit', JSON.stringify(f3));
  assert.equal(await env.evalOgx(page, () => OGX.bot._readCache.size()), size0, 'the refused send kept the read cache');
  await env.evalOgx(page, () => OGX.settings.set('botcore.maxFleetSendsPerHour', 500));
  // force: never the cached step 0
  env.server.clearLog();
  await runActions(env, page, [{ type: 'read.fleetTable', bodyId: HOME, prio: 'read', params: {}, why: 'тест: флот 2' }, SEND({ cls: 'force', why: 'тест: force' })], { tag: 'f4', id: 'botcore:f4' });
  await results(env, page, 'f4', 60000);
  R = env.server.requests;
  const iS1b = R.findIndex((r) => r.page === 'fleetStep1');
  assert.equal(R.slice(0, iS1b).filter((r) => r.page === 'fleetTable' && r.method === 'GET').length, 2, 'force: its own step 0');
  // 3. botcore-10: verifyUncertain accepts only a fleet id that was not there at step 0
  const vu = await env.evalOgx(page, async ({ HOME }) => {
    const fr = await new Promise((res) => {
      OGX.bot.register({ id: 'botcore:vu', module: 'botcore', prio: 'fleet', startJitter: [0, 50], async run(w) { res(await w.act({ type: 'read.fleetTable', bodyId: HOME, fresh: true, prio: 'read', params: {}, why: 'тест: полёты' })); return { nextInMs: 3600000 }; } });
    });
    const f = (fr.data.fleetTable.flights || []).find((x) => !x.returning && x.fleetId != null && x.target);
    if (!f) return { none: true, flights: fr.data.fleetTable.flights };
    const c = f.target.replace(/[[\]]/g, '').split(':').map(Number);
    const e = (before) => ({ id: 'vu', type: 'fleet.send', bodyId: HOME, params: { mission: f.missionId, target: { galaxy: c[0], system: c[1], position: c[2], type: 1 }, ships: {} }, flightsBefore: before });
    return { old: await OGX.bot._verifyUncertain(e([f.fleetId])), fresh: await OGX.bot._verifyUncertain(e([])), noSet: await OGX.bot._verifyUncertain(e(undefined)) };
  }, { HOME });
  assert.ok(!vu.none, 'a flight on the saved fleetTable: ' + JSON.stringify(vu));
  assert.equal(vu.old.ok, false); assert.equal(vu.old.error, 'uncertain', 'the old flight is not this send: ' + JSON.stringify(vu.old));
  assert.equal(vu.fresh.ok, true, JSON.stringify(vu.fresh));
  assert.equal(vu.noSet.error, 'uncertain');
  // 4. botbuild-6: the queue box must hold the element at the ordered level
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'fixtures', 'galaxyz', 'queue', 'buildings-queue5-live.html'), 'utf8');
  const vb = await env.evalOgx(page, (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const v = (id, level) => OGX.bot._verifyBuild({ type: 'build.building', params: { id, cmd: 'insert' }, plan: { step: { level } } }, doc, null, null, null);
    return { m50: v(1, 50), m51: v(1, 51), s9: v(71, 9), s10: v(71, 10) };
  }, html);
  assert.equal(vb.m50.ok, true); assert.equal(vb.s9.ok, true);
  assert.equal(vb.m51.ok, false, 'metal mine 51 is not in the queue (50 is): ' + JSON.stringify(vb.m51));
  assert.equal(vb.s10.ok, false, JSON.stringify(vb.s10));
  // 5. botcore-7: 100 module lines in a burst -> at most one storage write of 'lines' now, the last line stored within ~2 s
  const lw = await env.evalOgx(page, async () => {
    let n = 0;
    const orig = OGX.storage.set;
    OGX.storage.set = function (k, ...a) { if (k === 'botcore.lines') n++; return orig.call(this, k, ...a); };
    try {
      await new Promise((res) => {
        OGX.bot.register({ id: 'botcore:lines', module: 'botcore', prio: 'fleet', startJitter: [0, 50], async run(w) { for (let i = 0; i < 100; i++) w.rec('test', 'строка ' + i); res(); return { nextInMs: 3600000 }; } });
      });
      const n1 = n;
      await new Promise((r) => setTimeout(r, 2600));
      const stored = await OGX.storage.get('botcore.lines', []);
      return { n1, n2: n, last: (stored[stored.length - 1] || {}).what };
    } finally { OGX.storage.set = orig; }
  });
  assert.ok(lw.n1 <= 1, 'writes during the burst: ' + lw.n1); assert.ok(lw.n2 <= 2, 'writes after 2.6 s: ' + lw.n2);
  assert.equal(lw.last, 'строка 99');
  // 6. lastPageAt and read.page { after }: met -> no request; not met -> one fresh GET; read.page { fresh } bypasses the cache
  const lp0 = await env.evalOgx(page, () => OGX.bot.lastPageAt());
  assert.ok(lp0 > 0, 'the page load counts');
  env.server.clearLog();
  await runActions(env, page, [
    { type: 'read.page', bodyId: HOME, prio: 'read', params: { page: 'overview', after: lp0 - 1000 }, why: 'тест: after выполнено' },
    { type: 'read.page', bodyId: HOME, prio: 'read', params: { page: 'overview', after: lp0 + 10 * 60000 }, why: 'тест: after не выполнено' },
    { type: 'read.page', bodyId: HOME, prio: 'read', params: { page: 'overview' }, why: 'тест: из кэша' },
    { type: 'read.page', bodyId: HOME, prio: 'read', params: { page: 'overview', fresh: true }, why: 'тест: fresh в params' },
  ], { tag: 'a1', id: 'botcore:a1' });
  const [a1, a2, a3, a4] = await results(env, page, 'a1', 40000);
  assert.equal(a1.ok, true); assert.equal(a1.cached, true, JSON.stringify(a1));
  assert.equal(a2.ok, true); assert.ok(!a2.cached);
  assert.equal(a3.at, a2.at, 'plain read from the cache');
  assert.ok(a4.at > a2.at, 'params.fresh: a new read');
  assert.equal(env.server.requests.filter((r) => r.page === 'overview').length, 2, 'after-met and the cached read made no request');
  assert.ok(await env.evalOgx(page, () => OGX.bot.lastPageAt()) >= a2.at, 'a bot page read moves lastPageAt');
  await mandatory(env, '(t)');
  await env.close();
}, { timeout: 240000 });

// ------------------------------------------------------------------ (v) the fleet dispatch page holds the queue, capped and visible (audit botcore missed-2)
T.test('(v) a fleetStep1 page holds normal actions (status pauseReason "userActive", journaled once), the lease is at most 90 s and capped at the token\'s 600 s', async () => {
  const env = await G.launch({ settings: isolate(Object.assign({ 'botcore.master': true, 'botcore.dryRun': false, 'botcore.userIdleSec': 0 }, FAST)) });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  const step = await env.game('fleetStep1', { newPage: true });
  await waitJournal(env, step, 'botcore:user-busy', { timeoutMs: 15000 });
  const ub = await until(async () => { const v = await env.get('botcore.userBusy'); return v && v.why === 'fleetStep' ? v : null; }, { what: 'fleetStep lease', timeoutMs: 8000 });
  assert.ok(ub.until - ub.t <= 90000, 'lease <= 90 s: ' + (ub.until - ub.t));
  const leaderPage = (await status(env, page)).leader ? page : step;
  await env.evalOgx(leaderPage, () => { OGX.bot._R.startPauseUntil = 0; });
  await runActions(env, leaderPage, [{ type: 'read.page', bodyId: HOME, prio: 'read', fresh: true, params: { page: 'resources' }, why: 'тест: ждёт страницу отправки' }], { tag: 'w1', id: 'botcore:w1' });
  const st = await until(async () => { const s = await status(env, leaderPage); return s.pauseReason === 'userActive' ? s : null; }, { what: 'pauseReason userActive', timeoutMs: 15000 });
  assert.notEqual(st.state, 'paused');
  assert.equal(await env.evalOgx(leaderPage, () => !!(OGX.__t.w1 && OGX.__t.w1.done)), false, 'the read waits');
  await mandatory(env, '(v)');
  await env.close();
}, { timeout: 120000 });
