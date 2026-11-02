'use strict';
// «Автовход» (botcore.autoLogin) against the GALAXYZ mock with a 2Moons-like login page at /Aeternum/index.php
// (upstream index template shape: form#login action=index.php?page=login, select[name=uni], input[name=username],
// input[name=password], submit «Вход»; the browser's autofill is simulated by a page script that fills the fields later)
// and a GALAXYZ-like one (<button type="button"> that posts via fetch).
// input[name=password], submit «Вход"; the browser's autofill is simulated by a page script that fills the fields later).
// [HYPOTHETICAL] (tests-mock-21): the live GALAXYZ logged-out index.php was never captured, so these tests prove autoLogin
// against the upstream template shape only; a different live form (field names, universe selector, captcha) is not covered.
//   (a) logout seen by a bot request with autoLogin on: pause 'logout' (master stays on), the leader tab opens the login
//       page, the content part waits for the autofill and clicks «Вход» once, the next game page resumes the bot;
//       the password never reaches storage or the journal
//   (b) the autofill never fills: banner «нужен один клик», no click; a real click that reveals nothing -> «жду ещё клик»;
//       after the 3rd such click «Автовход: браузер не подставил пароль», gave up, bot stays paused
//   (c) the login page without a pending record does nothing; 3 attempts in the last hour -> no 4th; a record for another
//       origin (https) or another universe directory of the same host is ignored, the matching one is used
//   (d) GALAXYZ-like page, credentials in the settings: the fields are filled, the fetch login fails (inline error),
//       the bot journals the diagnosis and retries with form.requestSubmit() -> native POST -> overview -> «вход выполнен»
//   (d2) a login form with neither action nor method: the fallback submit goes out as a POST to index.php?page=login,
//       the password never lands in a URL
//   (e) a saved password the browser reveals only after a REAL gesture: banner, a Playwright click anywhere, then the submit
//   (e2) the user types the password by hand (with a pause > 1.5 s): the bot never submits, the user's Enter logs in
//   (e3) the user's gesture is a click on «Войти» itself (slow AJAX login): the bot waits for it, no second POST
//   (f) the password lives only in the settings: journal export, settings block, storage export, status, console are clean;
//       the user-activity journal does not record the length of the typed password
//   (g) ?code=1 after an own attempt: gave up with «неправильный логин или пароль», no further click, credentials dropped
//   node tests/gz-bot-autologin.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'];
const SECRET = 'S3cr3t-autofill';
const USER = 'vodoleyko1992';
const isolate = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])),
  { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500 }, extra);
const withCred = (extra = {}) => isolate(Object.assign({ 'botcore.master': true, 'botcore.autoLogin': true, 'botcore.autoLoginUser': USER, 'botcore.autoLoginPass': SECRET }, extra));
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

/** 2Moons-like login page. autofillMs: a page script fills the fields after that delay (the browser's autofill);
 *  fillOnGesture: fills 300 ms after the first REAL pointerdown (Chromium keeps a saved password hidden until a gesture). */
function loginPage({ autofillMs = null, fillOnGesture = false } = {}) {
  const fillJs = `document.getElementById('username').value = ${JSON.stringify(USER)}; document.getElementById('password').value = ${JSON.stringify(SECRET)};`;
  let fill = '';
  if (autofillMs !== null) fill = `<script>setTimeout(function () { ${fillJs} }, ${autofillMs});</script>`;
  if (fillOnGesture) fill = `<script>document.addEventListener('pointerdown', function h(ev) { if (!ev.isTrusted) return; document.removeEventListener('pointerdown', h, true); setTimeout(function () { ${fillJs} }, 300); }, true);</script>`;
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aeternum</title></head><body>'
    + '<div id="header"><a href="index.php?page=register">Регистрация</a> <a href="index.php?page=lostPassword">Забыли пароль?</a></div>'
    + '<div id="loginbox"><h1>Аeternum</h1><form id="login" name="login" action="index.php?page=login" data-action="index.php?page=login" method="post">'
    + '<div class="fieldwrapper"><label for="universe">Вселенная</label><select name="uni" id="universe" class="changeAction"><option value="1" selected>Aeternum</option></select></div>'
    + '<div class="fieldwrapper"><label for="username">Имя</label><input name="username" id="username" type="text" autocomplete="username"></div>'
    + '<div class="fieldwrapper"><label for="password">Пароль</label><input name="password" id="password" type="password" autocomplete="current-password"></div>'
    + '<div class="formRow"><input type="submit" class="loginButton" value="Вход"></div></form></div>' + fill + '</body></html>';
}
/** GALAXYZ-like login page: the fields in form#login, a <button type="button"> whose onclick posts via fetch (ajax=1) only when
 *  the password has a value, else shows an inline <div class="error">; a failed fetch answer shows the error too. */
