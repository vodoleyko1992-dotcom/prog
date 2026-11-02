'use strict';
// Infinity module «mail» (new messages menu) on GALAXYZ (ogamex.eu/Aeternum) through the GALAXYZ mock (tests/gz-server.js):
//  - the REAL saved pages messages-spy / messages-all: the native grid / table hidden (not removed), one compact line per spy
//    report, loot 50 % and Battle Transporters (217, 40 000 000) computed from the page source (im[] floats of the Simulate
//    link, 2Moons calculateSteal), no request on open;
//  - tabs: [UPSTREAM] fixtures per category (combat, expedition, transport, player) loaded by a tab click
//    (GET page=messages&mode=view&messcat=N&site=1&ajax=1), with the kind summary;
//  - bulk actions: the native form POST (mode=action, actionTop, messageID[id]=1), the confirm dialog, rows dropped;
//  - «Старый вид» brings the native table back; spy module still stores reports from the hidden rows;
//  - no console errors, no 'NaN' / 'undefined' in the widget. Screenshots: tests/out/gz-mail-*.png.
//   node tests/gz-mod-inf-mail.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;
const { PAGES: PAGE_DIR } = require('./gz-server');

const OUT = path.join(__dirname, 'out');
const saved = (name) => fs.readFileSync(path.join(PAGE_DIR, name + '.html'), 'utf8');
const shot = async (page, name) => { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'gz-mail-' + name + '.png'), fullPage: true }); };
const digits = (s) => +String(s).replace(/[^\d]/g, '');

// ------------------------------------------------------------------ expected values from the page source (no OGX)
const php0 = (x) => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));
function spyReports(html) {
  const out = [];
  const re = /<tr id="message_(\d+)" class="message_head[^"]*">[\s\S]*?<div class="spyRaportHead">\s*<a[^>]*>Spy Report ([^[]*?)\s*\[(\d+):(\d+):(\d+)\][\s\S]*?href="([^"]*page=battleSimulator[^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const im = {};
    for (const [, id, v] of m[6].replace(/&amp;/g, '&').matchAll(/im\[(\d+)\]=([\d.]+)/g)) im[id] = php0(parseFloat(v));
    out.push({ id: +m[1], name: m[2].trim(), coords: [+m[3], +m[4], +m[5]], res: { metal: im[901], crystal: im[902], deuterium: im[903] },
      ships: Object.keys(im).some((k) => +k >= 200 && +k < 300) });
  }
  return out;
}
function steal(L, cap) {
  const d = { metal: 0, crystal: 0, deuterium: 0 };
  d.metal = Math.min(cap / 3, L.metal); cap -= d.metal;
  d.crystal = Math.min(cap / 2, L.crystal); cap -= d.crystal;
  d.deuterium = Math.min(cap, L.deuterium); cap -= d.deuterium;
  const m2 = Math.min(cap / 2, L.metal - d.metal); d.metal += m2; cap -= m2;
  d.crystal += Math.min(cap, L.crystal - d.crystal);
  return d.metal + d.crystal + d.deuterium;
}
/** loot 50 % and Battle Transporters (40 000 000) for the whole loot by the fill order, + 10 % reserve on that capacity. */
function raid(res) {
  const L = { metal: res.metal * 0.5, crystal: res.crystal * 0.5, deuterium: res.deuterium * 0.5 };
  const total = L.metal + L.crystal + L.deuterium;
  let lo = total, hi = total * 3;
  while (steal(L, hi) < total - 1) hi *= 2;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (steal(L, mid) >= total - 1e-3) hi = mid; else lo = mid; }
  return { loot: Math.floor(L.metal) + Math.floor(L.crystal) + Math.floor(L.deuterium), cap: hi, ships: Math.ceil((hi * 1.1) / 40000000) };
}

const rowsOf = (p) => p.evaluate(() => [...document.querySelectorAll('.ogx-i-mail-table tbody tr.ogx-i-mail-row')].map((tr) => ({
  id: +tr.dataset.id, kind: tr.dataset.kind, cells: [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()),
  lootTitle: (tr.querySelector('.ogx-i-mail-loot') || {}).title || '' })));
