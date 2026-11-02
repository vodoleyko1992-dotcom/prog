'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OgameX Infinity / empire: «Империя» tab (resources, buildings, stations, research, fleet, defense matrices),
// queued targets, totals, production check, stale dimming, refresh-all (cp notice, progress, cancel, restore),
// refresh of the current body without ?cp=, fault isolation between views, safety on non-OgameX pages.
//   node tests/legacy-ogamex/infinity-empire.test.js
const fs = require('fs');
const path = require('path');
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');
const { rewrite } = require('../server');

const ROOT = path.resolve(__dirname, '..', '..');
const EMPIRE_SRC = fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/empire/empire.js'), 'utf8');
const PANEL_FILE = path.join(ROOT, 'ogamex-infinity/modules/panel/panel.js');
// The real panel module when present (it owns the menu entry); the empire tab works without it as well.
const PANEL_SRC = fs.existsSync(PANEL_FILE) ? fs.readFileSync(PANEL_FILE, 'utf8') : null;

let extCache = null;
function ext() {
  if (!extCache) {
    const modules = {};
    if (PANEL_SRC) modules.panel = PANEL_SRC;
    modules.empire = EMPIRE_SRC;
    extCache = coreExt({ name: 'infinity', modules });
  }
  return extCache;
}

const P = 'ogx-i-empire-';
const SETTINGS = { 'core.httpGapMs': 200 };