function gzLoginPage() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aeternum</title></head><body>'
    + '<div class="login-wrapper"><a href="index.php?page=register" class="btn">Регистрация</a>'
    + '<form id="login" name="login" action="index.php?page=login" method="post">'
    + '<div class="form-group"><input name="username" id="username" type="text" class="form-control" placeholder="Логин"></div>'
    + '<div class="form-group"><input name="password" id="password" type="password" class="form-control" placeholder="Пароль"></div>'
    + '<div id="loginError" class="error" hidden></div>'
    + '<button type="button" id="loginbtn" class="btn btn-primary" onclick="doLogin()">Войти</button>'
    + '</form></div>'
    + '<script>function doLogin() { var f = document.getElementById("login"), err = document.getElementById("loginError");'
    + ' if (!f.password.value) { err.hidden = false; err.textContent = "Введите пароль"; return; }'
    + ' var body = new URLSearchParams(new FormData(f)); body.set("ajax", "1");'
    + ' fetch("index.php?page=login", { method: "POST", body: body, credentials: "same-origin" })'
    + '  .then(function (r) { return r.text().then(function (t) { return { r: r, t: t }; }); })'
    + '  .then(function (x) { if (x.r.redirected) { location.href = x.r.url; return; } var j = {}; try { j = JSON.parse(x.t); } catch (e) {}'
    + '    if (j.ok) location.href = "game.php?page=overview"; else { err.hidden = false; err.textContent = j.error || "Ошибка входа"; } })'
    + '  .catch(function () { err.hidden = false; err.textContent = "Ошибка сети"; }); }</script>'
    + '</body></html>';
}
/** GALAXYZ-like page whose form names neither action nor method; its <button type="button"> runs a JS check that fails. */
function bareLoginPage() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aeternum</title></head><body>'
    + '<form id="login" name="login">'
    + '<input name="username" id="username" type="text"><input name="password" id="password" type="password">'
    + '<div id="loginError" class="error" hidden></div>'
    + '<button type="button" id="loginbtn" onclick="var e = document.getElementById(\'loginError\'); e.hidden = false; e.textContent = \'Проверка формы не прошла\';">Войти</button>'
    + '</form></body></html>';
}
/** The REAL ogamex.eu login page (saved by John 2026-11-02, eu/login): navbar and jumbotron «Войти» buttons only open the
 *  Bootstrap modal #modalLoginForm (data-toggle="modal"); form#login (POST, action …/index.php?page=login) holds the universe
 *  select, input#username-login[type=username] and input#inputPassword; the «Войти» submit button #login-submit stands in the
 *  modal-footer OUTSIDE the form; a jQuery submit handler posts {username, password} to login_valid.php and calls form.submit()
 *  when the answer is "1", else shows #error_notif. Bootstrap/jQuery are replaced by the equivalent plain JS.
 *  fillWhenShown: the browser fills the saved login/password only once the modal (the field) is shown. */
