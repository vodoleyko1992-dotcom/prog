'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// End-to-end test of the ONE extension «OgameX Suite» (ogx/ogamex-suite, assembled by tests/sync.sh): the real manifest,
// loader, hub, all 7 Live and all 10 Infinity modules, against the mock server with OgameX's own game JS.
//   node tests/legacy-ogamex/suite-e2e.test.js            (OGX_TEST_MODE=inject for inject mode)
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;

const DIR = path.join(__dirname, '..', '..', 'ogamex-suite');
const PAGES = ['/overview', '/resources', '/facilities', '/research', '/shipyard', '/defense', '/fleet', '/fleet/movement', '/galaxy', '/messages'];
const LIVE = ['menu', 'planetbar', 'inflight', 'techcost', 'fleetinfo', 'expedition', 'timeline'];
const INFINITY = ['panel', 'empire', 'targets', 'spy', 'stats', 'stalk', 'flights', 'fleethelp', 'todo', 'prefs'];
const INFINITY_TABS = ['planets', 'empire', 'targets', 'search', 'spy', 'stats', 'stalk', 'flights', 'collect', 'todo', 'prefs'];
const HOSTS = '*|*|suite.hosts';
const MODS = '*|*|suite.modules';

const count = (page, sel) => page.$$eval(sel, (e) => e.length);
const nbsp = (s) => String(s).replace(/\u00a0/g, ' ');

/** Ids of the game's own elements (outside anything the add-on created). */
function gameIds(page) {
  return page.evaluate(() => [...document.querySelectorAll('[id]')]
    .filter((e) => !/^ogx-/.test(e.id) && !e.closest('[id^="ogx-"], .ogx-root, .ogx-gx-slot, .ogx-panel, .ogx-modal-overlay, .ogx-tooltip'))
    .map((e) => e.id).filter((id) => !/^(tippy|tooltip|ui-id-)/.test(id) && !/^dropdown\d+$/.test(id))); // dropdownNNN: random ids of the game's own select widget
}
async function settle(page, ms = 1200) { await page.waitForTimeout(ms); }

/** Mandatory checks on every page: marks, one menu entry, one side panel, no duplicate ids or styles, Live widgets once. */
async function common(page, where) {
  const marks = await page.evaluate(() => Object.fromEntries([...document.documentElement.attributes].filter((a) => a.name.startsWith('data-ogx')).map((a) => [a.name, a.value])));
  assert.deepEqual(marks, { 'data-ogx-suite': 'ready', 'data-ogx-live': 'ready', 'data-ogx-infinity': 'ready' }, where + ' marks');
  const menu = await page.$$eval('#menuTableTools > li', (els) => els.map((e) => e.id));
  assert.deepEqual(menu, ['ogx-suite-entry'], where + ': exactly one menu entry (Live and Infinity entries stay detached)');
  assert.equal(await count(page, '#ogx-l-menu-entry, #ogx-i-panel-entry'), 0, where + ': no separate Live/Infinity entries');
  assert.equal(await count(page, '.ogx-panel'), 1, where + ': one side panel');
  assert.equal(await count(page, '#ogx-panel-infinity'), 1, where);
  const dup = await page.evaluate(() => {
    const seen = {}; for (const e of document.querySelectorAll('[id^="ogx-"]')) seen[e.id] = (seen[e.id] || 0) + 1;
    return Object.entries(seen).filter(([, n]) => n > 1);
  });
  assert.deepEqual(dup, [], where + ': duplicate ogx ids (double injection)');
  // one style element per module/core
  const styles = await page.$$eval('style[id^="ogx-"]', (e) => e.map((x) => x.id).sort());
  for (const id of ['ogx-core', 'ogx-s-suite', 'ogx-l-menu', 'ogx-l-planetbar', 'ogx-l-inflight', 'ogx-l-timeline-css', 'ogx-i-panel', 'ogx-i-targets', 'ogx-i-spy', 'ogx-i-prefs']) {
    assert.ok(styles.includes(id), where + ': style ' + id + ' in ' + styles.join(','));
  }
  // Live, on every page: planetbar once per planet row, inflight box once, timeline once
  const perRow = await page.$$eval('#planetList > .smallplanet', (rows) => rows.map((r) => r.querySelectorAll('.ogx-l-planetbar-prod').length));
  assert.ok(perRow.length >= 2 && perRow.every((n) => n === 1), where + ': planetbar per row ' + JSON.stringify(perRow));
  assert.equal(await count(page, '[data-ogx-act="inflight:toggle"]'), 1, where + ': inflight box');
  assert.equal(await count(page, '#ogx-l-timeline'), 1, where + ': timeline');
  assert.equal(await count(page, '.ogx-l-timeline-root'), 1, where + ': timeline root');
}

