// node verify.js  -> checks mechanics-calc.js against every number printed on the REAL pages, runs R-empire.js on the
// real + upstream fixtures (Chromium, JS disabled) and writes fixtures/mechanics-expected-parse.json.
const path = require('path'), fs = require('fs');
const G = path.resolve(__dirname, '../..');
const Z = require(path.join(G, 'mechanics-calc.js'));
const E = JSON.parse(fs.readFileSync(path.join(G, 'elements.json'), 'utf8')).elements;
const { run } = require(path.join(G, 'tools/buildings/run-recipe.js'));
let fails = 0;
const eq = (name, got, want, tol = 0.5) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: got ${typeof got === 'number' ? Math.round(got * 1000) / 1000 : got}, want ${want}`);
};
const CFG = Z.AETERNUM_CONFIG;
const research = { 113: 12, 131: 8, 132: 0, 133: 8, 115: 12, 117: 7, 118: 4 };     // REAL research.html / imperium.html
const factor = Object.assign(Z.factors({ officers: { 601: 18, 603: 3 } }), { Energy: 0.2 }); // Geologist 18 (REAL officier); Energy 0.20 observed (3 x 0.05 = 0.15 upstream!)

// 1. page=resources, main planet [2:68:5], temp 32..72 (REAL resources.html rows, planet tooltip)
const main = { type: 1, tempMax: 72, levels: { 1: 38, 2: 35, 3: 33, 4: 30, 12: 0, 22: 18, 23: 17, 24: 16, 212: 797 },
  pct: { 1: 10, 2: 10, 3: 10, 4: 10, 12: 10, 212: 10 }, stock: { 901: 1, 902: 1, 903: 1 } };
const P = Z.production(main, { research, factor }, CFG);
eq('metal mine row 938.100.934', P.rows[1][901] * CFG.resource_multiplier, 938100934);
eq('crystal mine row 432.777.527', P.rows[2][902] * CFG.resource_multiplier, 432777527);
eq('deut row 191.546.210', P.rows[3][903] * CFG.resource_multiplier, 191546210);
eq('metal energy -14.214', P.rows[1][911], -14214);
eq('crystal energy -9.836', P.rows[2][911], -9836);
eq('deut energy -22.993', P.rows[3][911], -22993);
eq('solar 10.470', P.rows[4][911], 10470);
eq('797 satellites 30.817', P.rows[212][911], 30817);
eq('basic metal 440.000', P.basic[901], 440000);
eq('basic crystal 220.000', P.basic[902], 220000);
eq('bonus metal 994.386.990', P.bonus[901], 994386990, 1);
eq('bonus crystal 389.499.775', P.bonus[902], 389499775, 1);
eq('bonus deut 203.038.982', P.bonus[903], 203038982, 1);
eq('bonus energy 8.257', P.bonus[911], 8257);
eq('total metal 1.932.927.923 (= resourceTicker production 1932927923.2055)', P.perHour[901], 1932927923.2055, 0.01);
eq('total crystal 822.497.302 (ticker 822497302.17436)', P.perHour[902], 822497302.17436, 0.01);
eq('total deut 394.585.192 (ticker 394585191.6862)', P.perHour[903], 394585191.6862, 0.01);
eq('energy balance 2.502', P.energyBalance, 2502, 1);
eq('imperium energy main 49.544 (= produced, not balance)', P.energy, 49544);
eq('metal storage 3.417 M (ticker limit 3416925000)', P.limit[901], 3416925000);
eq('crystal storage (ticker limit 1863925000)', P.limit[902], 1863925000);
eq('deut storage (ticker limit 1016750000)', P.limit[903], 1016750000);

// 2. page=imperium energy row of the colonies (temps from planet tooltips)
const col = (tempMax, L4, sats) => Z.production({ type: 1, tempMax, levels: { 4: L4, 212: sats }, pct: {} }, { research, factor }, CFG).energy;
eq('imperium energy [2:68:7] 622', col(62, 10, 0), 622);
eq('imperium energy [2:68:6] 1.276', col(60, 14, 0), 1276);
eq('imperium energy [2:68:8] 4.988', col(30, 17, 77), 4988);

// 3. planet data: diameter = floor(1000 sqrt(fields)), tooltips "18.627 km (85 / 347)" etc.
for (const [f, d] of [[347, 18627], [433, 20808], [514, 22671], [400, 20000]]) eq(`diameter of ${f} fields`, Math.floor(1000 * Math.sqrt(f)), d);
eq('home fields 405 = initial_fields 400 + Terraformer 1 x 5', Z.maxFields(400, 1), 405);
// 4. fleet: slots / expeditions (REAL fleetTable "Fleet 1 / 13", "0 / 2 expedition")
eq('fleet slots computer 12', Z.fleetSlots(12), 13);
eq('expedition slots astro 6', Z.expeditionSlots(6), 2);
eq('colony ship speed (impulse 7) 6000', Z.shipSpeed(E, 208, research), 6000, 1e-6);
eq('probe speed (combustion 12) 2.2e8', Z.shipSpeed(E, 210, research), 2.2e8, 1e-3);
const gsf = CFG.fleet_speed / 2500, d = Z.distance({ g: 2, s: 68, p: 5 }, { g: 2, s: 68, p: 9 });
const sec = Math.round(Z.duration(10, 6000, d, gsf));
eq('distance [2:68:5]->[2:68:9] 1.020', d, 1020);
eq('duration 653 s (REAL fleetStep3)', sec, 653);
eq('consumption 118 (REAL fleetStep2/3)', Z.consumption({ 208: { n: 1, speed: 6000, consumption: 1000 } }, sec, d, gsf), 118);
// 5. upstream-only sanity values (not observable on real pages)
eq('storage level 0 = 10000 (upstream x1)', Z.storageBase(0), 10000);
eq('storage level 8 = 1590000? (OGame value)', Z.storageBase(8) , 1590000);
const lc = Z.loot({ 901: 100000, 902: 100000, 903: 10000 }, 25000);
eq('loot 100k/100k/10k cap 25k: metal (= OgameX test value)', lc[901], 10000, 0.01); eq('... crystal', lc[902], 10000, 0.01); eq('... deut', lc[903], 5000);
eq('moon chance 2.000.000 debris = 20', Z.moonChance(2000000), 20);
eq('spy 1 probe equal tech: counter chance 1/101', Z.spy(1, 10, 10).counterChance, 2 / 202, 1e-9);
const b = Z.battle(E, [{ techs: {}, unit: { 204: 100 } }], [{ techs: {}, unit: { 401: 10 } }], { rng: () => 0.5 });
console.log('battle 100 LF vs 10 RL (rng 0.5):', JSON.stringify({ won: b.won, rounds: b.rounds, a: b.attackers, d: b.defenders, debris: b.debris }));
const sim = Z.simulate(E, [{ techs: { 109: 2, 110: 7, 111: 6 }, unit: { 206: 50 } }], [{ techs: { 109: 2, 110: 2, 111: 2 }, unit: { 204: 200, 401: 100 } }], {}, 30);
console.log('simulate 50 cruisers vs 200 LF + 100 RL x30:', JSON.stringify(sim));

(async () => {
  const fx = (f) => path.join(G, 'fixtures', f);
  const [real, up] = await run([[fx('mechanics-real-imperium.html'), path.join(__dirname, 'R-empire.js')],
    [fx('mechanics-upstream-empire.html'), path.join(__dirname, 'R-empire.js')]]);
  eq('empire real: 4 planets', real.planets.length, 4);
  eq('empire real: unmapped rows', real.unmapped.length, 0);
  eq('empire real: Σ metal 1.559.340.984', real.totals[901], 1559340984);
  eq('empire real: research 124 = 6', real.research[124], 6);
  eq('empire real: [2:68:8] satellites 77', real.planets[3].levels[212], 77);
  eq('empire upstream: 3 bodies incl. moon', up.planets.length, 3);
  eq('empire upstream: moon fieldsMax 7', up.planets[2].fieldsMax, 7);
  fs.writeFileSync(fx('mechanics-expected-parse.json'), JSON.stringify({
    'mechanics-real-imperium.html': real, 'mechanics-upstream-empire.html': up,
    'production(main planet, AETERNUM_CONFIG)': { perHour: P.perHour, energy: P.energy, energyUsed: P.energyUsed, limit: P.limit, bonus: P.bonus },
  }, null, 1));
  console.log(fails ? `${fails} FAILED` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
