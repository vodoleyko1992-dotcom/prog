'use strict';
// The standalone «Скан страниц» userscript (tools/pagescan/ogx-pagescan.user.js, the privacy-patched copy of
// /mnt/project-files/ogamex-addons/pagescan) on a synthetic GALAXYZ-shaped server, plain Chromium, script injected after
// load like a paste into the console: private pages (notes, ticket, buddyList, GiveBonus, satinal) are never requested —
// not from the list, not through discovered links — the settings page lands without the e-mail / password values and
// without textarea contents, every saved file is free of e-mail addresses, log.txt carries the browser family instead of
// the User-Agent, index.json says what was excluded.
//   node tests/gz-pagescan-tool.test.js        (about 20 s: the scan keeps its real 0.3–0.6 s pauses)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { chromium } = require('playwright');
const T = require('./lib');
const { assert } = T;

const SCRIPT = path.resolve(__dirname, '..', 'tools', 'pagescan', 'ogx-pagescan.user.js');
const PRIVATE = ['notes', 'ticket', 'buddyList', 'GiveBonus', 'satinal'];

const page = (title, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="generator" content="GALAXYZ 2.0"><title>${title}</title></head>
<body id="${title}"><select id="planetSelector"><option value="game.php?page=overview&cp=33" selected>Homeworld [1:1:1]</option></select>
<ul id="menuTable"><li><a href="game.php?page=overview">Обзор</a></li><li><a href="game.php?page=notes">Заметки</a></li><li><a href="game.php?page=ticket">Поддержка</a></li>
<li><a href="game.php?page=buddyList">Друзья</a></li><li><a href="game.php?page=GiveBonus">Ваучер</a></li><li><a href="game.php?page=satinal">Купить</a></li><li><a href="game.php?page=techtree">Дерево</a></li></ul>
${body}<div class="footer">Contact: admin@ogamex.eu</div></body></html>`;
const SETTINGS = page('settings', `<form action="game.php?page=settings" method="post"><input type="hidden" name="mode" value="send">
<input name="username" type="text" value="John"> <input name="email" type="text" value="john@example.com">
<input type="text" value="perm@example.org" name="permanentEmail" id="permanentEmail"><input type="password" name="newpass" value="hunter2">
<input type="checkbox" name="spycount" value="3" checked> <textarea name="signature">private signature with secret@mail.test</textarea>
<input type=hidden name=db_email value=x@y.zz></form><p>Permanent e-mail: john.doe+tag@sub.example.co.uk</p>`);

function startServer(reqs) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, data) => { res.writeHead(code, { 'Content-Type': type }); res.end(data); };
    if (!/\/game\.php$/.test(u.pathname)) return send(404, 'text/plain', '');
    reqs.push(req.method + ' ' + u.search);
    const pg = u.searchParams.get('page') || 'overview';
    if (/Ajax$/.test(pg)) return send(200, 'text/html', JSON.stringify({ technology: u.searchParams.get('technology'), page: pg }));
    if (pg === 'settings') return send(200, 'text/html; charset=UTF-8', SETTINGS);
    if (PRIVATE.includes(pg)) return send(200, 'text/html; charset=UTF-8', page(pg, '<h1>SHOULD NEVER BE FETCHED</h1>'));
    send(200, 'text/html; charset=UTF-8', page(pg, `<h1>${pg}</h1><a href="game.php?page=galaxy&galaxy=2&system=5">foreign</a>`));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

/** Minimal unzip (stored + deflate) through the central directory. */
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

T.test('pagescan userscript: private pages never requested, settings without e-mail / password / textarea, no e-mail anywhere, no User-Agent', async () => {
  const reqs = [];
  const server = await startServer(reqs);
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogx-pagescan-tool-'));
  const browser = await chromium.launch({ headless: process.env.OGX_HEADED !== '1' });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 800 } });
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`http://127.0.0.1:${server.port}/Aeternum/game.php?page=overview&cp=33`, { waitUntil: 'load' });
    await p.addScriptTag({ path: SCRIPT });
    await p.waitForSelector('#ogx-ps [data-go]');
    const notice = await p.textContent('#ogx-ps .pv');
    assert.match(notice, /В архив попадут/);
    assert.match(notice, /e-mail/);
    assert.match(notice, /User-Agent/);
    assert.equal(await p.isChecked('#ogx-ps [data-o="messages"]'), false, 'mail off by default');
    await p.uncheck('#ogx-ps [data-o="details"]');          // nothing to fetch there; discover stays on: the links to the private pages must be refused
    await p.click('#ogx-ps [data-go]');
    await p.waitForFunction(() => /^(Готово|Остановлено)/.test(document.querySelector('#ogx-ps .st').textContent), null, { timeout: 120000 });
    assert.match(await p.textContent('#ogx-ps .st'), /^Готово/);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#ogx-ps [data-dl]')]);
    const zipPath = path.join(dlDir, 'scan.zip');
    await dl.saveAs(zipPath);
    const files = unzip(fs.readFileSync(zipPath));
    const names = Object.keys(files).sort();

    // 1) private pages: not requested, not in the archive (list and discovered links alike)
    const privateReq = reqs.filter((q) => PRIVATE.some((pg) => new RegExp('[?&]page=' + pg + '(&|$)').test(q)));
    assert.deepEqual(privateReq, [], 'no request to a private page');
    assert.deepEqual(names.filter((n) => PRIVATE.some((pg) => n.toLowerCase().includes(pg.toLowerCase()))), []);
    assert.ok(reqs.some((q) => /page=techtree/.test(q)) && names.some((n) => /00-global\/techtree\.html$/.test(n)), 'ordinary global pages still scanned');
    assert.ok(names.some((n) => /^p33-/.test(n) && /overview\.html$/.test(n)), 'per-planet pages: ' + names.join(','));
    assert.ok(!reqs.some((q) => /page=galaxy&galaxy=2/.test(q)), 'foreign systems are not followed');

    // 2) settings: kept (the game settings matter), without the private values
    const st = files['00-global/settings.html'];
    assert.ok(st, 'settings saved: ' + names.join(','));
    assert.doesNotMatch(st, /@/, 'no e-mail address anywhere in settings.html');
    assert.doesNotMatch(st, /hunter2|john@|perm@|secret@|private signature/);
    assert.match(st, /name="email" type="text" value=""/);
    assert.match(st, /value="" name="permanentEmail"/);
    assert.match(st, /name="newpass" value=""/);
    assert.match(st, /<textarea name="signature"><\/textarea>/);
    assert.match(st, /name="username" type="text" value="John"/, 'the user name stays');
    assert.match(st, /name="spycount" value="3" checked/, 'game settings stay');
    assert.match(st, /Permanent e-mail: <email>/);
    assert.match(st, /scrubbed=email,mail\/pass-values,textarea/);

    // 3) nothing in the archive carries an e-mail address; log.txt has the browser family, not the User-Agent
    for (const [n, data] of Object.entries(files)) if (n !== 'index.json') assert.doesNotMatch(data, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'e-mail in ' + n);
    const log = files['log.txt'];
    assert.match(log.split('\n')[0], /ogx-pagescan 1\.1\.0 start .* browser=(HeadlessChrome|Chrome|Chromium|Firefox) \d+$/, log.split('\n')[0]);
    assert.doesNotMatch(log, /UA=|Mozilla\//);
    const index = JSON.parse(files['index.json']);
    assert.deepEqual(index.privacy.excludedPages, PRIVATE);
    assert.ok(index.privacy.scrubbed.includes('email addresses'));
    assert.equal(index.version, '1.1.0');
    // the planet is switched back at the end
    assert.match(reqs[reqs.length - 1], /page=overview&cp=33/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close().catch(() => {});
    server.srv.close();
    fs.rmSync(dlDir, { recursive: true, force: true });
  }
});
