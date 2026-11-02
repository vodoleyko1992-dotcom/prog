'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / prefs: «Настройки» tab (module toggles + generated form for every Infinity module), export of a
// targets mark (download), import into a fresh profile (file chooser, preview, merge) restores it, replace mode via pasted
// JSON, keyboard shortcuts (panel, prev/next body, planet↔moon, page jump, fleet select-all), ignored in inputs and
// for arrow keys on /galaxy, diagnostics, safety on non-OgameX pages.
//   node tests/legacy-ogamex/infinity-prefs.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const ORDER = ['panel', 'empire', 'targets', 'spy', 'stats', 'stalk', 'flights', 'fleethelp', 'todo', 'prefs'];

let extCache = null;
function ext() {
  if (fs.existsSync(path.join(ROOT, 'ogamex-infinity/manifest.json')) && process.env.OGX_PREFS_REAL_EXT) return 'infinity';
  if (!extCache) {
    const modules = {};
    for (const m of ORDER) {
      const f = path.join(ROOT, `ogamex-infinity/modules/${m}/${m}.js`);
      if (fs.existsSync(f)) modules[m] = fs.readFileSync(f, 'utf8');
    }
    extCache = coreExt({ name: 'infinity', modules });
  }
  return extCache;
}
const nb = (s) => String(s || '').replace(/[ \s]+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPrefs(page) {
  const hidden = await page.$eval('#ogx-panel-infinity', (e) => e.hidden);
  if (hidden) await page.keyboard.press('Alt+Shift+KeyI');
  await page.waitForSelector('#ogx-panel-infinity:not([hidden])', { timeout: 5000 });
  await page.click('#ogx-panel-infinity .ogx-tab[data-tab="prefs"]');
  await page.waitForSelector('#ogx-panel-infinity .ogx-tab-pane[data-tab="prefs"]:not([hidden]) .ogx-i-prefs-form', { timeout: 5000 });
}
async function waitFor(fn, what, ms = 6000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(100); }
  throw new Error('timeout: ' + what + ' last=' + JSON.stringify(v));
}
async function journal(env, page) {
  return env.evalOgx(page, async () => {
    const st = await OGX.diag.store();
    const r = await st.query({ last: 3000 });
    return r.events.concat(OGX.diag.recent()).map((e) => e.s + ' ' + e.k + ' ' + e.w);
  });
}