/** Page-specific widgets, each exactly once. */
const PAGE_CHECKS = {
  async '/resources'(page, env) { await techList(page, env, 'resources'); },
  async '/facilities'(page, env) { await techList(page, env, 'facilities'); },
  async '/research'(page, env) { await techList(page, env, 'research'); },
  async '/shipyard'(page, env) { await techList(page, env, 'shipyard'); },
  async '/defense'(page, env) { await techList(page, env, 'defense'); },
  async '/fleet'(page, env) {
    await env.waitFor(page, '#ogx-l-fleetinfo');
    assert.equal(await count(page, '#ogx-l-fleetinfo'), 1, 'fleetinfo once');
    assert.equal(await count(page, '.ogx-l-fleetinfo-box'), 1, 'fleetinfo box once');
    assert.equal(await count(page, '#ogx-l-expedition-box1'), 1, 'expedition box (step 1) once');
    assert.equal(await count(page, '#ogx-l-expedition-box2'), 1, 'expedition box (step 2) once');
    assert.equal(await count(page, '#ogx-i-fleethelp-bar1'), 1, 'fleethelp bar (step 1) once');
    assert.equal(await count(page, '#ogx-i-fleethelp-allbut'), 1);
    assert.equal(await count(page, '#ogx-i-fleethelp-bar2'), 1, 'fleethelp bar (step 2) once');
    // the game's dispatcher still works with both Live and Infinity on the page
    assert.equal(await page.evaluate(() => typeof window.fleetDispatcher === 'object' && window.fleetDispatcher !== null), true, 'fleetDispatcher alive');
  },
  async '/fleet/movement'(page) {
    assert.equal(await count(page, '#ogx-i-flights-movement'), 1, 'flights movement chart once');
  },
  async '/galaxy'(page) {
    // The game's first /ajax/galaxy answer can arrive before OGX.boot (HARNESS.md §3 rule 6): browse the system again
    // with the game's own function, as a player would.
    await page.evaluate(() => loadContentNew(1, 42));
    await page.waitForSelector('#galaxyRow13 .ogx-gx-slot[data-owner="stalk"]', { state: 'attached', timeout: 15000 });
    const rows = await page.$$eval('[id^="galaxyRow"]', (els) => els.map((r) => ({
      id: r.id, targets: r.querySelectorAll('.ogx-gx-slot[data-owner="targets"]').length, stalk: r.querySelectorAll('.ogx-gx-slot[data-owner="stalk"]').length,
    })).filter((r) => r.targets || r.stalk));
    assert.ok(rows.length >= 4, 'galaxy rows with tools: ' + JSON.stringify(rows));
    for (const r of rows) assert.ok(r.targets <= 1 && r.stalk <= 1, 'one slot per module and row ' + JSON.stringify(r));
    assert.equal(await count(page, '#galaxyRow8 .ogx-i-targets-star, #galaxyRow8 .ogx-i-stalk-eye'), 0, 'no star or eye on the own planet');
    for (const r of [4, 6, 11, 13]) {
      assert.equal(await count(page, `#galaxyRow${r} .ogx-i-targets-star`), 1, 'one target star in row ' + r);
      assert.equal(await count(page, `#galaxyRow${r} .ogx-i-stalk-eye`), 1, 'one stalk eye in row ' + r);
    }
    assert.equal(await count(page, '#ogx-l-menu-clock'), 1, 'Live galaxy clock once');
  },
  async '/messages'(page) {
    await page.waitForSelector('li.msg .ogx-i-spy-badge', { state: 'attached', timeout: 15000 });
    const per = await page.$$eval('li.msg', (els) => els.map((li) => li.querySelectorAll('.ogx-i-spy-badge').length));
    assert.equal(per.filter((n) => n === 1).length, 3, 'one spy badge per espionage report ' + JSON.stringify(per));
    assert.ok(per.every((n) => n <= 1), 'never two badges on one message');
  },
};
async function techList(page, env, name) {
  await env.waitFor(page, '#technologies .ogx-l-techcost-badge');
  await env.waitFor(page, '#technologies .ogx-i-todo-plus');
  const per = await page.$$eval('#technologies li.technology[data-technology]', (lis) => lis.map((li) => [
    li.dataset.technology, li.querySelectorAll('.ogx-l-techcost-badge').length, li.querySelectorAll('.ogx-i-todo-plus').length]));
  assert.ok(per.length > 0, name + ': list items');
  const bad = per.filter(([, a, b]) => a !== 1 || b !== 1);
  assert.deepEqual(bad, [], name + ': each item has one Live cost badge and one Infinity "+" ');
}

