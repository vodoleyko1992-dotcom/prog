// Runs the empire.md snippets (empire-recipes.js, JS disabled, raw saved DOM) on the real pages and prints their output.
// Usage (from specs/galaxyz/): NODE_PATH=$(npm root -g) node tools/run_empire_snippets.js [--only=a,b]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = path.resolve(__dirname, '../../../../eu/pages');
const RECIPES = fs.readFileSync(path.resolve(__dirname, '../empire-recipes.js'), 'utf8');

const S = {
  imperium: ['imperium.html', `(() => { const r = GZEmpire.parseImperium(document);
    return { columns: r.columns, research: r.research, warnings: r.warnings,
      main: r.bodies[254102], totals901to911: [901, 902, 903, 911].map(id => r.totals[id]), totalsShips212: r.totals[212] }; })()`],
  imperiumColony: ['imperium.html', `(() => { const r = GZEmpire.parseImperium(document); const b = r.bodies[254103];
    return { name: b.name, coords: b.coords, resources: b.resources, buildingsNonZero: Object.fromEntries(Object.entries(b.buildings).filter(e => e[1])),
      ships: Object.fromEntries(Object.entries(b.ships).filter(e => e[1])) }; })()`],
  imperiumSumCheck: ['imperium.html', `(() => { const r = GZEmpire.parseImperium(document); const bad = [];
    for (const s of GZEmpire.IMPERIUM_SECTIONS) { if (s.key === 'research') continue;
      for (const id of s.ids) { const sum = r.columns.reduce((a, c) => a + r.bodies[c.cp][s.key][id], 0); if (sum !== r.totals[id]) bad.push([id, sum, r.totals[id]]); } }
    return { rowsChecked: GZEmpire.IMPERIUM_SECTIONS.reduce((a, s) => a + s.ids.length, 0), sumMismatches: bad }; })()`],
  imperiumRowNames: ['imperium.html', `(() => { const rows = [...document.querySelector('table.empire').rows].slice(5); let sec = -1, i = 0; const out = [];
    for (const tr of rows) { if (tr.querySelector('th')) { sec++; i = 0; out.push('== ' + tr.textContent.trim()); continue; }
      out.push(GZEmpire.IMPERIUM_SECTIONS[sec].ids[i++] + '=' + tr.cells[0].textContent.trim()); } return out.join(', '); })()`],
  columnOrderVsPlanetList: ['imperium.html', `({ imperium: GZEmpire.parseImperium(document).columns.map(c => c.cp),
    planetList: [...document.querySelectorAll('#myWorlds .smallplanet a.planetlink')].map(a => +a.href.match(/cp=(\\d+)/)[1]),
    selector: [...document.querySelectorAll('#planetSelector option')].map(o => +o.value) })`],
  resources: ['resources.html', `GZEmpire.parseResources(document)`],
  ticker: ['resources.html', `GZEmpire.ticker(document)`],
  officier: ['officier.html', `GZEmpire.parseOfficier(document)`],
  factors: ['officier.html', `GZEmpire.officerFactors(GZEmpire.parseOfficier(document).officers)`],
  // data-status="off" vs upstream officer requirements (install/install.sql:1297-1324)
  lockedVsRequirements: ['officier.html', `(() => { const REQ = { 603: { 601: 5 }, 604: { 602: 5 }, 605: { 601: 10, 603: 2 }, 606: { 601: 10, 603: 2 },
    607: { 605: 1 }, 608: { 606: 1 }, 609: { 601: 20, 603: 10, 605: 3, 606: 3, 607: 2, 608: 2 }, 610: { 602: 10, 604: 5 }, 611: { 602: 10, 604: 5 },
    612: { 610: 1 }, 613: { 611: 1 }, 614: { 602: 20, 604: 10, 610: 2, 611: 2, 612: 1, 613: 3 }, 615: { 614: 1, 609: 1 } };
    const o = GZEmpire.parseOfficier(document).officers, lv = Object.fromEntries(o.map(x => [x.id, x.level]));
    const rows = o.map(x => ({ id: x.id, locked: x.locked, reqMet: Object.entries(REQ[x.id] || {}).every(([r, l]) => lv[r] >= l) }));
    return { agree: rows.filter(r => r.locked === !r.reqMet).length + ' / ' + rows.length, disagree: rows.filter(r => r.locked !== !r.reqMet) }; })()`],
};

(async () => {
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const pages = {};
  const load = async file => {
    if (pages[file]) return pages[file];
    const page = await ctx.newPage();
    await page.route('**/*', r => r.abort());
    await page.setContent(fs.readFileSync(path.join(DIR, file), 'utf8'), { waitUntil: 'domcontentloaded' });
    await page.evaluate(RECIPES);   // page.evaluate still runs with page JS disabled (<script> tags do not)
    return (pages[file] = page);
  };
  const results = {};
  for (const [name, [file, code]] of Object.entries(S)) {
    if (only.length && !only.includes(name)) continue;
    const page = await load(file);
    try { results[name] = await page.evaluate(code); } catch (e) { results[name] = 'ERROR ' + e.message.split('\n')[0]; }
    console.log('### ' + name + ' [' + file + ']\n' + JSON.stringify(results[name], null, 1).replace(/\n\s*/g, ' ') + '\n');
  }

  if (!only.length || only.includes('model')) {
    // Production model check: imperium levels + resources percents + planet-list temperature + officier factors + research.
    const imp = results.imperium ? await (await load('imperium.html')).evaluate(`GZEmpire.parseImperium(document)`) : null;
    const res = results.resources;
    const temp = await (await load('imperium.html')).evaluate(`[...document.querySelectorAll('#myWorlds .smallplanet a.planetlink')].map(a =>
      ({ cp: +a.href.match(/cp=(\\d+)/)[1], tempMax: +a.getAttribute('title').match(/(-?\\d+)°C to (-?\\d+)°C/)[2] }))`);
    const factor = results.factors;
    const main = imp.bodies[254102];
    const percents = Object.fromEntries(res.producers.map(p => [p.id, p.percent]));
    const levels = Object.assign({}, main.buildings, { 212: main.ships[212] });
    const model = await (await load('imperium.html')).evaluate(([p]) => GZEmpire.production(p),
      [{ levels, percents, tempMax: temp.find(t => t.cp === 254102).tempMax, research: imp.research, factor }]);
    console.log('### model [imperium+resources+officier] main planet 254102\n' + JSON.stringify({ model,
      page: { total: res.total, ticker: results.ticker && Object.fromEntries(Object.entries(results.ticker).map(([k, v]) => [k, v.perHour])) } }) + '\n');
    const model02 = await (await load('imperium.html')).evaluate(([p]) => GZEmpire.production(p),
      [{ levels, percents, tempMax: temp.find(t => t.cp === 254102).tempMax, research: imp.research, factor: Object.assign({}, factor, { Energy: 0.2 }) }]);
    console.log('### model with factor.Energy = 0.2\n' + JSON.stringify(model02.energy) + '\n');
    const colonies = [];
    for (const c of imp.columns) {
      const b = imp.bodies[c.cp];
      const st = await (await load('imperium.html')).evaluate(([l]) => [22, 23, 24].map(id => GZEmpire.storage(l[id])), [b.buildings]);
      colonies.push({ cp: c.cp, coords: c.coords.join(':'), storage: st, stock: [901, 902, 903].map(r => b.resources[r]),
        full: [901, 902, 903].map((r, i) => b.resources[r] >= st[i]) });
    }
    console.log('### storage vs stock (imperium)\n' + JSON.stringify(colonies) + '\n');
  }
  await browser.close();
})();
