'use strict';
// Infinity modules «panel», «empire», «todo», «prefs» on the REAL saved GALAXYZ pages (ogamex.eu/Aeternum, fixtures/galaxyz/pages)
// through the GALAXYZ mock (tests/gz-server.js) and the suite extension:
//   panel  (ogamex-infinity/modules/panel)   header (officers instead of a class), tab «Планеты», fields badges, body links
//   empire (ogamex-infinity/modules/empire)  tab «Империя» from page=imperium, refresh = one page=imperium without cp
//   todo   (ogamex-infinity/modules/todo)    «+» on list pages, plan tab (exact costs, unknown times), «Построить» on a click only
//   prefs  (ogamex-infinity/modules/prefs)   hotkeys (page jumps, prev/next body, fleetTable select all/none), export/import
// Every expected number comes from the saved page source (imperium table, resourceTicker, officier levels, list levels,
// fleetTable counts) or specs/galaxyz/elements.json, never from the module. Also: no console errors, the game chrome does not
// move, nothing is requested without a click, nothing is POSTed except after the user's own confirmation.
// Screenshots: tests/out/gz-inf-empire-*.png.
//   node tests/gz-mod-inf-empire.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

const OUT = path.join(__dirname, 'out');
const PAGES = path.join(__dirname, '..', 'fixtures', 'galaxyz', 'pages');
const ELEMENTS = require('../specs/galaxyz/elements.json').elements;
const OTHERS = ['menu', 'planetbar', 'techcost', 'timeline', 'inflight', 'fleetinfo', 'expedition', 'spy', 'stats', 'targets', 'stalk', 'fleethelp', 'flights'];
const VIEW = { width: 1400, height: 900 };
const PN = 'ogx-i-panel-';
const EM = 'ogx-i-empire-';
const TD = 'ogx-i-todo-';
const PR = 'ogx-i-prefs-';
const MAIN = 254102;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const solo = (extra = {}) => Object.assign(Object.fromEntries(OTHERS.map((m) => [m + '.enabled', false])), { 'core.tickMs': 250 }, extra);
const saved = (name) => fs.readFileSync(path.join(PAGES, name + '.html'), 'utf8');
const digits = (s) => (s == null ? null : +String(s).replace(/[^\d]/g, ''));
const shot = async (page, name, full = false) => { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'gz-inf-empire-' + name + '.png'), fullPage: full }); };
const BY_NAME = Object.fromEntries(Object.values(ELEMENTS).map((e) => [e.name, e.id]));

