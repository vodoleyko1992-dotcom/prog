'use strict';
// OGX.botSim (ogamex-bot/modules/botsim/botsim.js) — node-only tests.
//   node tests/bot-sim.test.js          (also run by: node tests/run-all.js bot-sim)
// 1. Golden cases (fixtures/bot/sim-golden, made by tests/bot-sim-php/make-golden.js): the JS battle()/steal() with the stored
//    random-number list equals the stored PHP output exactly, AND the upstream PHP source (tests/bot-sim-php/run.php) is run
//    again on the same lists and must still give that output. php missing or the upstream tree missing = FAIL (never skipped).
// 2. Hand-computed round, PHP round() emulation, raid/expedition statistics, optimizeRaid, spyNeeded, debrisForRecyclers.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const L = require('./bot-sim-php/lib');

const S = L.S;
const U = L.UNITS;
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`ok   ${name} (${Date.now() - t0} ms)`); } catch (e) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n     ${(e && e.stack) || e}`); }
}

function goldens() {
  return fs.readdirSync(L.GOLDEN).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(L.GOLDEN, f), 'utf8')));
}

(async () => {
  await test('contract surface', () => {
    assert.equal(S.version, '1.0.0');
    for (const k of ['rng', 'unitTable', 'loadCatalog', 'battle', 'steal', 'minCapacityForLoot', 'raid', 'optimizeRaid', 'expedition', 'expeditionFind', 'spyNeeded', 'debrisForRecyclers']) assert.equal(typeof S[k], 'function', k);
    const u = U[206];
    assert.deepEqual([u.metal, u.crystal, u.deuterium, u.attack, u.shield, u.hullBase, u.capacity, u.rf[204], u.rf[401], u.isShip, u.isDefense], [20000, 7000, 2000, 400, 50, 2700, 800, 6, 10, true, false]);
    assert.equal(U[407].attack, 0); assert.equal(U[408].attack, 0); assert.equal(U[409].attack, 0);   // domes never shoot
    assert.equal(U[401].isDefense, true);
    assert.equal(U[214].rf[210], 1250);
  });

  await test('rng: deterministic per seed, int() inclusive bounds', () => {
    const a = S.rng(42); const b = S.rng(42); const c = S.rng(43);
    const sa = Array.from({ length: 50 }, () => a.int(0, 1000)); const sb = Array.from({ length: 50 }, () => b.int(0, 1000));
    assert.deepEqual(sa, sb);
    assert.notDeepEqual(sa, Array.from({ length: 50 }, () => c.int(0, 1000)));
    const r = S.rng('x'); const seen = new Set();
    for (let i = 0; i < 5000; i++) { const v = r.int(80, 120); assert.ok(v >= 80 && v <= 120 && Number.isInteger(v)); seen.add(v); }
    assert.equal(seen.size, 41);
    for (let i = 0; i < 1000; i++) { const f = r.float(); assert.ok(f >= 0 && f < 1); }
  });

  // php must be present: the comparison with the upstream source is the point of this suite
  assert.ok(L.phpAvailable(), 'php is not installed: the botSim golden comparison cannot run (install php-cli)');

  await test('phpRound() equals PHP 8 round() (pre-rounding quirk)', () => {
    const r = S.rng('round'); const vals = [2.4999999999999996, 28.499999999999996, 0.49999999999999994, 0.5, 1.5, 2.5, 1e15 + 0.5, 4503599627370495.5, 1e-9];
    for (let i = 0; i < 4000; i++) {
      vals.push(r.int(0, 100000) * (r.int(56, 84) / 100));
      vals.push(r.float() * 1e6);
      vals.push((r.int(0, 1e6) + 0.5) * (1 - 1e-16 * r.int(0, 8)));
      vals.push(r.float() * 1e12 / 100000);
    }
    fs.mkdirSync(L.OUT, { recursive: true });
    const f = path.join(L.OUT, 'round-' + process.pid + '.json');
    fs.writeFileSync(f, JSON.stringify(vals));
    const php = JSON.parse(require('child_process').execFileSync('php', ['-r', '$v=json_decode(file_get_contents($argv[1]));echo json_encode(array_map("round",$v));', f]).toString());
    fs.unlinkSync(f);
    let bad = 0; for (let i = 0; i < vals.length; i++) if (S.phpRound(vals[i]) !== php[i]) { bad++; if (bad < 5) console.log('  round', vals[i], S.phpRound(vals[i]), php[i]); }
    assert.equal(bad, 0);
    assert.equal(S.phpRound(28.499999999999996), 29);   // 50 * (57/100): Math.round gives 28, PHP 29
  });

  const G = goldens();
  await test(`golden cases: >= 30 present (${G.length})`, () => {
    assert.ok(G.length >= 30, 'run node tests/bot-sim-php/make-golden.js');
    const names = G.map((g) => g.name).join(' ');
    for (const k of ['rf-cruiser-vs-lf', 'rf-214-vs-many', 'domes-small-large', 'draw-6-rounds', 'defense-rebuild', 'acs-two-attackers', 'empty-defender', 'attacker-wiped', 'capacity-below-halves', 'steal-metal-eq-deut-11-12', 'gz-213', 'gz-216', 'gz-218', 'gz-217-219-220']) assert.ok(names.includes(k), 'missing case ' + k);
  });

  await test('golden: JS battle()/steal() with the stored numbers == stored PHP output', () => {
    const fails = [];
    for (const g of G) {
      const rep = L.replayer(g.numbers, g.ranges);
      let js;
      try { js = L.runJs(g.input, rep); } catch (e) { fails.push(g.name + ': ' + e.message); continue; }
      if (rep.used !== g.numbers.length) fails.push(`${g.name}: used ${rep.used} of ${g.numbers.length} numbers`);
      const d = L.compare(js, g.expected);
      if (d.length) fails.push(g.name + ': ' + d.slice(0, 3).join('; '));
    }
    assert.deepEqual(fails, []);
  });

  await test('golden: upstream PHP re-run on the stored numbers == stored output (and == JS)', () => {
    const php = L.runPhp(G.map((g) => L.phpCase(g.name, g.input, g.numbers, g.ranges)));
    const fails = [];
    G.forEach((g, i) => {
      const exp = Object.assign({}, php[i]); delete exp.name;
      const d = L.compare({ ...g.expected, steal: g.expected.steal }, exp);
      if (d.length) fails.push(g.name + ': ' + d.slice(0, 3).join('; '));
      if (exp.used !== g.numbers.length) fails.push(g.name + ': PHP used ' + exp.used);
    });
    assert.deepEqual(fails, []);
  });

  await test('golden: the harness detects a different number list (negative control)', () => {
    const g = G.find((x) => x.name === 'acs-two-attackers');
    // every attack roll flipped to the other end of rand(80, 120)
    const nums = g.numbers.map((v, i) => (g.ranges[i][0] === 80 ? (v > 100 ? 80 : 120) : v));
    const [php] = L.runPhp([L.phpCase('neg', g.input, nums, g.ranges)]);
    const js = L.runJs(g.input, L.replayer(nums, g.ranges));
    assert.deepEqual(L.compare(js, php), []);                 // still equal to each other
    assert.notDeepEqual(L.compare(js, g.expected), []);       // but not to the original
    const [short] = L.runPhp([L.phpCase('short', g.input, g.numbers.slice(0, -1), g.ranges.slice(0, -1))]);
    assert.match(short.error, /exhausted/);
  });

  await test('golden: quirks are exercised (rebuild, 11/12 steal, draw after 6 rounds)', () => {
    const by = Object.fromEntries(G.map((g) => [g.name, g]));
    const rb = by['defense-rebuild'];
    const js = L.runJs(rb.input, L.replayer(rb.numbers, rb.ranges));
    assert.ok(Object.values(js.battle.defenders[0].rebuilt).some((n) => n > 0), 'defense rebuilt');
    const st = by['steal-metal-eq-deut-11-12'].expected.steal;
    assert.equal(st.metal + st.crystal + st.deuterium, 110000);   // capacity 120000 = halves, only 11/12 taken
    assert.equal(by['draw-6-rounds-lc-vs-dome'].expected.won, 'w');
    assert.equal(by['draw-6-rounds-lc-vs-dome'].expected.rounds, 7);   // ROUND[0..6]
    assert.equal(by['empty-defender'].expected.won, 'a');
    assert.equal(by['attacker-wiped'].expected.won, 'r');
    const cb = by['capacity-below-halves'].expected.steal;   // 2 LC = 10000 capacity
    assert.ok(Math.abs(cb.metal + cb.crystal + cb.deuterium - 10000) < 1e-6);
  });

  // Hand-computed first round, 10 Light Fighters (204) vs 5 Rocket Launchers (401), all techs 0, rand(80,120) = 100 and
  // rand(0,200) = 100 in round 0:
  //   LF : att = 10·50·1·1.00 = 500, shield = 10·10 = 100, hull = 10·(3000+1000)/10 = 4000
  //   RL : att =  5·80·1·1.00 = 400, shield =  5·20 = 100, hull =  5·(2000+0)/10    = 1000
  //   attacker loss: moc = 10·(400·1)/10 = 400 (no RF on 204 from 401); 100/10 = 10 < 400 -> maxRemove = floor(10·5/10·1) = 5,
  //     moc = 400 − min(100, 400) = 300, remove = min(5, 10·min(300/4000·1.00, 1)) = 0.75 -> ceil(10 − 0.75) = 10 LF
  //   defender loss: moc = 5·(500·1)/5 = 500; 100/5 = 20 < 500 -> maxRemove = floor(5·10/5·1) = 10,
  //     moc = 500 − 100 = 400, remove = min(10, 5·min(400/1000·1.00, 1)) = 2 -> ceil(5 − 2) = 3 RL
  await test('hand-computed round: 10 LF vs 5 RL -> 10 LF, 3 RL after round 0', () => {
    const tail = S.rng('tail'); const head = [100, 100, 100, 100]; const calls = [];
    const rng = { float: tail.float, int(min, max) { calls.push([min, max]); return head.length ? head.shift() : tail.int(min, max); } };
    const b = S.battle({ attackers: [{ units: { 204: 10 } }], defenders: [{ units: { 401: 5 } }], rng, units: U, trace: true });
    assert.deepEqual(calls.slice(0, 4), [[80, 120], [80, 120], [0, 200], [0, 200]]);
    assert.deepEqual(b.trace[1].attackers[0], { 204: 10 });
    assert.deepEqual(b.trace[1].defenders[0], { 401: 3 });
  });

  await test('battle(): missiles excluded, ships sorted before defense, debris/lostValue/moonChance', () => {
    const b = S.battle({ attackers: [{ units: { 207: 100, 202: 5 } }], defenders: [{ units: { 503: 10, 502: 10, 401: 10, 204: 10 } }], seed: 7, units: U });
    assert.deepEqual(b.order.defenders[0].map((p) => p[0]), [204, 401]);
    assert.deepEqual(b.order.attackers[0].map((p) => p[0]), [202, 207]);
    assert.equal(b.won, 'a');
    assert.equal(b.defenders[0].after[204], 0);
    // debris 30 % of lost ships (10 LF = 30000 M + 10000 C) + 0 % defense, no deuterium
    assert.equal(b.debris.metal, 9000 + 0.3 * 45000 * (b.attackers[0].lost[207] || 0) + 0.3 * 2000 * (b.attackers[0].lost[202] || 0));
    assert.equal(b.moonChance, Math.min(Math.round((b.debris.metal + b.debris.crystal) / 100000), 20));
    assert.equal(b.lostValue.defender.metal, 30000 + 2000 * (b.defenders[0].lost[401] || 0));
    const s2 = S.battle({ attackers: [{ units: { 207: 100 } }], defenders: [{ units: { 204: 10 } }], seed: 7, units: U, targetType: 3 });
    assert.equal(s2.moonChance, 0);
  });

  await test('steal(): 5 steps, storage factor, carried cargo, minCapacityForLoot', () => {
    const p = { metal: 1e6, crystal: 6e5, deuterium: 3e5 };
    const big = S.steal({ capacity: 1e7, planet: p });
    assert.deepEqual(big, { metal: 5e5, crystal: 3e5, deuterium: 1.5e5 });
    const s = S.steal({ ships: { 202: 10 }, planet: p, units: U });   // 50000
    assert.ok(Math.abs(s.metal + s.crystal + s.deuterium - 50000) < 1e-6);
    for (const k of ['metal', 'crystal', 'deuterium']) assert.ok(Math.abs(s[k] - 50000 / 3) < 1e-6, k);   // 1/3 each, nothing left for steps 4-5
    const sf = S.steal({ ships: { 202: 10 }, storageFactor: 0.5, carried: { metal: 5000, crystal: 0, deuterium: 0 }, planet: p, units: U });
    assert.ok(Math.abs(sf.metal + sf.crystal + sf.deuterium - (75000 - 5000)) < 1e-6);
    assert.deepEqual(S.steal({ capacity: 0, planet: p }), { metal: 0, crystal: 0, deuterium: 0 });
    // M = D: capacity = sum of halves takes 11/12, the minimum is 12.5 % more
    const md = { metal: 120000, crystal: 0, deuterium: 120000 };
    const st = S.steal({ capacity: 120000, planet: md });
    assert.equal(st.metal + st.crystal + st.deuterium, 110000);
    const need = S.minCapacityForLoot(md);
    assert.equal(need, 135000);
    const ok = S.steal({ capacity: need, planet: md }); assert.ok(ok.metal >= 60000 - 1e-6 && ok.deuterium >= 60000 - 1e-6);
    const no = S.steal({ capacity: need - 1, planet: md }); assert.ok(no.metal < 60000 - 1e-6 || no.deuterium < 60000 - 1e-6);
    assert.equal(S.minCapacityForLoot({ metal: 0, crystal: 0, deuterium: 0 }), 0);
    assert.equal(S.minCapacityForLoot({ metal: 3e6, crystal: 0, deuterium: 0 }), 2250000);   // metal only: step 1 cap/3 + step 4 half of the rest = 2/3 of cap
  });

  const A = { units: { 207: 1000, 206: 2000 }, tech: { weapons: 12, shielding: 12, armour: 12 } };
  const D = { units: { 401: 5000, 402: 3000, 403: 300, 204: 1000 }, tech: { weapons: 10, shielding: 10, armour: 10 } };
  const PL = { metal: 1e7, crystal: 5e6, deuterium: 2e6 };
  await test('raid(): deterministic per seed, stable (±1 %) across seeds with 1000 runs', () => {
    const r1 = S.raid({ attacker: A, defender: D, planet: PL, runs: 200, seed: 9, units: U });
    const r2 = S.raid({ attacker: A, defender: D, planet: PL, runs: 200, seed: 9, units: U });
    assert.deepEqual(r1, r2);
    const rs = [1, 2, 3].map((seed) => S.raid({ attacker: A, defender: D, planet: PL, runs: 1000, seed, units: U }));
    const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
    for (const r of rs.slice(1)) {
      assert.ok(Math.abs(r.win - rs[0].win) <= 0.01, 'win');
      for (const k of ['loot', 'attackerLoss', 'defenderLoss']) assert.ok(rel(r[k].mean.msu, rs[0][k].mean.msu) <= 0.01, k + ' ' + r[k].mean.msu + ' ' + rs[0][k].mean.msu);
      assert.ok(rel(r.debris.mean.metal, rs[0].debris.mean.metal) <= 0.01, 'debris');
    }
    const r = rs[0];
    assert.ok(r.win + r.draw + r.loss > 0.999999);
    assert.ok(r.debris.p10.metal <= r.debris.p50.metal && r.debris.p50.metal <= r.debris.p90.metal);
    assert.ok(Math.abs(r.net.mean - (r.loot.mean.msu - r.attackerLoss.mean.msu)) < 1e-3);
    const withFuel = S.raid({ attacker: A, defender: D, planet: PL, runs: 50, seed: 1, units: U, fuel: 1000 });
    const noFuel = S.raid({ attacker: A, defender: D, planet: PL, runs: 50, seed: 1, units: U });
    assert.ok(Math.abs(noFuel.net.mean - withFuel.net.mean - 3000) < 1e-6);   // fuel is deuterium x rates.d
    assert.ok(r.survivors.mean[207] > 0);
  });

  await test('optimizeRaid(): undefended -> cargo only (tried 0), default loot carriers = Battle Transporters 217 only', () => {
    const o = S.optimizeRaid({ defender: { units: {} }, planet: { metal: 4e6, crystal: 2e6, deuterium: 1e6 }, available: { 202: 1000, 203: 300, 204: 500, 217: 5 }, units: U, seed: 1 });
    assert.equal(o.ok, true);
    assert.equal(o.tried, 0);
    const ids = Object.keys(o.ships).map(Number);
    assert.deepEqual(ids, [217], 'John\'s rule: 202/203 are never picked as loot carriers');
    // no 217 at all: no fallback to 202/203
    const none = S.optimizeRaid({ defender: { units: {} }, planet: { metal: 4e6, crystal: 2e6, deuterium: 1e6 }, available: { 202: 1000, 203: 300 }, units: U, seed: 1 });
    assert.equal(none.ok, false); assert.deepEqual(none.ships, {});
    const cap = U[ids[0]].capacity * o.ships[ids[0]];
    assert.ok(cap >= S.minCapacityForLoot({ metal: 4e6, crystal: 2e6, deuterium: 1e6 }));
    assert.equal(o.sim.win, 1);
    assert.ok(/без защиты/.test(o.why));
    // not enough cargo, build allowance -> missing
    const m = S.optimizeRaid({ defender: { units: {} }, planet: { metal: 4e6, crystal: 2e6, deuterium: 1e6 }, available: { 203: 10 }, maxShips: { 203: 1000 }, cargoIds: [203], units: U });
    assert.ok(m.missing[203] > 0 && m.ships[203] === 10 + m.missing[203]);
  });

  await test('optimizeRaid(): defended target -> fleet with win >= 0.99', () => {
    const def = { units: { 401: 300, 402: 150, 403: 20 }, tech: { weapons: 8, shielding: 8, armour: 8 } };
    const planet = { metal: 2e7, crystal: 1e7, deuterium: 5e6 };
    const o = S.optimizeRaid({ defender: def, planet, available: { 202: 5000, 203: 2000, 217: 50, 204: 20000, 206: 3000, 207: 1500 }, attackerTech: { weapons: 10, shielding: 10, armour: 10 },
      combatIds: [204, 206, 207], units: U, seed: 3, runs: 60, winMin: 0.99 });
    assert.equal(o.ok, true, o.why);
    assert.ok(o.tried > 0);
    assert.ok(o.sim.win >= 0.99);
    const check = S.raid({ attacker: { units: o.ships, tech: { weapons: 10, shielding: 10, armour: 10 } }, defender: def, planet, runs: 400, seed: 77, units: U });
    assert.ok(check.win >= 0.97, 'independent check win ' + check.win);
    assert.ok(check.loot.mean.msu > check.attackerLoss.mean.msu);
    assert.deepEqual(o.missing, {});
    assert.ok(/победа/.test(o.why));
    // impossible: only 5 light fighters available
    const bad = S.optimizeRaid({ defender: def, planet, available: { 202: 100, 204: 5 }, combatIds: [204], units: U, seed: 3, runs: 30 });
    assert.equal(bad.ok, false); assert.ok(/Нет подходящего состава/.test(bad.why));
  });

  await test('optimizeRaid(): confirmation pass enforces winMin (60-run lucky seeds are not accepted)', () => {
    // verify-r2 case: 203x90 + 204x4 vs 10x401 (tech 5/5/5, attacker bonus 100 %) won 60/60 at one seed, true win 0.955
    const def = { units: { 401: 10 }, tech: { weapons: 5, shielding: 5, armour: 5 } };
    const planet = { metal: 3e6, crystal: 1.5e6, deuterium: 5e5 };
    const bonusPct = { attack: 100, defense: 100, shield: 100 };
    const four = S.raid({ attacker: { units: { 203: 90, 204: 4 }, bonusPct }, defender: def, planet, runs: 2000, seed: 'r', units: U });
    assert.ok(four.win < 0.98, 'the reported fleet really is below winMin: ' + four.win);
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const o = S.optimizeRaid({ defender: def, planet, available: { 203: 500, 204: 300 }, cargoIds: [203], attackerTech: { bonusPct }, combatIds: [204, 205, 206, 207], units: U, seed, runs: 60, winMin: 0.99 });
      assert.equal(o.ok, true, o.why);
      assert.ok(o.sim.runs >= 400, 'the accepted sim is the confirmation pass: ' + o.sim.runs);
      assert.ok(/400 боёв/.test(o.why), o.why);
      const chk = S.raid({ attacker: { units: o.ships, bonusPct }, defender: def, planet, runs: 2000, seed: 'chk' + seed, units: U });
      assert.ok(chk.win >= 0.985, seed + ': independent 2000-run check ' + chk.win + ' for ' + JSON.stringify(o.ships));
    }
  });

  await test('expedition(): event frequencies 1/9 ±1 % over 90k runs; find = min(free, Σ(M+C))', () => {
    const ships = { 202: 10, 210: 1 };
    const e = S.expedition({ ships, runs: 90000, seed: 5, units: U, attackerTech: { weapons: 10, shielding: 10, armour: 10 } });
    for (const k of ['resources', 'darkMatter', 'ships', 'battle', 'blackHole', 'time']) assert.ok(Math.abs(e.freq[k] - 1 / 9) <= 0.01, k + ' ' + e.freq[k]);
    assert.ok(Math.abs(e.freq.nothing - 3 / 9) <= 0.01);
    assert.equal(e.probs.blackHole, 1 / 9);
    // 10 LC (2000+2000) + 1 probe (0+1000) = 41000 = 200·points ; free cargo 10·5000 + 5 = 50005
    assert.equal(e.find.capByPoints, 41000); assert.equal(e.find.capByCargo, 50005);
    assert.deepEqual(S.expeditionFind({ ships, units: U }), { free: 50005, points: 205, max: 41000 });
    assert.equal(S.expeditionFind({ ships: { 203: 10 }, units: U }).max, 120000);                 // Σ(M+C) 120000 < 250000
    assert.equal(S.expeditionFind({ ships: { 204: 10 }, units: U }).max, 500);                    // free cargo 500 < 40000
    assert.equal(S.expeditionFind({ ships: { 202: 10 }, cargoOnBoard: 45000, units: U }).max, 5000);
    // every resource find equals the cap: E[find total] = P(resources) · 41000
    const tot = e.find.expected.metal + e.find.expected.crystal + e.find.expected.deuterium;
    assert.ok(Math.abs(tot - e.freq.resources * 41000) < 1e-6);
    assert.ok(Math.abs(e.find.expected.metal / tot - 0.5) < 0.03 && Math.abs(e.find.expected.deuterium / tot - 1 / 6) < 0.03);
    assert.ok(e.dm.expected > 0.11 * 100 * 0.9 && e.dm.expected < 1 / 9 * 600);
    assert.equal(e.blackHoleLoss.msu, 10 * (2000 + 2000 * 1.5) + 1000 * 1.5);
    assert.ok(e.shipsFound.expected[202] > 0 && !e.shipsFound.expected[209]);
    assert.ok(e.time.slowShare > 0.7 && e.time.slowShare < 0.8);
    const e2 = S.expedition({ ships, runs: 500, seed: 5, units: U });
    assert.deepEqual(e2, S.expedition({ ships, runs: 500, seed: 5, units: U }));
  });

  await test('spyNeeded(): MissionCaseSpy thresholds', () => {
    // Δ = +2 (we are better): MinAmount = −4 -> research needs −4+5 = 1 probe
    assert.equal(S.spyNeeded({ ourSpy: 10, theirSpy: 8, want: 'research' }), 1);
    assert.equal(S.spyNeeded({ ourSpy: 10, theirSpy: 8, want: 'ships' }), 1);
    // Δ = −1: MinAmount = +1 -> fleet 1, defense 2, buildings 4, research 6
    assert.equal(S.spyNeeded({ ourSpy: 7, theirSpy: 8, want: 'ships' }), 1);
    assert.equal(S.spyNeeded({ ourSpy: 7, theirSpy: 8, want: 'defense' }), 2);
    assert.equal(S.spyNeeded({ ourSpy: 7, theirSpy: 8, want: 'buildings' }), 4);
    assert.equal(S.spyNeeded({ ourSpy: 7, theirSpy: 8, want: 'research' }), 6);
    // Δ = −3: MinAmount = 9 -> research 14 ; equal techs: research 5
    assert.equal(S.spyNeeded({ ourSpy: 5, theirSpy: 8, want: 'research' }), 14);
    assert.equal(S.spyNeeded({ ourSpy: 8, theirSpy: 8, want: 'research' }), 5);
    // spy tech 0 counts as 1
    assert.equal(S.spyNeeded({ ourSpy: 0, theirSpy: 1, want: 'defense' }), 1);
    // SpyPower: n·(1+power) >= 14 -> with +100 %: 7 probes
    assert.equal(S.spyNeeded({ ourSpy: 5, theirSpy: 8, spyPower: 1, want: 'research' }), 7);
  });

  await test('debrisForRecyclers()', () => {
    assert.equal(S.debrisForRecyclers({ metal: 0, crystal: 0 }), 0);
    assert.equal(S.debrisForRecyclers({ metal: 100000, crystal: 80000 }), 10);              // 180000·1.1/20000 = 9.9
    assert.equal(S.debrisForRecyclers({ metal: 100000, crystal: 100000 }, { marginPct: 0 }), 10);
    assert.equal(S.debrisForRecyclers({ metal: 100000, crystal: 100000 }, { marginPct: 0, storageFactor: 0.5 }), 7);
    assert.equal(S.debrisForRecyclers({ metal: 5e8, crystal: 2e8 }, { cap: 200000000, marginPct: 10 }), 4);  // 219 battle recycler
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