T.test('prefs: settings tab lists every Infinity module; export with a targets mark; import into a fresh profile restores it', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  const page = await env.open('/overview');
  await env.waitFor(page, '#ogx-panel-infinity');

  // panel toggled by Alt+Shift+I
  await page.keyboard.press('Alt+Shift+KeyI');
  await page.waitForSelector('#ogx-panel-infinity:not([hidden])', { timeout: 5000 });
  await page.keyboard.press('Alt+Shift+KeyI');
  await page.waitForSelector('#ogx-panel-infinity[hidden]', { state: 'attached', timeout: 5000 });

  await openPrefs(page);
  // module toggles first, one per Infinity module
  const mods = await page.$$eval('.ogx-i-prefs-mod', (els) => els.map((e) => e.dataset.mod));
  assert.deepEqual(mods, ORDER);
  const firstSec = await page.$eval('.ogx-tab-pane[data-tab="prefs"] .ogx-i-prefs-sec', (e) => e.dataset.sec);
  assert.equal(firstSec, 'modules');
  assert.match(nb(await page.textContent('.ogx-i-prefs-reload-note')), /после перезагрузки/);
  // generated form: core + every module (all are loaded in this test extension)
  const ns = await page.$$eval('.ogx-i-prefs-form fieldset.ogx-settings-ns', (els) => els.map((e) => e.dataset.ns));
  assert.deepEqual(ns, ['core'].concat(ORDER));
  // enable toggle first inside a module fieldset; hotkeys with the defaults
  assert.equal(await page.$eval('fieldset[data-ns="targets"] .ogx-field', (e) => e.dataset.key), 'targets.enabled');
  assert.equal(await page.$eval('#ogx-set-prefs-keyNextBody', (e) => e.value), 'Alt+PageDown');
  assert.equal(await page.$eval('#ogx-set-prefs-keyOverview', (e) => e.value), 'Alt+Shift+1');
  assert.equal(await page.$eval('#ogx-set-prefs-keyTab1', (e) => e.value), '');
  const help = nb(await page.textContent('.ogx-i-prefs-help'));
  assert.match(help, /Alt\+Shift\+I Открыть\/закрыть панель Infinity/);
  assert.match(help, /Alt\+PageDown Следующая планета/);

  // module toggle writes the setting
  await page.click('.ogx-i-prefs-mod[data-mod="todo"] input');
  await waitFor(async () => { const s = await env.get('settings'); return s && s.todo && s.todo.enabled === false; }, 'todo.enabled=false');
  await page.click('.ogx-i-prefs-mod[data-mod="todo"] input');
  await waitFor(async () => { const s = await env.get('settings'); return s && s.todo && s.todo.enabled === true; }, 'todo.enabled=true');

  // a mark created by the targets module
  await env.evalOgx(page, () => OGX.bus.emit('targets:add', { coords: '1:42:6', type: 1, playerName: 'OldMiner', playerId: 201, planetName: 'Old' }));
  const marks = await waitFor(async () => { const m = await env.get('targets.marks'); return m && m.planets && m.planets['1:42:6:1'] ? m : null; }, 'targets mark');
  assert.equal(marks.planets['1:42:6:1'].playerId, 201);

  // «Экспорт всего» -> download
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('.ogx-i-prefs-export-all')]);
  const name = dl.suggestedFilename();
  const host = env.host.replace(/[^a-z0-9.-]+/gi, '_');
  assert.match(name, new RegExp(`^ogamex-infinity-${host.replace(/\./g, '\\.')}-108-\\d{8}\\.json$`));
  const tmp = path.join(os.tmpdir(), 'ogx-prefs-' + process.pid + '-' + name);
  await dl.saveAs(tmp);
  const file = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  assert.equal(file.format, 'ogx-export');
  assert.equal(file.ext, 'infinity');
  assert.equal(String(file.playerId), '108');
  assert.equal(file.kind, 'all');
  assert.equal(file.data.player['targets.marks'].planets['1:42:6:1'].playerName, 'OldMiner');
  assert.ok(file.data.player.settings, 'settings exported');
  assert.ok(file.data.server, 'server scope exported (exportIncludeServer default on)');
  assert.ok(!Object.keys(file.data.player).some((k) => k.startsWith('lock.')));

  // «Экспорт целей» -> only targets.* / stalk.*
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('.ogx-i-prefs-export-targets')]);
  assert.match(dl2.suggestedFilename(), /^ogamex-infinity-targets-/);
  const tmp2 = tmp + '.targets.json';
  await dl2.saveAs(tmp2);
  const tfile = JSON.parse(fs.readFileSync(tmp2, 'utf8'));
  assert.equal(tfile.kind, 'targets');
  assert.ok(Object.keys(tfile.data.player).length >= 1);
  assert.ok(Object.keys(tfile.data.player).every((k) => /^(targets|stalk)\./.test(k)), Object.keys(tfile.data.player).join(','));
  assert.equal(tfile.data.server, undefined);

  const ev = await journal(env, page);
  assert.ok(ev.some((x) => /^B prefs exportAll/.test(x)), 'B exportAll');
  assert.ok(ev.some((x) => /^B prefs exportTargets/.test(x)), 'B exportTargets');
  assert.ok(ev.some((x) => /^U prefs hotkey/.test(x)), 'U hotkey');
  assert.ok(ev.some((x) => /^U .*prefs:export-all/.test(x)), 'U export-all click');
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();

  // ---- fresh profile (other port = other host): import the file, merge mode
  const env2 = await T.launch({ ext: ext(), scenario: 'vega' });
  const p2 = await env2.open('/overview');
  await env2.waitFor(p2, '#ogx-panel-infinity');
  assert.ok(!(await env2.get('targets.marks')));
  await openPrefs(p2);
  const [chooser] = await Promise.all([p2.waitForEvent('filechooser', { timeout: 10000 }), p2.click('.ogx-i-prefs-import')]);
  await chooser.setFiles(tmp);
  await p2.waitForSelector('.ogx-modal .ogx-i-prefs-preview', { timeout: 8000 });
  const prevText = nb(await p2.textContent('.ogx-i-prefs-preview'));
  assert.match(prevText, /Файл с другого сервера/);           // the first env ran on another port
  assert.match(prevText, /Цели и метки/);
  assert.equal(await p2.$eval('.ogx-i-prefs-grp[data-group="targets"] input', (e) => e.checked), true);
  assert.equal(await p2.$eval('.ogx-i-prefs-grp[data-group="targets"] td:nth-child(3)', (e) => e.textContent.trim()), '1');
  assert.equal(await p2.$eval('.ogx-i-prefs-keytable tr[data-key="targets.marks"]', (e) => e.dataset.state), 'new');
  assert.equal(await p2.$eval('input.ogx-i-prefs-mode[value="merge"]', (e) => e.checked), true);
  await p2.click('.ogx-modal button.ogx-btn-primary');
  const m2 = await waitFor(async () => { const m = await env2.get('targets.marks'); return m && m.planets && m.planets['1:42:6:1'] ? m : null; }, 'imported mark');
  assert.equal(m2.planets['1:42:6:1'].playerName, 'OldMiner');
  await p2.waitForSelector('.ogx-i-prefs-result:not([hidden])', { timeout: 5000 });
  assert.match(nb(await p2.textContent('.ogx-i-prefs-result')), /Импорт завершён: записано \d+/);
  // after a reload the targets module reads it (badge/table) — the stored value is what counts here
  const ev2 = await journal(env2, p2);
  assert.ok(ev2.some((x) => /^B prefs importPreview/.test(x)), 'B importPreview');
  assert.ok(ev2.some((x) => /^B prefs importApply/.test(x)), 'B importApply');
  assert.ok(ev2.some((x) => /^U prefs import-confirm/.test(x)), 'U import-confirm');

  // ---- replace mode through pasted JSON: targets only, the local extra mark disappears
  await env2.evalOgx(p2, async () => {
    const m = await OGX.storage.get('targets.marks');
    m.planets['3:3:3:1'] = { color: 'red', note: 'лишняя', updatedAt: 1, isTarget: true };
    await OGX.storage.set('targets.marks', m);
    await OGX.storage.set('targets.extra', { v: 1 });   // a key of the group that is not in the file
    await OGX.storage.flush();
  });
  await p2.fill('.ogx-i-prefs-paste', fs.readFileSync(tmp2, 'utf8'));
  await p2.click('.ogx-i-prefs-paste-btn');
  await p2.waitForSelector('.ogx-modal .ogx-i-prefs-preview', { timeout: 8000 });
  await p2.check('input.ogx-i-prefs-mode[value="replace"]');
  await p2.click('.ogx-modal button.ogx-btn-primary');
  await p2.waitForSelector('.ogx-modal button[data-role="ok"]', { timeout: 5000 });   // danger confirm
  await p2.click('.ogx-modal button[data-role="ok"]');
  const m3 = await waitFor(async () => { const m = await env2.get('targets.marks'); return m && m.planets && !m.planets['3:3:3:1'] ? m : null; }, 'replaced marks');
  assert.ok(m3.planets['1:42:6:1']);
  assert.ok(!(await env2.get('targets.extra')));

  // invalid JSON -> error toast, nothing written
  await p2.fill('.ogx-i-prefs-paste', '{"format":"other"}');
  await p2.click('.ogx-i-prefs-paste-btn');
  await p2.waitForSelector('.ogx-toast-error', { timeout: 5000 });
  assert.match(nb(await p2.textContent('.ogx-toast-error')), /не файл экспорта OgameX/);
  // the import/preview warnings are expected log lines, not errors
  assert.deepEqual(env2.ogxErrors(), []);
  assert.deepEqual(env2.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  fs.rmSync(tmp, { force: true }); fs.rmSync(tmp2, { force: true });
  await env2.close();
});

