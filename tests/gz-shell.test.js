'use strict';
// The «OgameX Suite» shell on the REAL saved GALAXYZ pages of ogamex.eu/Aeternum (scratchpad/eu/pages): the real unpacked
// extension (manifest, loader, hub, all modules) in Chromium; every host resolves to a local server that serves
// /Aeternum/game.php?page=<name>[&mode=<mode>] from the saved pages and the live CSS/images from eu/overview/*_files
// (the game's own JS is not served). Checks the menu entry in #menuTable, the side panel with Live / Infinity / Бот / Логи,
// the journal export, the page layout staying intact, and the popup's «эта вкладка» status. Screenshots of every page go to
// tests/out/shell-<page>.png.
//   node tests/gz-shell.test.js
//   OGX_GZ_PAGES=/path/to/pages node tests/gz-shell.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const T = require('./lib');
const { assert } = T;

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'ogamex-suite');
const OUT = path.join(__dirname, 'out');
const EU = path.resolve(ROOT, '..', 'eu');
const PAGES = process.env.OGX_GZ_PAGES || path.join(EU, 'pages');
const ASSETS = path.join(EU, 'overview', fs.existsSync(path.join(EU, 'overview')) ? (fs.readdirSync(path.join(EU, 'overview')).find((f) => /_files$/.test(f)) || '') : '');
const ALL = fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).sort();
const MIME = { css: 'text/css', gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2' };

/** One server for the whole file: game.php?page=..&_f=<file> -> saved page; any other path -> asset by basename (no JS). */
function startServer() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, data) => { res.writeHead(code, { 'Content-Type': type }); res.end(data); };
    if (/\/game\.php$/.test(u.pathname) || u.pathname === '/index.php' || u.pathname === '/other') {
      const pg = u.searchParams.get('page') || 'overview';
      const name = u.searchParams.get('_f') || pg + (u.searchParams.get('mode') ? '-' + u.searchParams.get('mode') : '');
      const file = path.join(PAGES, path.basename(name) + '.html');
      if (!fs.existsSync(file)) return send(404, 'text/html', 'no page');
      // the saved fleetStep3 redirects to fleetTable after 3 s
      return send(200, 'text/html; charset=UTF-8', fs.readFileSync(file, 'utf8').replace(/<meta http-equiv="refresh"[^>]*>/i, ''));
    }
    const ext = (u.pathname.match(/\.(\w+)$/) || [])[1];
    const file = ASSETS && path.join(ASSETS, path.basename(decodeURIComponent(u.pathname)));
    if (ext && MIME[ext] && file && fs.existsSync(file)) return send(200, MIME[ext], fs.readFileSync(file));
    send(404, 'text/plain', '');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

