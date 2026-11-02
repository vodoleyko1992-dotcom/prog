'use strict';
// Generates fixtures/bot/sim-golden/<name>.json = { input, numbers, ranges, expected } :
//   1. runs OGX.botSim.battle() with a seeded rng that records every rand(min, max) call (numbers + ranges);
//   2. feeds the same list to the UPSTREAM calculateAttack/calculateSteal through tests/bot-sim-php/run.php;
//   3. stores the PHP output as `expected` and fails when the JS result differs (or PHP is missing).
//   node tests/bot-sim-php/make-golden.js
const fs = require('fs');
const path = require('path');
const L = require('./lib');

if (!L.phpAvailable()) { console.error('make-golden: php not found'); process.exit(1); }
const cases = require('./cases')(L.S);
const names = new Set();
const prepared = cases.map((c) => {
  if (names.has(c.name)) throw new Error('duplicate case ' + c.name);
  names.add(c.name);
  const input = { attackers: c.attackers, defenders: c.defenders, planet: c.planet, fleetDebrisPct: c.fleetDebrisPct !== undefined ? c.fleetDebrisPct : 30,
    defDebrisPct: c.defDebrisPct !== undefined ? c.defDebrisPct : 0, keepOrder: !!c.keepOrder };
  const rec = L.recorder(c.seed);
  const js = L.runJs(input, rec);
  return { c, input, numbers: rec.numbers, ranges: rec.ranges, js };
});
const php = L.runPhp(prepared.map((p) => L.phpCase(p.c.name, p.input, p.numbers, p.ranges)));
fs.mkdirSync(L.GOLDEN, { recursive: true });
for (const f of fs.readdirSync(L.GOLDEN)) if (f.endsWith('.json')) fs.unlinkSync(path.join(L.GOLDEN, f));
let bad = 0;
prepared.forEach((p, i) => {
  const d = L.compare(p.js, php[i]);
  if (d.length) { bad++; console.error('MISMATCH', p.c.name, d.slice(0, 5)); }
  const expected = Object.assign({}, php[i]); delete expected.name;
  fs.writeFileSync(path.join(L.GOLDEN, p.c.name + '.json'), JSON.stringify({ name: p.c.name, seed: p.c.seed, input: p.input, numbers: p.numbers, ranges: p.ranges, expected }, null, 1) + '\n');
  console.log(`${d.length ? 'FAIL' : 'ok  '} ${p.c.name.padEnd(30)} won=${php[i].won} rounds=${php[i].rounds} rand calls=${p.numbers.length}`);
});
console.log(`${prepared.length} golden cases written to ${path.relative(L.ROOT, L.GOLDEN)}, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