/** page=imperium of the saved file: { cps: [column cp], sections: { Resources|Buildings|...: { id|name: [values per column] } }, fields }. */
function imperium(html) {
  const cps = [...html.matchAll(/<td style="width:100px"><a href="[^"]*page=overview&amp;cp=(\d+)"><img/g)].map((m) => +m[1]);
  const t = html.slice(html.indexOf('<th colspan="6">Empire'));
  const tbl = t.slice(0, t.indexOf('</table>'));
  let sec = 'Head';
  const sections = {};
  for (const m of tbl.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const th = /<th colspan="6">([^<]+)<\/th>/.exec(m[1]);
    if (th) { sec = th[1]; continue; }
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').trim());
    if (tds.length < 6) continue;
    const key = BY_NAME[tds[0]] || tds[0];
    (sections[sec] = sections[sec] || {})[key] = tds.slice(2);
  }
  const col = (cp) => cps.indexOf(cp);
  return { cps, sections, col, value: (sec, key, cp) => digits(sections[sec][key][col(cp)]) };
}
/** resourceTicker of a saved page (current body): { metal|crystal|deuterium: { amount, storage, perHour } }. */
function tickers(html) {
  const out = {};
  const re = /resourceTicker\(\{\s*available:\s*\(?(-?[\d.eE+]+)\)?,\s*limit:\s*\[0,\s*"?(\d+)"?\],\s*production:\s*(-?[\d.eE+]+),\s*valueElem:\s*"current_(\w+)"/g;
  let m;
  while ((m = re.exec(html))) out[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
  return out;
}
/** Officer levels of the saved page=officier: { id: level } (div of each officer: «Level N / max» next to its id). */
function officerLevels(html) {
  const out = {};
  // CommanderDetailsAjax&technology=<id> ... level text follows in the same item
  const parts = html.split(/data-technology="(6\d\d)"/);
  for (let i = 1; i < parts.length; i += 2) {
    const id = +parts[i];
    if (out[id] !== undefined) continue;
    const lv = /class="level"[^>]*data-value="(\d+)"/.exec(parts[i + 1]) || /<span class="level"[^>]*>\s*(?:<span>)?\s*(\d+)/.exec(parts[i + 1]);
    if (lv) out[id] = +lv[1];
  }
  return out;
}
/** List level of an item of a saved list page. */
function listLevel(html, id) {
  for (const chunk0 of html.split(/<li class="technology has_details/).slice(1)) {
    const chunk = chunk0.split(/<\/li>/)[0];
    if (+(/data-technology="(\d+)"/.exec(chunk) || [])[1] !== id) continue;
    const lv = /class="level"[^>]*data-value="(\d+)"/.exec(chunk);
    return lv ? +lv[1] : null;
  }
  return null;
}
/** Price of a level from the element catalog (cost x factor^(level-1), floored; units per piece). */
function price(id, level) {
  const e = ELEMENTS[id];
  const unit = e.kind === 'ship' || e.kind === 'defense' || e.kind === 'missile';
  const f = unit ? 1 : Math.pow(e.factor || 1, level - 1);
  const c = e.cost || {};
  return { metal: Math.floor((c[901] || 0) * f), crystal: Math.floor((c[902] || 0) * f), deuterium: Math.floor((c[903] || 0) * f), energy: Math.floor((c[911] || 0) * f) };
}

function recordRequests(env) {
  env.pageRequests = [];
  env.context.on('request', (rq) => {
    const u = new URL(rq.url());
    if (!/\/game\.php$/.test(u.pathname)) return;
    env.pageRequests.push({ method: rq.method(), url: u.pathname + u.search, type: rq.resourceType() });
  });
  return env;
}
async function launch(o = {}) { return recordRequests(await G.launch(Object.assign({ viewport: VIEW }, o, { settings: solo(o.settings || {}) }))); }
/** Requests of the add-on (not the documents the test opened). */
const ownRequests = (env) => (env.pageRequests || []).filter((r) => r.type !== 'document');
const posts = (env) => env.server.requests.filter((r) => r.method === 'POST');

async function mandatory(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  assert.deepEqual(env.consoleErrors().filter((e) => /OGX|ogx-|panel|empire|todo|prefs/i.test((e.text || '') + (e.stack || ''))).map((e) => e.text), [], what + ': no console errors from the add-on');
}

/** Boxes of the game chrome with our elements in place and with them hidden: equal = no layout shift. */
async function layoutShift(page) {
  return page.evaluate(() => {
    const sels = ['#links', '#menuTable', '#inhalt', '#rechts', '#myWorlds', '#resTable', '#siteFooter', '#countColonies'];
    const measure = () => {
      const o = {};
      for (const s of sels) { const e = document.querySelector(s); if (e) { const b = e.getBoundingClientRect(); o[s] = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; } }
      document.querySelectorAll('#planetList > .smallplanet').forEach((r, i) => { const b = r.getBoundingClientRect(); o['planet' + i] = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
      document.querySelectorAll('ul.icons > li.technology').forEach((r, i) => { const b = r.getBoundingClientRect(); o['li' + i] = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
      o.scrollW = document.documentElement.scrollWidth;
      return o;
    };
    const ours = Array.from(document.querySelectorAll('.ogx-i-panel-fields-badge, .ogx-i-todo-plus, .ogx-i-todo-ready, .ogx-i-todo-dplus')).filter((e) => !e.closest('#ogx-root, .ogx-sidepanel'));
    const withUs = measure();
    const keep = ours.map((e) => [e, e.style.display]);
    for (const [e] of keep) e.style.setProperty('display', 'none', 'important');
    const without = measure();
    for (const [e, d] of keep) e.style.display = d;
    return { diff: Object.keys(without).filter((k) => JSON.stringify(withUs[k]) !== JSON.stringify(without[k])).map((k) => k + ' ' + JSON.stringify(withUs[k]) + ' vs ' + JSON.stringify(without[k])), ours: ours.length };
  });
}
async function openTab(env, page, tab) {
  await env.evalOgx(page, (t) => { const sp = OGX.dom.sidePanel('infinity'); sp.open(); sp.selectTab(t); }, tab);
}
async function closePanel(env, page) { await env.evalOgx(page, () => OGX.dom.sidePanel('infinity').close()); }
const panelText = (page) => page.evaluate(() => { const p = document.querySelector('.ogx-sidepanel'); return p ? p.innerText : ''; });
const modalButton = (page, label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('.ogx-modal-overlay .ogx-modal-buttons button')].reverse().find((x) => x.textContent.trim() === l);
  if (!b) return null;
  b.click();
  return b.textContent;
}, label);

// ================================================================== panel
T.test('panel (real pages): officers instead of a class, planets from page=imperium + tickers, fields badges, no requests', async () => {
  const env = await launch();
  try {
    await env.game('officier');
    await env.game('overview');
    const page = await env.game('imperium');
    const imp = imperium(saved('imperium'));
    const tk = tickers(saved('imperium'));
    const off = officerLevels(saved('officier'));
    assert.deepEqual(Object.fromEntries(Object.entries(off).filter(([, v]) => v > 0)), { 601: 18, 603: 3 }, 'saved officier levels');

    await openTab(env, page, 'planets');
    await env.waitFor(page, '.' + PN + 'row[data-key="p' + MAIN + '"] .' + PN + 'res[data-amount]');
    await page.waitForTimeout(400);
    const head = await page.evaluate((P) => {
      const h = document.getElementById(P + 'head');
      return { name: h.querySelector('.' + P + 'pname').textContent, cls: h.querySelector('.' + P + 'pcls').hidden, rank: h.querySelector('.' + P + 'prank').textContent,
        dm: h.querySelector('.' + P + 'pdm').textContent, officers: [...h.querySelectorAll('.' + P + 'officer')].map((x) => [+x.dataset.id, +x.dataset.level, x.textContent]),
        text: h.innerText };
    }, PN);
    assert.equal(head.name, /id="playerName">[\s\S]*?<a [^>]*>([^<]+)<\/a>/.exec(saved('imperium'))[1]);
    assert.equal(head.cls, true, 'no class on GALAXYZ');
    assert.ok(!/без класса|Коллекционер|Генерал|Первооткрыватель/.test(head.text), head.text);
    assert.equal(head.rank, 'место ' + /statistics&amp;range=(\d+)/.exec(saved('imperium'))[1]);
    assert.equal(digits(head.dm), +/id="current_darkmatter" data-real="(\d+)"/.exec(saved('imperium'))[1], 'dark matter of the newest page (imperium)');
    assert.deepEqual(head.officers, [[601, 18, 'Геолог 18'], [603, 3, 'Инженер 3']]);

    const rows = await page.evaluate((P) => [...document.querySelectorAll('.' + P + 'row')].map((r) => ({
      key: r.dataset.key, name: r.querySelector('.' + P + 'name').textContent, coords: r.querySelector('.' + P + 'coords').textContent,
      fields: (r.querySelector('.' + P + 'fields-txt') || {}).textContent, ships: r.querySelector('.' + P + 'ships').dataset.ships,
      res: Object.fromEntries([...r.querySelectorAll('.' + P + 'res')].map((c) => [c.dataset.res, { amount: +c.dataset.amount, perHour: c.dataset.perHour, rate: c.querySelector('.' + P + 'rate').textContent, title: c.title, bad: c.classList.contains(P + 'bad') }])),
      links: [...r.querySelectorAll('.' + P + 'link')].map((a) => [a.textContent, a.getAttribute('href').replace(/^.*\?/, '')]),
      href: r.querySelector('.' + P + 'name').getAttribute('href').replace(/^.*\?/, '') })), PN);
    assert.deepEqual(rows.map((r) => r.key), ['p254102', 'p254103', 'p254104', 'p254105'], 'planet-list order');
    const names = { 254102: 'Главная планета', 254103: 'Colony', 254104: 'Colony', 254105: 'Colony' };
    const fleetIds = Object.values(ELEMENTS).filter((e) => e.kind === 'ship' && e.id !== 212).map((e) => e.id);
    for (const r of rows) {
      const cp = +r.key.slice(1);
      assert.equal(r.name, names[cp]);
      const [used, max] = imp.sections.Head.Fields[imp.col(cp)].split('/').map((x) => +x.trim());
      assert.equal(r.fields, used + '/' + max, r.key + ' fields = imperium');
      const ships = fleetIds.reduce((s, id) => s + (imp.value('Ships', id, cp) || 0), 0);
      assert.equal(+r.ships, ships, r.key + ' ships = imperium Ships without satellites');
      assert.equal(r.href, 'page=imperium&cp=' + cp, 'body switch keeps the page like the game selector');
      assert.deepEqual(r.links.map((l) => l[0]), ['П', 'В', 'Фл', 'Г']);
      assert.deepEqual(r.links.map((l) => l[1]), ['page=buildings&cp=' + cp, 'page=shipyard&mode=fleet&cp=' + cp, 'page=fleetTable&cp=' + cp, 'page=galaxy&cp=' + cp]);
      if (cp === MAIN) {
        for (const k of ['metal', 'crystal', 'deuterium']) {
          assert.ok(r.res[k].amount >= Math.floor(tk[k].amount) && r.res[k].amount < tk[k].amount + tk[k].perHour / 60, k + ' main = ticker ' + r.res[k].amount + ' / ' + tk[k].amount);
          assert.equal(+r.res[k].perHour, tk[k].perHour, k + ' main per hour = ticker');
        }
        assert.equal(r.res.metal.rate.replace(/[\u00a0\u202f]/g, ' '), '+1,93 млрд/ч');
      } else {
        const resName = { metal: 'Metal', crystal: 'Crystal', deuterium: 'Deuterium' };
        for (const k of ['metal', 'crystal', 'deuterium']) {
          assert.equal(r.res[k].amount, imp.value('Resources', resName[k], cp), r.key + ' ' + k + ' = imperium stock');
          assert.equal(r.res[k].rate, '—/ч', 'production unknown, not +0');
          assert.equal(r.res[k].bad, false, 'unknown storage is not «full»');
          assert.match(r.res[k].title, /Хранилище и выработка неизвестны/);
        }
      }
    }
    const totals = await page.evaluate((P) => {
      const lines = [...document.querySelectorAll('.' + P + 'tline')];
      const line = (label) => lines.find((l) => (l.querySelector('.' + P + 'tlabel') || {}).textContent.startsWith(label));
      const vals = (l) => [...l.querySelectorAll('.' + P + 'tval:not(.' + P + 'thead)')].map((c) => +c.dataset.value);
      return { prodLabel: line('Выработка').querySelector('.' + P + 'tlabel').textContent, prod: vals(line('Выработка')), note: document.querySelector('.' + P + 'tnote').textContent,
        bodies: vals(line('На планетах')) };
    }, PN);
    assert.equal(totals.prodLabel, 'Выработка/ч*');
    assert.deepEqual(totals.prod.slice(0, 3), ['metal', 'crystal', 'deuterium'].map((k) => Math.floor(tk[k].perHour)), 'production total = the one known planet');
    assert.match(totals.note, /известна для 1 из 4 планет/);
    const pt = await panelText(page);
    assert.ok(!/NaN|undefined|x0\b|null/.test(pt), 'no NaN/undefined/x0 in the panel: ' + pt.match(/.{0,30}(NaN|undefined|x0\b|null).{0,30}/));
    await shot(page, 'panel-planets');

    // badges under the planet list (panel closed so the right column is visible)
    await closePanel(env, page);
    await page.waitForTimeout(300);
    const badges = await page.evaluate((P) => [...document.querySelectorAll('.' + P + 'fields-badge')].map((b) => [b.closest('.smallplanet').querySelector('a.planetlink').getAttribute('href').replace(/^.*cp=/, ''), b.textContent]), PN);
    assert.deepEqual(badges.map((b) => b[0]), ['254102', '254103', '254104', '254105']);
    for (const [cp, txt] of badges) assert.equal(txt, imp.sections.Head.Fields[imp.col(+cp)].replace(/\s/g, ''));
    assert.deepEqual((await layoutShift(page)).diff, [], 'game chrome unchanged by the badges');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, 'gz-inf-empire-panel-badges.png'), clip: { x: 900, y: 0, width: 500, height: 700 } });

    assert.deepEqual(ownRequests(env), [], 'the panel sends no request (flights from the event box)');
    assert.deepEqual(posts(env), []);
    await mandatory(env, 'panel');
  } finally { await env.close(); }
});

T.test('panel: officers unknown -> link to page=officier; body links avoid the galaxy view and the fleet steps', async () => {
  const env = await launch();
  try {
    let page = await env.game('overview');
    await openTab(env, page, 'planets');
    await env.waitFor(page, '.' + PN + 'offlink');
    const h = await page.evaluate((P) => ({ link: document.querySelector('.' + P + 'offlink').getAttribute('href').replace(/^.*\?/, ''), text: document.getElementById(P + 'head').innerText }), PN);
    assert.equal(h.link, 'page=officier');
    assert.match(h.text, /Офицеры: неизвестно — откройте «Офицеры»/);
    assert.ok(!/без класса/.test(h.text));
    const href = (p) => p.evaluate((P) => [...document.querySelectorAll('.' + P + 'row .' + P + 'name')].map((a) => a.getAttribute('href').replace(/^.*\?/, '')), PN);
    assert.deepEqual(await href(page), [254102, 254103, 254104, 254105].map((cp) => 'page=overview&cp=' + cp));
    page = await env.game('galaxy');
    await openTab(env, page, 'planets');
    await env.waitFor(page, '.' + PN + 'row');
    assert.deepEqual(await href(page), [254102, 254103, 254104, 254105].map((cp) => 'page=overview&cp=' + cp), 'galaxy: switch on the overview (a galaxy view costs deuterium)');
    const gTitle = await page.evaluate((P) => document.querySelector('.' + P + 'link[data-ogx-act="panel:link-galaxy"]').title, PN);
    assert.match(gTitle, /стоит дейтерий/);
    await shot(page, 'panel-galaxy');
    page = await env.game('shipyard', { mode: 'defense' });
    await openTab(env, page, 'planets');
    await env.waitFor(page, '.' + PN + 'row');
    assert.deepEqual(await href(page), [254102, 254103, 254104, 254105].map((cp) => 'page=shipyard&mode=defense&cp=' + cp));
    page = await env.openSaved('fleetStep2');
    await openTab(env, page, 'planets');
    await env.waitFor(page, '.' + PN + 'row');
    assert.deepEqual(await href(page), [254102, 254103, 254104, 254105].map((cp) => 'page=fleetTable&cp=' + cp), 'fleetStep2 is a POST result: switch on fleetTable');
    // a row click navigates (the user's click) to the link target
    page = await env.game('overview');
    await openTab(env, page, 'planets');
    await env.waitFor(page, '.' + PN + 'row[data-key="p254104"]');
    await Promise.all([page.waitForURL(/cp=254104/), page.click('.' + PN + 'row[data-key="p254104"] .' + PN + 'r3', { position: { x: 120, y: 5 } })]);
    assert.match(page.url(), /page=overview&cp=254104$/);
    assert.deepEqual(ownRequests(env), []);
    await mandatory(env, 'panel links');
  } finally { await env.close(); }
});

// ================================================================== empire
/** Matrix of the empire tab: { rowId: { colKey: text } }. */
const matrix = (page) => page.evaluate((P) => {
  const out = {};
  for (const tr of document.querySelectorAll('.' + P + 'pane .' + P + 'table tr[data-id]')) {
    out[tr.dataset.id] = {};
    for (const td of tr.querySelectorAll('td[data-key]')) if (td.dataset.key) out[tr.dataset.id][td.dataset.key] = { text: td.textContent, title: td.title, cls: td.className };
  }
  return out;
}, EM);
async function showView(env, page, view) {
  await page.click('.' + EM + 'pane .' + EM + 'view[data-view="' + view + '"]');
  await page.waitForSelector('.' + EM + 'pane .' + EM + 'v-' + view);
  await page.waitForTimeout(150);
}

T.test('empire (page=imperium): every view equals the game table; production check with the officers; missiles «—»', async () => {
  const env = await launch();
  try {
    await env.game('officier');
    const page = await env.game('imperium');
    const imp = imperium(saved('imperium'));
    const tk = tickers(saved('imperium'));
    await openTab(env, page, 'empire');
    await env.waitFor(page, '.' + EM + 'pane .' + EM + 'table');
    const cps = [254102, 254103, 254104, 254105];
    const n = (t) => digits(t);

    await showView(env, page, 'buildings');
    let m = await matrix(page);
    const bIds = Object.keys(imp.sections.Buildings).map(Number);
    let checked = 0;
    for (const id of bIds) {
      if (!m[id]) continue;   // the module shows the catalog «building» rows (mines, storage); facilities are in «Станции»
      for (const cp of cps) { assert.equal(n(m[id]['p' + cp].text), imp.value('Buildings', id, cp), `building ${id} on ${cp}`); checked++; }
    }
    for (const cp of cps) assert.equal(m.fields['p' + cp].text.replace(/\s/g, ''), imp.sections.Head.Fields[imp.col(cp)].replace(/\s/g, ''));
    await showView(env, page, 'stations');
    m = await matrix(page);
    for (const id of bIds) {
      if (!m[id]) continue;
      for (const cp of cps) {
        if (/na/.test(m[id]['p' + cp].cls) && imp.value('Buildings', id, cp) === 0) continue;   // moon-only buildings on a planet
        assert.equal(n(m[id]['p' + cp].text), imp.value('Buildings', id, cp), `station ${id} on ${cp}`); checked++;
      }
    }
    assert.ok(checked >= 4 * 18, 'building cells checked: ' + checked);
    await shot(page, 'empire-stations');

    await showView(env, page, 'research');
    m = await matrix(page);
    for (const [id, vals] of Object.entries(imp.sections.Technologies)) assert.equal(n(m[id].account.text), digits(vals[0]), 'research ' + id);

    await showView(env, page, 'fleet');
    m = await matrix(page);
    for (const id of Object.keys(imp.sections.Ships).map(Number)) for (const cp of cps) assert.equal(n(m[id]['p' + cp].text), imp.value('Ships', id, cp), `ship ${id} on ${cp}`);
    await showView(env, page, 'defense');
    m = await matrix(page);
    for (const id of Object.keys(imp.sections.Defenses).map(Number)) for (const cp of cps) assert.equal(n(m[id]['p' + cp].text), imp.value('Defenses', id, cp), `defense ${id} on ${cp}`);
    for (const id of [502, 503]) for (const cp of cps) {
      assert.equal(m[id]['p' + cp].text, '—', 'missiles are not on page=imperium');
      assert.match(m[id]['p' + cp].title, /Ракеты не показываются/);
    }

    await showView(env, page, 'resources');
    m = await matrix(page);
    const resName = { metal: 'Metal', crystal: 'Crystal', deuterium: 'Deuterium' };
    for (const k of ['metal', 'crystal', 'deuterium']) {
      const main = n(m['stock-' + k]['p' + MAIN].text);
      assert.ok(main >= Math.floor(tk[k].amount) && main < tk[k].amount + tk[k].perHour / 60, k + ' main stock ~ ticker');
      assert.equal(n(m['storage-' + k]['p' + MAIN].text), tk[k].storage, k + ' storage = ticker limit');
      assert.equal(n(m['prod-' + k]['p' + MAIN].text), Math.floor(tk[k].perHour), k + ' production = ticker');
      assert.ok(!/mismatch/.test(m['prod-' + k]['p' + MAIN].cls), 'computed production (Geologist 18, Engineer 3) matches the game: ' + m['prod-' + k]['p' + MAIN].title);
      for (const cp of cps.slice(1)) {
        assert.equal(n(m['stock-' + k]['p' + cp].text), imp.value('Resources', resName[k], cp), `${k} stock ${cp} = imperium`);
        assert.equal(m['storage-' + k]['p' + cp].text, '—', 'storage unknown on page=imperium');
        assert.match(m['prod-' + k]['p' + cp].text, /^≈[\d\s  ]+$/, 'production: calculation only, marked ≈');
      }
    }
    for (const cp of cps.slice(1)) assert.equal(n(m.energy['p' + cp].text), imp.value('Resources', 'Energy', cp), 'energy production = imperium');
    const note = await page.evaluate((P) => [...document.querySelectorAll('.' + P + 'pane .' + P + 'note')].map((x) => x.textContent), EM);
    assert.deepEqual(note, ['Расчёт выработки совпадает с игрой (проверено планет: 1).']);
    const pt = await panelText(page);
    assert.ok(!/NaN|undefined|x0\b/.test(pt), 'no NaN/undefined/x0');
    const game = await page.evaluate((P) => document.querySelector('.' + P + 'game-link').getAttribute('href').replace(/^.*\?/, ''), EM);
    assert.equal(game, 'page=imperium', 'link to the game empire = page.urlFor(empire)');
    await shot(page, 'empire-resources');
    assert.deepEqual(ownRequests(env), [], 'no request without a click');
    await mandatory(env, 'empire');
  } finally { await env.close(); }
});

T.test('empire refresh on GALAXYZ: one page=imperium without cp; production pages only after the notice; current body without cp', async () => {
  const env = await launch({ settings: { 'empire.refreshViews': ['buildings', 'stations', 'research', 'fleet', 'defense'] } });
  try {
    const page = await env.game('overview');
    await openTab(env, page, 'empire');
    await env.waitFor(page, '.' + EM + 'refresh-all');
    const before = await env.evalOgx(page, async () => { const b = await OGX.state.bodies(); return Object.values(b).map((x) => !!x.levelsT.resources); });
    assert.deepEqual(before, [false, false, false, false], 'nothing known before');
    env.server.clearLog();
    await page.click('.' + EM + 'refresh-all');
    await page.waitForSelector('.' + EM + 'result');
    assert.equal(await page.$('.ogx-modal-overlay'), null, 'no cp notice for page=imperium');
    let reqs = env.server.requests.map((r) => r.method + ' ' + r.route + (r.cp ? ' cp=' + r.cp : ''));
    assert.deepEqual(reqs, ['GET page=imperium'], 'exactly one background page=imperium, no cp');
    const after = await env.evalOgx(page, async () => { const b = await OGX.state.bodies(); return Object.values(b).map((x) => [x.key, x.levels[1]]); });
    const imp = imperium(saved('imperium'));
    assert.deepEqual(after, [254102, 254103, 254104, 254105].map((cp) => ['p' + cp, imp.value('Buildings', 1, cp)]));
    assert.match(await page.textContent('.' + EM + 'result'), /^Обновлено: 1 из 1 запроса\.$/);

    // «Ресурсы» also wants page=resources of every planet (with cp): notice first; «Отмена» sends nothing
    await env.evalOgx(page, () => OGX.settings.set('empire.refreshViews', ['resources', 'buildings']));
    await page.waitForSelector('.' + EM + 'what summary');
    env.server.clearLog();
    await page.click('.' + EM + 'refresh-all');
    await page.waitForSelector('.ogx-modal-overlay .' + EM + 'notice');
    const notice = await page.textContent('.ogx-modal-overlay .' + EM + 'notice');
    assert.match(notice, /&cp=/);
    assert.ok(!/OgameX/.test(notice), 'GALAXYZ wording');
    await shot(page, 'empire-notice');
    assert.equal(await modalButton(page, 'Отмена'), 'Отмена');
    await page.waitForTimeout(300);
    assert.deepEqual(env.server.requests, [], 'cancelled: no request');

    // current body: page=imperium + page=resources, both without cp
    env.server.clearLog();
    await page.click('.' + EM + 'refresh-current');
    await page.waitForFunction((P) => /Обновлено/.test((document.querySelector('.' + P + 'result') || {}).textContent || ''), EM);
    reqs = env.server.requests.map((r) => r.method + ' ' + r.route + (r.cp ? ' cp=' + r.cp : ''));
    assert.deepEqual(reqs, ['GET page=imperium', 'GET page=resources'], 'current body: no cp switch');

    // accepted notice: imperium once, then page=resources per planet through cp, then the restore
    env.server.clearLog();
    await page.click('.' + EM + 'refresh-all');
    await page.waitForSelector('.ogx-modal-overlay .' + EM + 'notice');
    await modalButton(page, 'Понятно, обновить');
    await page.waitForFunction((P) => /Обновлено: \d+ из 5/.test((document.querySelector('.' + P + 'result') || {}).textContent || ''), EM, { timeout: 30000 });
    // the mock serves the main planet for every cp: the 3 colonies are refused (body mismatch). The summary counts only the
    // stored pages and never contradicts the error count (review fix: was «5 из 5 … Ошибок: 3»)
    const resText = await page.evaluate((P) => document.querySelector('.' + P + 'result').textContent, EM);
    const m = /Обновлено: (\d+) из 5 запросов\.(?: Ошибок: (\d+)\.)?/.exec(resText);
    assert.ok(m, resText);
    assert.equal(+m[1] + +(m[2] || 0), 5, resText);
    assert.ok(!/body mismatch/.test(resText), resText);
    reqs = env.server.requests.map((r) => r.method + ' ' + r.route + (r.cp ? ' cp=' + r.cp : ''));
    assert.equal(reqs[0], 'GET page=imperium');
    assert.deepEqual(reqs.slice(1, 5), [254102, 254103, 254104, 254105].map((cp) => 'GET page=resources cp=' + cp));
    assert.ok(reqs.slice(5).every((r) => r === 'GET page=overview cp=254102'), 'restore of the current planet: ' + reqs.slice(5));
    assert.deepEqual(posts(env), [], 'nothing posted');
    await mandatory(env, 'empire refresh');
  } finally { await env.close(); }
});

// ================================================================== todo
const LIVE = path.join(__dirname, '..', 'fixtures', 'galaxyz', 'live');
/**
 * The GALAXYZ queue box the way the live game renders it (fixtures/galaxyz/live/queue-*.html, snapshots 2026-10-31):
 * first order active (img.build-icon + .build-level), the rest a.construction-queue-item; level = list level + earlier orders.
 */
function queueBox(html, orders) {
  if (!orders.length) return '';
  const seen = {};
  const items = orders.map((o) => { seen[o.id] = (seen[o.id] || 0) + 1; return { id: o.id, level: (listLevel(html, o.id) || 0) + seen[o.id] }; });
  const [a, ...rest] = items;
  return `<div class="content"><div style="float:left;width:100%;"><div id="progressbar" data-time="46"></div><div class="build-info-row"><div class="build-image-wrapper">
<img class="build-icon" src="./styles/theme/gow/gebaeude/${a.id}.png"><form action="game.php?page=buildings" method="post" class="build_form"><input type="hidden" name="cmd" value="">
<button type="submit" class="btn-cancel-building-construction tooltip" data-tooltip-content="&lt;span&gt;Cancel expansion To Level &lt;span&gt;${a.level}&lt;/span&gt; ?&lt;/span&gt;"><img></button></form></div>
<div class="build-text"><span class="build-name">#${a.id}</span><span class="build-level">Improve to Level
<span>${a.level}</span></span><span class="build-time" id="time" data-time="65" secs="46">00:00:36</span></div></div></div>
<div class="container" style="margin-top:10px;">` + rest.map((x) => `<form action="game.php?page=buildings" method="post" class="build_form"><input type="hidden" name="cmd" value=""><input type="hidden" name="listid" value="">
<button type="submit" class="construction-queue-btn"><a class="construction-queue-item tooltip" data-cancel-message="${x.level} ?" data-tooltip-position="top" style="background-image:url(./styles/theme/gow/gebaeude/${x.id}.png);">
<span>${x.level}</span></a></button></form>`).join('\n') + '</div></div>';
}
/** page=buildings answers with the queue of the accepted orders (+ `extra` already queued) unless `ignore()` says the server dropped them. */
function queueRoute(env, { extra = [], ignore = () => false } = {}) {
  env.server.route('GET', 'buildings', (req, res, ctx) => {
    const orders = extra.concat(ignore() ? [] : (ctx.state.builds || []).filter((b) => b.page === 'buildings' && b.cmd === 'insert'));
    return ctx.sendPage('buildings', (html) => html.replace('<div class="largebox">', '<div class="largebox">' + queueBox(html, orders)));
  });
}

T.test('todo (page=buildings, shipyard): «+» adds the next level / the panel amount; exact costs; times «—»; «Построить» only after confirmation', async () => {
  const env = await launch();
  try {
    let page = await env.game('buildings');
    const html = saved('buildings');
    const tk = tickers(html);
    await env.waitFor(page, 'li.technology[data-technology="1"] .' + TD + 'plus');
    const plusCount = await page.evaluate((P) => [document.querySelectorAll('ul.icons > li.technology').length, document.querySelectorAll('.' + P + 'plus').length], TD);
    assert.equal(plusCount[1], plusCount[0], 'one «+» per list item');
    assert.deepEqual((await layoutShift(page)).diff, [], 'list items and chrome unchanged by «+»');
    const overlap = await page.evaluate((P) => [...document.querySelectorAll('ul.icons > li.technology')].filter((li) => {
      const g = li.querySelector('button.upgrade'); const o = li.querySelector('.' + P + 'plus');
      if (!g || !o) return false;
      const a = g.getBoundingClientRect(); const b = o.getBoundingClientRect();
      return a.width && !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom);
    }).map((li) => li.dataset.technology), TD);
    assert.deepEqual(overlap, [], '«+» never covers the game\'s own build button');
    const lv1 = listLevel(html, 1);
    assert.ok(lv1 > 0 && listLevel(html, 33) >= 0, 'saved list levels');
    await page.click('li.technology[data-technology="1"] .' + TD + 'plus');
    await page.waitForFunction((P) => /→/.test(document.querySelector('li.technology[data-technology="1"] .' + P + 'plus').textContent), TD);
    assert.equal(await page.textContent('li.technology[data-technology="1"] .' + TD + 'plus'), '→' + (lv1 + 1));
    let plans = await env.get('todo.plans');
    assert.deepEqual(plans.bodies['p' + MAIN].map((x) => [x.objectId, x.targetLevel]), [[1, lv1 + 1]]);
    // a costly one: Terraformer (33) next level
    const lv33 = listLevel(html, 33);
    await page.click('li.technology[data-technology="33"] .' + TD + 'plus');
    await page.waitForFunction((P) => /→/.test(document.querySelector('li.technology[data-technology="33"] .' + P + 'plus').textContent), TD);
    await shot(page, 'todo-buildings');

    await openTab(env, page, 'todo');
    await env.waitFor(page, '.' + TD + 'list[data-list="p' + MAIN + '"] tbody tr');
    const rows = await page.evaluate((P) => [...document.querySelectorAll('.' + P + 'list[data-list="p254102"] tbody tr')].map((tr) => ({
      obj: +tr.dataset.obj, cost: tr.querySelector('.' + P + 'cost').title, costLines: tr.querySelectorAll('.' + P + 'cost > div').length, time: tr.querySelector('.' + P + 'time').textContent, timeTitle: tr.querySelector('.' + P + 'time').title,
      status: tr.querySelector('.' + P + 'status').textContent })), TD);
    const fmt = (c) => [c.metal && 'М ' + c.metal, c.crystal && 'К ' + c.crystal, c.deuterium && 'Д ' + c.deuterium, c.energy && 'Э ' + c.energy].filter(Boolean).join(' · ');
    const p1 = price(1, lv1 + 1);
    const p33 = price(33, lv33 + 1);
    assert.equal(rows[0].cost.replace(/[\s  ](?=\d)/g, ''), fmt(p1).replace(/ (?=\d)/g, ''), 'metal mine cost = catalog price');
    assert.equal(rows[1].cost.replace(/[\s  ](?=\d)/g, ''), fmt(p33).replace(/ (?=\d)/g, ''));
    assert.equal(rows[0].time, '—');
    assert.match(rows[0].timeTitle, /скорость строительства/);
    const afford = (c) => ['metal', 'crystal', 'deuterium'].every((k) => c[k] <= tk[k].amount);
    assert.equal(rows[0].status, afford(p1) ? 'можно строить' : rows[0].status);
    assert.ok(afford(p1), 'saved stock pays the next metal mine level');
    assert.match(rows[1].status, afford(p33) ? /можно строить/ : /^через /);
    const tfoot = await page.textContent('.' + TD + 'list[data-list="p254102"] tfoot');
    assert.ok(!/NaN|undefined/.test(tfoot), tfoot);
    assert.match(await page.textContent('.' + TD + 'list[data-list="p254102"] .' + TD + 'time-note'), /скорость строительства этой вселенной неизвестна/);
    await shot(page, 'todo-tab');

    // «Построить»: cancel -> nothing; confirm -> one POST page=buildings cmd=insert building=1 (cp of the body);
    // «заказано» only once the returned page shows the order in the queue
    queueRoute(env);
    env.server.clearLog();
    await page.click('.' + TD + 'list[data-list="p254102"] tbody tr:first-child .' + TD + 'build');
    await page.waitForSelector('.ogx-modal-overlay');
    await modalButton(page, 'Отмена');
    await page.waitForTimeout(300);
    assert.deepEqual(env.server.requests, [], 'cancelled build sends nothing');
    await page.click('.' + TD + 'list[data-list="p254102"] tbody tr:first-child .' + TD + 'build');
    await page.waitForSelector('.ogx-modal-overlay');
    await modalButton(page, 'Построить');
    // the returned page shows the order in the game queue: «в очереди» (verified), the item is marked as sent
    await page.waitForFunction((P) => /в очереди/.test((document.querySelector('.' + P + 'list[data-list="p254102"] tbody tr:first-child .' + P + 'status') || {}).textContent || ''), TD, { timeout: 10000 });
    assert.ok((await env.get('todo.plans')).bodies['p' + MAIN][0].sentAt > 0, 'marked as ordered');
    const p = posts(env);
    assert.equal(p.length, 1, 'one POST');
    assert.equal(p[0].route, 'page=buildings');
    assert.deepEqual({ cmd: p[0].form.cmd, building: p[0].form.building }, { cmd: 'insert', building: '1' });
    assert.ok(p[0].cp === MAIN || p[0].cp === null, 'current body');

    // shipyard: «+» = 1 unit; details panel amount -> «+ в план»
    env.server.route('GET', 'ShipDetailsAjax', (req, res, ctx) => {
      const id = +ctx.query.technology;
      ctx.json({ target: 'technologydetails', content: { technologydetails: `<div id="technologydetails" data-tech="${id}"><h3>Element ${id}</h3>
        <ul class="costs" data-tech-id="${id}" data-level="0" data-max="255" data-factor="1"><li class="cost-item" data-res="901" data-base="2000"><span class="res-amount">2000</span></li></ul>
        <form class="build_form" action="game.php?page=shipyard" method="post" data-tech-ok="1" data-room-ok="1" data-max-reached="0" data-buyable="1" data-busy="0">
        <input type="number" id="b_input_${id}" class="upgrade-input" name="fmenge[${id}]" value="1" min="1"><div class="build-it_wrap"><button type="submit" class="upgrade build_submit">Build</button></div></form></div>` } });
    });
    page = await env.game('shipyard', { mode: 'fleet' });
    await env.waitFor(page, 'li.technology[data-technology="210"] .' + TD + 'plus');
    await page.click('li.technology[data-technology="210"] .' + TD + 'plus');
    await page.waitForFunction((P) => document.querySelector('li.technology[data-technology="210"] .' + P + 'plus').textContent === '+1', TD);
    assert.equal(await page.$('#technologydetails'), null, '«+» does not open the game details');
    await page.click('ul.icons > li.technology[data-technology="208"] div.icon', { position: { x: 50, y: 30 } });
    await page.waitForSelector('#technologydetails .' + TD + 'dplus');
    await page.fill('#b_input_208', '5');
    await page.click('#technologydetails .' + TD + 'dplus');
    await page.waitForFunction((P) => document.querySelector('li.technology[data-technology="208"] .' + P + 'plus').textContent === '+1', TD);
    plans = await env.get('todo.plans');
    assert.deepEqual(plans.bodies['p' + MAIN].filter((x) => x.amount).map((x) => [x.objectId, x.amount]), [[210, 1], [208, 5]]);
    await shot(page, 'todo-shipyard', false);
    assert.deepEqual((await layoutShift(page)).diff, []);
    assert.equal(posts(env).length, 1, 'still only the confirmed build');
    await mandatory(env, 'todo');
  } finally { await env.close(); }
});

T.test('todo: GALAXYZ queue (live markup) — «+» counts queued levels; «Построить» counts only when the queue shows it', async () => {
  // parser on the live markup (snapshots of ogamex.eu, 2026-10-31)
  const env = await launch();
  try {
    let page = await env.game('buildings');
    await env.waitFor(page, 'li.technology[data-technology="1"] .' + TD + 'plus');
    const live = {};
    for (const f of ['queue-buildings', 'queue-research', 'queue-overview']) live[f] = fs.readFileSync(path.join(LIVE, f + '.html'), 'utf8');
    const parsed = await env.evalOgx(page, (L) => {
      const o = {};
      for (const [k, html] of Object.entries(L)) o[k] = OGX.todo._test.gzQueue(new DOMParser().parseFromString(html, 'text/html')).map((x) => [x.objectId, x.targetLevel, x.active]);
      return o;
    }, live);
    // expected values read from the fixtures with plain regexes (not the module)
    const expect = (html) => [...html.matchAll(/build-icon" src="[^"]*\/(\d+)\.png[\s\S]*?build-level">[^<]*<span>(\d+)/g)].map((m) => [+m[1], +m[2], true])
      .concat([...html.matchAll(/construction-queue-item[^>]*?gebaeude\/(\d+)\.png[^>]*>\s*<span>(\d+)/g)].map((m) => [+m[1], +m[2], false]));
    for (const k of Object.keys(live)) assert.deepEqual(parsed[k], expect(live[k]), k);
    assert.deepEqual(parsed['queue-buildings'], [[15, 3, true], [4, 24, false], [4, 23, false], [4, 22, false], [4, 21, false]]);
    assert.deepEqual(parsed['queue-research'], [[117, 13, true], [117, 14, false], [117, 15, false]]);

    // «+» on a page whose queue already holds metal mine L+1 and L+2 -> the plan gets L+3
    const html = saved('buildings');
    const lv1 = listLevel(html, 1);
    queueRoute(env, { extra: [{ id: 1 }, { id: 1 }] });
    page = await env.game('buildings');
    await env.waitFor(page, 'li.technology[data-technology="1"] .' + TD + 'plus');
    await page.click('li.technology[data-technology="1"] .' + TD + 'plus');
    await page.waitForFunction((P) => /→/.test(document.querySelector('li.technology[data-technology="1"] .' + P + 'plus').textContent), TD);
    assert.equal(await page.textContent('li.technology[data-technology="1"] .' + TD + 'plus'), '→' + (lv1 + 3), 'next level above the queued ones');
    const plans = await env.get('todo.plans');
    assert.deepEqual(plans.bodies['p' + MAIN].map((x) => [x.objectId, x.targetLevel]), [[1, lv1 + 3]]);
  } finally { await env.close(); }
});

T.test('todo: «Построить» on GALAXYZ — server drops the order -> error; one level of several -> «ещё раз»; queued -> «в очереди»', async () => {
  const html = saved('buildings');
  const lv1 = listLevel(html, 1);
  const lv4 = listLevel(html, 4);
  const env = await launch({ storage: { '{ns}|todo.plans': { v: 1, bodies: { ['p' + MAIN]: [{ id: 'a', objectId: 1, targetLevel: lv1 + 1, addedAt: 1 }, { id: 'b', objectId: 4, targetLevel: lv4 + 2, addedAt: 2 }] }, research: [] } } });
  try {
    let dropped = true;
    queueRoute(env, { ignore: () => dropped });
    const page = await env.game('buildings');
    await env.waitFor(page, 'li.technology[data-technology="1"] .' + TD + 'plus');
    await openTab(env, page, 'todo');
    const row = (i) => '.' + TD + 'list[data-list="p' + MAIN + '"] tbody tr:nth-child(' + i + ')';
    await env.waitFor(page, row(2));
    const build = async (i) => {
      await page.click(row(i) + ' .' + TD + 'build');
      await page.waitForSelector('.ogx-modal-overlay');
      await modalButton(page, 'Построить');
    };
    // 1) the server answers with the page but the queue is empty: not ordered
    await build(1);
    await page.waitForFunction(() => /не построено/.test((document.getElementById('ogx-toasts') || {}).textContent || ''), null, { timeout: 10000 });
    let plans = await env.get('todo.plans');
    assert.ok(!plans.bodies['p' + MAIN][0].sentAt, 'not marked as ordered');
    assert.doesNotMatch(await page.textContent(row(1) + ' .' + TD + 'status'), /заказано|в очереди/);
    assert.equal(posts(env).length, 1, 'the click sent one POST');
    // 2) solar plant: target = list level + 2, the game queues one level per order -> «ещё раз», still not «заказано»
    dropped = false;
    await build(2);
    await page.waitForFunction(() => /до цели ур\./.test((document.getElementById('ogx-toasts') || {}).textContent || ''), null, { timeout: 10000 });
    plans = await env.get('todo.plans');
    assert.ok(!plans.bodies['p' + MAIN][1].sentAt, 'partial order not marked');
    // 3) once more -> L+2 in the queue -> «в очереди», marked as ordered
    await build(2);
    await page.waitForFunction((r) => /в очереди/.test((document.querySelector(r) || {}).textContent || ''), row(2) + ' .' + TD + 'status', { timeout: 10000 });
    plans = await env.get('todo.plans');
    assert.ok(plans.bodies['p' + MAIN][1].sentAt > 0);
    const j = await env.evalOgx(page, () => OGX.diag.recent({ k: 'todo' }).filter((e) => e.w === 'build:verify').map((e) => [e.d.started, e.d.partial, e.d.queued]));
    assert.deepEqual(j, [[false, false, 0], [true, true, lv4 + 1], [true, false, lv4 + 2]]);
    assert.deepEqual(env.server.state.builds.map((b) => [b.page, b.cmd, b.id]), [['buildings', 'insert', 1], ['buildings', 'insert', 4], ['buildings', 'insert', 4]]);
    await mandatory(env, 'todo verify');
  } finally { await env.close(); }
});

T.test('todo: ready dot on the planet list (GALAXYZ rows), imperium-only planet = «выработка неизвестна»', async () => {
  const env = await launch({ storage: { '{ns}|todo.plans': { v: 1, bodies: { p254102: [{ id: 'a', objectId: 1, targetLevel: 39, addedAt: 1 }], p254104: [{ id: 'b', objectId: 1, targetLevel: 33, addedAt: 1 }] }, research: [] } } });
  try {
    await env.game('imperium');
    const page = await env.game('overview');
    await env.waitFor(page, '.' + TD + 'ready');
    const dots = await page.evaluate((P) => [...document.querySelectorAll('.' + P + 'ready')].map((d) => [d.dataset.key, d.closest('.smallplanet').querySelector('a.planetlink').getAttribute('href').replace(/^.*cp=/, '')]), TD);
    assert.deepEqual(dots, [['p254102', '254102']], 'main planet can pay metal mine 39; colony [2:68:7] cannot pay 33');
    assert.deepEqual((await layoutShift(page)).diff, []);
    await page.screenshot({ path: path.join(OUT, 'gz-inf-empire-todo-dot.png'), clip: { x: 1000, y: 100, width: 300, height: 260 } });
    await openTab(env, page, 'todo');
    await env.waitFor(page, '.' + TD + 'list[data-list="p254104"] tbody tr');
    const st = await page.textContent('.' + TD + 'list[data-list="p254104"] tbody tr .' + TD + 'status');
    const imp = imperium(saved('imperium'));
    const c33 = price(1, 33);
    assert.ok(c33.metal > imp.value('Resources', 'Metal', 254104), 'colony stock is short for metal mine 33');
    assert.equal(st, 'не хватает (выработка неизвестна)');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'todo-ready');
    assert.deepEqual(ownRequests(env), []);
    await mandatory(env, 'todo dots');
  } finally { await env.close(); }
});

// ================================================================== prefs
T.test('prefs hotkeys on GALAXYZ: page jumps, next/prev body (selector order), galaxy -> overview, fleetTable select all / none', async () => {
  const env = await launch();
  try {
    let page = await env.game('overview');
    await page.click('body', { position: { x: 5, y: 5 } });
    const go = async (key, re) => { await Promise.all([page.waitForURL(re, { timeout: 8000 }), page.keyboard.press(key)]); await env.waitReady(page); return page.url().replace(/^.*\?/, ''); };
    assert.equal(await go('Alt+Shift+Digit2', /page=buildings/), 'page=buildings');
    assert.equal(await go('Alt+Shift+Digit3', /page=resources/), 'page=resources');
    assert.equal(await go('Alt+Shift+Digit9', /page=imperium/), 'page=imperium');
    assert.equal(await go('Alt+PageDown', /cp=254103/), 'page=imperium&cp=254103', 'next planet of #planetSelector, same page');
    page = await env.game('overview');
    await page.click('body', { position: { x: 5, y: 5 } });
    assert.equal(await go('Alt+PageUp', /cp=254105/), 'page=overview&cp=254105', 'previous of the first = the last');
    page = await env.game('galaxy');
    await page.click('body', { position: { x: 5, y: 5 } });
    assert.equal(await go('Alt+PageDown', /cp=254103/), 'page=overview&cp=254103', 'galaxy: never a new galaxy view');
    // planet <-> moon without a moon: toast, no navigation
    page = await env.game('overview');
    await page.click('body', { position: { x: 5, y: 5 } });
    await page.keyboard.press('Alt+Shift+KeyM');
    await page.waitForSelector('.ogx-toast');
    assert.match(await page.textContent('.ogx-toast'), /нет луны/);

    // fleetTable: select all = every flying ship of the page, reset = 0; nothing submitted
    page = await env.game('fleetTable');
    await page.click('body', { position: { x: 5, y: 5 } });
    const src = saved('fleetTable');
    const inputs = [...src.matchAll(/<td id="ship(\d+)_value">([\d.]+)<\/td>[\s\S]*?<\/tr>/g)].filter((m) => new RegExp(`name="ship${m[1]}"`).test(m[0])).map((m) => [m[1], digits(m[2])]);
    assert.ok(inputs.length >= 2, 'saved fleetTable has flying ships');
    await page.keyboard.press('Alt+Shift+KeyA');
    await page.waitForFunction((id) => document.querySelector('input[name="ship' + id + '"]').value !== '0', inputs[0][0]);
    const vals = () => page.evaluate((ids) => ids.map((id) => [id, +document.querySelector('input[name="ship' + id + '"]').value]), inputs.map((x) => x[0]));
    assert.deepEqual(await vals(), inputs);
    await shot(page, 'prefs-fleet-all');
    await page.keyboard.press('Alt+Shift+KeyR');
    await page.waitForFunction((id) => document.querySelector('input[name="ship' + id + '"]').value === '0', inputs[0][0]);
    assert.deepEqual(await vals(), inputs.map(([id]) => [id, 0]));
    assert.deepEqual(posts(env), [], 'nothing submitted');
    assert.deepEqual(ownRequests(env), [], 'hotkeys only navigate');
    await mandatory(env, 'prefs hotkeys');
  } finally { await env.close(); }
});

T.test('prefs tab on GALAXYZ: labels of the jumps, export file of the GALAXYZ account, import preview without «n:»', async () => {
  const env = await launch({ storage: { '{ns}|targets.list': { v: 1, items: [{ id: 'x', coords: '2:70:4' }] } } });
  try {
    const page = await env.game('overview');
    await openTab(env, page, 'prefs');
    await env.waitFor(page, '.' + PR + 'help');
    const help = await page.evaluate((P) => [...document.querySelectorAll('.' + P + 'hk')].map((x) => x.textContent), PR);
    assert.ok(help.includes('Alt+Shift+2 Перейти: Постройки (рудники, склады, фабрики)'), help.join('\n'));
    assert.ok(help.includes('Alt+Shift+3 Перейти: Сырьё (настройки добычи)'));
    assert.ok(help.includes('Alt+Shift+9 Перейти: Империя'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.' + PR + 'export-all')]);
    assert.match(dl.suggestedFilename(), /^ogamex-infinity-ogamex\.eu_\d+_aeternum-n_vodoleyko1992-\d{8}\.json$|^ogamex-infinity-ogamex\.eu.*aeternum-n_vodoleyko1992-\d{8}\.json$/i, dl.suggestedFilename());
    const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(file.format, 'ogx-export');
    assert.equal(file.playerId, 'n:vodoleyko1992');
    assert.deepEqual(file.data.player['targets.list'], { v: 1, items: [{ id: 'x', coords: '2:70:4' }] });
    // import of the same file: preview names the player without the storage prefix, no «other account» warning
    await page.fill('.' + PR + 'paste', JSON.stringify(file));
    await page.click('.' + PR + 'paste-btn');
    await page.waitForSelector('.' + PR + 'preview');
    const pv = await page.textContent('.' + PR + 'preview .' + PR + 'src');
    assert.match(pv, /игрок vodoleyko1992/);
    assert.equal(await page.$('.' + PR + 'preview .' + PR + 'warn'), null, 'same account, no warning');
    await shot(page, 'prefs-import');
    await modalButton(page, 'Отмена');
    assert.deepEqual(ownRequests(env), []);
    assert.deepEqual(posts(env), []);
    await mandatory(env, 'prefs tab');
  } finally { await env.close(); }
});