T.test('suite: manifest, popup/options files, icons', async () => {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.name, 'OgameX Suite');
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.equal(m.version_name, m.version + ' beta');
  assert.deepEqual(m.permissions, ['storage']);
  assert.equal(m.browser_specific_settings.gecko.id, 'ogamex-suite@ogx.local');
  const iso = m.content_scripts[1].js;
  assert.equal(iso[0], 'shared/core/00-ogx.js');
  assert.equal(iso[iso.length - 1], 'loader.js');
  const live = iso.filter((f) => f.startsWith('modules/live/')).map((f) => f.split('/')[2]);
  const inf = iso.filter((f) => f.startsWith('modules/infinity/')).map((f) => f.split('/')[2]);
  assert.deepEqual(live, LIVE);
  assert.deepEqual(inf, INFINITY);
  assert.ok(iso.indexOf('modules/live/timeline/timeline.js') < iso.indexOf('modules/infinity/panel/panel.js'), 'Live before Infinity');
  for (const cs of m.content_scripts) assert.deepEqual(cs.matches, ['http://*/*', 'https://*/*']);
  for (const s of [16, 32, 48, 128]) {
    const b = fs.readFileSync(path.join(DIR, `icons/icon${s}.png`));
    assert.equal(b.slice(1, 4).toString(), 'PNG');
    assert.equal(b.readUInt32BE(16), s, 'icon width');
  }
  for (const f of [...iso, 'background.js', 'popup/popup.html', 'popup/popup.js', 'options/options.html']) assert.ok(fs.existsSync(path.join(DIR, f)), f);
});

T.test('suite: every page — each Live and Infinity widget exactly once, no errors, game page intact', async () => {
  const env = await T.launch({ ext: 'suite', scenario: 'vega', gameJs: true });
  // Baseline: the host allow-list (popup «Серверы») excludes this server, so the add-on stays out completely.
  await env.setStorage({ [HOSTS]: ['other.example.org'] });
  const baseline = {};
  for (const p of PAGES) {
    const page = await env.open(p, { waitReady: false });
    await settle(page, p === '/galaxy' || p === '/messages' ? 2500 : 1200);
    assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false, p + ': gated off');
    assert.equal(await count(page, '[id^="ogx-"], [class*="ogx-"]'), 0, p + ': nothing injected when the host is not allowed');
    baseline[p] = await gameIds(page);
  }
  assert.deepEqual(env.consoleErrors().map((l) => l.text), [], 'the game page itself has no errors');
  await env.setStorage({ [HOSTS]: [] });
  env.clearLogs();

  for (const p of PAGES) {
    const page = await env.open(p);
    await settle(page, p === '/galaxy' || p === '/messages' ? 2500 : 1500);
    await common(page, p);
    if (PAGE_CHECKS[p]) await PAGE_CHECKS[p](page, env);
    const now = new Set(await gameIds(page));
    const missing = baseline[p].filter((id) => !now.has(id));
    assert.deepEqual(missing, [], p + ': game elements removed by the add-on');
  }
  // the modules that ran, per page, are all modules of both sections
  const active = await env.evalOgx(await env.page(), () => (OGX._ctxs || []).map((c) => c.ctx.ext + '/' + c.def.name));
  for (const n of LIVE.filter((x) => !['techcost', 'fleetinfo', 'expedition'].includes(x))) assert.ok(active.includes('live/' + n), 'active live/' + n + ' in ' + active);
  for (const n of INFINITY) assert.ok(active.includes('infinity/' + n), 'active infinity/' + n);
  assert.ok(active.includes('suite/suite'), 'hub');
  assert.deepEqual(env.ogxErrors().map((l) => l.text), [], 'no OGX errors');
  assert.deepEqual(env.consoleErrors().map((l) => l.text), [], 'no console errors at all');
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), [], 'no unhandled requests');
}, { timeout: 300000 });

