// Runs fleet-recipes.js on the REAL saved fleet pages and on fixtures/fleet-*.html in Chromium (Playwright),
// both on the live document and through DOMParser (what a background fetch() sees), plus the PHP-exact calc
// against the numbers the real server printed.
// Usage (cwd = specs/galaxyz): NODE_PATH=/opt/node22/lib/node_modules node tools/check_fleet.js [--write]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const HERE = path.resolve(__dirname, '..');
const FIX = path.join(HERE, 'fixtures');
const files = fs.readdirSync(FIX).filter((f) => /^fleet-.*\.html$/.test(f)).sort();
const kind = (f) => /fleetTable/.test(f) ? 'table' : /Step1/.test(f) ? 's1' : /Step2/.test(f) ? 's2' : 's3';
(async () => {
  const b = await chromium.launch();
  const out = {};
  let fail = 0;
  const p = await b.newPage();
  p.on('pageerror', () => {});
  await p.route('**/*', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  for (const f of files) {
    await p.goto('file://' + path.join(FIX, f), { waitUntil: 'domcontentloaded' });
    await p.addScriptTag({ path: path.join(HERE, 'fleet-recipes.js') });
    const html = fs.readFileSync(path.join(FIX, f), 'utf8');
    out[f] = await p.evaluate(([h, k]) => {
      const fn = { table: GZFleet.parseFleetTable, s1: GZFleet.parseStep1, s2: GZFleet.parseStep2, s3: GZFleet.parseStep3 }[k];
      const live = fn(document);
      const parsed = fn(new DOMParser().parseFromString(h, 'text/html'));
      return { live, sameAsDomParser: JSON.stringify(live) === JSON.stringify(parsed) };
    }, [html, kind(f)]);
    if (!out[f].sameAsDomParser) { fail++; console.error('DOMParser mismatch', f); }
  }
  // calc against REAL numbers: step1 (2:68:5 -> 2:68:5, 47 s, 2 deut) and step3 (2:68:5 -> 2:68:9, 1020, 653 s, 118 deut)
  await p.goto('file://' + path.join(FIX, 'fleet-real-fleetStep1.html'), { waitUntil: 'domcontentloaded' });
  await p.addScriptTag({ path: path.join(HERE, 'fleet-recipes.js') });
  out.calc = await p.evaluate(() => {
    const d = GZFleet.parseStep1(document).data;
    const from = { galaxy: 2, system: 68, planet: 5 };
    const a = GZFleet.calc.estimate({ from, to: from, ships: d.ships, speed: 10, gameSpeed: d.gamespeed });
    const s3 = GZFleet.calc.estimate({ from, to: { galaxy: 2, system: 68, planet: 9 }, ships: d.ships, speed: 10, gameSpeed: d.gamespeed });
    // fleetStep3 printed: Target time 10:20:01, Time of Return 10:30:54 -> return - arrival must equal the duration
    const r = GZFleet.parseStep3(new DOMParser().parseFromString('<div id="inhalt"><table><tr><th class="success">Fleet sent</th></tr>' +
      '<tr><td>Mission</td><td>Colonize</td></tr><tr><td>D</td><td>1.020</td></tr><tr><td>S</td><td>6.000</td></tr><tr><td>C</td><td>118</td></tr>' +
      '<tr><td>F</td><td>2:68:5</td></tr><tr><td>T</td><td>2:68:9</td></tr><tr><td>A</td><td>30. Oct 2026, 10:20:01</td></tr><tr><td>R</td><td>30. Oct 2026, 10:30:54</td></tr></table></div>', 'text/html'));
    return { sameTarget: a, step3: s3, realStep3Delta: (r.returnWall - r.arrivalWall) / 1000,
      checks: { durSame: a.durationSec === 47, consSame: a.consumption === 2, dist: s3.distance === 1020, dur: s3.durationSec === 653,
        cons: s3.consumption === 118, delta: (r.returnWall - r.arrivalWall) / 1000 === 653,
        shipSpeedLC: Math.round(GZFleet.calc.shipSpeed({ speed: 5000, speedTech: 4 }, { 115: 12, 117: 7, 118: 4 })) === 12000,
        shipSpeedProbe: Math.round(GZFleet.calc.shipSpeed({ speed: 100000000, speedTech: 1 }, { 115: 12, 117: 7, 118: 4 })) === 220000000,
        shipSpeedColony: Math.round(GZFleet.calc.shipSpeed({ speed: 2500, speedTech: 2 }, { 115: 12, 117: 7, 118: 4 })) === 6000 } };
  });
  for (const [k, v] of Object.entries(out.calc.checks)) if (!v) { fail++; console.error('calc check failed', k); }
  // a few hard expectations on the real pages
  const t = out['fleet-real-fleetTable.html'].live;
  const exp = [
    ['real table slots', JSON.stringify(t.slots) === '{"used":1,"max":13}'],
    ['real table exp', JSON.stringify(t.expeditions) === '{"used":0,"max":2}'],
    ['real table asteroids', t.extraCounters.length === 1 && t.extraCounters[0].max === 5],
    ['real flight', t.flights.length === 1 && t.flights[0].fleetId === 396900 && t.flights[0].missionId === 8 &&
      t.flights[0].arrivalUnix === 1793348429 && t.flights[0].returnUnix === 1793350031 && t.flights[0].tzOffsetMs === 7200000],
    ['real ships', t.ships.map((s) => s.id + ':' + s.count + ':' + s.speed + ':' + s.selectable).join() === '208:2:6000:true,210:102:220000000:true,212:797:0:false'],
    ['real s1 token', out['fleet-real-fleetStep1.html'].live.token === 'd583ed8b434e588148fe929b8f939eab'],
    ['real s2 missions', JSON.stringify(out['fleet-real-fleetStep2.html'].live.missions.map((m) => m.id)) === '[7]'],
    ['real s3', out['fleet-real-fleetStep3.html'].live.success && out['fleet-real-fleetStep3.html'].live.consumption === 118],
    ['synthetic error', out['fleet-live-synthetic-error.html'].live.success === false && /deuterium/.test(out['fleet-live-synthetic-error.html'].live.message)],
    ['synthetic table', out['fleet-live-synthetic-fleetTable.html'].live.flights.length === 5 && out['fleet-live-synthetic-fleetTable.html'].live.acs.name === 'AG482913377'],
  ];
  for (const [n, ok] of exp) if (!ok) { fail++; console.error('FAIL', n); }
  await b.close();
  const s = JSON.stringify(out, null, 1);
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(FIX, 'fleet-expected-parse.json'), s + '\n');
  console.log(fail ? 'FAILED ' + fail : 'OK ' + files.length + ' pages + calc');
  process.exit(fail ? 1 : 0);
})();
