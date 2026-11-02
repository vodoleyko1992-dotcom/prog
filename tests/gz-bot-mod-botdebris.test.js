'use strict';
// botdebris pure rules (no browser): module definition and C5 defaults, recycler count (residual, margin, float noise), the aim inside
// the arrival window, cheapest-fuel speed with the 90 s lead, origin order for battles and own fields, transport ship count with fuel
// in the hold, D > C > M payload, recycling report text, battle field = existing + p50. Loaded in a vm sandbox with OGX.botSim.
//   node tests/gz-bot-mod-botdebris.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'ogamex-bot', 'modules', 'botdebris', 'botdebris.js');
const SIM = require(path.join(ROOT, 'ogamex-bot', 'modules', 'botsim', 'botsim.js'));
function load() {
  const mods = [];
  const window = { OGX: { module: (def) => mods.push(def), botSim: SIM } };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { window, setTimeout, clearTimeout, console }, { filename: FILE });
  const L = {};
  for (const [k, v] of Object.entries(window.OGX.botDebris._lib)) L[k] = (...a) => { const r = v(...a); return r === undefined || r === null ? r : JSON.parse(JSON.stringify(r)); };
  return { L, mods: mods.map((m) => Object.assign({}, m, { settings: JSON.parse(JSON.stringify(m.settings)) })), OGX: window.OGX };
}

T.test('ship rules (BOT_CONTRACT C10): debris only in Battle Recyclers 219, transports only in Battle Transporters 217', () => {
  const lib = load().OGX.botDebris._lib;
  assert.equal(lib.REC, 219, 'recycler = 219, never 209');
  assert.equal(lib.TRANSPORT, 217, 'transport = 217, never 202/203');
  const src = fs.readFileSync(path.join(__dirname, '..', 'ogamex-bot', 'modules', 'botdebris', 'botdebris.js'), 'utf8');
  assert.ok(!/\b(202|203|209)\b/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'no 202 / 203 / 209 in the code');
});

T.test('module definition: name, title, every contract C5 setting with its default, everything on (0.3.2)', () => {
  const { mods, OGX } = load();
  assert.equal(mods.length, 1);
  const m = mods[0];
  assert.equal(m.name, 'botdebris'); assert.equal(m.title, 'Бот: обломки и логистика');
  const want = { on: true, followBattles: true, arriveMinSec: 1, arriveMaxSec: 2, marginPct: 10, keepResidual: true, residual: 1000, postBattle: true, ownDf: true,
    minOwnDf: 10000000, checkMinMin: 30, checkMaxMin: 60, minBattleDf: 1000000, logistics: true, logisticsOrigin: '', deutReserveH: 2, repatriate: true,
    repatriateMin: 500000000, overflowPct: 90 };
  assert.deepEqual(Object.keys(m.settings).sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) assert.deepEqual(m.settings[k].default, v, k);
  for (const [k, d] of Object.entries(m.settings)) assert.ok(/[а-яё]/i.test(d.label), 'russian label ' + k);
  assert.equal(OGX.botDebris.version, '1.0.0');
  assert.equal(typeof m.init, 'function');
});