T.test('suite: one side panel with Live / Infinity / Бот / Логи, Live window, TXT log export', async () => {
  const env = await T.launch({ ext: 'suite', scenario: 'vega', gameJs: true });
  const page = await env.open('/overview');
  await settle(page, 800);
  await page.click('#ogx-suite-entry a.menubutton');
  await page.waitForSelector('#ogx-panel-infinity:not([hidden])', { timeout: 5000 });
  assert.equal(await page.textContent('#ogx-panel-infinity .ogx-panel-title'), 'OgameX Suite');
  const groups = await page.$$eval('#ogx-panel-infinity .ogx-tab-group', (e) => e.map((x) => x.dataset.group + ':' + x.textContent));
  assert.deepEqual(groups, ['live:Live', 'infinity:Infinity', 'bot:Бот', 'logs:Логи']);

  // Infinity: every tab exactly once, each renders without errors
  await page.click('#ogx-panel-infinity .ogx-tab-group[data-group="infinity"]');
  const tabs = await page.$$eval('#ogx-panel-infinity .ogx-tabs:not(.ogx-tab-groups) .ogx-tab', (e) => e.map((x) => x.dataset.tab));
  assert.deepEqual(tabs.slice().sort(), INFINITY_TABS.slice().sort(), 'Infinity tabs ' + tabs);
  for (const t of tabs) {
    await page.click(`#ogx-panel-infinity .ogx-tab[data-tab="${t}"]`);
    await page.waitForFunction((id) => { const p = document.querySelector(`#ogx-panel-infinity .ogx-tab-pane[data-tab="${id}"]`); return p && !p.hidden && p.childElementCount > 0; }, t, { timeout: 5000 });
  }
  assert.equal(await count(page, '#ogx-panel-infinity .ogx-tab-pane'), INFINITY_TABS.length + 3, 'panes: Infinity + live + bot + diag');
  // prefs lists the 10 Infinity modules
  await page.click('#ogx-panel-infinity .ogx-tab[data-tab="prefs"]');
  // Live group: overview with the 7 Live modules and the Live window
  await page.click('#ogx-panel-infinity .ogx-tab-group[data-group="live"]');
  await page.waitForSelector('.ogx-tab-pane[data-tab="live"]:not([hidden]) .ogx-s-hub-modules', { timeout: 5000 });
  const liveRows = await page.$$eval('.ogx-s-hub-modules tbody tr', (e) => e.map((x) => x.dataset.module + ':' + x.querySelector('.ogx-s-hub-state').textContent));
  assert.deepEqual(liveRows.map((r) => r.split(':')[0]), LIVE);
  assert.ok(liveRows.includes('planetbar:работает на этой странице'), liveRows.join(' | '));
  assert.ok(liveRows.includes('fleetinfo:не для этой страницы'), liveRows.join(' | '));
  assert.equal(await page.isHidden('#ogx-panel-infinity .ogx-tabs:not(.ogx-tab-groups)'), true, 'one tab in the Live group: no second row');
  await page.click('[data-ogx-act="suite:live-open"]');
  await page.waitForSelector('#ogx-l-menu-modal', { timeout: 5000 });
  assert.equal(await count(page, '#ogx-l-menu-modal'), 1);
  assert.equal(await count(page, '#ogx-l-menu-coexist'), 0, 'no "two extensions" banner inside the suite');
  const ns = await page.$$eval('#ogx-l-menu-settings fieldset[data-ns]', (e) => e.map((x) => x.dataset.ns));
  assert.equal(ns[0], 'core');
  for (const n of ns.slice(1)) assert.ok(LIVE.includes(n) || n === 'diag', 'Live window lists only Live settings, got ' + n);
  assert.ok(ns.includes('planetbar') && !ns.includes('empire') && !ns.includes('suite'), ns.join(','));
  await page.keyboard.press('Escape');
  await page.click('.ogx-modal .ogx-modal-buttons .ogx-btn').catch(() => {});
  await page.waitForSelector('#ogx-l-menu-modal', { state: 'detached', timeout: 5000 });

  // Bot: placeholder
  await page.click('#ogx-panel-infinity .ogx-tab-group[data-group="bot"]');
  await page.waitForSelector('.ogx-tab-pane[data-tab="bot"]:not([hidden]) .ogx-s-hub-bot', { timeout: 5000 });
  assert.match(await page.textContent('.ogx-s-hub-bot .ogx-s-hub-h'), /Бот — в разработке/);
  assert.equal(await count(page, '.ogx-s-hub-bot li'), 6);

  // Логи: the shared panel, exactly once; TXT export
  await page.click('#ogx-panel-infinity .ogx-tab-group[data-group="logs"]');
  await page.waitForSelector('.ogx-tab-pane[data-tab="diag"]:not([hidden]) .ogx-diag', { timeout: 5000 });
  assert.equal(await count(page, '.ogx-diag'), 1);
  await env.evalOgx(page, async () => { OGX.log.rec('B', 'e2e', 'marker', { n: 1 }); await OGX.diag.flush(); await OGX.diag.publishContext(); await OGX.storage.flush(); return true; });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('.ogx-tab-pane[data-tab="diag"] [data-ogx-act="diag:today"]')]);
  assert.match(dl.suggestedFilename(), /^ogx-suite-log-today-localhost_\d+-\d{8}-\d{6}\.txt$/);
  const txt = fs.readFileSync(await dl.path(), 'utf8');
  checkTxt(txt, 'page');

  // popup «Логи» reads the same journal (extension mode only: inject mode has no extension pages)
  if (env.mode === 'extension') {
    const pop = await env.page(true);
    await pop.goto(`chrome-extension://${T.extensionId(DIR)}/popup/popup.html?tab=logs`);
    await pop.waitForSelector('body[data-ready="1"] [data-pane="logs"]:not([hidden]) [data-ogx-act="diag:new"]', { timeout: 5000 });
    const [d2] = await Promise.all([pop.waitForEvent('download', { timeout: 10000 }), pop.click('[data-ogx-act="diag:today"]')]);
    const t2 = fs.readFileSync(await d2.path(), 'utf8');
    checkTxt(t2, 'popup');
    await pop.close();
  }
  assert.deepEqual(env.ogxErrors().map((l) => l.text), []);
  assert.deepEqual(env.consoleErrors().map((l) => l.text), []);
}, { timeout: 180000 });

