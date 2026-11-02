'use strict';
// «Автовход» (botcore.autoLogin) against the GALAXYZ mock with a 2Moons-like login page at /Aeternum/index.php
// (upstream index template shape: form#login action=index.php?page=login, select[name=uni], input[name=username],
// input[name=password], submit «Вход"; the browser's autofill is simulated by a page script that fills the fields later).
//   (a) logout seen by a bot request with autoLogin on: pause 'logout' (master stays on), the leader tab opens the login
//       page, the content part waits for the autofill and clicks «Вход» once, the next game page resumes the bot;
//       the password never reaches storage or the journal
//   (b) the autofill never fills: no click, «Автовход: браузер не подставил пароль», gave up, bot stays paused
//   (c) the login page without a pending record does nothing; 3 attempts in the last hour -> no 4th
//   node tests/gz-bot-autologin.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'];
const SECRET = 'S3cr3t-autofill';
const isolate = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])),
  { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500 }, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeoutMs = 30000, stepMs = 250, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }   // the page may be navigating
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for ' + what);
    await sleep(stepMs);
  }
}
const status = (env, page) => env.evalOgx(page, () => OGX.bot.status());

function loginPage({ autofillMs = null } = {}) {
  const fill = autofillMs === null ? '' : `<script>setTimeout(function () { document.getElementById('username').value = 'vodoleyko1992'; document.getElementById('password').value = ${JSON.stringify(SECRET)}; }, ${autofillMs});</script>`;
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aeternum</title></head><body>'
    + '<div id="header"><a href="index.php?page=register">Регистрация</a> <a href="index.php?page=lostPassword">Забыли пароль?</a></div>'
    + '<div id="loginbox"><h1>Аeternum</h1><form id="login" name="login" action="index.php?page=login" data-action="index.php?page=login" method="post">'
    + '<div class="fieldwrapper"><label for="universe">Вселенная</label><select name="uni" id="universe" class="changeAction"><option value="1" selected>Aeternum</option></select></div>'
    + '<div class="fieldwrapper"><label for="username">Имя</label><input name="username" id="username" type="text" autocomplete="username"></div>'
    + '<div class="fieldwrapper"><label for="password">Пароль</label><input name="password" id="password" type="password" autocomplete="current-password"></div>'
    + '<div class="formRow"><input type="submit" class="loginButton" value="Вход"></div></form></div>' + fill + '</body></html>';
}
/** routes: GET resources -> logout redirect; GET index.php -> login page; POST index.php -> 302 overview (records the posts) */
function routes(env, opts) {
  const posts = [];
  env.server.route('GET', 'resources', (req, res, ctx) => ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/index.php?code=3' }));
  env.server.route('GET', '/Aeternum/index.php', (req, res, ctx) => ctx.send(200, loginPage(opts)));
  env.server.route('POST', '/Aeternum/index.php', (req, res, ctx) => { posts.push({ query: ctx.query, form: ctx.form }); ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/game.php?page=overview' }); });
  return posts;
}
async function logoutViaBot(env, page) {
  await env.evalOgx(page, () => {
    OGX.bot.register({
      id: 'botcore:test-logout', module: 'botcore', prio: 'fleet', startJitter: [0, 50],
      async run(w) {
        if (OGX.__lo) return { nextInMs: 3600000 };
        OGX.__lo = true;
        await w.act({ type: 'read.page', bodyId: 254102, why: 'тест: вылет', params: { page: 'resources' } });
        return { nextInMs: 3600000 };
      },
    });
  });
}
const alRecord = (env) => env.get('botcore.autologin', { scope: 'global' });
async function journal(env, page, re) {
  return (await env.evalOgx(page, () => (OGX.diag.recent({ s: 'B' }) || []).map((e) => ({ k: e.k, w: e.w, d: e.d })))).filter((e) => re.test(e.k));
}

T.test('(a) logout with autoLogin: pause (master on), login page, autofill, one click «Вход», resume on the next game page', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.autoLogin': true }) });
  const posts = routes(env, { autofillMs: 1200 });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  assert.equal(HOME, 254102);
  await logoutViaBot(env, page);
  // the leader tab goes to the login page, the content part clicks «Вход», the mock logs in and redirects to the overview
  await until(async () => posts.length >= 1, { what: 'login POST', timeoutMs: 40000 });
  assert.equal(posts.length, 1, 'one click');
  assert.equal(posts[0].query.page, 'login');
  assert.equal(posts[0].form.uni, '1');
  await until(async () => /game\.php\?page=overview/.test(page.url()) && (await env.evalOgx(page, () => !!(OGX.bot && OGX.bot._R && OGX.bot._R.inited))), { what: 'game page again', timeoutMs: 30000 });
  const st = await until(async () => { const s = await status(env, page); return s.state !== 'paused' && s.state !== 'off' ? s : null; }, { what: 'resumed', timeoutMs: 20000 });
  assert.equal(st.master, true, 'master stays on');
  assert.notEqual(st.state, 'stopped');
  assert.equal(st.pauseReason === 'logout', false);
  const al = await alRecord(env);
  assert.equal(al.pending, null, 'pending cleared');
  assert.equal(al.attempts.length, 1);
  assert.ok(!JSON.stringify(al).includes(SECRET), 'no password in storage');
  assert.ok(!JSON.stringify(await env.storage(env.ext[0])).includes(SECRET), 'no password anywhere in extension storage');
  const ev = await journal(env, page, /^botcore:autologin$/);
  assert.ok(ev.some((e) => /вход выполнен/.test(e.w)), 'journal: login done');
  assert.ok(!JSON.stringify(ev).includes(SECRET));
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(b) the browser never fills the password: no click, «браузер не подставил пароль», bot stays paused', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.autoLogin': true }) });
  const posts = routes(env, { autofillMs: null });
  const page = await env.game('overview');
  await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  await logoutViaBot(env, page);
  await until(async () => /index\.php/.test(page.url()), { what: 'login page', timeoutMs: 30000 });
  const al = await until(async () => { const r = await alRecord(env); return r && r.gaveUp ? r : null; }, { what: 'gave up', timeoutMs: 25000 });
  assert.match(al.last.text, /Автовход: браузер не подставил пароль/);
  assert.equal(posts.length, 0, 'nothing posted');
  assert.equal((al.attempts || []).length, 0);
  // reload of the login page: no second try for this logout
  await page.reload();
  await sleep(2500);
  assert.equal(posts.length, 0);
  // the bot is still on, paused for the logout
  const paused = await env.get('botcore.paused');
  assert.equal(paused.reason, 'logout');
  assert.equal(paused.resumeAfterLogin, true);
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(c) login page without a pending record: nothing; 3 attempts in the last hour: no 4th', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.autoLogin': true }) });
  const posts = routes(env, { autofillMs: 200 });
  const page = await env.open('/Aeternum/index.php', { waitReady: false });
  await sleep(3000);
  assert.equal(posts.length, 0, 'no pending: no click');
  const host = new URL(page.url()).host;
  const t = Date.now();
  await env.setStorage({ '*|*|botcore.autologin': { pending: { t: t - 1000, host, url: page.url() }, attempts: [t - 50000, t - 40000, t - 30000] } });
  await page.reload();
  const al = await until(async () => { const r = await alRecord(env); return r && r.gaveUp ? r : null; }, { what: 'gave up', timeoutMs: 15000 });
  assert.match(al.last.text, /3 попытки за час/);
  assert.equal(posts.length, 0, 'no 4th attempt');
  // a pending record of another host is ignored too
  await env.setStorage({ '*|*|botcore.autologin': { pending: { t: Date.now(), host: 'other.example:1', url: 'x' }, attempts: [] } });
  await page.reload();
  await sleep(2500);
  assert.equal(posts.length, 0);
}, { timeout: 90000 });