T.test('prefs: shortcuts — next/prev body, planet↔moon, page jump, fleet select-all; inputs and galaxy arrows ignored', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'vega' });
  let page = await env.open('/overview?cp=1');
  await env.waitFor(page, '#ogx-panel-infinity');

  // typing in an input never triggers a shortcut
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'ogx-test-input'; document.body.appendChild(i); });
  await page.focus('#ogx-test-input');
  env.clearRequests();
  await page.keyboard.press('Alt+PageDown');
  await page.keyboard.press('Alt+Shift+Digit7');
  await sleep(600);
  assert.deepEqual(env.requests('GET').map((r) => r.path).filter((p) => !p.startsWith('/ajax')), []);
  assert.equal(new URL(page.url()).searchParams.get('cp'), '1');

  // Alt+PageDown on /overview?cp=1 -> ?cp=3
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await Promise.all([page.waitForURL(/\/overview\?cp=3$/, { timeout: 8000 }), page.keyboard.press('Alt+PageDown')]);
  await env.waitReady(page);
  assert.ok(env.requests('GET', '/overview').some((r) => r.cp === 3));
  // the mock serves the compact layout for body 3 (planets 1, 3, 4, 6, 7, 8; body 4 is not a vega body): next -> 4, prev -> 1
  await Promise.all([page.waitForURL(/\/overview\?cp=4$/, { timeout: 8000 }), page.keyboard.press('Alt+PageDown')]);
  await env.waitReady(page);
  page = await env.open('/overview?cp=3');
  await Promise.all([page.waitForURL(/\/overview\?cp=1$/, { timeout: 8000 }), page.keyboard.press('Alt+PageUp')]);
  await env.waitReady(page);
  // on the vega planet page (planets 1, 3) prev from 1 wraps to 3
  await Promise.all([page.waitForURL(/\/overview\?cp=3$/, { timeout: 8000 }), page.keyboard.press('Alt+PageUp')]);
  await env.waitReady(page);
  // back to planet 1, then planet -> moon (5) -> planet (1)
  page = await env.open('/overview?cp=1');
  await Promise.all([page.waitForURL(/\/overview\?cp=5$/, { timeout: 8000 }), page.keyboard.press('Alt+Shift+KeyM')]);
  await env.waitReady(page);
  await Promise.all([page.waitForURL(/\/overview\?cp=1$/, { timeout: 8000 }), page.keyboard.press('Alt+Shift+KeyM')]);
  await env.waitReady(page);

  // page jump Alt+Shift+7 -> /galaxy; arrows are never ours there (keyNextBody rebound to ArrowRight below)
  await Promise.all([page.waitForURL(/\/galaxy$/, { timeout: 8000 }), page.keyboard.press('Alt+Shift+Digit7')]);
  await env.waitReady(page);
  await env.evalOgx(page, () => OGX.settings.set('prefs.keyNextBody', 'ArrowRight'));
  env.clearRequests();
  await page.keyboard.press('ArrowRight');
  await sleep(700);
  assert.ok(/\/galaxy$/.test(page.url()), page.url());
  assert.deepEqual(env.requests('GET').map((r) => r.path).filter((p) => !p.startsWith('/ajax')), []);
  // ... but on the overview the same binding works
  page = await env.open('/overview?cp=1');
  await Promise.all([page.waitForURL(/\/overview\?cp=3$/, { timeout: 8000 }), page.keyboard.press('ArrowRight')]);
  await env.waitReady(page);

  // fleet page: Alt+Shift+A clicks a#sendall, Alt+Shift+R a#resetall (fleet/index.blade.php:944,949)
  page = await env.open('/fleet?cp=1');
  await page.evaluate(() => {
    window.__ogxClicks = [];
    for (const id of ['sendall', 'resetall']) { const a = document.getElementById(id); if (a) a.addEventListener('click', () => window.__ogxClicks.push(id)); }
  });
  await page.keyboard.press('Alt+Shift+KeyA');
  await page.keyboard.press('Alt+Shift+KeyR');
  await waitFor(() => page.evaluate(() => window.__ogxClicks.length === 2), 'fleet clicks');
  assert.deepEqual(await page.evaluate(() => window.__ogxClicks), ['sendall', 'resetall']);

  const ev = await journal(env, page);
  assert.ok(ev.some((x) => /^B prefs hotkey/.test(x)), 'B hotkey');
  assert.ok(ev.some((x) => /^B prefs navigate/.test(x)), 'B navigate');
  assert.ok(ev.some((x) => /^U prefs hotkey/.test(x)), 'U hotkey');

  // pure helper: Alt+Shift+1 on a US layout is reported as "!" by e.key but matches by e.code
  const combos = await env.evalOgx(page, () => OGX.prefsLib.combosFromEvent({ altKey: true, shiftKey: true, key: '!', code: 'Digit1' }));
  assert.deepEqual(combos, ['Alt+Shift+1', 'Alt+Shift+!']);
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();
});

T.test('prefs: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext() });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  await page.keyboard.press('Alt+PageDown');
  await page.waitForTimeout(300);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
  await env.close();
});