T.test('recycler count: ceil((field - residual)/cap) + metal ballast on farm targets (exactly the residual stays), whole field otherwise (integer-exact); deuterium never counts', () => {
  const { L } = load();
  const f = { metal: 3001000, crystal: 1000000 };
  const sizer = (amount, o) => L.simRecyclers(amount, o.cap, o.marginPct);
  assert.deepEqual(L.recyclersFor({ field: f, residual: 1000, keep: true, cap: 20000, marginPct: 10, sizer }), { total: 4001000, target: 4000000, n: 200, keep: true, ballast: 0, nFloor: 200 },
    'keepResidual: ceil x 1.1 = 220 would harvest all 4 001 000 -> 200 x 20 000 = 4 000 000 leaves exactly the residual, no ballast');
  const r24 = L.recyclersFor({ field: { metal: 24000, crystal: 0 }, residual: 1000, keep: true, cap: 20000, marginPct: 10, sizer });
  assert.deepEqual([r24.n, r24.ballast, r24.nFloor], [2, 17000, 1], '24 000 field: 2 recyclers + 17 000 ballast harvest 23 000 and leave 1 000 (1 recycler would leave 4 000)');
  // verify-r2 case: predicted 48 000 + residual 1 000 -> 3 recyclers with 12 000 ballast instead of 2 (which left ~9 000)
  const r49 = L.recyclersFor({ field: { metal: 33000, crystal: 16000 }, residual: 1000, keep: true, cap: 20000, marginPct: 10, sizer });
  assert.deepEqual([r49.target, r49.n, r49.ballast], [48000, 3, 12000]);
  assert.equal(L.recyclersFor({ field: { metal: 24000, crystal: 0 }, residual: 1000, keep: true, cap: 20000, marginPct: 10, sizer, ballast: false }).n, 1, 'ballast off: floor keeps 4 000');
  // ballast limits: the hold after fuel (step 3) and the origin's metal
  assert.deepEqual(L.ballastFor({ n: 3, cap: 20000, target: 48000, fuel: 300, metal: 1e6 }), { n: 3, ballast: 12000 });
  assert.equal(L.ballastFor({ n: 3, cap: 20000, target: 48000, fuel: 48500, metal: 1e6 }), null, 'fuel + ballast over the hold');
  assert.equal(L.ballastFor({ n: 3, cap: 20000, target: 48000, fuel: 0, metal: 5000 }), null, 'not enough metal');
  assert.deepEqual(L.ballastFor({ n: 3, cap: 20000, target: 48000, fuel: 0, metal: null }), { n: 3, ballast: 12000 }, 'unknown stock: the server min()s the load');
  assert.equal(L.recyclersFor({ field: { metal: 24000, crystal: 0 }, residual: 1000, keep: false, cap: 20000, marginPct: 10, sizer }).n, 2, 'no residual: ceil + margin');
  assert.equal(L.recyclersFor({ field: f, residual: 1000, keep: false, cap: 20000, marginPct: 10, sizer }).n, 221, 'ceil(4001000 x 1.1 / 20000) = 220.06 -> 221');
  assert.equal(SIM.debrisForRecyclers({ metal: 4000000, crystal: 0 }, { cap: 20000, marginPct: 10 }), 220, 'the module agrees with OGX.botSim.debrisForRecyclers');
  assert.equal(L.simRecyclers(4000000, 20000, 10), 220, 'exact integer check');
  assert.equal(L.simRecyclers(4000001, 20000, 10), 221);
  assert.equal(L.simRecyclers(2999000, 20000, 10), 165);
  assert.equal(L.simRecyclers(1, 20000, 10), 1);
  assert.equal(L.simRecyclers(4000000, 30000, 0), 134, 'Storage expert cap (state.shipStats incl. 607) and no margin');
  assert.equal(L.recyclersFor({ field: { metal: 900, crystal: 0 }, residual: 1000, keep: true, cap: 20000, marginPct: 10, sizer }).n, 0, 'only the residual: nothing to send');
  assert.equal(L.recyclersFor({ field: { metal: 1e6, crystal: 0, deuterium: 5e6 }, cap: 20000, marginPct: 0, sizer }).total, 1e6, 'no deuterium in debris (F4)');
  // battle field = existing + p50 (mean only when p50 is missing)
  assert.deepEqual(L.battleField({ existingDebris: { metal: 1000, crystal: 0 }, debris: { metal: 9, crystal: 9, p50: { metal: 300, crystal: 200 } } }).field, { metal: 1300, crystal: 200 });
  assert.deepEqual(L.battleField({ existingDebris: null, debris: { metal: 50, crystal: 60 } }).field, { metal: 50, crystal: 60 });
});