function ogamexLoginPage({ fillWhenShown = false } = {}) {
  const fillJs = fillWhenShown ? `setTimeout(function () { document.getElementById('username-login').value = ${JSON.stringify(USER)}; document.getElementById('inputPassword').value = ${JSON.stringify(SECRET)}; }, 300);` : '';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Главная - Eogame</title><style>#error_notif { display: none; } .modal { display: none; } .modal.show { display: block; }</style></head><body>'
    + '<nav class="navbar"><select class="lang m-2"><option>Русский</option></select>'
    + '<button class="btn btn-outline-success my-2 my-sm-0 m-1" type="submit" data-toggle="modal" data-target="#modalLoginForm">Войти</button>'
    + '<a href="index.php?page=register"><button class="btn btn btn-outline-primary my-2 my-sm-0 m-1" type="submit">Зарегистрироваться</button></a></nav>'
    + '<div class="jumbotron text-center"><h1 class="xiord">OGAMEX</h1>'
    + '<button type="button" class="btn btn-primary m-1 rounded xiord" data-toggle="modal" data-target="#modalLoginForm">Войти</button></div>'
    + '<div class="modal fade " id="modalLoginForm" tabindex="-1" role="dialog" aria-hidden="true"><div class="modal-dialog" role="document"><div class="modal-content">'
    + '<div class="modal-header"><h5 class="modal-title">Авторизация</h5><button type="button" class="close" data-dismiss="modal" aria-label="Close"><span>×</span></button></div>'
    + '<div class="modal-body"><div id="error_notif" class="alert alert-danger" role="alert">You used wrong credentials!</div>'
    + '<form id="login" class="evrenForm" name="login" action="index.php?page=login" method="post">'
    + '<div class="form-group"><select class="form-control" id="universe"><option value="4" selected>Aeternum (New)</option><option value="0">Nexus Prime</option></select></div>'
    + '<div class="form-group"><input type="username" name="username" id="username-login" class="form-control" placeholder="Логин"></div>'
    + '<div class="form-group"><input type="password" name="password" class="form-control" id="inputPassword" placeholder="Пароль"></div>'
    + '</form></div>'
    + '<div class="modal-footer"><button type="submit" name="login-submit" id="login-submit" tabindex="4" class="form-control btn btn-success">Войти</button>'
    + '<a href="index.php?page=lostPassword"><small>Восстановление пароля</small></a></div></div></div></div>'
    + '<script>'
    + 'document.addEventListener("click", function (ev) { var t = ev.target.closest("[data-toggle=modal]"); if (t) { var m = document.querySelector(t.getAttribute("data-target")); m.classList.add("show"); m.setAttribute("aria-hidden", "false"); ' + fillJs + ' }'
    + ' var d = ev.target.closest("[data-dismiss=modal]"); if (d) d.closest(".modal").classList.remove("show"); });'
    + 'document.getElementById("login").addEventListener("submit", function (e) { var form = this; e.preventDefault();'
    + ' var body = new URLSearchParams(); body.set("username", document.getElementById("username-login").value); body.set("password", document.getElementById("inputPassword").value);'
    + ' fetch("login_valid.php", { method: "POST", body: body, credentials: "same-origin" }).then(function (r) { return r.text(); })'
    + '  .then(function (data) { if (data == 1) { form.submit(); } else { document.getElementById("error_notif").style.display = "block"; } }); });'
    + '</script></body></html>';
}
/** routes for the real ogamex.eu page: login_valid.php answers "1" for the right pair (else "0"), the native POST logs in. */
function ogamexRoutes(env, opts = {}) {
  const valid = [];
  const posts = [];
  env.server.route('GET', 'resources', (req, res, ctx) => ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/index.php?code=3' }));
  env.server.route('GET', '/Aeternum/index.php', (req, res, ctx) => ctx.send(200, ogamexLoginPage(opts)));
  env.server.route('POST', '/Aeternum/login_valid.php', (req, res, ctx) => {
    valid.push({ t: Date.now(), form: ctx.form });
    ctx.send(200, ctx.form.username === USER && ctx.form.password === SECRET ? '1' : '0', 'text/html');
  });
  env.server.route('POST', '/Aeternum/index.php', (req, res, ctx) => {
    posts.push({ t: Date.now(), query: ctx.query, form: ctx.form });
    ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/game.php?page=overview' });
  });
  return { valid, posts };
}
/** routes: GET resources -> logout redirect; GET index.php -> login page; POST index.php -> 302 overview (records the posts),
 *  or 302 index.php?code=<postCode> (wrong login/password). */
function routes(env, opts = {}) {
  const posts = [];
  env.server.route('GET', 'resources', (req, res, ctx) => ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/index.php?code=3' }));
  env.server.route('GET', '/Aeternum/index.php', (req, res, ctx) => ctx.send(200, loginPage(opts)));
  env.server.route('POST', '/Aeternum/index.php', (req, res, ctx) => {
    posts.push({ query: ctx.query, form: ctx.form });
    const to = opts.postCode ? '/Aeternum/index.php?code=' + opts.postCode : '/Aeternum/game.php?page=overview';
    ctx.send(302, '', 'text/html', { Location: ctx.origin + to });
  });
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
/** The autologin events of the login page live in the background journal store (sent with 'ogx:diag:put'): read them from a game page. */
async function storedAutologin(env, page) {
  return env.evalOgx(page, async () => {
    const b = OGX.diag.backend();
    await b.flush();
    const r = await b.query({ sinceT: Date.now() - 20 * 60000, maxBytes: 8 * 1024 * 1024 });
    return (r.events || []).filter((e) => e.k === 'botcore:autologin').map((e) => ({ w: e.w, d: e.d }));
  });
}
const bannerText = (page) => page.evaluate(() => { const b = document.querySelector('.ogx-autologin-banner'); return b ? b.textContent : null; });
async function setup(env, { leader = true } = {}) {
  const page = await env.game('overview');
  if (leader) await until(async () => (await status(env, page)).leader, { what: 'leader', timeoutMs: 15000 });
  return page;
}
async function resumed(env, page) {
  await until(async () => /game\.php\?page=overview/.test(page.url()) && (await env.evalOgx(page, () => !!(OGX.bot && OGX.bot._R && OGX.bot._R.inited))), { what: 'game page again', timeoutMs: 30000 });
  const st = await until(async () => { const s = await status(env, page); return s.state !== 'paused' && s.state !== 'off' ? s : null; }, { what: 'resumed', timeoutMs: 20000 });
  assert.equal(st.master, true, 'master stays on');
  assert.notEqual(st.state, 'stopped');
  assert.equal(st.pauseReason === 'logout', false);
  // the pause ends a tick before resumeAfterLogin() journals «вход выполнен»: wait for the line before reading journals
  await until(async () => (await journal(env, page, /^botcore:autologin$/)).some((e) => /вход выполнен/.test(e.w)), { what: 'journal: login done', timeoutMs: 10000 });
  return st;
}

T.test('(a) logout with autoLogin: pause (master on), login page, autofill, one click «Вход», resume on the next game page', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.autoLogin': true }) });
  const posts = routes(env, { autofillMs: 1200 });
  const page = await setup(env);
  assert.equal(HOME, 254102);
  await logoutViaBot(env, page);
  // the leader tab goes to the login page, the content part clicks «Вход», the mock logs in and redirects to the overview
  await until(async () => posts.length >= 1, { what: 'login POST', timeoutMs: 40000 });
  assert.equal(posts.length, 1, 'one click');
  assert.equal(posts[0].query.page, 'login');
  assert.equal(posts[0].form.uni, '1');
  await resumed(env, page);
  const al = await alRecord(env);
  assert.equal(al.pending, null, 'pending cleared');
  assert.equal(al.attempts.length, 1);
  assert.ok(!JSON.stringify(al).includes(SECRET), 'no password in storage');
  assert.ok(!JSON.stringify(await env.storage(env.ext[0])).includes(SECRET), 'no password anywhere in extension storage');
  const ev = await journal(env, page, /^botcore:autologin$/);
  assert.ok(ev.some((e) => /вход выполнен/.test(e.w)), 'journal: login done');
  assert.ok(!JSON.stringify(ev).includes(SECRET));
  const lp = await storedAutologin(env, page);
  const first = lp.find((e) => /попытка 1 из 3/.test(e.w));
  assert.ok(first, 'login page journaled the attempt: ' + JSON.stringify(lp.map((e) => e.w)));
  assert.equal(first.d.method, 'click');
  assert.equal(first.d.how, 'autofill');
  assert.match(first.d.button, /^input\.loginButton\[submit\] «Вход»$/);
  assert.ok(!JSON.stringify(lp).includes(SECRET));
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(b) the browser never fills the password: banner «нужен один клик», no click; after a real click still nothing: «браузер не подставил пароль», bot stays paused', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.autoLogin': true }) });
  const posts = routes(env, { autofillMs: null });
  const page = await setup(env);
  await logoutViaBot(env, page);
  await until(async () => /index\.php/.test(page.url()), { what: 'login page', timeoutMs: 30000 });
  // ~10 s without a password: the bot asks for one click (banner + title), journals it once, does not give up yet
  const al = await until(async () => { const r = await alRecord(env); return r && r.last && /нужен один клик по странице входа/.test(r.last.text) ? r : null; }, { what: 'click asked', timeoutMs: 25000 });
  assert.ok(!al.gaveUp, 'not given up: a click may still reveal the password');
  assert.equal(posts.length, 0, 'nothing posted');
  assert.equal((al.attempts || []).length, 0);
  assert.match(await bannerText(page), /бот ждёт автовхода — кликните в любом месте страницы/);
  assert.match(await page.title(), /Нужен клик/);
  // a reload before the click: the banner again, no attempt, no second journal line
  await page.reload();
  await until(async () => /кликните/.test((await bannerText(page)) || ''), { what: 'banner after reload', timeoutMs: 20000 });
  assert.equal(posts.length, 0);
  // a REAL click, but the browser has no password for this page: after 10 s the bot asks for another click (not given up)
  await page.mouse.click(300, 420);
  await until(async () => (await env.evalOgx(page, () => window.__ogxAutoLogin || [])).some((e) => /жду ещё клик/.test(e.w)), { what: 'asks again', timeoutMs: 25000 });
  await until(async () => /кликните/.test((await bannerText(page)) || ''), { what: 'banner asks again', timeoutMs: 5000 });
  assert.ok(!(await alRecord(env)).gaveUp, 'one click that revealed nothing does not end the login');
  assert.equal(posts.length, 0);
  // the 2nd click: still waiting
  await page.mouse.click(310, 430);
  await sleep(1000);
  await until(async () => /кликните/.test((await bannerText(page)) || ''), { what: 'banner asks a 3rd time', timeoutMs: 20000 });
  assert.ok(!(await alRecord(env)).gaveUp, 'two clicks: still waiting');
  // the 3rd click without a password: the bot gives up and says so
  await page.mouse.click(320, 440);
  const al2 = await until(async () => { const r = await alRecord(env); return r && r.gaveUp ? r : null; }, { what: 'gave up', timeoutMs: 25000 });
  assert.match(al2.last.text, /Автовход: браузер не подставил пароль/);
  assert.match(await bannerText(page), /браузер не подставил пароль/);
  assert.equal(posts.length, 0, 'nothing posted');
  assert.equal((al2.attempts || []).length, 0);
  // reload of the login page: no second try for this logout
  await page.reload();
  await sleep(2500);
  assert.equal(posts.length, 0);
  assert.equal(await bannerText(page), null);
  // the bot is still on, paused for the logout
  const paused = await env.get('botcore.paused');
  assert.equal(paused.reason, 'logout');
  assert.equal(paused.resumeAfterLogin, true);
  const lp = await env.evalOgx(page, () => window.__ogxAutoLogin || []);
  assert.equal(lp.filter((e) => /нужен один клик/.test(e.w)).length, 0, 'the second page load does not repeat the journal line');
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 180000 });

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
  // same host, other scheme (a network attacker's http:// page when the game is https) or another universe directory
  const origin = new URL(page.url()).origin;
  const other = origin.startsWith('https:') ? origin.replace(/^https:/, 'http:') : origin.replace(/^http:/, 'https:');
  for (const pend of [{ origin: other, dir: '/Aeternum/' }, { origin, dir: '/Other/' }, { cred: { login: USER, password: SECRET } }]) {
    await env.setStorage({ '*|*|botcore.autologin': { pending: Object.assign({ t: Date.now(), host, url: page.url() }, pend), attempts: [] } });
    await page.reload();
    await sleep(2500);
    assert.equal(posts.length, 0, 'ignored: ' + JSON.stringify(Object.keys(pend)));
  }
  // the record for exactly this origin + directory is used
  await env.setStorage({ '*|*|botcore.autologin': { pending: { t: Date.now(), host, origin, dir: '/Aeternum/', url: page.url() }, attempts: [] } });
  await page.reload();
  await until(async () => posts.length >= 1, { what: 'login POST for the matching record', timeoutMs: 20000 });
}, { timeout: 120000 });