let shared = null;
async function env() {
  if (shared) return shared;
  if (process.env.OGX_NO_SYNC !== '1') T.sync();
  const server = await startServer();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogx-gz-shell-'));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium', headless: process.env.OGX_HEADED !== '1', viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${DIR}`, `--load-extension=${DIR}`, '--host-resolver-rules=MAP * 127.0.0.1'],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(worker.url()).host;
  const origin = 'http://ogamex.eu:' + server.port;
  const errors = [];
  const open = async (name, { wait = true } = {}) => {
    const p = await context.newPage();
    p.on('console', (m) => { if (m.type() === 'error' && /\[OGX/.test(m.text())) errors.push(name + ': ' + m.text()); });
    const [pg, mode] = name.split('-');
    const q = 'page=' + (name.startsWith('messages') ? 'messages' : pg) + (mode && !name.startsWith('messages') ? '&mode=' + mode : '') + '&_f=' + name;
    await p.goto(origin + '/Aeternum/game.php?' + q, { waitUntil: 'domcontentloaded' });
    if (wait) await p.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
    return p;
  };
  shared = { server, context, extId, origin, open, errors, worker,
    async close() { await context.close().catch(() => {}); server.srv.close(); fs.rmSync(userDir, { recursive: true, force: true }); } };
  return shared;
}

/** Bounding boxes of the game's chrome, to prove the shell does not move anything. */
const layoutBoxes = (p) => p.evaluate(() => {
  const out = {};
  for (const sel of ['#links', '#inhalt', '#rechts', '#info', '#resTable', '#menuTable']) {
    const e = document.querySelector(sel);
    if (e) { const r = e.getBoundingClientRect(); out[sel] = [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }
  }
  return out;
});

T.test('menu entry «OgameX Suite» in the real left menu (#menuTable) on every real page, same markup as the game', async () => {
  const e = await env();
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of ALL) {
    const p = await e.open(name);
    const r = await p.evaluate(() => {
      const ul = document.querySelector('#menuTable');
      const li = document.getElementById('ogx-suite-entry');
      const own = [...document.querySelectorAll('#menuTable > li')].filter((x) => x.id && x.id.startsWith('ogx-')).map((x) => x.id);
      const a = li && li.querySelector('a.menubutton');
      const ref = ul && ul.querySelector('li:not([id]) a.menubutton');
      const box = (x) => { if (!x) return null; const b = x.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left) }; };
      return { inMenu: !!li && li.parentElement === ul, own, label: a && a.textContent.trim(), icon: !!(li && li.querySelector('.menu_icon')),
        a: box(a), ref: box(ref), visible: !!a && a.offsetParent !== null, panel: document.querySelectorAll('.ogx-panel').length };
    });
    assert.ok(r.inMenu, name + ': entry is a child of #menuTable');
    assert.deepEqual(r.own, ['ogx-suite-entry'], name + ': exactly one own menu entry');
    assert.match(r.label, /^OgameX Suite/, name);
    assert.ok(r.icon && r.visible, name + ': visible, with an icon slot');
    assert.equal(r.a.l, r.ref.l, name + ': aligned with the game buttons');
    assert.ok(Math.abs(r.a.h - r.ref.h) <= 2, name + ': same height as the game buttons ' + JSON.stringify(r));
    assert.equal(r.panel, 1, name + ': one side panel');
    await p.screenshot({ path: path.join(OUT, 'shell-' + name + '.png') });
    await p.close();
  }
  assert.deepEqual(e.errors, [], 'no [OGX ...] console errors');
});

T.test('panel: groups Live / Infinity / Бот / Логи, Бот = обзор бота (с 0.3.2 включён по умолчанию), layout unchanged, Esc closes', async () => {
  const e = await env();
  for (const name of ['overview', 'buildings', 'galaxy', 'fleetStep3', 'transport']) {
    const p = await e.open(name);
    const before = await layoutBoxes(p);
    await p.click('#ogx-suite-entry a.menubutton');
    await p.waitForSelector('#ogx-panel-infinity:not([hidden])');
    const groups = await p.$$eval('#ogx-panel-infinity .ogx-tab-groups .ogx-tab', (b) => b.map((x) => x.textContent.trim()));
    assert.deepEqual(groups, ['Infinity', 'Live', 'Бот', 'Логи'], name + ' groups');
    await p.click('#ogx-panel-infinity .ogx-tab-group[data-group="live"]');
    const live = await p.$$eval('#ogx-panel-infinity [data-tab="live"] tr[data-module]', (r) => r.map((x) => x.dataset.module));
    assert.deepEqual(live, ['menu', 'planetbar', 'inflight', 'techcost', 'fleetinfo', 'expedition', 'timeline'], name);
    if (name === 'overview') await p.screenshot({ path: path.join(OUT, 'shell-overview-panel-live.png') });
    await p.click('#ogx-panel-infinity .ogx-tab-group[data-group="bot"]');
    await p.waitForSelector('#ogx-panel-infinity .ogx-tab-pane[data-tab="bot"] .ogx-b-bot-state');
    const bot = await p.textContent('#ogx-panel-infinity .ogx-tab-pane[data-tab="bot"]');
    assert.doesNotMatch(bot, /Бот выключен/, name + ': bot on by default (0.3.2)');
    assert.match(bot, /Пробный режим/, name + ': dry-run switch shown');
    if (name === 'overview') await p.screenshot({ path: path.join(OUT, 'shell-overview-panel-bot.png') });
    await p.click('#ogx-panel-infinity .ogx-tab-group[data-group="infinity"]');
    const inf = await p.$$eval('#ogx-panel-infinity .ogx-tabs:not(.ogx-tab-groups) .ogx-tab', (b) => b.length);
    assert.ok(inf >= 3, name + ': Infinity tabs ' + inf);
    await p.click('#ogx-panel-infinity .ogx-tab-group[data-group="logs"]');
    await p.waitForSelector('#ogx-panel-infinity .ogx-diag-btn[data-ogx-act="diag:full"]');
    const st = await p.evaluate(() => {
      const el = document.getElementById('ogx-panel-infinity');
      const cs = getComputedStyle(el);
      return { pos: cs.position, z: +cs.zIndex, right: Math.round(el.getBoundingClientRect().right), vw: innerWidth, sx: document.documentElement.scrollWidth };
    });
    assert.equal(st.pos, 'fixed', name);
    assert.ok(st.z > 1100, name + ': above the fancybox overlay');
    assert.ok(st.sx <= st.vw, name + ': no horizontal scroll ' + JSON.stringify(st));
    assert.deepEqual(await layoutBoxes(p), before, name + ': game layout unchanged with the panel open');
    await p.screenshot({ path: path.join(OUT, 'shell-' + name + '-panel.png') });
    await p.keyboard.press('Escape');
    assert.ok(await p.$eval('#ogx-panel-infinity', (x) => x.hidden), name + ': Esc closes');
    await p.close();
  }
});

T.test('the game chrome sits where it sits without the extension (left menu, content, header)', async () => {
  const e = await env();
  const plain = await chromium.launch({ args: ['--host-resolver-rules=MAP * 127.0.0.1'] });
  try {
    const ctx = await plain.newContext({ viewport: { width: 1400, height: 900 } });
    for (const name of ['overview', 'buildings', 'galaxy', 'imperium', 'fleetStep1', 'transport']) {
      const a = await ctx.newPage();
      const [pg, mode] = name.split('-');
      await a.goto(e.origin + '/Aeternum/game.php?page=' + pg + (mode ? '&mode=' + mode : '') + '&_f=' + name, { waitUntil: 'load' });
      const want = await layoutBoxes(a);
      const b = await e.open(name);
      await b.waitForTimeout(500);
      const have = await layoutBoxes(b);
      for (const sel of ['#links', '#inhalt', '#info', '#resTable']) assert.deepEqual(have[sel], want[sel], name + ' ' + sel);
      // the menu only grows by our one row
      assert.equal(have['#menuTable'][0], want['#menuTable'][0], name + ' #menuTable');
      await a.close(); await b.close();
    }
  } finally { await plain.close(); }
});

T.test('right column at laptop widths: no horizontal scroll, planet list not split, Live modules ported (no warnings)', async () => {
  const e = await env();
  const plain = await chromium.launch({ args: ['--host-resolver-rules=MAP * 127.0.0.1'] });
  try {
    for (const width of [1280, 1366]) {
      const ctx = await plain.newContext({ viewport: { width, height: 800 } });
      for (const name of ['overview', 'galaxy', 'imperium', 'fleetTable', 'fleetStep1', 'fleetStep2']) {
        const a = await ctx.newPage();
        await a.goto(e.origin + '/Aeternum/game.php?page=' + name + '&_f=' + name, { waitUntil: 'load' });
        const want = await a.evaluate(() => document.documentElement.scrollWidth);
        await a.close();
        const warns = [];
        const b = await e.context.newPage();
        await b.setViewportSize({ width, height: 800 });
        b.on('console', (m) => { if (m.type() === 'warning' && /\[OGX Suite\/(planetbar|inflight|timeline|expedition|fleetinfo)\]/.test(m.text())) warns.push(m.text()); });
        await b.goto(e.origin + '/Aeternum/game.php?page=' + name + '&_f=' + name, { waitUntil: 'domcontentloaded' });
        await b.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
        await b.waitForSelector('.ogx-l-inflight-totals', { timeout: 10000 });
        await b.waitForTimeout(800);
        const r = await b.evaluate(() => {
          const lists = [...document.querySelectorAll('#planetList')];
          const last = lists[lists.length - 1];
          const totals = document.querySelector('.ogx-l-inflight-totals');
          const tl = document.querySelector('#ogx-l-timeline');
          const name = document.querySelector('#planetList .planet-name').getBoundingClientRect();
          const sw = document.querySelector('.ogx-l-planetbar-switch');
          const swr = sw && !sw.hidden ? sw.getBoundingClientRect() : null;
          return {
            sw: document.documentElement.scrollWidth,
            totalsInLast: !!(totals && last.contains(totals)), timelineAfterLast: !!(tl && last.nextElementSibling === tl),
            prod: [...document.querySelectorAll('.ogx-l-planetbar-prod')].map((x) => +x.dataset.planetId),
            switchCovers: !!(swr && swr.bottom > name.top && swr.top < name.bottom && swr.right > name.left),
            exp: document.querySelector('.ogx-l-expedition-points') ? document.querySelector('.ogx-l-expedition-points').textContent : null,
            expBtn: !!document.querySelector('a.ogx-l-expedition-btn'),
            fleetinfo: !!document.querySelector('#ogx-l-fleetinfo'),
          };
        });
        await b.close();
        assert.equal(r.sw, want, `${name} @${width}: scrollWidth with the extension`);
        assert.ok(r.totalsInLast, name + ': «Итоги» below the last planet');
        assert.ok(r.timelineAfterLast, name + ': «Полёты» after the last #planetList');
        assert.deepEqual(r.prod, [254102, 254103, 254104, 254105], name + ': one planetbar overlay per planet (cp= ids)');
        assert.equal(r.switchCovers, false, name + ': switcher does not cover the first planet name');
        assert.deepEqual(warns, [], name + ' @' + width + ': Live module warnings');
        if (name === 'fleetStep1') { assert.equal(r.exp, '150', 'expedition points of 1 colony ship'); assert.ok(r.expBtn, 'expedition button on fleetStep1'); }
        if (name === 'fleetTable') assert.ok(r.fleetinfo, 'fleetinfo table on fleetTable');
      }
      await ctx.close();
    }
  } finally { await plain.close(); }
});

T.test('«Логи для разбора»: «Выгрузить логи» = one TXT with everything; «Ещё» → «Новое с прошлой выгрузки» with the GALAXYZ context', async () => {
  const e = await env();
  const p = await e.open('overview');
  await p.click('#ogx-suite-entry a.menubutton');
  await p.click('#ogx-panel-infinity .ogx-tab-group[data-group="logs"]');
  const [full] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#ogx-panel-infinity .ogx-diag-btn[data-ogx-act="diag:full"]')]);
  assert.match(full.suggestedFilename(), /^ogx-suite-logs-/);
  const all = fs.readFileSync(await full.path(), 'utf8');
  assert.match(all, /^=== OGX полная выгрузка для разбора/);
  assert.match(all, /Расширение: OgameX Suite/);
  for (const sec of ['=== НАСТРОЙКИ (все, JSON) ===', '=== ОТЧЁТ САМООБУЧЕНИЯ ===', '=== EVENTS ===', '=== СНИМКИ СТРАНИЦ ===']) assert.ok(all.includes(sec), sec);
  assert.match(all, /\[S\] page: overview/);
  await p.click('#ogx-panel-infinity .ogx-diag-more > summary');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#ogx-panel-infinity .ogx-diag-btn[data-ogx-act="diag:new"]')]);
  const file = path.join(OUT, 'shell-export.txt');
  await dl.saveAs(file);
  const txt = fs.readFileSync(file, 'utf8');
  assert.match(txt, /OgameX Suite/);
  assert.match(txt, /ogamex\.eu/i, 'host in the header');
  assert.match(txt, /galaxyz/i, 'engine in the header');
  assert.match(await p.textContent('#ogx-panel-infinity .ogx-diag-status'), /Сохранено/);
  await p.close();
});

T.test('popup: «эта вкладка» says GALAXYZ detected on a game page and why not elsewhere', async () => {
  const e = await env();
  // Without the "tabs" permission tab URLs are hidden: the page opened last has the highest tab id.
  const lastTabId = () => e.worker.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));
  const status = async () => {
    const tabId = await lastTabId();
    const pop = await e.context.newPage();
    await pop.goto(`chrome-extension://${e.extId}/popup/popup.html?tabId=${tabId}`);
    await pop.waitForSelector('[data-ogx-tabstatus]:not([data-ogx-tabstatus="wait"])', { timeout: 10000 });
    const r = await pop.evaluate(() => { const x = document.querySelector('[data-ogx-tabstatus]'); return { state: x.dataset.ogxTabstatus, text: x.textContent.replace(/\s+/g, ' ').trim() }; });
    return { r, pop };
  };
  await e.open('overview');
  let { r, pop } = await status();
  assert.equal(r.state, 'ok', JSON.stringify(r));
  assert.match(r.text, /GALAXYZ 1\.8/);
  assert.match(r.text, /overview/);
  // review fix: the hint names what the panel shows (Live has no «Обзор» sub-tab label)
  const foot = await pop.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  assert.ok(!/Live → «Обзор»/.test(foot), 'no hint to an invisible «Обзор» tab');
  assert.match(foot, /Live \(список модулей «OgameX Live»\)/);
  await pop.setViewportSize({ width: 380, height: 600 });
  await pop.screenshot({ path: path.join(OUT, 'shell-popup-ok.png') });
  await pop.close();
  // a GALAXYZ page that is not a game page (login: no serverTime) -> reason
  const login = await e.context.newPage();
  await login.goto(e.origin + '/index.php?_f=overview', { waitUntil: 'domcontentloaded' });
  ({ r, pop } = await status());
  assert.equal(r.state, 'no', JSON.stringify(r));
  assert.match(r.text, /game\.php/, 'reason names the path');
  await pop.setViewportSize({ width: 380, height: 600 });
  await pop.screenshot({ path: path.join(OUT, 'shell-popup-no.png') });
  await pop.close();
  // a page without content scripts (about:blank) -> «расширение не работает на этой вкладке»
  const blank = await e.context.newPage();
  await blank.goto('about:blank');
  const id = await lastTabId();
  pop = await e.context.newPage();
  await pop.goto(`chrome-extension://${e.extId}/popup/popup.html?tabId=${id}`);
  await pop.waitForSelector('[data-ogx-tabstatus]:not([data-ogx-tabstatus="wait"])', { timeout: 10000 });
  assert.equal(await pop.$eval('[data-ogx-tabstatus]', (x) => x.dataset.ogxTabstatus), 'none');
  await pop.close();
  // the module switches still render
  pop = await e.context.newPage();
  await pop.goto(`chrome-extension://${e.extId}/popup/popup.html`);
  await pop.waitForSelector('body[data-ready="1"]');
  assert.ok(await pop.$('[data-section="bot"]'), 'Бот section');
  await e.close();
  shared = null;
});