// The orion mock serves /shipyard, /defense, /research, /resources/settings (and /facilities for planet 7) with the
// metas of planet 4. OgameX itself renders the page of the body selected by ?cp= (GlobalGame.php:43-46), so for a
// clean refresh we serve the same fixtures with the metas of the requested body.
const BODY_META = { 4: ['Homeworld', '1:102:8'], 7: ['Colony', '1:105:4'], 9: ['Moon', '1:102:8'] };
const ORION = {
  '/resources': (id) => (id === 7 ? 'buildings-resources-colony.html' : id === 9 ? 'buildings-resources-moon.html' : 'buildings-resources.html'),
  '/facilities': (id) => (id === 9 ? 'buildings-facilities-moon.html' : 'buildings-facilities.html'),
  '/research': () => 'buildings-research.html',
  '/shipyard': () => 'buildings-shipyard.html',
  '/defense': () => 'buildings-defense.html',
  '/resources/settings': () => 'buildings-resource-settings.html',
};
function bodyPage(name, id) {
  let html = T.fixture(name);
  html = html.replace(/(name="ogame-planet-id" content=")\d+/, '$1' + id);
  if (BODY_META[id]) {
    html = html.replace(/(name="ogame-planet-name" content=")[^"]*/, '$1' + BODY_META[id][0]);
    html = html.replace(/(name="ogame-planet-coordinates" content=")[^"]*/, '$1' + BODY_META[id][1]);
  }
  return html;
}
function installBodyRoutes(env) {
  for (const [p, pick] of Object.entries(ORION)) {
    env.server.route('GET', p, (req, res, ctx) => {
      const id = ctx.state.currentBodyId || 4;
      ctx.rec.fixture = 'empire:' + p + ':' + id;
      return ctx.send(200, rewrite(bodyPage(pick(id), id), ctx.origin), 'text/html; charset=utf-8');
    });
  }
}

async function openEmpire(env, page) {
  await env.evalOgx(page, () => { const p = OGX.dom.sidePanel('infinity'); p.open(); p.selectTab('empire'); return true; }, null, 'infinity');
  await env.waitFor(page, `.${P}table`);
}
async function selectView(page, id) {
  await page.click(`.ogx-tab-pane[data-tab="empire"] .${P}views button[data-view="${id}"]`);
  await page.waitForSelector(`.ogx-tab-pane[data-tab="empire"] .${P}table.${P}v-${id}`);
}
const cellText = (page, view, rowId, key) => page.$eval(`.ogx-tab-pane[data-tab="empire"] .${P}v-${view} tr[data-id="${rowId}"] td[data-key="${key}"]`, (td) => td.textContent.trim());
const totalText = (page, view, rowId) => page.$eval(`.ogx-tab-pane[data-tab="empire"] .${P}v-${view} tr[data-id="${rowId}"] td.${P}total`, (td) => td.textContent.trim());
const nbsp = (s) => s.replace(/[  ]/g, ' ');

T.test('empire: matrices after visiting the pages (Metal Mine 22 →23, Plasma 7 →8, Large Cargo 120 →167), production check, journal', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion', settings: SETTINGS });
  let page;
  for (const p of ['/resources/settings', '/research', '/shipyard', '/defense', '/facilities', '/resources']) page = await env.open(p);
  await openEmpire(env, page);

  // default view = resources; one column per body of the planet list (Homeworld, its moon, Colony) + totals
  const heads = await page.$$eval(`.ogx-tab-pane[data-tab="empire"] .${P}table thead th.${P}col`, (ths) => ths.map((t) => t.dataset.key));
  assert.deepEqual(heads, ['p4', 'm9', 'p7']);
  assert.equal(await page.$$eval(`.ogx-tab-pane[data-tab="empire"] .${P}table thead th.${P}total-h`, (e) => e.length), 1);

  // stock of the current planet = projected amount from the stored inline resources
  const exp = await env.evalOgx(page, async () => {
    const b = await OGX.state.body('p4');
    const research = await OGX.state.research();
    const player = await OGX.state.player();
    const server = await OGX.state.server();
    const pr = OGX.calc.production({
      levels: b.levels, percents: b.percents, ships: { 212: b.ships[212] || 0, 217: b.ships[217] || 0 }, tempMin: b.tempMin, tempMax: b.tempMax,
      position: +b.coords.split(':')[2], isMoon: false, research: research.levels, playerClass: player.playerClass, server: { economySpeed: server.economySpeed },
    });
    const p = OGX.state.projected(b, OGX.time.serverNow());
    return { stock: p.res.metal.amount, reported: b.res.metal.perHour, computed: pr.perHour, reportedAll: { metal: b.res.metal.perHour, crystal: b.res.crystal.perHour, deuterium: b.res.deuterium.perHour }, percentsT: b.percentsT, storage: b.res.metal.storage };
  }, null, 'infinity');
  assert.ok(exp.percentsT, 'resource settings merged');
  const stockTxt = nbsp(await cellText(page, 'resources', 'stock-metal', 'p4'));
  const stockNum = +stockTxt.replace(/\D/g, '');
  assert.ok(Math.abs(stockNum - exp.stock) <= Math.max(50, exp.reported / 60), `stock ${stockTxt} vs ${exp.stock}`);
  assert.equal(nbsp(await cellText(page, 'resources', 'storage-metal', 'p4')), nbsp(await env.evalOgx(page, (n) => OGX.fmt.num(n), exp.storage, 'infinity')));
  // production cells carry the computed value; the mismatch hint is shown exactly when the difference exceeds 2 %
  for (const r of ['metal', 'crystal', 'deuterium']) {
    const info = await page.$eval(`.ogx-tab-pane[data-tab="empire"] .${P}v-resources tr[data-id="prod-${r}"] td[data-key="p4"]`, (td) => ({ computed: +td.dataset.computed, mismatch: td.classList.contains('ogx-i-empire-mismatch'), title: td.title, text: td.textContent }));
    assert.equal(info.computed, exp.computed[r], r);
    const rep = exp.reportedAll[r];
    const shouldMismatch = Math.abs(exp.computed[r] - rep) / Math.max(Math.abs(rep), 1) > 0.02 && Math.abs(exp.computed[r] - rep) >= 2;
    assert.equal(info.mismatch, shouldMismatch, `${r}: game ${rep}, calc ${exp.computed[r]} (${info.title})`);
    assert.match(info.title, /Расчёт:/);
  }
  console.log('    production p4: game', JSON.stringify(exp.reportedAll), 'calc', JSON.stringify(exp.computed));
  const noteCount = await page.$$eval(`.ogx-tab-pane[data-tab="empire"] .${P}mismatch-note, .ogx-tab-pane[data-tab="empire"] .${P}match-note`, (e) => e.length);
  assert.equal(noteCount, 1);
  // never-visited bodies show "—" with a hint
  assert.equal(await cellText(page, 'resources', 'stock-metal', 'p7'), '—');

  // buildings: Metal Mine 22 →23 (active), Crystal Mine →20 (queued); moon: mines not applicable
  await selectView(page, 'buildings');
  assert.equal(nbsp(await cellText(page, 'buildings', 1, 'p4')), '22 →23');
  assert.match(nbsp(await cellText(page, 'buildings', 2, 'p4')), /→20$/);
  assert.equal(await page.$eval(`.${P}v-buildings tr[data-id="1"] td[data-key="m9"]`, (td) => td.className.includes('ogx-i-empire-na')), true);
  assert.equal(await page.$eval(`.${P}v-buildings tr[data-id="1"] td[data-key="p4"]`, (td) => td.className.includes('ogx-i-empire-queued')), true);
  assert.equal(nbsp(await totalText(page, 'buildings', 1)), '22');

  // stations from /facilities
  await selectView(page, 'stations');
  const robotics = await env.evalOgx(page, async () => (await OGX.state.body('p4')).levels[14], null, 'infinity');
  assert.ok(robotics > 0);
  assert.equal(nbsp(await cellText(page, 'stations', 14, 'p4')).split(' ')[0], String(robotics));

  // research: one column, Plasma 7 →8
  await selectView(page, 'research');
  assert.equal(await page.$$eval(`.${P}v-research thead th.${P}col`, (e) => e.length), 1);
  assert.equal(nbsp(await cellText(page, 'research', 122, 'account')), '7 →8');

  // fleet: Large Cargo 120 →167 (47 in production), Light Fighter + 100 queued, totals
  await selectView(page, 'fleet');
  assert.equal(nbsp(await cellText(page, 'fleet', 203, 'p4')), '120 →167');
  const lf = await env.evalOgx(page, async () => (await OGX.state.body('p4')).ships[204] || 0, null, 'infinity');
  assert.equal(nbsp(await cellText(page, 'fleet', 204, 'p4')), nbsp(await env.evalOgx(page, (n) => OGX.fmt.num(n[0]) + ' →' + OGX.fmt.num(n[0] + 100), [lf], 'infinity')));
  assert.equal(nbsp(await totalText(page, 'fleet', 203)), '120');

  // defense amounts from /defense
  await selectView(page, 'defense');
  const rl = await env.evalOgx(page, async () => (await OGX.state.body('p4')).defense[401], null, 'infinity');
  assert.equal(nbsp(await cellText(page, 'defense', 401, 'p4')).split(' →')[0], nbsp(await env.evalOgx(page, (n) => OGX.fmt.num(n), rl, 'infinity')));

  // stale dimming: staleHours = 1 and data 2 h old
  await env.evalOgx(page, async () => {
    const T2 = OGX.time.serverNow() - 2 * 3600000;
    await OGX.storage.update('bodies', (b) => { b.p4.defenseT = T2; return b; });
    OGX.bus.emit('state:updated', { keys: ['bodies'] });
    return true;
  }, null, 'infinity');
  await page.waitForFunction(() => { const td = document.querySelector('.ogx-i-empire-v-defense tr[data-id="401"] td[data-key="p4"]'); return td && td.classList.contains('ogx-i-empire-stale') === false; });
  await env.evalOgx(page, () => OGX.settings.set('empire.staleHours', 1), null, 'infinity');
  await page.waitForFunction(() => { const td = document.querySelector('.ogx-i-empire-v-defense tr[data-id="401"] td[data-key="p4"]'); return td && td.classList.contains('ogx-i-empire-stale') && /назад/.test(td.title); });

  // production check hint: a reported production 10 % below the computed one is flagged
  await env.evalOgx(page, async () => {
    await OGX.storage.update('bodies', (b) => { b.p4.res.metal.perHour = Math.round(b.p4.res.metal.perHour * 0.9); return b; });
    OGX.bus.emit('state:updated', { keys: ['bodies'] });
    return true;
  }, null, 'infinity');
  await selectView(page, 'resources');
  await page.waitForSelector(`.ogx-tab-pane[data-tab="empire"] .${P}v-resources tr[data-id="prod-metal"] td[data-key="p4"].${P}mismatch`);
  assert.match(await page.textContent(`.ogx-tab-pane[data-tab="empire"] .${P}mismatch-note`), /Homeworld — металл/);
  await env.screenshot(page, 'infinity-empire-resources');

  // journal: U events for the view switches
  const uev = await env.evalOgx(page, () => OGX.diag.recent({ s: 'U' }).filter((e) => e.k === 'empire').map((e) => e.w), null, 'infinity');
  assert.ok(uev.includes('view'), JSON.stringify(uev));

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.screenshot(page, 'infinity-empire-defense');
});

T.test('empire: «Обновить всё» shows the cp notice, fetches every body with ?cp=, restores cp=4 and fills the matrix', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion', settings: SETTINGS });
  installBodyRoutes(env);
  const page = await env.open('/overview');
  await openEmpire(env, page);
  await selectView(page, 'buildings');
  assert.equal(await cellText(page, 'buildings', 1, 'p7'), '—');
  env.clearRequests();

  await page.click(`.${P}refresh-all`);
  await env.waitFor(page, '.ogx-modal .ogx-modal-buttons button');
  assert.match(await page.textContent('.ogx-modal'), /\?cp=/);
  await page.click('.ogx-modal .ogx-modal-buttons button:has-text("Понятно, обновить")');
  await env.waitFor(page, `.${P}progress .${P}cancel`);
  await page.waitForSelector(`.${P}progress .${P}result`, { timeout: 30000 });
  assert.match(await page.textContent(`.${P}progress .${P}result`), /Обновлено: 15 из 15/);

  const reqs = env.requests('GET').filter((r) => /^\/(resources|resources\/settings|facilities|research|shipyard|defense|overview)$/.test(r.path)).map((r) => r.path + '?cp=' + r.cp);
  const pages = reqs.filter((r) => !r.startsWith('/overview'));
  assert.equal(pages.length, 15, reqs.join('\n'));
  for (const id of [4, 7, 9]) assert.ok(pages.some((r) => r.endsWith('?cp=' + id)), 'cp=' + id);
  assert.equal(pages.filter((r) => r.startsWith('/research')).length, 1);
  assert.ok(!pages.includes('/resources/settings?cp=9'), 'no settings for the moon');
  assert.equal(reqs[reqs.length - 1], '/overview?cp=4');
  assert.equal(await env.evalOgx(page, () => OGX.settings.get('core.cpConfirmed'), null, 'infinity'), true);

  // the matrix now has the colony and the moon
  await page.waitForFunction(() => { const td = document.querySelector('.ogx-i-empire-v-buildings tr[data-id="1"] td[data-key="p7"]'); return td && td.textContent.trim() !== '—'; });
  const col = await env.evalOgx(page, async () => { const b = await OGX.state.bodies(); return { mm7: b.p7.levels[1], lb9: b.m9.levels[41], ships9: !!b.m9.shipsT }; }, null, 'infinity');
  assert.ok(col.mm7 >= 0 && col.ships9);
  assert.equal(nbsp(await cellText(page, 'buildings', 1, 'p7')).split(' ')[0], String(col.mm7));
  await selectView(page, 'stations');
  assert.equal(nbsp(await cellText(page, 'stations', 41, 'm9')).split(' ')[0], String(col.lb9));

  // journal: B refresh events
  const bev = await env.evalOgx(page, () => OGX.diag.recent({ s: 'B' }).filter((e) => e.k === 'empire').map((e) => e.w), null, 'infinity');
  for (const w of ['refresh:start', 'refreshBodies', 'refresh:end']) assert.ok(bev.includes(w), w + ' in ' + JSON.stringify(bev));

  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
});