T.test('moon risk [UPSTREAM MissionCaseAttack:341-386]: a new moon erases the whole field; chance = min(round(new debris/100000), 20) on a planet without a moon', () => {
  const { L } = load();
  const B = (extra) => Object.assign({ target: { galaxy: 2, system: 68, position: 10, type: 1 }, existingDebris: { metal: 4e6, crystal: 0 }, debris: { metal: 0, crystal: 0, p50: { metal: 1.2e6, crystal: 0.3e6 } } }, extra);
  assert.equal(L.moonPctOf(B(), { metal: 1.2e6, crystal: 0.3e6 }), 15, 'round(1.5e6/1e5) = 15 (only the NEW debris counts)');
  assert.equal(L.moonPctOf(B(), { metal: 9e6, crystal: 0 }), 20, 'capped at moon_chance 20');
  assert.equal(L.moonPctOf(B({ targetHasMoon: true }), { metal: 9e6, crystal: 0 }), 0, 'planet with a moon: no chance');
  assert.equal(L.moonPctOf(B({ target: { galaxy: 2, system: 68, position: 10, type: 3 } }), { metal: 9e6, crystal: 0 }), 0, 'moon target');
  const F = L.battleField(B());
  assert.deepEqual(F.field, { metal: 5.2e6, crystal: 0.3e6 }, 'sizing field unchanged (no moon outcome)');
  assert.equal(F.moonPct, 15);
  assert.deepEqual(F.expected, { metal: 5.2e6 * 0.85, crystal: 0.3e6 * 0.85 }, 'existing + new, both lost with the moon');
  assert.equal(L.battleField(B({ targetHasMoon: true })).moonPct, 0);
  // pre-send only while the expected harvest pays the fuel spent in every outcome
  assert.equal(L.preWorthIt({ harvest: 1e6, moonPct: 20, fuel: 1000, rateD: 3 }).ok, true);
  assert.equal(L.preWorthIt({ harvest: 10000, moonPct: 20, fuel: 1000, rateD: 3 }).ok, false, '8000 expected < 3 x 3000');
  assert.equal(L.preWorthIt({ harvest: 10000, moonPct: 0, fuel: 1000, rateD: 3 }).ok, true, 'no moon risk: unchanged behaviour');
  // pre-send minimum on the moon-discounted expectation (minBattleDf, default 1 M)
  const F15 = L.battleField(B());
  assert.deepEqual(L.preMinOk(F15, 1000000), { ok: true, expected: Math.round((5.2e6 + 0.3e6) * 0.85), min: 1000000 });
  assert.equal(L.preMinOk(F15, 5e6).ok, false, '5.5 M x 0.85 = 4.675 M < 5 M: no pre-send');
  assert.equal(L.preMinOk(L.battleField(B({ targetHasMoon: true })), 5e6).ok, true, 'a planet with a moon: no discount, 5.5 M >= 5 M');
  assert.equal(L.preMinOk(L.battleField(B()), 0).ok, true, 'minimum 0: always');
});

T.test('arrival aim: middle of [battle + min, battle + max] (absorbs ±1 s); wider windows jitter with a 1 s margin', () => {
  const { L } = load();
  assert.equal(L.aimSec(1, 2), 2, 'window [1, 3) s -> 2.0');
  assert.equal(L.aimSec(1, 1), 1.5);
  assert.equal(L.aimSec(1, 5, () => 0), 2, 'window [1, 6) s: center 3.5, jitter ±1.5 -> 2.0 .. 5.0');
  assert.equal(L.aimSec(1, 5, () => 1), 5);
  assert.equal(L.aimSec(1, 5, () => 0.5), 3.5);
  // precise tolerance: step 3 processed after the end of second battle + arriveMaxSec would arrive one second too late
  const B0 = 1793438580 * 1000;
  assert.equal(L.preTolMs({ battleArrival: B0, wantArrival: B0 + 2000 }, 2), 750, 'aim +2.0 s, window ends +3.0 s, 250 ms transit margin');
  assert.equal(L.preTolMs({ battleArrival: B0 + 400, wantArrival: B0 + 2000 }, 2), 750, 'battle second, not the battle ms');
  assert.equal(L.preTolMs({ battleArrival: B0, wantArrival: B0 + 3500 }, 5), 1000, 'never more than 1 s');
  assert.equal(L.preTolMs({ battleArrival: B0, wantArrival: B0 + 2950 }, 2), 100, 'at least 100 ms');
});

