'use strict';
// Shared helpers of the PHP comparison (make-golden.js and tests/bot-sim.test.js).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const S = require(path.join(ROOT, 'ogamex-bot/modules/botsim/botsim.js'));
const UNITS = S.unitTable(S.loadCatalog(path.join(ROOT, 'shared/core/08-catalog-data.js')));
const GOLDEN = path.join(ROOT, 'fixtures/bot/sim-golden');
const OUT = path.join(ROOT, 'tests/out/bot-sim-php');

/** Unit table as the PHP harness reads it (ordered list, rf as ordered pairs). */
function unitsForPhp(T) {
  return Object.keys(T).map(Number).sort((a, b) => a - b).map((id) => {
    const u = T[id];
    return { id, metal: u.metal, crystal: u.crystal, deuterium: u.deuterium, attack: u.attack, shield: u.shield, capacity: u.capacity,
      rf: Object.keys(u.rf).map(Number).sort((a, b) => a - b).map((t) => [t, u.rf[t]]) };
  });
}
/** C4 Side -> PHP side (bonusPct becomes tech 0 + factor pct/100, which gives the same multiplier 1 + pct/100). */
function sideForPhp(s, keepOrder) {
  let pairs = Array.isArray(s.units) ? s.units.map((p) => [+p[0], +p[1]]) : Object.keys(s.units || {}).map((k) => [+k, +s.units[k]]);
  pairs = pairs.filter((p) => p[1] > 0 && p[0] !== 502 && p[0] !== 503);
  if (!keepOrder) pairs.sort((a, b) => a[0] - b[0]);
  const f = s.factor || {};
  if (s.bonusPct) {
    const b = s.bonusPct;
    return { tech: { weapons: 0, shielding: 0, armour: 0 }, factor: { Attack: (b.attack || 0) / 100, Defensive: (b.defense || 0) / 100, Shield: (b.shield || 0) / 100, ShipStorage: s.storageFactor || 0 }, units: pairs, carried: s.carried || {} };
  }
  return { tech: s.tech || {}, factor: { Attack: f.Attack || 0, Defensive: f.Defensive || 0, Shield: f.Shield || 0, ShipStorage: f.ShipStorage !== undefined ? f.ShipStorage : (s.storageFactor || 0) }, units: pairs, carried: s.carried || {} };
}
/** Recording / replaying rng wrappers. */
function recorder(seed) {
  const r = S.rng(seed); const numbers = []; const ranges = [];
  return { numbers, ranges, float: r.float, int(min, max) { const v = r.int(min, max); numbers.push(v); ranges.push([min, max]); return v; } };
}
function replayer(numbers, ranges) {
  let i = 0;
  return {
    get used() { return i; },
    float() { throw new Error('float() not expected in battle'); },
    int(min, max) {
      if (i >= numbers.length) throw new Error(`number list exhausted at #${i} rand(${min}, ${max})`);
      if (ranges && (ranges[i][0] !== min || ranges[i][1] !== max)) throw new Error(`call #${i}: JS rand(${min}, ${max}) but list made for rand(${ranges[i]})`);
      return numbers[i++];
    },
  };
}
/** JS side of a case: battle + steal with the attackers' survivors (calculateSteal(simulate) is called whatever the result). */
function runJs(input, rngObj) {
  const b = S.battle({ attackers: input.attackers, defenders: input.defenders, fleetDebrisPct: input.fleetDebrisPct, defDebrisPct: input.defDebrisPct,
    keepOrder: !!input.keepOrder, rng: rngObj, units: UNITS });
  const fleets = input.attackers.map((s, i) => ({ units: b.order.attackers[i], storageFactor: s.bonusPct ? (s.storageFactor || 0) : ((s.factor && s.factor.ShipStorage) || s.storageFactor || 0), carried: s.carried }));
  const steal = S.stealFleets(fleets, input.planet, UNITS);
  return { won: b.won, rounds: b.rounds + 1, attackers: b.order.attackers, defenders: b.order.defenders, debris: b.debrisDetail, unitLost: b.unitLost, steal, battle: b };
}
function phpAvailable() { try { execFileSync('php', ['-v'], { stdio: 'pipe' }); return true; } catch (e) { return false; } }
/** Runs tests/bot-sim-php/run.php on PHP cases, returns its JSON output array. */
function runPhp(phpCases) {
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, 'cases-' + process.pid + '-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify({ cases: phpCases }));
  try {
    return JSON.parse(execFileSync('php', [path.join(__dirname, 'run.php'), f, '--tmp', OUT], { maxBuffer: 1 << 28 }).toString());
  } finally { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
}
function phpCase(name, input, numbers, ranges) {
  return { name, units: unitsForPhp(UNITS), attackers: input.attackers.map((s) => sideForPhp(s, input.keepOrder)), defenders: input.defenders.map((s) => sideForPhp(s, input.keepOrder)),
    FleetTF: input.fleetDebrisPct !== undefined ? input.fleetDebrisPct : 30, DefTF: input.defDebrisPct !== undefined ? input.defDebrisPct : 0, planet: input.planet, numbers, ranges };
}
/** Exact comparison: units/won/rounds equal; debris, unitLost and steal within 1e-9 relative. Returns a list of differences. */
function compare(js, php) {
  const diffs = [];
  const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (php.error) return ['php error: ' + php.error];
  if (js.won !== php.won) diffs.push(`won ${js.won} != ${php.won}`);
  if (js.rounds !== php.rounds) diffs.push(`rounds ${js.rounds} != ${php.rounds}`);
  for (const k of ['attackers', 'defenders']) if (JSON.stringify(js[k]) !== JSON.stringify(php[k])) diffs.push(`${k} ${JSON.stringify(js[k])} != ${JSON.stringify(php[k])}`);
  for (const s of ['attacker', 'defender']) for (const r of ['metal', 'crystal']) if (!close(js.debris[s][r], php.debris[s][r])) diffs.push(`debris.${s}.${r} ${js.debris[s][r]} != ${php.debris[s][r]}`);
  for (const s of ['attacker', 'defender']) if (!close(js.unitLost[s], php.unitLost[s])) diffs.push(`unitLost.${s} ${js.unitLost[s]} != ${php.unitLost[s]}`);
  for (const r of ['metal', 'crystal', 'deuterium']) if (!close(js.steal[r], php.steal[r])) diffs.push(`steal.${r} ${js.steal[r]} != ${php.steal[r]}`);
  return diffs;
}
module.exports = { ROOT, S, UNITS, GOLDEN, OUT, unitsForPhp, sideForPhp, recorder, replayer, runJs, runPhp, phpCase, compare, phpAvailable };
