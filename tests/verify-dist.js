'use strict';
// Verifies the packaged build in dist/ (run after package.sh):   node tests/verify-dist.js
//  1. zip contents (manifest version/version_name, background per browser, every referenced file present)
//  2. Chrome zip extracted to a temp dir and loaded unpacked in Chromium against the mock server: service worker
//     starts and answers ogx:ping, no errors in the worker, the overview page gets data-ogx-suite=ready with the side
//     panel groups Live / Infinity / Бот / Логи, the popup renders its module switches without errors.
//  2b. The same unpacked Chrome build against the GALAXYZ mock (tests/gz-server.js) serving the 20 real saved pages of
//     ogamex.eu/Aeternum at http://ogamex.eu:<port>/Aeternum/game.php?page=...: every page reaches data-ogx-suite=ready
//     with exactly one menu entry, no extension errors, no POST and no unhandled request on load (bot modules switched off
//     globally for this pass: Live / Infinity never act on their own); the panel opens, and its «Бот» group shows the 0.3.2
//     defaults (everything on: bot on, «Пробный режим» off, all 5 bot modules on).
//  3. Userscript: node --check, then injected at document-start into plain Chromium: the suite starts on the mock
//     overview (localStorage storage), the panel opens, and a non-OgameX page stays untouched; it also boots on the
//     GALAXYZ overview (engine galaxyz).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('./server');
const { startGzServer, pageNames } = require('./gz-server');
const T = require('./lib');

const DIST = path.join(__dirname, '..', 'dist');
const CHROME = path.join(DIST, 'ogamex-suite-0.3.3-beta-chrome.zip');
const FIREFOX = path.join(DIST, 'ogamex-suite-0.3.3-beta-firefox.zip');
const USER = path.join(DIST, 'ogamex-suite.user.js');
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); } catch (e) { results.push([name, false]); console.log(`  ✗ ${name}\n    ${e && e.stack || e}`); }
};
const extract = (zip) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ogx-dist-')); execFileSync('unzip', ['-q', zip, '-d', d]); return d; };

function checkTree(dir, browser) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, '0.3.3');
  // the spec list (DESIGN.md): unlimitedStorage lifts the 10 MB cap of chrome.storage.local, no user-visible prompt in either browser
  assert.deepEqual(m.permissions, ['storage', 'unlimitedStorage'], browser + ': permissions');
  assert.equal(m.version_name, browser === 'chrome' ? '0.3.3 beta' : undefined, 'version_name only for Chrome (Firefox warns)');
  if (browser === 'chrome') {
    assert.deepEqual(m.background, { service_worker: 'background.js' });
    assert.equal(m.browser_specific_settings, undefined);
  } else {
    assert.ok(Array.isArray(m.background.scripts) && !m.background.service_worker);
    assert.ok(m.browser_specific_settings.gecko.id);
  }
  const files = [m.background.service_worker, ...(m.background.scripts || []), m.action.default_popup, m.options_ui.page,
    ...Object.values(m.icons), ...m.content_scripts.flatMap((c) => c.js)].filter(Boolean);
  for (const f of files) assert.ok(fs.existsSync(path.join(dir, f)), browser + ': missing ' + f);
  for (const bad of ['tests', 'specs', 'fixtures', 'node_modules', '.gitignore']) assert.ok(!fs.existsSync(path.join(dir, bad)), browser + ': should not ship ' + bad);
  return m;
}