T.test('pre-send speed: cheapest fuel whose departure is >= now + 90 s; none -> null (post-battle)', () => {
  const { L } = load();
  // duration halves the speed roughly; fuel grows with speed
  const durOf = (s) => Math.round(270 / s);
  const fuelOf = (s) => s * s * 10;
  const now = 0; const arrivalWanted = 150000;
  const a = L.chooseSpeed({ arrivalWanted, now, durOf, fuelOf });
  // D = 150 s - dur: speed 1 -> 150-270 < 90 no; 2 -> 150-135 = 15 no; 3 -> 60 no; 4 -> 150-68 = 82 no; 5 -> 96 ok (fuel 250)
  assert.equal(a.speed, 5); assert.equal(a.departAt, 150000 - 54000); assert.equal(a.fuel, 250);
  assert.equal(a.alternatives.length, 10);
  assert.equal(L.chooseSpeed({ arrivalWanted: 120000, now, durOf, fuelOf }).speed, 9, 'D = 120 - 30 = 90 s at 90 % (cheaper than 100 %: 93 s)');
  const b = L.chooseSpeed({ arrivalWanted: 100000, now, durOf, fuelOf });
  assert.equal(b, null, 'even 100 % leaves less than 90 s');
  const c = L.chooseSpeed({ arrivalWanted: 150000, now, durOf, fuelOf, maxFuel: 200 });
  assert.equal(c, null, 'not enough deuterium for any valid speed');
  const d = L.chooseSpeed({ arrivalWanted: 1e7, now, durOf, fuelOf });
  assert.equal(d.speed, 1, 'far battle: 10 % is the cheapest');
});

T.test('origins: battle = nearest with enough (moon first on ties, else the most); own field = moon full > moon any > planet full > planet any', () => {
  const { L } = load();
  const P = (id, coords) => ({ id, key: 'p' + id, type: 'planet', coords });
  const Mn = (id, coords) => ({ id, key: 'm' + id, type: 'moon', coords });
  const c = (body, have, distance, fuelOk = true) => ({ body, have, distance, fuelOk });
  const pl = P(1, '2:68:5'); const mo = Mn(2, '2:68:5'); const far = P(3, '2:70:8');
  assert.equal(L.pickBattleOrigin([c(pl, 300, 1025), c(mo, 300, 1025), c(far, 500, 2890)], 220).origin.body.id, 2, 'moon on a tie');
  assert.equal(L.pickBattleOrigin([c(pl, 300, 1025), c(mo, 100, 1025), c(far, 500, 2890)], 220).origin.body.id, 1, 'nearest with enough');
  assert.equal(L.pickBattleOrigin([c(pl, 300, 1025, false), c(far, 500, 2890)], 220).origin.body.id, 3, 'no fuel -> next');
  const short = L.pickBattleOrigin([c(pl, 100, 1025), c(far, 150, 2890)], 220);
  assert.equal(short.full, false); assert.equal(short.origin.body.id, 3, 'none has enough: the body with most');
  assert.equal(L.pickBattleOrigin([], 1), null);
  // own field: a moon with some recyclers comes before a planet with all of them
  assert.equal(L.pickOwnOrigin([c(pl, 3000, 10), c(mo, 10, 10), c(far, 3000, 5)], 2000).origin.body.id, 2);
});

T.test('own-field origin order exactly as the spec', () => {
  const { L } = load();
  const P = (id) => ({ id, key: 'p' + id, type: 'planet', coords: '2:68:' + id });
  const Mn = (id) => ({ id, key: 'm' + id, type: 'moon', coords: '2:68:' + id });
  const c = (body, have, distance) => ({ body, have, distance, fuelOk: true });
  const all = [c(P(1), 3000, 5), c(P(2), 10, 5), c(Mn(3), 10, 50), c(Mn(4), 3000, 99)];
  assert.equal(L.pickOwnOrigin(all, 2000).origin.body.id, 4, 'moon full');
  assert.equal(L.pickOwnOrigin(all.slice(0, 3), 2000).origin.body.id, 3, 'moon any');
  assert.equal(L.pickOwnOrigin(all.slice(0, 2), 2000).origin.body.id, 1, 'planet full');
  assert.equal(L.pickOwnOrigin([all[1]], 2000).origin.body.id, 2, 'planet any');
  assert.equal(L.pickOwnOrigin([c(P(6), 10, 1), c(P(7), 300, 2)], 2000).origin.body.id, 7, 'inside «any»: most recyclers first');
  assert.equal(L.pickOwnOrigin([c(P(6), 3000, 2), c(P(7), 5000, 1)], 2000).origin.body.id, 7, 'inside «full»: nearest');
  assert.equal(L.pickOwnOrigin([c(P(5), 0, 1)], 1), null);
});

