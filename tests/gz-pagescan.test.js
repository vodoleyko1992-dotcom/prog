'use strict';
// «Скан страниц» (shared/core/24-pagescan.js) in the real unpacked extension on the saved GALAXYZ pages of ogamex.eu/Aeternum:
// the tab in the «Логи» group, a full scan of all 4 planets (GET only, no action pages, no mail by default, planet restored),
// and the downloaded ZIP (valid, per-planet folders, global pages, object details JSON, index.json, log.txt).
//   node tests/gz-pagescan.test.js        (about 1.5 min: the scan keeps its real 0.3–0.6 s pauses)
//   OGX_GZ_PAGES=/path/to/pages node tests/gz-pagescan.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { chromium } = require('playwright');
const T = require('./lib');
const { assert } = T;

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'ogamex-suite');
const PAGES = process.env.OGX_GZ_PAGES || path.resolve(ROOT, '..', 'eu', 'pages');

function startServer(reqs) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, data) => { res.writeHead(code, { 'Content-Type': type }); res.end(data); };
    if (!/\/game\.php$/.test(u.pathname)) return send(404, 'text/plain', '');
    reqs.push(req.method + ' ' + u.search);
    const pg = u.searchParams.get('page') || 'overview';
    const mode = u.searchParams.get('mode');
    if (/Ajax$/.test(pg)) return send(200, 'text/html', JSON.stringify({ technology: u.searchParams.get('technology'), page: pg }));
    if (pg === 'messages' && u.searchParams.get('ajax')) return send(200, 'text/html', '<table><tr><td>cat ' + u.searchParams.get('messcat') + '</td></tr></table>');
    const name = u.searchParams.get('_f') || (pg === 'shipyard' ? 'shipyard-' + (mode || 'fleet') : pg === 'messages' ? 'messages-all' : pg);
    const file = path.join(PAGES, path.basename(name) + '.html');
    if (!fs.existsSync(file)) return send(404, 'text/html', 'no page');
    send(200, 'text/html; charset=UTF-8', fs.readFileSync(file, 'utf8').replace(/<meta http-equiv="refresh"[^>]*>/i, ''));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

/** Minimal unzip (stored + deflate) through the central directory; checks every CRC-free size. */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'end of central directory');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header ' + i);
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(buf.readUInt32LE(off), 0x04034b50, 'local header ' + name);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const body = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.equal(data.length, usize, 'size of ' + name);
    out[name] = data.toString('utf8');
    p += 46 + nlen + elen + clen;
  }
  return out;
}