T.test('empire: refresh-all can be cancelled and still restores the original body', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion', settings: { 'core.httpGapMs': 200, 'core.cpConfirmed': true } });
  installBodyRoutes(env);
  const page = await env.open('/overview');
  await openEmpire(env, page);
  env.setState({ latencyMs: 250 });
  env.clearRequests();
  await page.click(`.${P}refresh-all`);
  await page.waitForFunction(() => /Обновление: [1-9]/.test((document.querySelector('.ogx-i-empire-progress-text') || {}).textContent || ''), null, { timeout: 15000 });
  await page.click(`.${P}progress .${P}cancel`);
  await page.waitForSelector(`.${P}progress .${P}result`, { timeout: 20000 });
  assert.match(await page.textContent(`.${P}progress .${P}result`), /отменено/);
  const reqs = env.requests('GET').filter((r) => /^\/(resources|resources\/settings|facilities|research|shipyard|defense|overview)$/.test(r.path)).map((r) => r.path + '?cp=' + r.cp);
  assert.ok(reqs.length - 1 < 15, reqs.join('\n'));
  assert.equal(reqs[reqs.length - 1], '/overview?cp=4');
  const uev = await env.evalOgx(page, () => OGX.diag.recent({ s: 'U' }).filter((e) => e.k === 'empire').map((e) => e.w), null, 'infinity');
  assert.ok(uev.includes('refresh:cancel'), JSON.stringify(uev));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('empire: «Обновить эту планету» without the cp notice re-reads only the current body without ?cp=', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion', settings: SETTINGS });
  const page = await env.open('/overview');
  await openEmpire(env, page);
  // only Флот and Постройки
  await page.click(`.${P}what summary`);
  for (const v of ['resources', 'stations', 'research', 'defense']) await page.click(`.${P}what-cb[data-view="${v}"]`);
  await page.waitForFunction(() => { const s = document.querySelector('.ogx-i-empire-what summary'); return s && /\(2\/6\)/.test(s.textContent); });
  assert.deepEqual(await env.evalOgx(page, () => OGX.settings.get('empire.refreshViews'), null, 'infinity'), ['buildings', 'fleet']);
  env.clearRequests();
  await page.click(`.${P}refresh-current`);
  await page.waitForSelector(`.${P}progress .${P}result`, { timeout: 20000 });
  assert.match(await page.textContent(`.${P}progress .${P}result`), /Обновлено: 2 из 2/);
  assert.equal(await page.$$eval('.ogx-modal', (e) => e.length), 0, 'no cp notice');
  const reqs = env.requests('GET').map((r) => r.path + (r.cp != null ? '?cp=' + r.cp : ''));
  assert.deepEqual(reqs.sort(), ['/resources', '/shipyard']);
  await selectView(page, 'fleet');
  assert.equal(nbsp(await cellText(page, 'fleet', 203, 'p4')), '120 →167');
  const bev = await env.evalOgx(page, () => OGX.diag.recent({ s: 'B' }).filter((e) => e.k === 'empire').map((e) => e.w), null, 'infinity');
  assert.ok(bev.includes('refreshCurrentDirect'), JSON.stringify(bev));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('empire: an error in one view does not break the others; expanded modal', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion', settings: SETTINGS });
  let page;
  for (const p of ['/shipyard', '/defense']) page = await env.open(p);
  await openEmpire(env, page);
  await env.evalOgx(page, () => { OGX.modules.empire._views.defense = () => { throw new Error('test fault'); }; return true; }, null, 'infinity');
  await page.click(`.ogx-tab-pane[data-tab="empire"] .${P}views button[data-view="defense"]`);
  await page.waitForSelector(`.ogx-tab-pane[data-tab="empire"] .${P}error[data-view="defense"]`);
  assert.match(await page.textContent(`.${P}error`), /Оборона/);
  await selectView(page, 'fleet');
  assert.equal(nbsp(await cellText(page, 'fleet', 203, 'p4')), '120 →167');
  await selectView(page, 'research'); // no research data yet: "—"
  assert.equal(await cellText(page, 'research', 122, 'account'), '—');
  // expanded view in a modal
  await selectView(page, 'fleet');
  await page.click(`.${P}expand`);
  await page.waitForSelector(`.${P}modal .${P}table.${P}v-fleet`);
  await page.click(`.${P}modal .${P}views button[data-view="buildings"]`);
  await page.waitForSelector(`.${P}modal .${P}table.${P}v-buildings`);
  const errs = env.ogxErrors();
  assert.ok(errs.length >= 1 && errs.every((e) => /test fault|view defense failed/.test(e.text + (e.stack || ''))), JSON.stringify(errs));
  const sev = await env.evalOgx(page, () => OGX.diag.recent({ s: 'S' }).filter((e) => e.k === 'empire' && e.w === 'view-error').length, null, 'infinity');
  assert.equal(sev, 1);
});

T.test('empire: nothing on non-OgameX pages', async () => {
  const env = await T.launch({ ext: ext(), scenario: 'orion' });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
  assert.deepEqual(env.ogxErrors(), []);
});