(async () => {
  const server = await startServer({ scenario: 'vega', gameJs: true });
  server.route('GET', /^\/plain$/, (req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><head><title>plain</title></head><body><p id="x">plain page</p></body></html>'); });
  const host = `localhost:${server.port}`;
  const origin = `http://${host}`;
  const chromeDir = extract(CHROME);
  const ffDir = extract(FIREFOX);
  let mf;

  await step('zip contents: chrome', async () => { mf = checkTree(chromeDir, 'chrome'); });
  await step('zip contents: firefox', async () => { checkTree(ffDir, 'firefox'); });

  await step('chrome zip loads unpacked: service worker, overview, panel, popup', async () => {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogx-pw-'));
    const ctx = await chromium.launchPersistentContext(userDir, { channel: 'chromium', headless: true, viewport: { width: 1400, height: 900 },
      args: [`--disable-extensions-except=${chromeDir}`, `--load-extension=${chromeDir}`, '--host-resolver-rules=MAP * 127.0.0.1'] });
    const errors = [];
    try {
      let sw = ctx.serviceWorkers()[0];
      if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
      const id = new URL(sw.url()).host;
      sw.on('console', (msg) => { if (msg.type() === 'error') errors.push('sw: ' + msg.text()); });
      const diagOk = await sw.evaluate(() => !!self.OGXDiagBG);
      assert.equal(diagOk, true, 'diag store in the service worker');
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push('page: ' + e.message));
      page.on('console', (msg) => { if (msg.type() === 'error' && /OGX/.test(msg.text())) errors.push('console: ' + msg.text()); });
      await page.goto(origin + '/overview', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
      await page.click('#ogx-suite-entry a.menubutton');
      await page.waitForSelector('#ogx-panel-infinity .ogx-tab-group', { timeout: 10000 });
      const groups = await page.$$eval('#ogx-panel-infinity .ogx-tab-group', (e) => e.map((x) => x.textContent.trim()));
      assert.deepEqual(groups, ['Infinity', 'Live', 'Бот', 'Логи']);
      await page.click('#ogx-panel-infinity .ogx-tab-group[data-group="bot"]');
      await page.waitForTimeout(300);
      const botText = await page.$eval('#ogx-panel-infinity', (e) => e.innerText);
      assert.doesNotMatch(botText, /Бот выключен/, 'Бот tab: the bot overview, on by default (0.3.2)');
      assert.match(botText, /Пробный режим/, 'Бот tab: dry-run switch');
      const pop = await ctx.newPage();
      pop.on('pageerror', (e) => errors.push('popup: ' + e.message));
      await pop.goto(`chrome-extension://${id}/popup/popup.html`);
      await pop.waitForTimeout(800);
      const ping = await pop.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'ogx:ping' }, r)));
      assert.equal(ping && ping.ok, true, 'service worker answers ogx:ping');
      assert.equal(ping.version, '0.3.3');
      await pop.goto(`chrome-extension://${id}/popup/popup.html?tab=modules`);
      await pop.waitForSelector('input[data-module="planetbar"]', { timeout: 5000 });
      const nMods = await pop.$$eval('input[data-module]', (e) => e.length);
      assert.ok(nMods >= 19, 'popup lists the 19 modules, got ' + nMods);
      await pop.goto(`chrome-extension://${id}/options/options.html`);
      await pop.waitForTimeout(500);
      assert.deepEqual(errors, [], 'errors: ' + errors.join('\n'));
      console.log(`    extension id ${id}, ${nMods} module switches in the popup`);
    } finally {
      await ctx.close();
      fs.rmSync(userDir, { recursive: true, force: true });
    }
  });

  await step('chrome zip loads unpacked on the 20 real GALAXYZ pages (ogamex.eu/Aeternum)', async () => {
    const gz = await startGzServer({ gameJs: true });
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogx-pw-'));
    const ctx = await chromium.launchPersistentContext(userDir, { channel: 'chromium', headless: true, viewport: { width: 1366, height: 900 },
      args: [`--disable-extensions-except=${chromeDir}`, `--load-extension=${chromeDir}`, '--host-resolver-rules=MAP * 127.0.0.1'] });
    const errors = [];
    const report = [];
    try {
      let sw = ctx.serviceWorkers()[0];
      if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
      sw.on('console', (msg) => { if (msg.type() === 'error') errors.push('sw: ' + msg.text()); });
      const gzOrigin = `http://ogamex.eu:${gz.port}`;
      const names = (Array.isArray(pageNames) ? pageNames : (typeof pageNames === 'function' ? pageNames() : Object.keys(pageNames)));
      assert.equal(names.length, 20, 'saved pages: ' + names.join(','));
      // Live / Infinity alone must not act on load: the bot (on by default since 0.3.2) is switched off globally for this pass
      const BOT_MODS = ['botcore', 'botpanel', 'botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo', 'botmissiles'];
      await sw.evaluate((mods) => new Promise((res) => chrome.storage.local.set({ '*|*|suite.modules': Object.fromEntries(mods.map((m) => [m, false])) }, res)), BOT_MODS);
      const page = await ctx.newPage();
      // the game's own scripts throw on a few saved pages (fleettrader.js / shipyard.js) with or without the extension:
      // only errors from our scripts or OGX console errors count
      page.on('pageerror', (e) => { const st = String(e && e.stack || e); if (/chrome-extension:|OGX|ogx/.test(st)) errors.push('page: ' + st.split('\n').slice(0, 3).join(' | ')); });
      page.on('console', (msg) => { if (msg.type() === 'error' && /OGX/.test(msg.text())) errors.push('console: ' + msg.text()); });
      for (const name of names) {
        const before = gz.requests.length;
        await page.goto(gzOrigin + gz.pathFor(name), { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
        await page.waitForTimeout(400);
        const n = await page.$$eval('#ogx-suite-entry', (e) => e.length);
        assert.equal(n, 1, name + ': menu entries ' + n);
        const extra = gz.requests.slice(before + 1).filter((r) => r.method !== 'GET' || r.page === 'galaxy');
        assert.deepEqual(extra.map((r) => r.method + ' ' + r.url), [], name + ': POST or galaxy request on load');
        report.push(name);
      }
      assert.deepEqual(gz.unhandled.map((r) => r.method + ' ' + r.url), [], 'unhandled requests');
      await sw.evaluate(() => new Promise((res) => chrome.storage.local.remove('*|*|suite.modules', res)));
      await page.goto(gzOrigin + gz.gamePath('overview'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
      await page.click('#ogx-suite-entry a');
      await page.waitForSelector('#ogx-panel-infinity .ogx-tab-group', { timeout: 10000 });
      const groups = await page.$$eval('#ogx-panel-infinity .ogx-tab-group', (e) => e.map((x) => x.textContent.trim()));
      assert.deepEqual(groups, ['Infinity', 'Live', 'Бот', 'Логи']);
      // «Бот»: 0.3.2 defaults in the packaged build — every function on (master on, dry-run off, every bot module on)
      await page.click('#ogx-panel-infinity .ogx-tab-group[data-group="bot"]');
      await page.click('#ogx-panel-infinity .ogx-tab[data-tab="bot"]');
      await page.waitForSelector('.ogx-b-bot-state', { timeout: 10000 });
      const bot = await page.evaluate(() => ({
        state: document.querySelector('.ogx-b-bot-state').dataset.state,
        dry: document.querySelector('.ogx-b-bot-dry').checked,
        banner: !!document.querySelector('.ogx-b-bot-live-banner'),
        tabs: [...document.querySelectorAll('#ogx-panel-infinity .ogx-tab[data-tab^="bot-"]')].map((b) => b.dataset.tab),
      }));
      assert.ok(!['off', 'stopped'].includes(bot.state), 'bot state ' + bot.state);
      assert.equal(bot.dry, false, '«Пробный режим» off by default');
      assert.equal(bot.banner, true, 'live banner');
      const modTabs = ['bot-botsave', 'bot-botfarm', 'bot-botdebris', 'bot-botbuild', 'bot-botexpo', 'bot-botmissiles'];
      for (const t of modTabs) assert.ok(bot.tabs.includes(t), 'bot tab ' + t + ' in ' + bot.tabs.join(','));
      for (const t of modTabs) {
        await page.click(`#ogx-panel-infinity .ogx-tab[data-tab="${t}"]`);
        await page.waitForSelector(`#ogx-panel-infinity .ogx-tab-pane[data-tab="${t}"] .ogx-b-bot-mod-on`, { timeout: 5000 });
        const on = await page.$eval(`#ogx-panel-infinity .ogx-tab-pane[data-tab="${t}"] .ogx-b-bot-mod-on`, (e) => e.checked);
        assert.equal(on, true, t + ' on by default');
      }
      console.log(`    «Бот»: state ${bot.state}, dry-run off, ${modTabs.length} modules on`);
      fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
      await page.screenshot({ path: path.join(__dirname, 'out', 'verify-dist-gz-overview-panel.png') });
      assert.deepEqual(errors, [], 'errors: ' + errors.join('\n'));
      console.log(`    ${report.length} GALAXYZ pages booted: ${report.join(', ')}`);
    } finally {
      await ctx.close();
      fs.rmSync(userDir, { recursive: true, force: true });
      await gz.close();
    }
  });

  await step('userscript: node --check', async () => { execFileSync(process.execPath, ['--check', USER]); });

  await step('userscript: header', async () => {
    const src = fs.readFileSync(USER, 'utf8');
    for (const re of [/@match\s+\*:\/\/\*\/\*/, /@grant\s+none/, /@run-at\s+document-start/, /@version\s+0\.3\.3-beta/]) assert.match(src.slice(0, 1500), re);
  });

  await step('userscript: smoke test on the mock overview and a non-OgameX page', async () => {
    const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * 127.0.0.1'] });
    const errors = [];
    try {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      await ctx.addInitScript({ content: fs.readFileSync(USER, 'utf8') });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push('page: ' + e.message));
      page.on('console', (msg) => { if (msg.type() === 'error' && /OGX/.test(msg.text())) errors.push('console: ' + msg.text()); });
      await page.goto(origin + '/overview', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
      const info = await page.evaluate(() => ({ store: window.OGX.storage && window.OGX.storage.backend && window.OGX.storage.backend(), keys: Object.keys(localStorage).filter((k) => k.startsWith('ogx.')).length, prod: document.querySelectorAll('.ogx-l-planetbar-prod').length, menu: [...document.querySelectorAll('#menuTableTools > li')].map((e) => e.id) }));
      assert.deepEqual(info.menu, ['ogx-suite-entry']);
      assert.ok(info.prod >= 2, 'planetbar rows ' + info.prod);
      await page.click('#ogx-suite-entry a.menubutton');
      await page.waitForSelector('#ogx-panel-infinity .ogx-tab-group', { timeout: 10000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
      const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ogx.')).length);
      assert.ok(keys > 0, 'data stored in localStorage');
      const plain = await ctx.newPage();
      plain.on('pageerror', (e) => errors.push('plain: ' + e.message));
      await plain.goto(origin + '/plain', { waitUntil: 'load' });
      await plain.waitForTimeout(500);
      const p = await plain.evaluate(() => ({ ogx: typeof window.OGX, attrs: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-ogx')), text: document.body.innerText }));
      assert.deepEqual(p, { ogx: 'undefined', attrs: [], text: 'plain page' });
      assert.deepEqual(errors, [], 'errors: ' + errors.join('\n'));
      console.log(`    ${keys} localStorage keys, ${info.prod} planet rows`);
    } finally {
      await browser.close();
    }
  });

  await step('userscript: boots on the GALAXYZ overview', async () => {
    const gz = await startGzServer({ gameJs: true });
    const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * 127.0.0.1'] });
    const errors = [];
    try {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.addInitScript({ content: fs.readFileSync(USER, 'utf8') });
      const page = await ctx.newPage();
      page.on('console', (msg) => { if (msg.type() === 'error' && /OGX/.test(msg.text())) errors.push('console: ' + msg.text()); });
      await page.goto(`http://ogamex.eu:${gz.port}` + gz.gamePath('overview'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
      const info = await page.evaluate(() => ({ engine: window.OGX.page.detect().engine, entries: document.querySelectorAll('#ogx-suite-entry').length, errs: (window.OGX.errors || []).length }));
      assert.deepEqual(info, { engine: 'galaxyz', entries: 1, errs: 0 });
      assert.deepEqual(errors, [], 'errors: ' + errors.join('\n'));
    } finally {
      await browser.close();
      await gz.close();
    }
  });

  await server.close();
  for (const d of [chromeDir, ffDir]) fs.rmSync(d, { recursive: true, force: true });
  void mf; void T;
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