T.test('«Скан страниц»: tab in «Логи», full scan of 4 planets (GET only, safe pages), ZIP with planets / global / details', async () => {
  T.sync();
  const reqs = [];
  const server = await startServer(reqs);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogx-gz-pagescan-'));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium', headless: process.env.OGX_HEADED !== '1', viewport: { width: 1400, height: 900 }, acceptDownloads: true,
    args: [`--disable-extensions-except=${DIR}`, `--load-extension=${DIR}`, '--host-resolver-rules=MAP * 127.0.0.1'],
  });
  try {
    const errors = [];
    const p = await context.newPage();
    p.on('console', (m) => { if (m.type() === 'error' && /\[OGX/.test(m.text())) errors.push(m.text()); });
    await p.goto(`http://ogamex.eu:${server.port}/Aeternum/game.php?page=overview`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('html[data-ogx-suite="ready"]', { timeout: 15000 });
    await p.click('#ogx-suite-entry a.menubutton');
    await p.click('#ogx-panel-infinity .ogx-tab-group[data-group="logs"]');
    await p.click('#ogx-panel-infinity .ogx-tab[data-tab="pagescan"]');
    await p.waitForSelector('#ogx-panel-infinity [data-ogx-act="pagescan:start"]');
    assert.equal(await p.isChecked('[data-ogx-pagescan="messages"]'), false, 'mail is off by default');
    assert.ok(await p.isDisabled('[data-ogx-act="pagescan:download"]'), 'nothing to download yet');
    reqs.length = 0;
    await p.click('[data-ogx-act="pagescan:start"]');
    await p.waitForFunction(() => /Готово|Остановлено|Ошибка|Сессия/.test((document.querySelector('.ogx-pagescan-status') || {}).textContent || ''), null, { timeout: 300000 });
    const status = await p.textContent('.ogx-pagescan-status');
    assert.match(status, /^Готово: \d+ страниц/, status);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('[data-ogx-act="pagescan:download"]')]);
    assert.match(dl.suggestedFilename(), /^ogx-pagescan-Aeternum-\d{8}-\d{4}\.zip$/);
    const files = unzip(fs.readFileSync(await dl.path()));
    const names = Object.keys(files);
    // per planet
    const dirs = [...new Set(names.filter((n) => /^p\d+-/.test(n)).map((n) => n.split('/')[0]))].sort();
    assert.deepEqual(dirs.map((d) => d.split('-')[0]), ['p254102', 'p254103', 'p254104', 'p254105'], dirs.join(' '));
    for (const d of dirs) for (const f of ['overview', 'buildings', 'resources', 'research', 'shipyard-fleet', 'shipyard-defense', 'fleetTable', 'galaxy', 'transport']) {
      assert.ok(names.includes(`${d}/${f}.html`), `${d}/${f}.html`);
    }
    assert.match(files[`${dirs[1]}/buildings.html`], /^<!-- ogx-pagescan url=\S+page=buildings\S*cp=254103/, 'header with the requested URL');
    assert.match(files[`${dirs[0]}/shipyard-fleet.html`], /data-technology="217"/, 'saved page body');
    for (const g of ['imperium', 'techtree', 'premium', 'officier', 'GiveBonus']) assert.ok(names.includes(`00-global/${g}.html`), g);
    for (const d of ['TechnologyDetailsAjax-1', 'ResearchDetailsAjax-199', 'ShipDetailsAjax-217', 'ShipDetailsAjax-503']) assert.ok(names.includes(`details/${d}.json`), d);
    assert.deepEqual(JSON.parse(files['details/ShipDetailsAjax-217.json']), { technology: '217', page: 'ShipDetailsAjax' });
    assert.ok(names.some((n) => n.startsWith('01-discovered/statistics')), 'discovered statistics&range=');
    assert.ok(!names.some((n) => n.startsWith('messages/')), 'no mail by default');
    const index = JSON.parse(files['index.json']);
    assert.equal(index.tool, 'ogx-pagescan'); assert.equal(index.startCp, '254102'); assert.equal(index.stopped, false);
    assert.match(files['log.txt'], /planets: \[/);
    // requests: GET only, nothing that acts, no mail, every per-planet page with its cp, planet restored at the end
    assert.ok(reqs.length > 100, 'requests ' + reqs.length);
    assert.deepEqual(reqs.filter((r) => !r.startsWith('GET ')), [], 'GET only');
    const bad = reqs.filter((r) => /page=(fleetStep|vote|donatebis|relocate|logout|messages)|cmd=|action=|delete|cancel/i.test(r));
    assert.deepEqual(bad, [], 'no action pages');
    assert.ok(reqs.some((r) => /page=transport&cp=254105/.test(r)), 'per-planet cp');
    assert.match(reqs[reqs.length - 1], /page=overview.*cp=254102/, 'restore to the start planet: ' + reqs[reqs.length - 1]);
    assert.deepEqual(errors, []);
  } finally {
    await context.close().catch(() => {});
    server.srv.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

T.test('discoverLinks keeps only safe read-only game.php links (node, no browser)', async () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(ROOT, 'shared', 'core', '24-pagescan.js'), 'utf8');
  const ctx = { window: { OGX: {} }, URLSearchParams, console };
  vm.runInNewContext(src, ctx);
  const S = ctx.window.OGX.pagescan;
  const html = ['game.php?page=statistics&amp;range=194', 'game.php?page=buildings&cmd=insert&building=1', 'game.php?page=fleetStep1',
    'game.php?page=vote', 'game.php?page=galaxy&galaxy=2&system=87', 'game.php?page=alliance&mode=memberList', 'game.php?page=alliance&mode=close',
    'game.php?page=messages&mode=view&messcat=0', 'game.php?page=ShipDetailsAjax&technology=1', 'game.php?page=overview&cp=254103',
    'game.php?page=premium&id=5'].map((u) => `<a href="${u}">x</a>`).join('');
  assert.deepEqual([...S.discoverLinks(html, new Set(['page=overview']))].sort(), ['page=alliance&mode=memberList', 'page=statistics&range=194']);
});
