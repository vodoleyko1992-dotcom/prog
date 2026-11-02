// node extract-real.js -> runs every recipe on its REAL page(s), writes _real.json (input of gen_elements.py)
const path = require('path'), fs = require('fs');
const { run } = require('./run-recipe.js');
const P = path.resolve(__dirname, '../../../../../eu/pages');
const R = (n) => path.join(__dirname, 'recipes', n);
const jobs = {
  'list.buildings': ['buildings', 'R1-list.js'], 'list.research': ['research', 'R1-list.js'],
  'list.shipyard-fleet': ['shipyard-fleet', 'R1-list.js'], 'list.shipyard-defense': ['shipyard-defense', 'R1-list.js'],
  'queuebox.buildings': ['buildings', 'R2-queuebox.js'], 'queuebox.research': ['research', 'R2-queuebox.js'], 'queuebox.shipyard-fleet': ['shipyard-fleet', 'R2-queuebox.js'],
  'shipyardData.fleet': ['shipyard-fleet', 'R3-shipyard-data.js'], 'shipyardData.defense': ['shipyard-defense', 'R3-shipyard-data.js'],
  resources: ['resources', 'R4-resources.js'], techtree: ['techtree', 'R5-techtree.js'], officier: ['officier', 'R6-officier.js'],
  trader: ['trader', 'R7-trader.js'], fleetDealer: ['fleetDealer', 'R8-fleetdealer.js'], fleetStep1: ['fleetStep1', 'R10-fleetstep1-ships.js'],
};
for (const f of ['buildings', 'research', 'shipyard-fleet', 'shipyard-defense', 'resources', 'techtree', 'officier', 'trader', 'fleetDealer']) jobs['page.' + f] = [f, 'R9-pageinfo.js'];
const keys = Object.keys(jobs);
run(keys.map((k) => [path.join(P, jobs[k][0] + '.html'), R(jobs[k][1])])).then((res) => {
  const out = Object.fromEntries(keys.map((k, i) => [k, res[i]]));
  fs.writeFileSync(path.join(__dirname, '_real.json'), JSON.stringify(out, null, 1));
  for (const k of keys) console.log(k, JSON.stringify(out[k]).slice(0, 160));
});