function checkTxt(txt, where) {
  const head = txt.split('\n').slice(0, 40).join('\n');
  assert.ok(txt.startsWith('=== OGX журнал для разбора (формат 1) ===\n'), where + ': first line\n' + head);
  assert.match(head, /^Расширение: OgameX Suite 0\.1\.0 \(ядро 0\.1\.0\)$/m, where);
  assert.match(head, /^Выгрузка: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC[+-]\d\d:\d\d {2}вид: /m, where);
  assert.match(head, /^Сервер: localhost:\d+ {2}хранилище журнала: /m, where);
  assert.match(head, /^Игрок: id 108/m, where);
  assert.match(head, /^Модули:$/m, where);
  for (const n of LIVE) assert.match(head, new RegExp('^  \\+ live/' + n + '\\b', 'm'), where + ' live/' + n + '\n' + head);
  for (const n of INFINITY) assert.match(head, new RegExp('^  \\+ infinity/' + n + '\\b', 'm'), where + ' infinity/' + n);
  assert.match(head, /^Ошибки за 10 мин: U=\d+ B=\d+ S=\d+ N=\d+ G=\d+ L=\d+$/m, where);
  assert.match(head, /^Событий в файле: \d+/m, where);
  assert.ok(txt.includes('\n=== SUMMARY ===\n'), where + ': summary');
  assert.ok(txt.includes('События по источникам/видам:'), where);
  assert.ok(txt.includes('\n=== EVENTS ===\n'), where + ': events');
  assert.match(txt, /\[S\] ready: overview/, where);
  assert.match(txt, /\[B\] e2e: marker/, where);
  assert.ok(!/Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e/.test(txt), where + ': CSRF token never exported');
}

