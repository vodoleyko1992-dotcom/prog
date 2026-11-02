// Runs the recipes of specs/galaxyz/mechanics-recipes.js on the REAL saved pages (Chromium, JS disabled, raw saved DOM) and prints the output.
// Usage: cd specs/galaxyz && NODE_PATH=$(npm root -g) node tools/mechanics/run_mechanics_snippets.js [--only=a,b]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = path.resolve(__dirname, '../../../../../eu/pages');
const SRC = fs.readFileSync(path.resolve(__dirname, '../../mechanics-recipes.js'), 'utf8');
const ELEMENTS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../elements.json'), 'utf8')).elements; // {id: {...}}

// [recipe, pages, arg]
const RUNS = [
  ['productionTable', ['resources.html']],
  ['resourceTickers', ['resources.html', 'overview.html']],
  ['resourceBarTooltips', ['overview.html']],
  ['planetFacts', ['resources.html']],
  ['elementLevels', ['buildings.html', 'research.html']],
  ['officerLevels', ['officier.html']],
  ['inferEconomy', ['resources.html']],
  ['storageMultiplier', ['resources.html'], { 22: 18, 23: 17, 24: 16 }],
  ['spyResourceCaps', ['messages-spy.html']],
  ['fleetStep1Data', ['fleetStep1.html']],
  ['harvestFlight', ['overview.html']],
  ['fleetTableFacts', ['fleetTable.html']],
  ['costInfo', ['fleetDealer.html']],
  ['traderFacts', ['trader.html']],
  ['expeditionPosition', ['galaxy.html']],
];

(async () => {
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') && r.request().resourceType() === 'document' ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  for (const [name, pages, arg] of RUNS) {
    if (only.length && !only.includes(name)) continue;
    for (const p of pages) {
      await page.goto('file://' + path.join(DIR, p));
      let out;
      try { out = await page.evaluate(`${SRC}\n;(${name})(document${arg ? ', ' + JSON.stringify(arg) : ''})`); } catch (e) { out = 'ERROR ' + e.message.split('\n')[0]; }
      console.log(`## ${name} ${p}\n${JSON.stringify(out)}`);
      if (name === 'costInfo' && out && typeof out === 'object') {
        // compare the server price list with elements.json (upstream install.sql + fork data)
        const diff = [];
        for (const [id, v] of Object.entries(out)) {
          const e = ELEMENTS[id] || Object.values(ELEMENTS).find((x) => x.id === +id);
          const want = e ? Object.fromEntries(Object.entries(e.cost).filter(([, n]) => n)) : null;
          if (JSON.stringify(want) !== JSON.stringify(v.cost)) diff.push({ id: +id, page: v.cost, elementsJson: want });
        }
        console.log(`## costInfo-vs-elements.json\n${JSON.stringify({ ids: Object.keys(out).length, diff })}`);
      }
    }
  }
  await browser.close();
})();