T.test('transport: smallest n with cargo + fuel(n) <= n x cap; D > C > M payload; recycling report text', () => {
  const { L } = load();
  const t = L.transportShips({ load: { metal: 1000000, crystal: 500000, deuterium: 0 }, cap: 25000, fuelOf: (n) => 30 * n + 1 });
  assert.equal(t.n, 61, '1 500 000 + fuel(60) = 1 501 801 > 1 500 000 -> 61');
  assert.equal(t.fuel, 30 * 61 + 1);
  assert.equal(L.transportShips({ load: { metal: 10, crystal: 0, deuterium: 0 }, cap: 25000, fuelOf: () => 5 }).n, 1);
  assert.equal(L.transportShips({ load: { metal: 0, crystal: 0, deuterium: 0 }, cap: 25000, fuelOf: () => 5 }), null, 'never an empty transport (A4)');
  assert.deepEqual(L.payloadDCM({ metal: 500, crystal: 300, deuterium: 200 }, 450), { metal: 0, crystal: 250, deuterium: 200 });
  assert.deepEqual(L.payloadDCM({ metal: 500, crystal: 300, deuterium: 200 }, 5000), { metal: 500, crystal: 300, deuterium: 200 });
  assert.deepEqual(L.harvestFromText('Having arrived at there destination your Recyclers collect 3.001.000 Metal and 1.000.000 Crystal'), { metal: 3001000, crystal: 1000000 });
  assert.deepEqual(L.harvestFromText('Your Recycler (220 ships) have a total storage capacity of 4,400,000. At the target [2:68:10], 3,001,000 Metal, 1,000,000 Crystal and 0 Deuterium are floating in space. You have harvested 3,001,000 Metal, 1,000,000 Crystal and 0 Deuterium.'), { metal: 3001000, crystal: 1000000 });
  assert.equal(L.harvestFromText('Your fleet returns'), null);
  assert.equal(L.coordsOf('[2:68:10]'), '2:68:10'); assert.equal(L.coordsOf({ galaxy: 2, system: 68, planet: 7 }), '2:68:7');
});

T.test('logistics load (needLoad): the chain need up to the spare, never below the waiting step (min); short -> null with the shortfall', () => {
  const { L } = load();
  const need = { res: { metal: 900, crystal: 500, deuterium: 0 }, min: { metal: 300, crystal: 100, deuterium: 0 } };
  assert.deepEqual(L.needLoad(need, { metal: 5000, crystal: 5000, deuterium: 5000 }), { load: { metal: 900, crystal: 500, deuterium: 0 }, short: {} }, 'whole chain in one trip');
  assert.deepEqual(L.needLoad(need, { metal: 400, crystal: 5000, deuterium: 0 }), { load: { metal: 400, crystal: 500, deuterium: 0 }, short: {} }, 'capped by the spare, the step is covered');
  assert.deepEqual(L.needLoad(need, { metal: 200, crystal: 5000, deuterium: 0 }), { load: null, short: { metal: 100 } }, 'the step itself is not covered');
  assert.deepEqual(L.needLoad({ res: { metal: 10, crystal: 0, deuterium: 0 } }, { metal: 5, crystal: 0, deuterium: 0 }).short, { metal: 5 }, 'old needs without min: all-or-nothing');
});

/** Fake runtime for ownStep / sourcesFor (no browser). */
function fakeRun(OGX, o = {}) {
  const calls = { act: [], rec: [] };
  let now = o.now || 1793500000000;
  OGX.bot = { randMs: ([a]) => a, msu: (r) => (r.metal || 0) + (r.crystal || 0) * 2 + (r.deuterium || 0) * 3, needs: { list: () => o.needs || [] } };
  OGX.galaxy = { cached: async () => o.cache || null };
  const wctx = {
    now: () => now, cfg: (k) => Object.assign({ checkMinMin: 30, checkMaxMin: 60, minOwnDf: 10000000, deutReserveH: 2 }, o.cfg || {})[k], core: (k) => ({ galaxyViewsPerHour: 200 }[k]),
    decide: () => {}, rec: (k, w, d) => calls.rec.push({ k, w, d }),
    act: async (a) => { calls.act.push(a); return { ok: true, data: { system: { t: now, positions: [] } } }; },
    available: (key) => Object.assign({ metal: 0, crystal: 0, deuterium: 0 }, (o.avail || {})[key]), locked: () => null,
  };
  return { wctx, calls, at: (t) => { now = t; } };
}