T.test('(d) GALAXYZ-like page + credentials: fields filled, fetch login fails -> diagnosis, retry with requestSubmit -> «вход выполнен»', async () => {
  const env = await G.launch({ settings: withCred() });
  const posts = [];
  let loggedIn = true;
  const toLogin = (ctx) => ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/index.php?code=3' });
  env.server.route('GET', 'resources', (req, res, ctx) => { loggedIn = false; return toLogin(ctx); });
  // the session probe of the login page (GET game.php?page=overview) is answered like the game would: redirect while logged out
  env.server.route('GET', 'overview', (req, res, ctx) => (loggedIn ? ctx.sendPage('overview') : toLogin(ctx)));
  env.server.route('GET', '/Aeternum/index.php', (req, res, ctx) => ctx.send(200, gzLoginPage()));
  env.server.route('POST', '/Aeternum/index.php', (req, res, ctx) => {
    const ajax = ctx.form.ajax === '1';
    posts.push({ t: Date.now(), query: ctx.query, form: ctx.form, ajax });
    if (ajax) return ctx.send(200, JSON.stringify({ ok: false, error: 'Неверный токен формы' }), 'application/json');   // the broken AJAX login
    loggedIn = true;
    return ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/game.php?page=overview' });
  });
  const page = await setup(env);
  await logoutViaBot(env, page);
  // attempt 1: the credentials go into the game's own form, the click runs the page's fetch login, which fails
  await until(async () => posts.length >= 1, { what: 'fetch login POST', timeoutMs: 40000 });
  assert.equal(posts[0].ajax, true);
  assert.equal(posts[0].form.username, USER, 'login field filled from the settings');
  assert.equal(posts[0].form.password, SECRET, 'password field filled from the settings');
  assert.match(page.url(), /index\.php/, 'still on the login page');
  // ~15 s watch, diagnosis, retry ~20 s after the first submit: form.requestSubmit() -> native POST -> 302 overview
  await until(async () => posts.length >= 2, { what: 'native login POST', timeoutMs: 60000 });
  assert.equal(posts[1].ajax, false);
  assert.equal(posts[1].query.page, 'login');
  assert.equal(posts[1].form.password, SECRET);
  assert.ok(posts[1].t - posts[0].t >= 15000 && posts[1].t - posts[0].t < 40000, 'retry after the watch: ' + (posts[1].t - posts[0].t) + ' ms');
  // between the attempts the login page probed the session once (GET game.php?page=overview, answered with the logout redirect)
  const probes = env.requests('GET', 'overview').filter((r) => r.t > posts[0].t && r.t < posts[1].t);
  assert.ok(probes.length >= 1, 'session probe between the attempts');
  await resumed(env, page);
  const al = await alRecord(env);
  assert.equal(al.pending, null, 'pending (with the credentials) cleared');
  assert.equal(al.attempts.length, 2);
  assert.ok(!JSON.stringify(al).includes(SECRET));
  const lp = await storedAutologin(env, page);
  const texts = lp.map((e) => e.w);
  const a1 = lp.find((e) => /вход по сохранённым логину и паролю \(попытка 1 из 3/.test(e.w));
  assert.ok(a1, 'attempt 1 journaled: ' + JSON.stringify(texts));
  assert.equal(a1.d.method, 'click');
  assert.equal(a1.d.how, 'cred');
  assert.match(a1.d.button, /^button#loginbtn\.btn\.btn-primary\[button\] «Войти»$/);
  const diag = lp.find((e) => /страница входа не ушла после «нажимаю «Вход»»/.test(e.w));
  assert.ok(diag, 'diagnosis journaled: ' + JSON.stringify(texts));
  assert.equal(diag.d.filledAfter, true);
  assert.match(diag.d.error, /Неверный токен формы/);
  assert.equal(diag.d.code, 3);
  const a2 = lp.find((e) => /попытка 2 из 3/.test(e.w));
  assert.ok(a2, 'attempt 2 journaled: ' + JSON.stringify(texts));
  assert.equal(a2.d.method, 'requestSubmit');
  assert.ok(!JSON.stringify(lp).includes(SECRET), 'no password in the login page journal');
  assert.ok(!JSON.stringify(lp).includes(USER), 'no login in the login page journal');
  assert.ok((await journal(env, page, /^botcore:autologin$/)).some((e) => /вход выполнен/.test(e.w)), 'journal: login done');
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 150000 });

T.test('(d2) form without action and method: the fallback submit is a POST to index.php?page=login, never a GET with the password', async () => {
  const env = await G.launch({ settings: withCred() });
  const posts = []; const gets = [];
  let loggedIn = true;
  const toLogin = (ctx) => ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/index.php?code=3' });
  env.server.route('GET', 'resources', (req, res, ctx) => { loggedIn = false; return toLogin(ctx); });
  env.server.route('GET', 'overview', (req, res, ctx) => (loggedIn ? ctx.sendPage('overview') : toLogin(ctx)));
  env.server.route('GET', '/Aeternum/index.php', (req, res, ctx) => { gets.push(req.url); return ctx.send(200, bareLoginPage()); });
  env.server.route('POST', '/Aeternum/index.php', (req, res, ctx) => {
    posts.push({ t: Date.now(), url: req.url, query: ctx.query, form: ctx.form });
    loggedIn = true;
    return ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/game.php?page=overview' });
  });
  const page = await setup(env);
  await logoutViaBot(env, page);
  // attempt 1 (click on the JS button) does nothing; attempt 2 (requestSubmit) ~20 s later posts the form
  await until(async () => posts.length >= 1, { what: 'login POST', timeoutMs: 70000 });
  assert.equal(posts[0].query.page, 'login', 'posted to the login handler: ' + posts[0].url);
  assert.equal(posts[0].form.password, SECRET, 'the password in the POST body');
  assert.ok(!posts[0].url.includes(SECRET) && !/password=/.test(posts[0].url), 'no credentials in the POST url');
  assert.ok(gets.every((u) => !u.includes(SECRET) && !/password=|username=/.test(u)), 'no GET with credentials: ' + JSON.stringify(gets));
  await resumed(env, page);
  const lp = await storedAutologin(env, page);
  const diag = lp.find((e) => /страница входа не ушла/.test(e.w));
  assert.ok(diag, 'diagnosis of attempt 1: ' + JSON.stringify(lp.map((e) => e.w)));
  assert.equal(diag.d.methodSet, true);
  assert.equal(diag.d.actionSet, true);
  assert.match(diag.d.error, /Проверка формы не прошла/);
  const a2 = lp.find((e) => /попытка 2 из 3/.test(e.w));
  assert.ok(a2);
  assert.equal(a2.d.method, 'requestSubmit');
  assert.ok(!JSON.stringify(lp).includes(SECRET));
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 150000 });

T.test('(e) saved password hidden until a real gesture: banner, a real click anywhere on the page, then the submit', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.autoLogin': true }) });
  const posts = routes(env, { fillOnGesture: true });
  const page = await setup(env);
  await logoutViaBot(env, page);
  await until(async () => /index\.php/.test(page.url()), { what: 'login page', timeoutMs: 30000 });
  await until(async () => { const r = await alRecord(env); return r && r.last && /нужен один клик/.test(r.last.text); }, { what: 'click asked', timeoutMs: 25000 });
  assert.equal(posts.length, 0, 'no submit before the gesture');
  assert.match(await bannerText(page), /кликните в любом месте страницы/);
  await page.mouse.click(300, 420);                    // a trusted gesture: the page script (the browser) reveals the password
  await until(async () => posts.length >= 1, { what: 'login POST after the click', timeoutMs: 20000 });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].form.password, SECRET, 'the revealed password was submitted');
  await resumed(env, page);
  const lp = await storedAutologin(env, page);
  assert.equal(lp.filter((e) => /нужен один клик/.test(e.w)).length, 1, 'asked once: ' + JSON.stringify(lp.map((e) => e.w)));
  const a1 = lp.find((e) => /попытка 1 из 3/.test(e.w));
  assert.ok(a1);
  assert.equal(a1.d.how, 'autofill-gesture');
  assert.equal(a1.d.gesture, 'pointerdown');
  assert.ok(!JSON.stringify(lp).includes(SECRET));
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(e2) the user types the password by hand with pauses: the bot never submits, the user\'s own Enter logs in', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.autoLogin': true }) });
  const posts = routes(env, { autofillMs: null });
  const page = await setup(env);
  await logoutViaBot(env, page);
  await until(async () => /index\.php/.test(page.url()), { what: 'login page', timeoutMs: 30000 });
  await until(async () => { const r = await alRecord(env); return r && r.last && /нужен один клик/.test(r.last.text); }, { what: 'click asked', timeoutMs: 25000 });
  await page.focus('#password');
  await page.keyboard.type('ab');
  await sleep(2500);                                   // a pause longer than the 1.5 s «quiet» of the autofill check
  await page.keyboard.type('c');
  await sleep(4000);
  assert.equal(posts.length, 0, 'no submit of a half-typed password');
  const al = await alRecord(env);
  assert.match(al.last.text, /вы вводите логин или пароль сами/);
  assert.ok(!al.gaveUp);
  assert.equal((al.attempts || []).length, 0);
  assert.match(await bannerText(page), /нажмите «Вход»/);
  await page.keyboard.press('Enter');                  // the user's own submit
  await until(async () => posts.length >= 1, { what: 'the user\'s POST', timeoutMs: 15000 });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].form.password, 'abc');
  await resumed(env, page);
  assert.equal(posts.length, 1);
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(e3) the gesture is a click on «Войти» itself (slow AJAX login): the bot waits for its result, no second POST', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.autoLogin': true }) });
  const posts = [];
  env.server.route('GET', 'resources', (req, res, ctx) => ctx.send(302, '', 'text/html', { Location: ctx.origin + '/Aeternum/index.php?code=3' }));
  // the browser reveals the saved password at once on the first trusted pointerdown (before the button's click handler)
  const reveal = `<script>document.addEventListener('pointerdown', function h(ev) { if (!ev.isTrusted) return; document.removeEventListener('pointerdown', h, true); document.getElementById('username').value = ${JSON.stringify(USER)}; document.getElementById('password').value = ${JSON.stringify(SECRET)}; }, true);</script>`;
  env.server.route('GET', '/Aeternum/index.php', (req, res, ctx) => ctx.send(200, gzLoginPage().replace('</body>', reveal + '</body>')));
  env.server.route('POST', '/Aeternum/index.php', (req, res, ctx) => {
    posts.push({ t: Date.now(), form: ctx.form, ajax: ctx.form.ajax === '1' });
    setTimeout(() => ctx.send(200, JSON.stringify({ ok: true }), 'application/json'), 4000);   // a slow AJAX login
  });
  const page = await setup(env);
  await logoutViaBot(env, page);
  await until(async () => /index\.php/.test(page.url()), { what: 'login page', timeoutMs: 30000 });
  await until(async () => { const r = await alRecord(env); return r && r.last && /нужен один клик/.test(r.last.text); }, { what: 'click asked', timeoutMs: 25000 });
  await page.click('#loginbtn');
  await until(async () => posts.length >= 1, { what: 'the user\'s AJAX POST', timeoutMs: 10000 });
  assert.equal(posts[0].ajax, true);
  assert.equal(posts[0].form.password, SECRET);
  await resumed(env, page);
  assert.equal(posts.length, 1, 'no second login POST by the bot');
  const lp = await storedAutologin(env, page);
  assert.ok(lp.some((e) => /вы нажали «Вход» сами/.test(e.w)), JSON.stringify(lp.map((e) => e.w)));
  assert.ok(!lp.some((e) => /попытка \d из 3/.test(e.w)), 'the bot made no attempt of its own');
  const al = await alRecord(env);
  assert.equal(al.attempts.length, 1, 'the user\'s press counted as attempt 1');
  assert.ok(!JSON.stringify(lp).includes(SECRET));
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(f) the password lives only in the settings: journal export, settings block, storage export, status, console are clean', async () => {
  const env = await G.launch({ settings: withCred() });
  const posts = routes(env, { autofillMs: null });     // the browser fills nothing: the credentials do
  const page = await setup(env);
  await logoutViaBot(env, page);
  await until(async () => posts.length >= 1, { what: 'login POST', timeoutMs: 40000 });
  assert.equal(posts[0].form.username, USER);
  assert.equal(posts[0].form.password, SECRET, 'sent to the game\'s login form only');
  await resumed(env, page);
  const r = await env.evalOgx(page, async () => {
    const out = {};
    out.full = (await OGX.diag.export('full')).text;                 // «Выгрузить логи» (всё в одном файле)
    out.exportAll = JSON.stringify(await OGX.storage.exportAll());    // «Экспорт всего»
    out.status = JSON.stringify(OGX.bot.status());
    out.autoLoginInfo = JSON.stringify(OGX.bot.autoLoginInfo());
    out.context = JSON.stringify(await OGX.diag.context());
    out.extras = JSON.stringify(await OGX.diag.extras());
    out.all = OGX.settings.all('botcore');
    out.get = OGX.settings.get('botcore.autoLoginPass');
    // the user-activity journal ('U change') of a secret field and of an ordinary text field
    const box = document.createElement('div'); box.className = 'ogx-settings-form';
    box.innerHTML = '<input type="password" class="ogx-secret" id="ogx-set-botcore-autoLoginPass"><input type="text" id="ogx-set-botcore-autoLoginUser">';
    document.body.appendChild(box);
    for (const [el, v] of [[box.children[0], 'typed-secret-123'], [box.children[1], 'someone']]) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
    box.remove();
    out.u = (OGX.diag.recent({ s: 'U' }) || []).filter((e) => /ogx-set-botcore-autoLogin/.test(e.w)).map((e) => ({ w: e.w, d: e.d }));
    return out;
  });
  const uPass = r.u.filter((e) => /autoLoginPass/.test(e.w));
  const uUser = r.u.filter((e) => /autoLoginUser/.test(e.w));
  assert.ok(uPass.length >= 1 && uUser.length >= 1, 'U change events: ' + JSON.stringify(r.u));
  assert.ok(uPass.every((e) => e.d.len === undefined && e.d.v === undefined), 'no length of the password: ' + JSON.stringify(uPass));
  assert.equal(uUser[0].d.len, 'someone'.length, 'ordinary text fields keep their length');
  assert.equal(r.get, SECRET, 'get() returns the value (the bot needs it)');
  assert.equal(r.all.autoLoginPass, '<secret>', 'all() masks it');
  assert.equal(r.all.autoLoginUser, USER);
  for (const k of ['full', 'exportAll', 'status', 'autoLoginInfo', 'context', 'extras']) assert.ok(!String(r[k]).includes(SECRET), k + ' leaks the password');
  assert.ok(/=== НАСТРОЙКИ \(все, JSON\) ===/.test(r.full) && /autoLoginUser/.test(r.full), 'the settings block is in the export');
  const exported = JSON.parse(r.exportAll).data.player.settings.botcore;
  assert.equal(exported.autoLoginUser, USER, 'the storage export keeps the login');
  assert.equal(Object.prototype.hasOwnProperty.call(exported, 'autoLoginPass'), false, 'the storage export has no autoLoginPass key');
  assert.ok(/botcore:autologin/.test(r.full) && /вход по сохранённым логину и паролю/.test(r.full), 'the login page events are in the export');
  assert.ok(/Автовход: вход выполнен/.test(r.full));
  assert.ok(!env.logs.some((l) => String(l.text).includes(SECRET)), 'console of every page');
  const store = await env.storage(env.ext[0]);
  const where = Object.entries(store).filter(([, v]) => JSON.stringify(v).includes(SECRET)).map(([k]) => k);
  assert.deepEqual(where, [env.key('settings')], 'stored under settings only (the pending record dropped it)');
  const al = await alRecord(env);
  assert.equal(al.pending, null);
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(g) ?code=1 after an own attempt: gave up with «неправильный логин или пароль», no further click, credentials dropped', async () => {
  const env = await G.launch({ settings: withCred() });
  const posts = routes(env, { autofillMs: null, postCode: 1 });   // the game: wrong login/password
  const page = await setup(env);
  await logoutViaBot(env, page);
  await until(async () => posts.length >= 1, { what: 'login POST', timeoutMs: 40000 });
  assert.equal(posts[0].form.password, SECRET);
  const al = await until(async () => { const r = await alRecord(env); return r && r.gaveUp ? r : null; }, { what: 'gave up', timeoutMs: 20000 });
  assert.match(al.last.text, /Автовход: игра ответила «неправильный логин или пароль» — проверьте сохранённые данные/);
  assert.ok(al.pending && al.pending.t, 'pending kept (for the gaveUp check)');
  assert.equal(al.pending.cred, undefined, 'credentials dropped from the record');
  assert.ok(!JSON.stringify(al).includes(SECRET));
  assert.match(page.url(), /index\.php\?code=1/);
  await sleep(3000);
  assert.equal(posts.length, 1, 'no further attempt');
  assert.match(await bannerText(page), /неправильный логин или пароль/);
  await page.reload();
  await sleep(2500);
  assert.equal(posts.length, 1);
  const paused = await env.get('botcore.paused');
  assert.equal(paused.reason, 'logout');
  const lp = await env.evalOgx(page, () => window.__ogxAutoLogin || []);
  assert.equal(lp.length, 0, 'the reload journals nothing more');
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(h) the real ogamex.eu page + credentials: the bot opens «Авторизация», fills the fields, submits the form (requestSubmit, the button is outside the form) -> login_valid "1" -> POST -> «вход выполнен»', async () => {
  const env = await G.launch({ settings: withCred() });
  const r = ogamexRoutes(env);
  const page = await setup(env);
  await logoutViaBot(env, page);
  await until(async () => r.posts.length >= 1, { what: 'native login POST', timeoutMs: 45000 });
  assert.equal(r.valid.length, 1, 'one login_valid check');
  assert.equal(r.valid[0].form.username, USER);
  assert.equal(r.valid[0].form.password, SECRET);
  assert.equal(r.posts.length, 1, 'one login POST');
  assert.equal(r.posts[0].query.page, 'login');
  assert.equal(r.posts[0].form.password, SECRET);
  await resumed(env, page);
  const lp = await storedAutologin(env, page);
  const texts = lp.map((e) => e.w);
  assert.ok(lp.some((e) => /открываю окно входа/.test(e.w)), 'dialog opened: ' + JSON.stringify(texts));
  const a1 = lp.find((e) => /попытка 1 из 3/.test(e.w));
  assert.ok(a1, JSON.stringify(texts));
  assert.equal(a1.d.method, 'requestSubmit', 'no submit control inside the form: the form is submitted, never the navbar «Войти»');
  assert.equal(a1.d.button, null);
  assert.match(String(a1.d.dialog), /data-target|button/);
  assert.ok(!JSON.stringify(lp).includes(SECRET));
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });

T.test('(h2) the real ogamex.eu page, password saved in the browser and filled only into a shown field: the bot opens the dialog itself, no click needed', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.master': true, 'botcore.autoLogin': true }) });
  const r = ogamexRoutes(env, { fillWhenShown: true });
  const page = await setup(env);
  await logoutViaBot(env, page);
  await until(async () => r.posts.length >= 1, { what: 'native login POST', timeoutMs: 45000 });
  assert.equal(r.valid.length, 1);
  assert.equal(r.posts[0].form.password, SECRET);
  await resumed(env, page);
  const lp = await storedAutologin(env, page);
  assert.equal(lp.filter((e) => /нужен один клик/.test(e.w)).length, 0, 'no click asked: ' + JSON.stringify(lp.map((e) => e.w)));
  const a1 = lp.find((e) => /попытка 1 из 3/.test(e.w));
  assert.equal(a1.d.how, 'autofill');
  assert.equal(a1.d.method, 'requestSubmit');
  assert.deepEqual(env.ogxErrors().map((e) => e.text), []);
}, { timeout: 120000 });
