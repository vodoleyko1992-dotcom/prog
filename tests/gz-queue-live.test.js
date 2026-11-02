'use strict';
// GALAXYZ live queue markup (Aeternum snapshots 2026-10-31): OGX.parse.gz.queueBox reads the running item
// (.build-info-row > img.build-icon + .build-level span) and the queued ones (a.construction-queue-item), on page=buildings and
// page=research. Before 0.3.2 every busy queue read as «unknown»: botbuild waited 15 min per planet and never knew the research queue.
//   node tests/gz-queue-live.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const { assert } = T;
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const FX = path.join(ROOT, 'fixtures', 'galaxyz', 'queue');
const CORE = ['shared/core/00-ogx.js', 'shared/core/01-util.js', 'shared/core/08-catalog-data.js', 'shared/core/09-catalog.js', 'shared/core/11-parse.js'];

async function parse(file, page) {
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    const url = 'https://ogamex.eu/Aeternum/game.php?page=' + page;
    const html = fs.readFileSync(path.join(FX, file), 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');
    await p.route('**/*', (r) => (r.request().url() === url ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort()));
    await p.goto(url);
    for (const f of CORE) await p.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });
    return await p.evaluate(() => { const x = OGX.parse.gz.queueBox(document); return x && { title: x.title, empty: x.empty, items: x.items }; });
  } finally { await b.close(); }
}
const pairs = (x) => x.items.map((i) => [i.id, i.level]);

T.test('page=buildings: running robots 1 (1 s left) + robots 2, 3, 4 queued', async () => {
  const x = await parse('buildings-queue-live.html', 'buildings');
  assert.equal(x.empty, false);
  assert.deepEqual(pairs(x), [[14, 1], [14, 2], [14, 3], [14, 4]]);
  assert.equal(x.items[0].restSec, 1);
});
T.test('page=buildings: a full queue of 5 (metal mine 50 + missile silo 6..9 queued)', async () => {
  const x = await parse('buildings-queue5-live.html', 'buildings');
  assert.deepEqual(pairs(x), [[1, 50], [71, 6], [71, 7], [71, 8], [71, 9]]);
  assert.equal(x.items[0].restSec, 461);
});
T.test('page=research: running espionage 21 (2473 s left, #progressbars) + laser 14 queued; the repeated running row is dropped', async () => {
  const x = await parse('research-queue-live.html', 'research');
  assert.deepEqual(pairs(x), [[106, 21], [120, 14]]);
  assert.equal(x.items[0].restSec, 2473);
});