async function noJunk(p, where) {
  const text = await p.evaluate(() => { const r = document.getElementById('ogx-mail'); return r ? r.textContent + [...r.querySelectorAll('[title]')].map((e) => e.title).join(' ') : ''; });
  for (const bad of [/NaN/, /undefined/, /\bnull\b/, /Infinity/]) assert.ok(!bad.test(text), where + ': ' + bad);
}
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!(e && e.getClientRects().length && getComputedStyle(e).display !== 'none'); }, sel);
async function clickTab(p, cat) {
  await p.click(`.ogx-i-mail-tab[data-cat="${cat}"]`);
  await p.waitForFunction((c) => document.querySelector(`.ogx-i-mail-tab-on[data-cat="${c}"]`) && !document.querySelector('.ogx-i-mail-status').textContent, cat);
  await p.waitForTimeout(150);
}
const answerModal = (p, ok = true) => p.evaluate((yes) => {
  const b = document.querySelector('.ogx-modal-overlay:last-of-type .ogx-modal-buttons button:' + (yes ? 'last-child' : 'first-child'));
  if (!b) return false;
  b.click();
  return true;
}, ok);

T.test('mail: real messages-spy -> native hidden, one line per report, loot and Battle Transporters from the page source, no request', async () => {
  const reps = spyReports(saved('messages-spy'));
  assert.equal(reps.length, 2);
  const env = await G.launch();
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('#ogx-mail .ogx-i-mail-table');
    assert.equal(await visible(p, '#messagestable'), false, 'native table hidden');
    assert.ok(await p.$('#messagestable'), 'native table kept in the DOM');
    assert.equal(await visible(p, 'a[onclick^="Message.getMessages(0)"]'), false, 'native category grid hidden');
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.ogx-i-mail-tab')].map((b) => b.textContent));
    assert.ok(tabs.some((t) => /^Шпионаж/.test(t)) && tabs.some((t) => /^Все/.test(t)), 'russian tabs: ' + tabs.join('|'));
    const rows = await rowsOf(p);
    assert.equal(rows.length, 2);
    for (const r of reps) {
      const row = rows.find((x) => x.id === r.id);
      assert.ok(row, 'row ' + r.id);
      const e = raid(r.res);
      assert.match(row.cells[1], new RegExp('\\[' + r.coords.join(':') + '\\]'));
      assert.ok(row.cells[1].includes(r.name), 'planet name');
      // loot shown short (млрд / трлн): the title has the exact numbers
      const m = row.lootTitle.match(/Металл ([\d\s ]+)\nКристалл ([\d\s ]+)\nДейтерий ([\d\s ]+)/);
      assert.ok(m, row.lootTitle);
      assert.ok(Math.abs(digits(m[1]) + digits(m[2]) + digits(m[3]) - e.loot) <= 2, `loot ${row.lootTitle} = ${e.loot}`);
      assert.ok(Math.abs(digits(row.cells[4]) - e.ships) <= 1, `transporters ${row.cells[4]} vs ${e.ships}`);
    }
    const big = rows.find((x) => x.id === 520244);
    assert.equal(big.cells[5], '—', 'fleet seen and empty');
    assert.equal(big.cells[6], '?', 'defence not seen');
    const small = rows.find((x) => x.id === 520242);
    assert.equal(small.cells[5], '?', 'resources-only report: fleet unknown');
    await noJunk(p, 'spy');
    // spy module still collects from the hidden rows
    await p.waitForTimeout(500);
    const stored = (await env.get('spy.reports')) || { items: {} };
    assert.ok(stored.items[520244] && stored.items[520242], 'spy module stored both reports');
    assert.deepEqual(env.server.requests.filter((x) => !(x.method === 'GET' && x.page === 'messages' && !x.mode)).map((x) => x.method + ' ' + x.url), [], 'no request on open');
    await shot(p, 'spy');
    // expand a report: the game's body under the line
    await p.click('.ogx-i-mail-row[data-id="520242"] td.ogx-i-mail-time');
    await p.waitForSelector('.ogx-i-mail-preview[data-id="520242"] .spyRaport', { state: 'attached' });
    const card = await p.textContent('.ogx-i-mail-preview .ogx-i-mail-card');
    assert.match(card, /\[2:72:6\]/);
    assert.match(card, /Флот: зонды не увидели/);
    // inline layout: the report opens under its line
    await env.evalOgx(p, () => OGX.settings.set('mail.layout', 'inline'));
    await p.waitForFunction(() => !document.querySelector('#ogx-mail.ogx-i-mail-full'));
    await p.click('.ogx-i-mail-row[data-id="520242"] td.ogx-i-mail-time');
    await p.waitForSelector('tr.ogx-i-mail-detail[data-for="520242"] .spyRaport');
    await shot(p, 'spy-inline');
    await env.evalOgx(p, () => OGX.settings.set('mail.layout', 'full'));
    await shot(p, 'spy-open');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mail: filters and sorting (loot from, search, clean)', async () => {
  const env = await G.launch();
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-mail-table');
    await p.fill('.ogx-i-mail-minloot', '100 млрд');
    await p.dispatchEvent('.ogx-i-mail-minloot', 'change');
    await p.waitForFunction(() => document.querySelectorAll('.ogx-i-mail-row').length === 1);
    assert.equal((await rowsOf(p))[0].id, 520244, 'only the big report has >= 100 млрд loot');
    await p.fill('.ogx-i-mail-minloot', '');
    await p.dispatchEvent('.ogx-i-mail-minloot', 'change');
    await p.waitForFunction(() => document.querySelectorAll('.ogx-i-mail-row').length === 2);
    await p.fill('.ogx-i-mail-q', '2:72');
    await p.waitForFunction(() => document.querySelectorAll('.ogx-i-mail-row').length === 1);
    assert.equal((await rowsOf(p))[0].id, 520242);
    await p.fill('.ogx-i-mail-q', '');
    await p.waitForFunction(() => document.querySelectorAll('.ogx-i-mail-row').length === 2);
    // sort by loot ascending
    await p.click('th[data-sort="loot"]');
    let ids = (await rowsOf(p)).map((r) => r.id);
    assert.deepEqual(ids, [520244, 520242], 'loot desc');
    await p.click('th[data-sort="loot"]');
    ids = (await rowsOf(p)).map((r) => r.id);
    assert.deepEqual(ids, [520242, 520244], 'loot asc');
    // clean: no report has both fleet and defence seen as 0
    await p.click('.ogx-i-mail-chk input');
    await p.waitForFunction(() => !document.querySelector('.ogx-i-mail-row'));
    assert.match(await p.textContent('.ogx-i-mail-empty'), /фильтр/);
    const amounts = await env.evalOgx(p, () => ['1 млрд', '500m', '2kkk', '3 трлн', '1.000.000', '1,5 млрд', ''].map(OGX.mailTest.parseAmount));
    assert.deepEqual(amounts, [1e9, 5e8, 2e9, 3e12, 1e6, 1.5e9, null]);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mail: tabs load categories (combat, expedition, transport, player) with summaries', async () => {
  const env = await G.launch();
  try {
    const p = await env.openSaved('messages-all');
    await p.waitForSelector('.ogx-i-mail-table');
    env.server.clearLog();
    await clickTab(p, 3);
    let rows = await rowsOf(p);
    assert.ok(rows.length >= 3, 'combat rows');
    const c1 = rows.find((r) => r.id === 520410);
    assert.match(c1.cells[3], /\[2:70:4\]/);
    assert.match(c1.cells[3], /добыча/);
    assert.ok(env.server.requests.some((x) => x.method === 'GET' && /mode=view/.test(x.url) && /messcat=3/.test(x.url)), 'GET mode=view messcat=3');
    await shot(p, 'combat');
    await clickTab(p, 15);
    rows = await rowsOf(p);
    assert.ok(rows.length >= 3, 'expedition rows');
    const ships = rows.find((r) => r.id === 520918);
    assert.match(ships.cells[3], /Light Cargo 37/);
    await shot(p, 'expedition');
    await clickTab(p, 5);
    rows = await rowsOf(p);
    const tr = rows.find((r) => r.id === 520510);
    assert.match(tr.cells[3], /\[2:68:6\]/);
    assert.match(tr.cells[3], /М 500 тыс\. · К 250 тыс\. · Д 100 тыс\./);
    await clickTab(p, 1);
    rows = await rowsOf(p);
    const pm = rows.find((r) => r.id === 520800);
    assert.match(pm.cells[3], /Kovacs/);
    assert.match(pm.cells[4], /Ответить/);
    await shot(p, 'player');
    await noJunk(p, 'tabs');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mail: bulk delete = native form POST after the confirm; rows dropped; «Старый вид» toggles back', async () => {
  const env = await G.launch();
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-mail-table');
    env.server.clearLog();
    await p.click('.ogx-i-mail-selall');
    assert.match(await p.textContent('.ogx-i-mail-count'), /выбрано 2/);
    await p.click('.ogx-i-mail-actions button.ogx-btn-danger');   // «Удалить выбранные»
    await p.waitForSelector('.ogx-modal-overlay .ogx-modal');
    assert.equal(env.server.requests.filter((x) => x.method === 'POST').length, 0, 'nothing before the confirm');
    await answerModal(p, true);
    await p.waitForFunction(() => !document.querySelector('.ogx-i-mail-row'));
    const posts = env.server.requests.filter((x) => x.method === 'POST' && x.page === 'messages');
    assert.equal(posts.length, 1);
    const body = new URLSearchParams(posts[0].raw || '');
    assert.equal(body.get('mode'), 'action');
    assert.equal(body.get('actionTop'), 'deletemarked');
    assert.equal(body.get('messcat'), '0');
    assert.equal(body.get('messageID[520244]'), '1');
    assert.equal(body.get('messageID[520242]'), '1');
    // keyboard: nothing left; old view
    await p.click('.ogx-i-mail-old');
    await p.waitForFunction(() => document.getElementById('ogx-mail').hidden);
    assert.equal(await visible(p, 'a[onclick^="Message.getMessages(0)"]'), true, 'native grid back');
    await p.click('.ogx-i-mail-back');
    await p.waitForFunction(() => !document.getElementById('ogx-mail').hidden);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mail: hotkeys select / delete the focused row; Escape clears', async () => {
  const env = await G.launch({ settings: { 'mail.confirmDelete': false } });
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-mail-table');
    await p.keyboard.press('j');
    await p.waitForSelector('.ogx-i-mail-focus');
    const first = await p.evaluate(() => +document.querySelector('.ogx-i-mail-focus').dataset.id);
    await p.keyboard.press('x');
    assert.match(await p.textContent('.ogx-i-mail-count'), /выбрано 1/);
    await p.keyboard.press('Escape');
    assert.doesNotMatch(await p.textContent('.ogx-i-mail-count'), /выбрано/);
    await p.keyboard.press('j');
    await p.keyboard.press('Delete');
    await p.waitForFunction(() => document.querySelectorAll('.ogx-i-mail-row').length === 1);
    const left = (await rowsOf(p)).map((r) => r.id);
    assert.ok(!left.includes(first), 'focused row deleted');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mail: full-screen layout, mass raid dialog (Battle Transporters only), cleanup rules', async () => {
  const env = await G.launch();
  try {
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('#ogx-mail.ogx-i-mail-full .ogx-i-mail-preview .ogx-i-mail-card');
    const box = await p.evaluate(() => { const r = document.getElementById('ogx-mail').getBoundingClientRect(); return [r.left, r.top, r.width, r.height, innerWidth, innerHeight]; });
    assert.deepEqual(box.slice(0, 2), [0, 0]);
    assert.equal(box[2], box[4]); assert.equal(box[3], box[5]);
    // mass raid: one dialog with the totals, cancel -> nothing sent
    env.server.clearLog();
    await p.click('.ogx-i-mail-selall');
    await p.click('.ogx-i-mail-braid');
    await p.waitForSelector('.ogx-modal-overlay .ogx-modal');
    const text = await p.textContent('.ogx-modal-overlay .ogx-modal');
    const reps = spyReports(saved('messages-spy'));
    const ships = reps.reduce((a, r) => a + raid(r.res).ships, 0);
    assert.match(text, /Рейдов: 2/);
    assert.ok(Math.abs(digits(text.match(/транспортов: ([\d\s ]+)/)[1]) - ships) <= 2, text);
    assert.match(text, /⚠ У 2 целей/);
    await answerModal(p, false);
    await p.waitForTimeout(300);
    assert.equal(env.server.requests.filter((x) => x.method === 'POST').length, 0, 'cancel = nothing sent');
    // cleanup rules: reports with loot < 100 млрд
    await p.click('.ogx-i-mail-selall');
    await p.fill('.ogx-i-mail-minloot', '100 млрд');
    await p.dispatchEvent('.ogx-i-mail-minloot', 'change');
    await p.click('.ogx-i-mail-clean');
    await p.waitForSelector('.ogx-modal-overlay .ogx-modal');
    assert.match(await p.textContent('.ogx-modal-overlay .ogx-modal'), /удалить 1 сообщ/);
    await answerModal(p, true);
    await p.waitForFunction(() => !document.querySelector('#ogx-mail [data-id="520242"]'));
    const post = env.server.requests.find((x) => x.method === 'POST' && x.page === 'messages');
    const body = new URLSearchParams(post.raw || '');
    assert.equal(body.get('messageID[520242]'), '1');
    assert.equal(body.get('messageID[520244]'), null);
    await shot(p, 'full');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mail: auto-clean on tab load removes empty expeditions in one POST', async () => {
  const env = await G.launch({ settings: { 'mail.autoClean': true } });
  try {
    const p = await env.openSaved('messages-all');
    await p.waitForSelector('.ogx-i-mail-table');
    env.server.clearLog();
    await clickTab(p, 15);
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-toast')].some((t) => /Автоочистка/.test(t.textContent)), null, { timeout: 8000 });
    const posts = env.server.requests.filter((x) => x.method === 'POST' && x.page === 'messages');
    assert.equal(posts.length, 1);
    const ids = [...new URLSearchParams(posts[0].raw).keys()].filter((k) => /^messageID/.test(k));
    assert.ok(ids.length >= 1, 'some expeditions removed');
    const left = await rowsOf(p);
    for (const r of left) assert.doesNotMatch(r.cells[3], /^(Ничего|Задержка|Ускорение)/, r.cells[3]);
    await shot(p, 'expedition-clean');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mail: mass raid after the dialog = fleetSendBatch with Battle Transporters only, one flight per report', async () => {
  const env = await G.launch();
  try {
    await env.openSaved('overview');
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-mail-table');
    env.server.clearLog();
    await p.click('.ogx-i-mail-selall');
    await p.click('.ogx-i-mail-braid');
    await p.waitForSelector('.ogx-modal-overlay .ogx-modal');
    await answerModal(p, true);
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-toast')].some((t) => /Рейдов отправлено/.test(t.textContent)), null, { timeout: 15000 });
    const step1 = env.server.requests.filter((x) => x.method === 'POST' && x.page === 'fleetStep1').map((x) => new URLSearchParams(x.raw));
    assert.equal(step1.length, 2);
    for (const b of step1) {
      const ships = [...b.keys()].filter((k) => /^ship\d+$/.test(k));
      assert.deepEqual(ships, ['ship217'], 'Battle Transporters only');
      assert.equal(b.get('target_mission'), '1');
    }
    assert.deepEqual(step1.map((b) => b.get('galaxy') + ':' + b.get('system') + ':' + b.get('planet')).sort(), ['2:72:6', '2:81:10']);
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('mail: «Зонды по отмеченным» asks first (batch rule); «Нет» sends nothing, «Да» runs the sends', async () => {
  const env = await G.launch();
  try {
    await env.openSaved('overview');
    const p = await env.openSaved('messages-spy');
    await p.waitForSelector('.ogx-i-mail-table');
    env.server.clearLog();
    const spies = () => env.server.requests.filter((x) => x.page === 'fleetAjax').length;
    await p.click('.ogx-i-mail-selall');
    await p.click('.ogx-i-mail-bspy');
    await p.waitForSelector('.ogx-modal-overlay .ogx-modal');
    assert.match(await p.textContent('.ogx-modal-overlay .ogx-modal'), /Отправить зонды на \d+ целей/);
    await p.waitForTimeout(200);
    assert.equal(spies(), 0, 'nothing before the confirm');
    await answerModal(p, false);
    await p.waitForTimeout(400);
    assert.equal(spies(), 0, 'cancel sends nothing');
    await p.click('.ogx-i-mail-bspy');
    await p.waitForSelector('.ogx-modal-overlay .ogx-modal');
    await answerModal(p, true);
    await p.waitForFunction(() => [...document.querySelectorAll('.ogx-toast')].some((t) => /Зонды отправлены на|Остановлено на/.test(t.textContent)), null, { timeout: 15000 });
    // the saved reports carry no planet ids: the spy may stop at «unresolved»; reaching the send step is what matters here
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});