T.test('suite: popup — global module switches and the server allow-list', async () => {
  const env = await T.launch({ ext: 'suite', scenario: 'vega' });
  let page = await env.open('/overview');
  assert.ok(await count(page, '.ogx-l-planetbar-prod') >= 2);
  if (env.mode === 'extension') {
    const pop = await env.page(true);
    await pop.goto(`chrome-extension://${T.extensionId(DIR)}/popup/popup.html?tab=modules`);
    await pop.waitForSelector('body[data-ready="1"]', { timeout: 5000 });
    const secs = await pop.$$eval('.sx-sec', (e) => e.map((x) => x.dataset.section + ':' + x.querySelectorAll('input[data-module]').length));
    assert.deepEqual(secs, ['live:7', 'infinity:10', 'bot:0']);
    assert.match(await pop.textContent('.sx-sec[data-section="bot"]'), /Бот \(в разработке\)/);
    assert.match(await pop.textContent('.sx-ver'), /0\.1\.0 beta/);
    await pop.click('input[data-module="planetbar"]');
    await pop.click('input[data-module="stalk"]');
    await pop.waitForFunction(() => /Сохранено/.test(document.querySelector('.sx-status').textContent));
    assert.deepEqual(await env.get('suite.modules', { scope: 'global' }), { planetbar: false, stalk: false });
    // allow-list: add a foreign host -> the game page here gets nothing
    await pop.click('[data-ogx-act="popup:tab-hosts"]');
    await pop.fill('[data-ogx-act="popup:host-input"]', 'https://ogx.example.org/overview');
    await pop.click('[data-ogx-act="popup:host-add"]');
    assert.deepEqual(await env.get('suite.hosts', { scope: 'global' }), ['ogx.example.org']);
    // a server where the suite already ran is offered as a chip
    assert.ok((await pop.textContent('[data-pane="hosts"]')).includes(env.host), 'known server chip');
    await pop.close();
    // options page = the same UI, full width, same store
    const opt = await env.page(true);
    await opt.goto(`chrome-extension://${T.extensionId(DIR)}/options/options.html?tab=modules`);
    await opt.waitForSelector('body.ogx-options[data-ready="1"]', { timeout: 5000 });
    assert.equal(await opt.isChecked('input[data-module="planetbar"]'), false, 'options page shows the stored switch');
    assert.equal(await opt.isChecked('input[data-module="panel"]'), true);
    assert.equal(await count(opt, '#ogx-diag-panel .ogx-diag'), 1, 'logs panel mounted once');
    await opt.close();
  } else {
    await env.setStorage({ [MODS]: { planetbar: false, stalk: false }, [HOSTS]: ['ogx.example.org'] });
  }
  page = await env.open('/overview', { waitReady: false });
  await settle(page, 1000);
  assert.equal(await count(page, '[id^="ogx-"], [class*="ogx-"]'), 0, 'host not in the allow-list: nothing');
  if (env.mode === 'extension') {
    // the popup export explains it: S gated in the journal, the popup's changes as U events, allow-list in the header
    const pop = await env.page(true);
    await pop.goto(`chrome-extension://${T.extensionId(DIR)}/popup/popup.html?tab=logs`);
    await pop.waitForSelector('body[data-ready="1"]', { timeout: 5000 });
    let info = null;
    for (let i = 0; i < 30; i++) {
      info = await pop.evaluate(async () => {
        const b = OGXDiagPanel.extensionBackend();
        const evs = (await b.query({})).events;
        const ctx = await b.context();
        return { gated: evs.filter((e) => e.s === 'S' && e.k === 'gated').map((e) => e.w + ' ' + JSON.stringify(e.d)),
          popup: evs.filter((e) => e.s === 'U' && e.k === 'popup').map((e) => e.w + ' ' + JSON.stringify(e.d)),
          head: OGXDiagLib.headerLines(ctx, evs).join('\n') };
      });
      if (info.gated.length) break;
      await pop.waitForTimeout(100);
    }
    assert.ok(info.gated.some((x) => x.startsWith(env.host + ' ') && x.includes('allow-list') && x.includes('ogx.example.org')), JSON.stringify(info.gated));
    assert.ok(info.popup.some((x) => x.startsWith('modules ') && x.includes('planetbar') && x.includes('stalk')), JSON.stringify(info.popup));
    assert.ok(info.popup.some((x) => x.startsWith('hosts ') && x.includes('ogx.example.org')), JSON.stringify(info.popup));
    assert.ok(info.head.includes('Серверы (allow-list): ogx.example.org') && info.head.includes(env.host + ' не в списке'), info.head);
    assert.ok(info.head.includes('Выключено глобально (попап): planetbar, stalk'), info.head);
    await pop.close();
  }
  // same mock under the allowed name: works
  page = await env.open(env.urlOn('ogx.example.org', '/overview'), { waitReady: false });
  await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 10000 });
  assert.equal(await count(page, '.ogx-l-planetbar-prod'), 0, 'planetbar switched off globally');
  assert.equal(await count(page, '[data-ogx-act="inflight:toggle"]'), 1, 'other Live modules still on');
  const active = await env.evalOgx(page, () => (OGX._ctxs || []).map((c) => c.def.name));
  assert.ok(!active.includes('stalk') && !active.includes('planetbar') && active.includes('panel') && active.includes('timeline'), active.join(','));
  // the hub reports the global switch in the Live overview
  await env.evalOgx(page, () => { const p = OGX.suite.panel(); p.open(); p.selectGroup('live'); return true; });
  await page.waitForSelector('.ogx-s-hub-modules tr[data-module="planetbar"]', { timeout: 5000 });
  assert.equal(nbsp(await page.textContent('.ogx-s-hub-modules tr[data-module="planetbar"] .ogx-s-hub-state')), 'выключен в окне расширения');
  assert.equal(await page.isDisabled('.ogx-s-hub-modules tr[data-module="planetbar"] input'), true);
  // per-account switch from the in-game Live overview
  await page.click('.ogx-s-hub-modules tr[data-module="timeline"] input');
  await page.waitForSelector('.ogx-s-hub-note:not([hidden])', { timeout: 5000 });
  // settings writes are coalesced (100 ms); wait until the switch is stored (inject mode relays storage through CDP)
  for (let i = 0; i < 50; i++) {
    const st = await env.storage();
    if (Object.entries(st).some(([k, v]) => /\|settings$/.test(k) && v && v.timeline && v.timeline.enabled === false)) break;
    await page.waitForTimeout(100);
  }
  await page.reload();
  await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 10000 });
  assert.equal(await count(page, '#ogx-l-timeline'), 0, 'timeline off for this account');
  // section marks follow the switches: Infinity all off -> no data-ogx-infinity, Live widgets alone
  await env.setStorage({ [MODS]: Object.fromEntries(INFINITY.map((n) => [n, false])) });
  await page.reload();
  await page.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 10000 });
  assert.equal(await page.getAttribute('html', 'data-ogx-infinity'), null);
  assert.equal(await page.getAttribute('html', 'data-ogx-live'), 'ready');
  assert.deepEqual(await page.$$eval('#menuTableTools > li', (e) => e.map((x) => x.id)), ['ogx-suite-entry'], 'the suite entry stays');
  assert.equal(await count(page, '.ogx-tab[data-tab="planets"]'), 0);
  assert.deepEqual(env.ogxErrors().map((l) => l.text), []);
}, { timeout: 120000 });

T.test('suite: safety on non-OgameX pages, gameforge excluded, works on any domain', async () => {
  const env = await T.launch({ ext: 'suite' });
  for (const p of ['/not-ogame', '/login', '/gameforge-like']) {
    const page = await env.open(p, { waitReady: false });
    await settle(page, 400);
    assert.equal(await count(page, '[class*="ogx-"], [id^="ogx-"]'), 0, p);
    assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false, p);
  }
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame', '/login', '/gameforge-like'], 'no requests of our own');
  let page = await env.open(env.urlOn('s1-en.ogame.gameforge.com', '/overview'), { waitReady: false });
  await settle(page, 600);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-ogx-suite')), false, 'gameforge excluded');
  assert.equal(await page.evaluate(() => typeof window.__ogxHook), 'undefined', 'no page hook on gameforge');
  page = await env.open(env.urlOn('my-ogamex.example.net', '/overview'));
  assert.equal(await page.getAttribute('html', 'data-ogx-suite'), 'ready');
  assert.deepEqual(env.ogxErrors().map((l) => l.text), []);
});
