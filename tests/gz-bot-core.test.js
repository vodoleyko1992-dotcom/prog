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
 *  atIn (ms from now -> at), preciseIn + tolMs (-> precise), deadlineIn. */
async function runActions(env, page, specs, { tag = 'r', id = 'botcore:test' } = {}) {
  await env.evalOgx(page, ({ specs, tag, id }) => {
    OGX.__t = OGX.__t || {};
    OGX.__t[tag] = { done: false, results: [] };
    OGX.bot.register({
      id, module: 'botcore', prio: 'fleet', startJitter: [0, 50],
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
  }, { specs, tag, id });
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
  assert.deepEqual(Object.fromEntries(defaults), { master: false, dryRun: true, maxActionsPerHour: 5000, maxFleetSendsPerHour: 30, galaxyViewsPerHour: 0, slotsReserve: 1, readMessages: true, sleepFrom: '01:30', deutReserve: 0,
    minGapMs: 300, maxGapMs: 600, autoLogin: false });
  assert.equal(await env.evalOgx(page, () => OGX.settings.schema('botcore').botcore.maxActionsPerHour.max), 20000, 'maxActionsPerHour up to 20000');
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
  for (const t of ['bot', 'bot-common', 'bot-botsave', 'bot-botfarm', 'bot-botdebris', 'bot-botbuild', 'bot-botexpo', 'bot-log']) assert.ok(tabs.includes(t), 'tab ' + t);
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
  // cp restore: the last action used the colony, the user is on the home planet
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
  await openBotPanel(env, page);
  await page.click('.ogx-b-bot-pause');   // «Продолжить»
  await until(async () => (await status(env, page)).state !== 'paused', { what: 'resumed' });
  st = await status(env, page);
  assert.equal(st.consecutiveErrors, 0);
  await waitJournal(env, page, 'botcore:resume');
  await mandatory(env, '(i)');
}, { timeout: 120000 });

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
  assert.deepEqual(defaults, { g: 150, c: 20, rg: 150, min: 100, ttl: [20000, 30000, 60000] });
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
  await mandatory(env, '(o)');
  await env.close();
}, { timeout: 200000 });
