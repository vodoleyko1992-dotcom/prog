'use strict';
// Live modules «menu», «planetbar», «techcost» on the REAL saved GALAXYZ pages of ogamex.eu/Aeternum (fixtures/galaxyz/pages)
// through the GALAXYZ mock (tests/gz-server.js) and the suite extension. Every expected number is read from the saved page
// source (resourceTicker, list levels, buy buttons) or from specs/galaxyz/elements.json, never from the module itself.
// Screenshots: tests/out/gz-live-ui-*.png.
//   node tests/gz-mod-live-ui.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;
const { PAGES: PAGE_DIR } = require('./gz-server');

const OUT = path.join(__dirname, 'out');
const ELEMENTS = require('../specs/galaxyz/elements.json').elements;
const saved = (name) => fs.readFileSync(path.join(PAGE_DIR, name + '.html'), 'utf8');
const digits = (s) => (s == null ? null : +String(s).replace(/[^\d]/g, ''));
const shot = async (page, name) => { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'gz-live-ui-' + name + '.png'), fullPage: true }); };

/** Header tickers of a saved page: { metal|crystal|deuterium: { amount, storage, perHour } } + energy { free, produced }. */
function tickers(html) {
  const out = {};
  const re = /resourceTicker\(\{\s*available:\s*\(?(-?[\d.eE+]+)\)?,\s*limit:\s*\[0,\s*"?(\d+)"?\],\s*production:\s*(-?[\d.eE+]+),\s*valueElem:\s*"current_(\w+)"/g;
  let m;
  while ((m = re.exec(html))) out[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
  const en = /class="res_current[^"]*Imperium[^"]*" t="([\d.]+)\s*\/\s*([\d.]+)"/.exec(html);
  out.energy = en ? { free: digits(en[1]), produced: digits(en[2]) } : null;
  return out;
}

/** List items of a saved list page, parsed from the source: [{ id, level, button, form, off }]. */
function listItems(html) {
  const out = [];
  const seen = new Set();
  const parts = html.split(/<li class="technology has_details/).slice(1);
  for (const chunk0 of parts) {
    const chunk = chunk0.split(/<\/li>/)[0];
    const id = +(/data-technology="(\d+)"/.exec(chunk) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const lv = /class="level"(?:[^>]*?data-value="(\d+)")?[^>]*>\s*(?:<span>)?\s*(\d+)/.exec(chunk);
    out.push({ id, level: lv ? +(lv[1] !== undefined ? lv[1] : lv[2]) : null, button: /<button class="upgrade"/.test(chunk),
      form: /class="build_form"/.test(chunk), off: /data-status="off"/.test(chunk) });
  }
  return out;
}

/** Price of a level from the element catalog (cost x factor^(level-1), floored; units: per piece). */
function price(id, level) {
  const e = ELEMENTS[id];
  const unit = e.kind === 'ship' || e.kind === 'defense' || e.kind === 'missile';
  const f = unit ? 1 : Math.pow(e.factor || 1, level - 1);
  const c = e.cost || {};
  return { metal: Math.floor((c[901] || 0) * f), crystal: Math.floor((c[902] || 0) * f), deuterium: Math.floor((c[903] || 0) * f), energy: Math.floor((c[911] || 0) * f) };
}

/** Boxes of the game chrome that the modules must not move. */
const layout = (p) => p.evaluate(() => {
  const out = {};
  for (const sel of ['#links', '#inhalt', '#rechts', '#resTable', '#menuTable', '#countColonies', '#galaxytableHead']) {
    const e = document.querySelector(sel);
    if (e) { const r = e.getBoundingClientRect(); out[sel] = [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }
  }
  out.hscroll = document.documentElement.scrollWidth > innerWidth + 1;
  return out;
});
const OFF = { 'menu.enabled': false, 'planetbar.enabled': false, 'techcost.enabled': false };

/** Page text of our widgets: never 'x0', 'NaN', 'undefined', 'null'. */
async function noJunk(env, page, where) {
  const text = await env.evalOgx(page, () => [...document.querySelectorAll('[class*="ogx-l-planetbar-"], [class*="ogx-l-techcost-"], [class*="ogx-l-menu-"]')]
    .map((e) => e.textContent + ' ' + (e.getAttribute('title') || '')).join('\n'));
  for (const bad of [/\bx0\b/, /NaN/, /undefined/, /\bnull\b/, /Infinity/]) assert.ok(!bad.test(text), where + ': ' + bad + ' in ' + (text.match(new RegExp('.{0,40}' + bad.source + '.{0,40}')) || [])[0]);
}

// ------------------------------------------------------------------------------------------------------------ planetbar
T.test('planetbar: overlay under every planet row with the exact header values, colonies honest, layout of the game kept', async () => {
  const base = await G.launch({ settings: OFF });
  const p0 = await base.game('overview');
  const before = await layout(p0);
  await base.close();

  const env = await G.launch();
  try {
    const page = await env.game('overview');
    await page.waitForSelector('.ogx-l-planetbar-prod');
    const html = saved('overview');
    const tk = tickers(html);
    const r = await env.evalOgx(page, () => {
      const rows = OGX.dom.planetRows();
      return rows.map(({ row, planetId }) => {
        const box = row.nextElementSibling && row.nextElementSibling.classList.contains('ogx-l-planetbar-prod') ? row.nextElementSibling : null;
        const stock = (k) => { const e = box && box.querySelector('.ogx-l-planetbar-planet .ogx-l-planetbar-stock.ogx-l-planetbar-r-' + k); return e ? { title: e.title, val: e.textContent, cls: e.className } : null; };
        const en = box && box.querySelector('.ogx-l-planetbar-energy');
        return { planetId, box: !!box, inflow: !!box && box.classList.contains('ogx-l-planetbar-inflow'), metal: stock('metal'), crystal: stock('crystal'), deuterium: stock('deuterium'),
          rate: box && [...box.querySelectorAll('.ogx-l-planetbar-planet .ogx-l-planetbar-rate')].map((e) => e.textContent),
          energy: en ? { val: en.textContent, title: en.title } : null, text: box && box.textContent, build: box && (box.querySelector('.ogx-l-planetbar-build') || {}).title };
      });
    });
    assert.deepEqual(r.map((x) => x.planetId), [254102, 254103, 254104, 254105]);
    assert.ok(r.every((x) => x.box && x.inflow), 'one in-flow overlay right after each planet row');
    assert.equal(await page.$$eval('.ogx-l-planetbar-prod', (l) => l.length), 4, 'exactly one overlay per planet');
    // main planet (current): capacity and hourly production exactly as resourceTicker in the page source
    const main = r[0];
    for (const k of ['metal', 'crystal', 'deuterium']) {
      const m = /Ёмкость: ([\d\s\u00a0\u202f]+)/.exec(main[k].title);
      assert.equal(digits(m[1]), tk[k].storage, k + ' storage');
      const ph = /Выработка: \+([\d\s\u00a0\u202f]+)\/ч/.exec(main[k].title);
      assert.equal(digits(ph[1]), Math.trunc(tk[k].perHour), k + ' per hour');
      const amt = digits(/: ([\d\s\u00a0\u202f]+) \(/.exec(main[k].title)[1]);
      assert.ok(amt >= Math.floor(tk[k].amount) && amt <= tk[k].amount + tk[k].perHour / 3600 * 120, k + ' projected stock ' + amt + ' vs ' + tk[k].amount);
    }
    assert.match(main.rate[0], /^\+1,93\sмлрд\/ч$/, 'metal per hour shown short ' + main.rate[0]);
    // energy: free energy of the header (t="free / produced")
    assert.equal(digits(main.energy.val), tk.energy.free, 'energy balance = free energy of the header');
    assert.match(main.energy.title, new RegExp('производство ' + String(tk.energy.produced).replace(/\B(?=(\d{3})+(?!\d))/g, '.?')));
    // colonies: never seen -> «нет данных»; the building icon of the list -> «идёт строительство» (no end time on GALAXYZ)
    for (const c of r.slice(1)) {
      assert.match(c.text, /нет данных/);
      assert.match(c.text, /идёт строительство/);
      assert.match(c.build, /значок в списке планет/);
    }
    assert.ok(!/данные устарели/.test(r.map((x) => x.text).join()), 'no "stale" claim for a queue never seen');
    await noJunk(env, page, 'overview');
    const after = await layout(page);
    for (const k of ['#links', '#inhalt', '#resTable', '#menuTable', '#rechts', '#countColonies']) assert.deepEqual(after[k], before[k], k + ' unchanged');
    assert.equal(after.hscroll, false, 'no horizontal scroll');
    // overlays inside the right column, below their own planet row, never overlapping the next row
    const geo = await page.evaluate(() => [...document.querySelectorAll('.ogx-l-planetbar-prod')].map((b) => {
      const r = b.getBoundingClientRect(); const col = document.querySelector('#rechts').getBoundingClientRect();
      const prev = b.previousElementSibling.getBoundingClientRect(); const next = b.parentElement.parentElement.nextElementSibling;
      return { inCol: r.left >= col.left - 1 && r.right <= col.right + 60, below: r.top >= prev.bottom - 1, nextTop: next ? next.getBoundingClientRect().top : null, bottom: r.bottom };
    }));
    for (const g of geo) { assert.ok(g.inCol && g.below, JSON.stringify(g)); if (g.nextTop !== null) assert.ok(g.nextTop >= g.bottom - 1, 'no overlap with the next planet ' + JSON.stringify(g)); }
    assert.deepEqual(env.server.requests.filter((x) => x.method !== 'GET' || !/^page=overview$/.test(x.route)).map((x) => x.method + ' ' + x.url), [], 'no request from the modules');
    await shot(page, 'overview');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

T.test('planetbar: ships known from the hangar -> Battle Transporters (217) owned vs needed, ships bar inside the overlay (not over the coordinates)', async () => {
  const env = await G.launch();
  try {
    await env.game('shipyard', { mode: 'fleet' });
    const page = await env.game('galaxy');
    await page.waitForSelector('.ogx-l-planetbar-prod');
    const items = listItems(saved('shipyard-fleet'));
    const have = (id) => items.find((x) => x.id === id).level;
    const r = await env.evalOgx(page, async () => {
      const box = document.querySelector('.ogx-l-planetbar-prod[data-planet-id="254102"]');
      const ts = box.querySelector('[data-ship="217"]');
      const st = await OGX.state.shipStats();
      const bar = box.querySelector('.ogx-l-planetbar-ships');
      const koords = document.querySelector('a.planetlink[href*="cp=254102"] .planet-koords').getBoundingClientRect();
      const b = bar && bar.getBoundingClientRect();
      return { ts: ts && ts.textContent, tsTitle: ts && ts.title, short: OGX.catalog.shortName(217), cap: st[217] && +st[217].cargo,
        sum: box.querySelector('.ogx-l-planetbar-sum').title, old: box.querySelectorAll('[data-ship="202"], [data-ship="203"]').length,
        bar: bar ? { ships: +bar.dataset.ships, inBox: box.contains(bar), overlapsCoords: b.top < koords.bottom && b.bottom > koords.top, h: b.height } : null,
        onLink: document.querySelectorAll('a.planetlink .ogx-l-planetbar-ships').length };
    });
    assert.equal(r.old, 0, 'no Small/Large Cargo counters: transport counts are in 217 only');
    assert.ok(r.ts && r.ts.startsWith(r.short + ' '), '217 counter labelled ' + r.short + ': ' + r.ts);
    assert.ok(r.cap >= 40e6, 'Battle Transporter cargo >= catalog base 40 000 000: ' + r.cap);
    assert.equal(digits(r.ts.slice(r.short.length).split('/')[0]), have(217), 'battle transporters owned = hangar amount');
    assert.equal(digits(r.ts.split('/')[1]), Math.ceil(digits(r.sum) / r.cap), 'needed 217 = ceil(Σ / 217 cargo)');
    assert.equal(digits(/вместимость ([\d\s\u00a0\u202f]+)/.exec(r.tsTitle)[1]), r.cap, 'tooltip shows the 217 cargo');
    const fleet = [202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 213, 214, 215, 216, 218, 219, 220].reduce((s, id) => s + (items.find((x) => x.id === id) || { level: 0 }).level, 0);
    assert.ok(r.bar && r.bar.inBox && !r.bar.overlapsCoords && r.bar.h >= 2, JSON.stringify(r.bar));
    assert.equal(r.bar.ships, fleet, 'stationed ships without satellites/crawlers');
    assert.equal(r.onLink, 0);
    await shot(page, 'galaxy-planetbar');
    await noJunk(env, page, 'galaxy');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

// ------------------------------------------------------------------------------------------------------------ techcost
const LIST_PAGES = [['buildings', {}, 'buildings'], ['research', {}, 'research'], ['shipyard', { mode: 'fleet' }, 'shipyard-fleet'], ['shipyard', { mode: 'defense' }, 'shipyard-defense']];

T.test('techcost: a badge on every list item with the catalog price of the next level; red exactly where the game has no buy button', async () => {
  const env = await G.launch();
  try {
    for (const [pg, o, file] of LIST_PAGES) {
      const base = await G.launch({ settings: OFF, server: env.server });
      const before = await layout(await base.game(pg, o));
      await base.close();
      const page = await env.game(pg, o);
      await page.waitForSelector('.ogx-l-techcost-badge');
      const html = saved(file);
      const items = listItems(html);
      const tk = tickers(html);
      const badges = await env.evalOgx(page, () => Object.fromEntries([...document.querySelectorAll('.ogx-l-techcost-badge')].map((b) => [b.dataset.id, {
        title: b.title, text: b.textContent, short: b.classList.contains('ogx-l-techcost-short'), unknown: b.classList.contains('ogx-l-techcost-unknown'),
        inLi: !!b.closest('li.technology[data-technology="' + b.dataset.id + '"]'),
        bad: [...b.querySelectorAll('.ogx-l-techcost-bad')].map((x) => x.className.match(/bl-(\w+)/)[1]) }])));
      assert.equal(Object.keys(badges).length, items.length, file + ': one badge per item');
      const unit = file.startsWith('shipyard');
      for (const it of items) {
        const b = badges[it.id];
        assert.ok(b && b.inLi, file + ' ' + it.id + ' badge inside its item');
        const e = ELEMENTS[it.id];
        if (!e.cost || !Object.keys(e.cost).length) { assert.ok(b.unknown, it.id + ' unknown price -> «цена ?»'); assert.match(b.text, /цена \?/); continue; }
        const want = price(it.id, unit ? 1 : it.level + 1);
        const head = unit ? 'Цена за 1 шт.' : 'Следующий уровень ' + (it.level + 1);
        assert.ok(b.title.startsWith(head), file + ' ' + it.id + ': ' + b.title.split('\n')[0]);
        for (const [k, ru] of [['metal', 'Металл'], ['crystal', 'Кристалл'], ['deuterium', 'Дейтерий'], ['energy', 'Энергия']]) {
          const m = new RegExp(ru + ' ([\\d\\s\\u00a0\\u202f]+)').exec(b.title);
          assert.equal(m ? digits(m[1]) : 0, want[k], `${file} ${it.id} L${it.level + 1} ${k}`);
        }
        // affordability = the game's own buy button (buildings/research, empty queue; buildings.md §3.6). Units have no button.
        if (!unit && !it.off) {
          const expectShort = !it.button;
          assert.equal(b.short, expectShort, `${file} ${it.id}: short ${b.short}, game button ${it.button} (${b.title.replace(/\n/g, ' | ')})`);
        }
        if (unit) {
          const short = ['metal', 'crystal', 'deuterium'].some((k) => want[k] > tk[k].amount + tk[k].perHour);
          assert.equal(b.short, short, file + ' ' + it.id);
        }
      }
      if (file === 'research') {
        assert.deepEqual(badges[199].bad, ['energy'], 'Graviton: 300 000 energy vs produced ' + tk.energy.produced);
        assert.ok(items.find((x) => x.id === 106).level === 12 && /Следующий уровень 13/.test(badges[106].title), 'research level from the text (no data-value)');
      }
      if (file === 'buildings') {
        assert.deepEqual(badges[15].bad, ['crystal']);
        assert.deepEqual(badges[31].bad.sort(), ['crystal', 'deuterium']);
        assert.ok(!badges[33].short, 'Terraformer energy 2000 is checked against PRODUCED energy (' + tk.energy.produced + '), not free (' + tk.energy.free + ')');
      }
      await noJunk(env, page, file);
      const after = await layout(page);
      for (const k of ['#links', '#inhalt', '#resTable', '#menuTable']) assert.deepEqual(after[k], before[k], file + ' ' + k + ' unchanged');
      const sizes = await page.evaluate(() => [...document.querySelectorAll('ul.icons > li.technology')].map((li) => li.getBoundingClientRect().height));
      assert.ok(sizes.every((hh) => hh === sizes[0]), file + ': list items keep their size');
      await shot(page, file);
    }
    assert.deepEqual(env.server.requests.filter((x) => x.method !== 'GET' || /DetailsAjax/i.test(x.url)).map((x) => x.method + ' ' + x.url), [], 'no request without a click');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

/** Details panel in the shape the fork's base.js reads (.costs[data-tech-id][data-level][data-factor] > li.cost-item[data-res][data-base]). */
function panel(id, { level, base, factor = 2, input }) {
  const items = Object.entries(base).filter(([, v]) => v > 0).map(([res, v]) => `<li class="cost-item" data-res="${res}" data-base="${v}"><span class="res-amount">${v}</span></li>`).join('');
  return { target: 'technologydetails', content: { technologydetails: `<div id="technologydetails" data-tech="${id}"><h3>Element ${id}</h3>
    <ul class="costs" data-tech-id="${id}" data-level="${level}" data-max="255" data-factor="${factor}">${items}</ul>
    <form class="build_form" action="game.php?page=x" method="post" data-tech-ok="1" data-room-ok="1" data-max-reached="0" data-buyable="1" data-busy="0">
      ${input || ''}<div class="build-it_wrap"><button type="submit" class="upgrade build_submit"><span class="tooltipTop" title="Build">Build</span></button></div></form></div>` } };
}

T.test('techcost: overlay in the details panel (need / have / ships / ETA), amount and target inputs, untrusted panel level ignored', async () => {
  const env = await G.launch();
  try {
    const html = saved('buildings');
    const tk = tickers(html);
    const nano = listItems(html).find((x) => x.id === 15);   // level 10, crystal short
    const p11 = price(15, nano.level + 1);
    env.server.route('GET', 'TechnologyDetailsAjax', (req, res, ctx) => {
      const id = +ctx.query.technology;
      if (id === 15) return ctx.json(panel(15, { level: nano.level, base: { 901: p11.metal, 902: p11.crystal, 903: p11.deuterium }, input: `<input type="number" id="b_input_15" class="upgrade-input" name="level" value="${nano.level + 1}">` }));
      return ctx.json(panel(id, { level: 1, base: { 901: 1000 } }));   // a panel whose level does not match the list
    });
    env.server.route('GET', 'ShipDetailsAjax', (req, res, ctx) => ctx.json(panel(+ctx.query.technology, { level: 0, factor: 1, base: { 901: 6000, 902: 6000 }, input: `<input type="number" id="b_input_${+ctx.query.technology}" class="upgrade-input" name="fmenge[${+ctx.query.technology}]" value="1" min="1">` })));
    let page = await env.game('buildings');
    await page.waitForSelector('.ogx-l-techcost-badge');
    await page.click('ul.icons > li.technology[data-technology="15"] div.icon', { position: { x: 50, y: 30 } });
    await page.waitForSelector('#technologydetails .ogx-l-techcost-ov');
    const read = () => env.evalOgx(page, () => {
      const ov = document.querySelector('#technologydetails .ogx-l-techcost-ov');
      const row = (k) => { const tr = ov.querySelector('.ogx-l-techcost-row-' + k); return tr ? { diff: tr.children[1].textContent, ships: tr.children[2].textContent, bad: tr.classList.contains('ogx-l-techcost-bad'), title: tr.title } : null; };
      return { title: ov.querySelector('.ogx-l-techcost-title').textContent, mult: ov.querySelector('.ogx-l-techcost-mult').textContent, metal: row('metal'), crystal: row('crystal'), deuterium: row('deuterium'),
        total: row('total'), eta: ov.querySelector('.ogx-l-techcost-eta').textContent, need: ov.querySelector('.ogx-l-techcost-need').textContent,
        afterCosts: ov.previousElementSibling && ov.previousElementSibling.classList.contains('costs'), cargo: (() => { const s = OGX.state; return s; })() && null };
    });
    let o = await read();
    assert.equal(o.title, 'Стоимость ур. ' + (nano.level + 1));
    assert.ok(o.afterCosts, 'overlay placed in the flow right after the game cost list');
    assert.ok(!o.metal.bad && !o.deuterium.bad && o.crystal.bad, JSON.stringify(o));
    const needC = digits(/нужно ([\d\s\u00a0\u202f]+)/.exec(o.crystal.title)[1]);
    assert.equal(needC, p11.crystal);
    const haveC = digits(/есть ([\d\s\u00a0\u202f]+)/.exec(o.crystal.title)[1]);
    assert.ok(haveC >= Math.floor(tk.crystal.amount) && haveC < tk.crystal.amount + tk.crystal.perHour / 30, 'crystal on hand ' + haveC);
    // the missing part is counted in Battle Transporters 217 only (cargo from shipStats, Storage officer included)
    const cargo217 = await env.evalOgx(page, async () => { const st = await OGX.state.shipStats(); return (st && st[217] && +st[217].cargo) || OGX.catalog.get(217).props.cargo; });
    const lackC = digits(/не хватает ([\d\s\u00a0\u202f]+)/.exec(o.crystal.title)[1]);
    assert.equal(o.crystal.ships.replace(/[\d\s\u00a0\u202f]+/, '#'), '#Ул. трансп.', o.crystal.ships);
    assert.equal(digits(o.crystal.ships), Math.ceil(lackC / cargo217), 'crystal 217 count ' + o.crystal.ships + ' cargo ' + cargo217);
    assert.equal(digits(o.total.ships), Math.ceil(lackC / cargo217), 'total 217 count');
    assert.doesNotMatch(o.crystal.ships + o.total.ships, /МТ|БТ/);
    assert.match(o.eta, /^Будет доступно через .+ \(в \d\d:\d\d:\d\d\)$/, o.eta);
    const secs = (p11.crystal - haveC) / tk.crystal.perHour * 3600;
    assert.ok(secs > 60 && secs < 3 * 3600, 'ETA in minutes, not hours: ' + secs);
    assert.equal(digits(o.need), p11.metal + p11.crystal + p11.deuterium);
    // target level input (+2 levels) -> cost of two levels like base.js sumGeometric
    await page.fill('#b_input_15', String(nano.level + 2));
    await page.dispatchEvent('#b_input_15', 'input');
    o = await read();
    const p12 = price(15, nano.level + 2);
    assert.equal(o.mult, 'до ур. ' + (nano.level + 2));
    assert.equal(digits(o.need), p11.metal + p11.crystal + p11.deuterium + p12.metal + p12.crystal + p12.deuterium);
    await shot(page, 'buildings-details');
    // a panel whose level disagrees with the REAL list level: list level + catalog price, nothing remembered
    await page.click('ul.icons > li.technology[data-technology="1"] div.icon', { position: { x: 50, y: 30 } });
    await page.waitForFunction(() => { const o2 = document.querySelector('#technologydetails .ogx-l-techcost-ov'); return o2 && o2.dataset.id === '1'; });
    const metal = listItems(html).find((x) => x.id === 1);
    o = await read();
    assert.equal(o.title, 'Стоимость ур. ' + (metal.level + 1));
    assert.equal(digits(/нужно ([\d\s\u00a0\u202f]+)/.exec(o.metal.title)[1]), price(1, metal.level + 1).metal);
    assert.equal(await env.get('techcost.verified'), undefined, 'an untrusted panel never becomes a "server price"');

    // units: amount input multiplies, «Хватает сейчас на»
    page = await env.game('shipyard', { mode: 'fleet' });
    await page.waitForSelector('.ogx-l-techcost-badge');
    await page.click('ul.icons > li.technology[data-technology="203"] div.icon', { position: { x: 50, y: 30 } });
    await page.waitForSelector('#technologydetails .ogx-l-techcost-ov');
    await page.fill('#b_input_203', '1000000');
    await page.dispatchEvent('#b_input_203', 'input');
    const u = await env.evalOgx(page, () => {
      const ov = document.querySelector('#technologydetails .ogx-l-techcost-ov');
      return { mult: ov.querySelector('.ogx-l-techcost-mult').textContent, need: ov.querySelector('.ogx-l-techcost-need').textContent,
        metalBad: ov.querySelector('.ogx-l-techcost-row-metal').classList.contains('ogx-l-techcost-bad'), afford: ov.querySelector('.ogx-l-techcost-afford').textContent };
    });
    assert.equal(digits(u.mult), 1000000);
    assert.equal(digits(u.need), 12e9);
    assert.ok(u.metalBad);
    const sy = tickers(saved('shipyard-fleet'));
    const can = digits(u.afford);
    assert.ok(can >= Math.floor(Math.min(sy.metal.amount, sy.crystal.amount) / 6000) && can < Math.min(sy.metal.amount, sy.crystal.amount) / 6000 + 2000, 'affordable pieces ' + can);
    await shot(page, 'shipyard-details');
    await noJunk(env, page, 'shipyard details');
    assert.deepEqual(env.server.requests.filter((x) => x.method !== 'GET').map((x) => x.url), [], 'no POST: nothing is built');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});

// ------------------------------------------------------------------------------------------------------------ menu
T.test('menu: detached entry in the suite, modal with honest GALAXYZ server data, galaxy clock after #colonized', async () => {
  const env = await G.launch();
  try {
    await env.game('fleetStep1');   // stores the fleet speed (gamespeed 7)
    let page = await env.game('galaxy');
    await page.waitForSelector('#ogx-l-menu-clock');
    const clock = await env.evalOgx(page, () => {
      const c = document.getElementById('ogx-l-menu-clock');
      return { prev: c.previousElementSibling && c.previousElementSibling.id, inInfo: !!c.closest('tr.info'), text: c.textContent, own: [...document.querySelectorAll('#menuTable > li[id^="ogx-"]')].map((x) => x.id) };
    });
    assert.equal(clock.prev, 'colonized');
    assert.ok(clock.inInfo);
    assert.match(clock.text, /^Сервер: \d\d:\d\d:\d\d/);
    assert.deepEqual(clock.own, ['ogx-suite-entry'], 'only the suite entry is in the game menu');
    await shot(page, 'galaxy-clock');

    page = await env.game('overview');
    env.server.clearLog();
    await env.evalOgx(page, () => { OGX.liveMenu.open(); return true; });
    await page.waitForSelector('#ogx-l-menu-modal .ogx-l-menu-server dd');
    await page.waitForFunction(() => document.querySelectorAll('#ogx-l-menu-modal .ogx-l-menu-fresh tbody tr').length === 4);
    const m = await env.evalOgx(page, () => {
      const dl = document.querySelector('#ogx-l-menu-modal .ogx-l-menu-server');
      const items = {};
      for (const dd of dl.querySelectorAll('dd')) items[dd.previousElementSibling.textContent] = { text: dd.textContent, title: dd.title };
      return { items, serverBtn: !!document.getElementById('ogx-l-menu-server-refresh'), note: document.querySelector('#ogx-l-menu-modal .ogx-l-menu-actions .ogx-l-menu-muted').textContent,
        rows: [...document.querySelectorAll('#ogx-l-menu-modal .ogx-l-menu-fresh tbody tr')].map((tr) => tr.textContent) };
    });
    assert.equal(m.items['Вселенная'].text, 'Aeternum');
    assert.match(m.items['Движок'].text, /^GALAXYZ 1\.8/);
    assert.equal(m.items['Добыча ресурсов'].text, 'x22000');
    assert.equal(m.items['Экономика (скорость построек)'].text, 'неизвестно');
    assert.equal(m.items['Исследования'].text, 'неизвестно');
    assert.equal(m.items['Скорость флота'].text, 'x7');
    assert.match(m.items['Скорость флота'].title, /шаг 1/);
    assert.equal(m.items['Часовой пояс сервера'].text, 'UTC+02:00');
    assert.equal(m.serverBtn, false, 'no server-settings button on GALAXYZ (there is no such page)');
    assert.equal(m.note, 'Страницы: Empire (один раз), Buildings.');
    assert.equal(m.rows.length, 4);
    assert.match(m.rows[0], /Главная планета/);
    await noJunk(env, page, 'menu modal');
    assert.deepEqual(env.server.requests.map((x) => x.url), [], 'opening the window sends nothing');
    await shot(page, 'menu-modal');

    // refresh-all only on a click, after the cp notice; 1 x page=imperium + page=buildings per planet, all GET, planet restored
    await page.click('#ogx-l-menu-refresh');
    await page.getByRole('button', { name: 'Понятно, обновить' }).click();
    let run = null;
    for (let i = 0; i < 120; i++) {   // OGX lives in the isolated world: poll through evalOgx
      run = await env.evalOgx(page, () => OGX.liveMenu.runState());
      if (!run.active && run.last) break;
      await page.waitForTimeout(250);
    }
    const reqs = env.server.requests.map((x) => ({ m: x.method, route: x.route, cp: x.cp }));
    assert.ok(reqs.every((x) => x.m === 'GET'), 'only GET');
    assert.deepEqual(reqs.filter((x) => x.route === 'page=imperium').length, 1, 'Empire once');
    assert.deepEqual(reqs.filter((x) => x.route === 'page=buildings').map((x) => x.cp), [254102, 254103, 254104, 254105]);
    assert.ok(!reqs.some((x) => /fleettable|galaxy/i.test(x.route || '')), 'no fleet page, no galaxy view (deuterium)');
    assert.equal(reqs[reqs.length - 1].cp, 254102, 'the current planet is selected again at the end');
    assert.ok(env.server.requests.every((x) => !(x.route === 'page=overview' && String((x.query || {}).ajax) === '1')), 'restore must not use page=overview&ajax=1 (503 on the live server)');
    assert.equal(run.last.done, 5);
    assert.ok(run.last.restored);
    // the mock serves the main planet for every cp: the other bodies are refused by the core as «body mismatch», nothing else
    assert.ok(run.last.errors.every((e) => /body mismatch/.test(e.error)), JSON.stringify(run.last.errors));
    // review fix: the user sees Russian text (no internal "body mismatch 254102 != 254103") and a summary that counts only
    // the stored pages («Обновлено: 2 из 5» next to «Ошибок: 3», never «5 из 5»)
    assert.equal(run.last.ok, 5 - run.last.errors.length);
    const result = await env.evalOgx(page, () => { const m = document.querySelector('.ogx-modal'); return m ? m.innerText : document.body.innerText; });
    assert.ok(!/body mismatch|!=\s*\d/.test(result), result);
    if (run.last.errors.length) {
      assert.match(result, new RegExp(`Обновлено: ${run.last.ok} из 5 запросов\\. Ошибок: ${run.last.errors.length}\\.`));
      assert.match(result, /игра показала другую планету/);
    }
    // page=imperium gave the colonies a stock without storage/production: planetbar shows the stock, never "+0/ч" or a full bar
    await page.waitForTimeout(400);
    const col = await env.evalOgx(page, () => {
      const box = document.querySelector('.ogx-l-planetbar-prod[data-planet-id="254103"]');
      return { text: box.textContent, rates: [...box.querySelectorAll('.ogx-l-planetbar-rate')].map((e) => e.textContent), energy: (box.querySelector('.ogx-l-planetbar-energy') || {}).textContent,
        fills: [...box.querySelectorAll('.ogx-l-planetbar-planet .ogx-l-planetbar-fill')].map((e) => e.style.width),
        tips: [...box.querySelectorAll('.ogx-l-planetbar-planet .ogx-l-planetbar-stock')].map((e) => e.title).filter((t) => !/^Энергия/.test(t)) };
    });
    // review fix: one sentence for the unknown capacity/production (no «Ёмкость: неизвестна, ёмкость и выработка неизвестны»)
    assert.equal(col.tips.length, 3, JSON.stringify(col.tips));
    for (const t of col.tips) {
      assert.match(t, /\nЁмкость и выработка неизвестны \(данные со страницы Empire: откройте эту планету\)/, t);
      assert.ok(!/неизвестна, ёмкость/.test(t), t);
    }
    assert.deepEqual(col.rates, ['?/ч', '?/ч', '?/ч'], JSON.stringify(col));
    assert.ok(!/\+0\/ч|нет данных/.test(col.text), col.text);
    assert.ok(col.energy === undefined || col.energy === '—', 'energy balance unknown, not 0: ' + col.energy);
    await noJunk(env, page, 'after refresh');
    await shot(page, 'menu-refresh');
    assert.deepEqual(env.ogxErrors(), []);
  } finally { await env.close(); }
});