T.test('own debris fields: one galaxy read per system per checkMinMin (planets of one system = one read), even when woken every few seconds', async () => {
  const { OGX } = load();
  const M = OGX.botDebris._M;
  M.meta = {}; M.seen = {}; M.own = {}; M.plans = {};
  const T0 = 1793500000000;
  const R = fakeRun(OGX, { now: T0, cache: { t: T0 - 5 * 3600000, positions: [] } });   // the cache is 5 h old (preview 2: never refreshed by bot reads)
  const env = { bodies: { p1: { key: 'p1', id: 1, coords: '2:68:5' }, p2: { key: 'p2', id: 2, coords: '2:68:6' }, p3: { key: 'p3', id: 3, coords: '2:68:9' } }, flights: [] };
  await OGX.botDebris._ownStep(R.wctx, env);
  assert.equal(R.calls.act.filter((a) => a.type === 'read.galaxy').length, 1, 'three planets in 2:68: one read');
  for (let i = 1; i <= 20; i++) { R.at(T0 + i * 5000); await OGX.botDebris._ownStep(R.wctx, env); }
  assert.equal(R.calls.act.length, 1, 'woken every 5 s for 100 s: no second read (the read result counts as fresh data)');
  // the read result is lost (e.g. reload: no data in memory) -> still no read before checkMinMin
  M.seen = {};
  R.at(T0 + 20 * 60000); await OGX.botDebris._ownStep(R.wctx, env);
  assert.equal(R.calls.act.length, 1, 'within checkMinMin of the last read: no read');
  R.at(T0 + 31 * 60000); await OGX.botDebris._ownStep(R.wctx, env);
  assert.equal(R.calls.act.length, 2, 'after checkMinMin with stale data: one read');
  // data of a bot scan seen on the bus (any module) is used as fresh: no read
  M.seen = { '2:68': { t: T0 + 70 * 60000, positions: [{ position: 6, debris: { metal: 2e7, crystal: 0 } }] } };
  R.at(T0 + 75 * 60000); await OGX.botDebris._ownStep(R.wctx, env).catch(() => {});
  assert.equal(R.calls.act.filter((a) => a.type === 'read.galaxy').length, 2, 'fresh bus data: no read');
  assert.ok(R.calls.rec.some((r) => r.k === 'harvest-own' && /2:68:6/.test(r.w)), 'the field from the bus data is found');
});

T.test('logistics sources: the body with the largest spare first; spare = available − its own plan keep − deuterium reserve; bodies with an open need never give', () => {
  const { OGX } = load();
  const R = fakeRun(OGX, { avail: { p1: { metal: 1e9, crystal: 1e9, deuterium: 1e9 }, p2: { metal: 3e9, crystal: 3e9, deuterium: 3e9 }, p3: { metal: 9e9, crystal: 9e9, deuterium: 9e9 }, p4: { metal: 5e9, crystal: 5e9, deuterium: 5e9 } } });
  const b = (id) => ({ key: 'p' + id, id, coords: '2:68:' + (4 + id), res: { deuterium: { amount: 1, perHour: 1e6, storage: 1e10 } } });
  const env = { bodies: { p1: b(1), p2: b(2), p3: b(3), p4: b(4) } };
  const keeps = { p2: { metal: 2.5e9, crystal: 2.5e9, deuterium: 2.5e9 } };
  const S = OGX.botDebris._sourcesFor(R.wctx, env, env.bodies.p1, null, new Set(['p1', 'p3']), keeps);
  assert.deepEqual(JSON.parse(JSON.stringify(S.map((c) => c.body.key))), ['p4', 'p2'], 'p3 has an open need, p1 is the target; p4 has the largest spare');
  assert.equal(S[1].spare.metal, 5e8, 'p2 keeps its own chain');
  assert.equal(S[0].spare.deuterium, 5e9 - 2e6, 'deuterium reserve 2 h x 1 M/h');
  const O = OGX.botDebris._sourcesFor(R.wctx, env, env.bodies.p1, env.bodies.p2, new Set(), keeps);
  assert.deepEqual(JSON.parse(JSON.stringify(O.map((c) => c.body.key))), ['p2'], 'the configured store only');
});
