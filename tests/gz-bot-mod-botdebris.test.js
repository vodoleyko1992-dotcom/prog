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
  assert.ok(!/cls:\s*'force'/.test(src), 'no slot class force: the slot botcore keeps in reserve belongs to the fleet save (debris-save-2)');
});

T.test('module definition: name, title, every contract C5 setting with its default, everything on (0.3.2)', () => {
  const { mods, OGX } = load();
  assert.equal(mods.length, 1);
  const m = mods[0];
  assert.equal(m.name, 'botdebris'); assert.equal(m.title, 'Бот: обломки и логистика');
  const want = { on: true, followBattles: true, arriveMinSec: 1, arriveMaxSec: 2, marginPct: 10, keepResidual: true, residual: 1000, postBattle: true, ownDf: true,
    minOwnDf: 10000000, checkMinMin: 30, checkMaxMin: 60, minBattleDf: 1000000, logistics: true, logisticsOrigin: '', deutReserveH: 2, repatriate: true,
    repatriateMin: 500000000, overflowPct: 90, ferry: true };
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

T.test('own debris fields journal (debris-save-14): «полей нет» after data without fields, «нет данных» with the next read time, galaxy views forbidden at budget 0', async () => {
  const { OGX } = load();
  const M = OGX.botDebris._M;
  M.meta = {}; M.seen = {}; M.own = {}; M.plans = {};
  const T0 = 1793500000000;
  const R = fakeRun(OGX, { now: T0, cache: null });
  const env = { bodies: { p1: { key: 'p1', id: 1, coords: '2:68:5' } }, flights: [] };
  const last = () => R.calls.rec.filter((r) => r.k === 'harvest-own').slice(-1)[0];
  await OGX.botDebris._ownStep(R.wctx, env);
  assert.equal(last().w, 'Свои поля: полей нет', 'read, no field: ' + last().w);
  M.seen = {};   // the read result is lost (reload) and the next read is not due yet
  R.at(T0 + 60000); await OGX.botDebris._ownStep(R.wctx, env);
  assert.ok(/^Свои поля: нет данных по 2:68 \(чтение после /.test(last().w), last().w);
  assert.deepEqual(JSON.parse(JSON.stringify(last().d.missing)), ['2:68']);
  R.wctx.core = (k) => ({ galaxyViewsPerHour: 0 }[k]);
  R.at(T0 + 40 * 60000); await OGX.botDebris._ownStep(R.wctx, env);
  assert.ok(/просмотр галактики запрещён/.test(last().w), last().w);
  assert.equal(R.calls.act.length, 1, 'budget 0: no read');
});

T.test('logistics sources: the body with the largest spare first; spare = available − its own plan keep − deuterium reserve; a body never gives what it waits for itself (debris-save-9)', () => {
  const { OGX } = load();
  const R = fakeRun(OGX, { avail: { p1: { metal: 1e9, crystal: 1e9, deuterium: 1e9 }, p2: { metal: 3e9, crystal: 3e9, deuterium: 3e9 }, p3: { metal: 9e9, crystal: 9e9, deuterium: 9e9 }, p4: { metal: 5e9, crystal: 5e9, deuterium: 5e9 } } });
  const b = (id) => ({ key: 'p' + id, id, coords: '2:68:' + (4 + id), res: { deuterium: { amount: 1, perHour: 1e6, storage: 1e10 } } });
  const env = { bodies: { p1: b(1), p2: b(2), p3: b(3), p4: b(4) } };
  const keeps = { p2: { metal: 2.5e9, crystal: 2.5e9, deuterium: 2.5e9 } };
  const needRes = { p1: { metal: 1e9, crystal: 0, deuterium: 0 }, p3: { metal: 1e9, crystal: 1e9, deuterium: 1e9 } };
  const S = OGX.botDebris._sourcesFor(R.wctx, env, env.bodies.p1, null, needRes, keeps);
  assert.deepEqual(JSON.parse(JSON.stringify(S.map((c) => c.body.key))), ['p4', 'p2'], 'p3 waits for all three itself, p1 is the target; p4 has the largest spare');
  assert.equal(S[1].spare.metal, 5e8, 'p2 keeps its own chain');
  assert.equal(S[0].spare.deuterium, 5e9 - 2e6, 'deuterium reserve 2 h x 1 M/h');
  // p3 waits only for crystal: its 9 G metal and deuterium are a source, its crystal is not
  const P = OGX.botDebris._sourcesFor(R.wctx, env, env.bodies.p1, null, { p3: { metal: 0, crystal: 1e9, deuterium: 0 } }, keeps);
  assert.equal(P[0].body.key, 'p3', 'p3 (open crystal need) still gives metal and deuterium');
  assert.equal(P[0].spare.crystal, 0); assert.equal(P[0].spare.metal, 9e9);
  const O = OGX.botDebris._sourcesFor(R.wctx, env, env.bodies.p1, env.bodies.p2, {}, keeps);
  assert.deepEqual(JSON.parse(JSON.stringify(O.map((c) => c.body.key))), ['p2'], 'the configured store only');
});

T.test('repatriation load (pure, shared with transport()): D = avail − keep − deutReserveH·perHour − fuel, D > C > M into the hold; overflow exports down to half the storage; destination room', () => {
  const { L } = load();
  const avail = { metal: 5e9, crystal: 3e9, deuterium: 12e9 };
  const keep = { metal: 4e9, crystal: 0, deuterium: 0 };
  const a = L.repatriateLoad({ avail, keep, keepD: 2.4e9, fuel: 340000, room: 340 * 4e7 - 340000 });
  assert.deepEqual(a.spare, { metal: 1e9, crystal: 3e9, deuterium: 12e9 - 2.4e9 - 340000 }, 'spare: keep, the 2 h reserve and the fuel come off');
  assert.deepEqual(a.load, { metal: 1e9, crystal: 3e9, deuterium: 12e9 - 2.4e9 - 340000 }, 'everything fits the hold of 340 x 217');
  const b = L.repatriateLoad({ avail, keep, keepD: 2.4e9, fuel: 10000, room: 10 * 4e7 - 10000 });
  assert.deepEqual(b.load, { metal: 0, crystal: 0, deuterium: 10 * 4e7 - 10000 }, 'a short hold takes deuterium first');
  const c = L.repatriateLoad({ avail: { metal: 5e9, crystal: 3e9, deuterium: 2e9 }, keep, keepD: 2.4e9, fuel: 1000, room: 1e12 });
  assert.deepEqual(c.load, { metal: 1e9, crystal: 3e9, deuterium: 0 }, 'deuterium under the reserve: metal and crystal still move, deuterium 0');
  assert.deepEqual(L.repatriateLoad({ avail: { metal: 1e9, crystal: 0, deuterium: 0 }, keep: { metal: 1e9, crystal: 0, deuterium: 0 }, keepD: 0, fuel: 0, room: 1e12 }).load, { metal: 0, crystal: 0, deuterium: 0 }, 'all under keep: nothing');
  const o = L.repatriateLoad({ avail: { metal: 9.6e9, crystal: 0, deuterium: 0 }, keep: { metal: 9e9, crystal: 0, deuterium: 0 }, keepD: 0, fuel: 0, room: 1e12, over: { metal: true }, storage: { metal: 1e10 } });
  assert.deepEqual(o.load, { metal: 4.6e9, crystal: 0, deuterium: 0 }, 'storage at the cap: exported down to half the storage even when keep holds more (production restarts)');
  const od = L.repatriateLoad({ avail: { metal: 0, crystal: 0, deuterium: 9.6e9 }, keep: { metal: 0, crystal: 0, deuterium: 0 }, keepD: 8e9, fuel: 1000, room: 1e12, over: { deuterium: true }, storage: { deuterium: 1e10 } });
  assert.deepEqual(od.load, { metal: 0, crystal: 0, deuterium: 9.6e9 - 5e9 - 1000 }, 'a full deuterium tank: the reserve shrinks to half the storage');
  // destination room: storage − amount − cargo already on its way; null when unknown
  const main = { res: { metal: { amount: 9.5e8, storage: 1e9 }, crystal: { amount: 1e9, storage: 1e9 }, deuterium: { amount: 1e6, storage: null } } };
  assert.deepEqual(L.destRoom(main), { room: { metal: 5e7, crystal: 0, deuterium: null }, full: { metal: false, crystal: true, deuterium: false } });
  assert.deepEqual(L.destRoom(main, { metal: 5e7, crystal: 0, deuterium: 0 }).full.metal, true, 'a flying delivery fills the room');
});

/** Fake runtime for logisticsStep (repatriation, no browser): bodies with stock / production / storage, ship counts behind read.fleetTable;
 *  a mission-3 send takes its cargo off the source (R.onSend). */
function fakeLogi(OGX, o = {}) {
  const calls = { act: [], rec: [] };
  let now = o.now || 1793500000000;
  OGX.bot = { randMs: ([a]) => a, msu: (r) => (r.metal || 0) + (r.crystal || 0) * 2 + (r.deuterium || 0) * 3, needs: { list: () => o.needs || [] }, battles: { list: () => [] } };
  // flight math stub: 10 s, fuel 1000 per ship
  OGX.fleet = { gz: { distance: () => 1005, duration: () => 10, consumption: (d) => 1000 * (d.n || 1), dataFor: (ships) => ({ maxspeed: 24000, n: Object.values(ships || {}).reduce((s, x) => s + (+x || 0), 0) }) } };
  const cfg = Object.assign({ deutReserveH: 2, repatriate: true, repatriateMin: 1e9, overflowPct: 90, logistics: false, logisticsOrigin: '', ferry: true }, o.cfg || {});
  let fleetId = 100;
  const J = (v) => JSON.parse(JSON.stringify(v));   // sandbox objects -> this realm (deepEqual compares prototypes)
  const R = { calls, cfg, onSend: null, at: (t) => { now = t; } };
  R.wctx = {
    now: () => now, cfg: (k) => cfg[k], core: (k) => ({ slotsReserve: 1 }[k]), decide: () => {}, rec: (k, w, d) => calls.rec.push(J({ k, w, d, t: now })),
    act: async (a) => {
      calls.act.push(J(Object.assign({ t: now }, a)));
      if (a.type === 'read.fleetTable') { const ships = (o.ships || {})[a.bodyId] || {}; return { ok: true, data: { fleetTable: { ships: Object.entries(ships).map(([id, count]) => ({ id: +id, count, speed: 24000 })) } } }; }
      if (R.onSend) R.onSend(a);
      return { ok: true, at: now, data: { fleetId: ++fleetId, arrival: now + 10000, back: now + 20000 } };
    },
    available: (key) => Object.assign({ metal: 0, crystal: 0, deuterium: 0 }, (o.avail || {})[key]), locked: () => null,
    canSend: async () => ({ ok: true, free: 5, reserve: 1 }), sleepCheck: () => ({ ok: true }), reserve: () => 1, release: () => {}, flights: () => [], threats: () => [],
  };
  R.sends = () => calls.act.filter((a) => a.type === 'fleet.send');
  R.reads = (bodyId) => calls.act.filter((a) => a.type === 'read.fleetTable' && (bodyId === undefined || a.bodyId === bodyId)).length;
  R.skips = (reason, bodyId) => calls.rec.filter((r) => r.k === 'skip' && r.d && r.d.reason === reason && (bodyId === undefined || r.d.body === bodyId));
  return R;
}
const RES3 = ['metal', 'crystal', 'deuterium'];
const body = (id, extra = {}) => Object.assign({ key: 'p' + id, id, type: 'planet', coords: '2:68:' + (4 + id), order: id, ships: {}, shipsT: null,
  res: { metal: { amount: 0, perHour: 0, storage: 1e12 }, crystal: { amount: 0, perHour: 0, storage: 1e12 }, deuterium: { amount: 0, perHour: 0, storage: 1e12 }, t: 1793500000000 - 60000 } }, extra);
const withRes = (b, m, c, d) => { b.res.metal.amount = m; b.res.crystal.amount = c; b.res.deuterium.amount = d; return b; };
function freshM(OGX) { const M = OGX.botDebris._M; M.meta = {}; M.logi = []; M.ships = {}; M.plans = {}; M.own = {}; M.seen = {}; M.stale.clear(); return M; }
/** The world side of a send: a transport takes its cargo off the source's stock (available and the state's amounts). */
const takeCargo = (avail, env) => (a) => {
  if (a.params.mission !== 3) return;
  const k = 'p' + a.bodyId;
  for (const r of RES3) { avail[k][r] -= a.params.cargo[r]; env.bodies[k].res[r].amount -= a.params.cargo[r]; }
};

T.test('repatriation planner: the deuterium reserve of transport() is applied in the plan (no self-refusal), the reserve survives a perHour drop-out, reads only after the stock check, one journal line and a cooldown per refused body, a colony without 217 gets them by a Deploy', async () => {
  const { OGX } = load();
  const M = freshM(OGX);
  const T0 = 1793500000000;
  const CAP = 4e7;
  const avail = { p1: { metal: 1e9, crystal: 1e9, deuterium: 1e9 }, p2: { metal: 5e9, crystal: 3e9, deuterium: 12e9 }, p3: { metal: 9.5e9, crystal: 1e6, deuterium: 1e7 }, p4: { metal: 2e9, crystal: 0, deuterium: 0 } };
  const ships = { 1: { 217: 1000 }, 2: { 217: 500 }, 3: {}, 4: { 217: 5 } };
  const R = fakeLogi(OGX, { now: T0, avail, ships, needs: [{ kind: 'keep', bodyKey: 'p2', keep: { metal: 4e9, crystal: 0, deuterium: 0 } }, { kind: 'keep', bodyKey: 'p4', keep: { metal: 2e9, crystal: 0, deuterium: 0 } }] });
  const p1 = withRes(body(1, { ships: { 217: 1000 }, shipsT: T0 - 60000 }), 1e9, 1e9, 1e9);          // main: 217 known from the state
  const p2 = withRes(body(2), 5e9, 3e9, 12e9); p2.res.deuterium.perHour = 1.2e9;                      // produces 1.2 G/h -> reserve 2.4 G
  const p3 = withRes(body(3), 9.5e9, 1e6, 1e7); p3.res.metal.storage = 1e10;                         // metal at 95 % of its storage, no 217
  const p4 = withRes(body(4), 2e9, 0, 0);                                                              // all under its own keep
  const env = { bodies: { p1, p2, p3, p4 }, stats: { 217: { cargo: CAP } }, flights: [] };
  R.onSend = takeCargo(avail, env);
  const step = () => OGX.botDebris._logisticsStep(R.wctx, env);
  // pass 1: p2 -> main with the reserve kept
  assert.equal(await step(), 1);
  let s = R.sends();
  assert.equal(s.length, 1, 'one send');
  assert.equal(s[0].params.mission, 3); assert.equal(s[0].bodyId, 2);
  const fuel = 1000 * 340;
  assert.deepEqual(s[0].params.ships, { 217: 340 }, 'n = ceil(total / cap): 340 of the 500');
  assert.deepEqual(s[0].params.cargo, { metal: 1e9, crystal: 3e9, deuterium: 12e9 - 2.4e9 - fuel }, 'D = stock − 2 h x 1.2 G − fuel, the metal above keep, all crystal');
  assert.equal(R.skips('stock').length, 0, 'no stock skip (the planner and transport() share the rule)');
  const plan = R.calls.rec.find((r) => r.k === 'repatriate');
  assert.equal(plan.d.keepD, 2.4e9, 'the reserve in the plan line');
  assert.ok(/запас дейтерия/.test(plan.w), plan.w);
  assert.equal(R.calls.rec.find((r) => r.k === 'transport-planned').d.keepDeut, 2.4e9);
  assert.equal(R.reads(2), 1, 'p2 read once'); assert.equal(R.reads(1), 0, 'the main is never read for this');
  // pass 2 (p2 in flight): p3 overflows without 217 -> Deploy of ceil(spare / cap) x 217 from the main
  R.at(T0 + 5000);
  assert.equal(await step(), 1);
  s = R.sends();
  assert.equal(s.length, 2, 'the ferry');
  assert.equal(s[1].params.mission, 4, 'Deploy'); assert.equal(s[1].bodyId, 1, 'from the main');
  assert.deepEqual(s[1].params.ships, { 217: Math.ceil((9.5e9 + 1e6 + 1e7) / CAP) }, 'as many 217 as the exportable stock needs');
  assert.deepEqual(s[1].params.target, { galaxy: 2, system: 68, position: 7, type: 1 });
  assert.equal(s[1].dedupeKey, 'botdebris:ferry:p3');
  assert.ok(R.calls.rec.some((r) => r.k === 'transport-sent' && r.d.action === 'ferry'), 'journaled as a ferry');
  assert.equal(R.reads(3), 1, 'p3 read once before the ferry');
  ships[3] = { 217: 238 };   // the world: the transporters land at T0 + 15 s
  // woken 20 x within 100 s: p4 (nothing exportable) is journaled once and never read, p2 (crumbs left after the export) once,
  // p3 is emptied once its transporters landed; no body is read twice for the same situation
  for (let i = 1; i <= 20; i++) { R.at(T0 + 5000 + i * 5000); await step(); }
  s = R.sends();
  assert.equal(s.length, 3, 'p3 repatriated after the ferry: ' + JSON.stringify(s.map((x) => [x.bodyId, x.params.mission])));
  assert.equal(s[2].params.mission, 3); assert.equal(s[2].bodyId, 3);
  assert.equal(s[2].params.cargo.metal, 9.5e9, 'the metal of p3 (no keep, no reserve)');
  assert.deepEqual(s[2].params.ships, { 217: 238 }, 'with the ferried transporters');
  assert.equal(R.reads(3), 2, 'one read before the ferry, one after it landed');
  assert.equal(R.reads(), 3, 'no other fleetTable read in 20 wakes');
  assert.equal(R.reads(4), 0, 'p4: nothing exportable -> never read');
  assert.equal(R.skips('stock', 4).length, 1, 'p4 journaled once (cooldown + journal dedupe)');
  assert.equal(R.skips('stock', 2).length, 1, 'p2 after the export: 340 000 deuterium left above the reserve is not worth a trip, journaled once');
  assert.equal(R.skips('ships').length, 0, 'the colony without 217 is ferried, not skipped');
  assert.ok(M.meta.repSkip.p4 && M.meta.repSkip.p4.until > T0 + 10 * 60000, 'p4 on a cooldown');
  // the core's perHour dropped out (page merge) and the colony filled up again: the remembered production keeps the reserve
  Object.assign(avail.p2, { metal: 5e9, crystal: 3e9, deuterium: 12e9 }); withRes(p2, 5e9, 3e9, 12e9);
  p2.res.deuterium.perHour = null;
  delete M.meta.repSkip.p2;   // what a fleet landing on p2 does (bot:fleet-returned)
  R.at(T0 + 11 * 60000);
  await step();
  const p2sends = R.sends().filter((x) => x.bodyId === 2);
  assert.equal(p2sends.length, 2, 'p2 again');
  assert.deepEqual(p2sends[1].params.cargo, { metal: 1e9, crystal: 3e9, deuterium: 12e9 - 2.4e9 - fuel }, 'perHour null: the reserve is still 2.4 G (remembered production)');
  const tp = R.calls.rec.filter((r) => r.k === 'transport-planned' && r.d.from === 2);
  assert.equal(tp[tp.length - 1].d.keepDeut, 2.4e9);
  // a landing ends p4's cooldown early; the same situation within the hour is not journaled again
  delete M.meta.repSkip.p4;
  R.at(T0 + 11 * 60000 + 5000);
  await step();
  assert.equal(R.skips('stock', 4).length, 1, 'same situation within the hour: still one line');
});

T.test('repatriation and the destination storage: only what fits the main (flying deliveries counted); nothing when it is full — except an overflowing colony', async () => {
  const { OGX } = load();
  freshM(OGX);
  const T0 = 1793500000000;
  const CAP = 4e7;
  const avail = { p1: { metal: 9.5e8, crystal: 1e9, deuterium: 0 }, p2: { metal: 3e8, crystal: 2e8, deuterium: 1e8 }, p3: { metal: 0, crystal: 5e8, deuterium: 0 }, p4: { metal: 0, crystal: 9.6e9, deuterium: 1e7 } };
  const ships = { 2: { 217: 100 }, 3: { 217: 100 }, 4: { 217: 300 } };
  const R = fakeLogi(OGX, { now: T0, avail, ships, cfg: { repatriateMin: 1e8 } });
  const p1 = withRes(body(1), 9.5e8, 1e9, 0); p1.res.metal.storage = 1e9; p1.res.crystal.storage = 1e9;   // main: 50 M metal room, crystal full
  const p2 = withRes(body(2), 3e8, 2e8, 1e8);
  const p3 = withRes(body(3), 0, 5e8, 0);                                                                 // crystal only, the main is full of it
  const p4 = withRes(body(4), 0, 9.6e9, 1e7); p4.res.crystal.storage = 1e10;                              // crystal at 96 % of its storage
  const env = { bodies: { p1, p2, p3, p4 }, stats: { 217: { cargo: CAP } }, flights: [] };
  R.onSend = takeCargo(avail, env);
  const step = () => OGX.botDebris._logisticsStep(R.wctx, env);
  assert.equal(await step(), 1);
  let s = R.sends();
  assert.equal(s[0].bodyId, 2);
  const n = Math.ceil((5e7 + 1e8) / CAP);
  assert.deepEqual(s[0].params.cargo, { metal: 5e7, crystal: 0, deuterium: 1e8 - n * 1000 }, 'metal capped to the room, crystal (full) left, deuterium whole');
  const plan = R.calls.rec.find((r) => r.k === 'repatriate' && r.d.from === 2);
  assert.deepEqual(plan.d.cut, { metal: 2.5e8, crystal: 2e8 }, 'the cut in the plan data');
  assert.ok(/не поместится/.test(plan.w), plan.w);
  R.at(T0 + 5000);
  assert.equal(await step(), 1, 'p4 sends although the main is full of crystal: its own storage is at the cap');
  s = R.sends();
  assert.equal(s.length, 2); assert.equal(s[1].bodyId, 4); assert.ok(s[1].params.cargo.crystal > 9e9, JSON.stringify(s[1].params.cargo));
  assert.equal(R.skips('destFull', 3).length, 1, 'p3: the main is full (crystal) and p3 does not overflow -> destFull, journaled once');
  assert.ok(/склад .* полон/.test(R.skips('destFull', 3)[0].w), R.skips('destFull', 3)[0].w);
  assert.equal(R.reads(3), 0, 'no fleetTable read for a body whose load has nowhere to go');
  // the flying metal fills the main's room: p2 (back after 20 s) gets no second trip for its remaining metal
  R.at(T0 + 25000);
  for (let i = 0; i < 2; i++) await step();
  const p2b = R.sends().filter((x) => x.bodyId === 2);
  assert.equal(p2b.length, 1, 'no second p2 transport: metal room taken by the first (pending), crystal full, deuterium gone: ' + JSON.stringify(p2b.map((x) => x.params.cargo)));
  assert.equal(R.reads(), 2, 'p2 and p4 once each');
});

T.test('repatriation with a stale state: the bot\'s own sends are taken off the stock until a page of the colony shows it again (no double trip that eats the deuterium reserve)', async () => {
  const { OGX } = load();
  const M = freshM(OGX);
  const T0 = 1793500000000;
  const avail = { p1: { metal: 1e9, crystal: 1e9, deuterium: 1e9 }, p2: { metal: 5e9, crystal: 3e9, deuterium: 12e9 } };
  const R = fakeLogi(OGX, { now: T0, avail, ships: { 2: { 217: 500 } } });
  const p1 = withRes(body(1), 1e9, 1e9, 1e9);
  const p2 = withRes(body(2), 5e9, 3e9, 12e9); p2.res.deuterium.perHour = 1.2e9;
  const env = { bodies: { p1, p2 }, stats: { 217: { cargo: 4e7 } }, flights: [] };
  // the core state as stored (not projected): the colony's stock was read a minute ago; a send does not change it
  const raw = { p2: { res: { t: T0 - 60000, metal: { amount: 5e9 }, crystal: { amount: 3e9 }, deuterium: { amount: 12e9 } } } };
  OGX.state = { bodies: async () => JSON.parse(JSON.stringify(raw)) };
  const setRaw = async () => { M.raw = await OGX.botDebris._rawStock(); };
  const step = async () => { await setRaw(); return OGX.botDebris._logisticsStep(R.wctx, env); };
  assert.equal(await step(), 1);
  assert.equal(R.sends().length, 1);
  const first = R.sends()[0];
  assert.equal(R.calls.rec.find((r) => r.k === 'transport-sent').d.srcAmt.deuterium, 12e9, 'the stock the send was taken from is kept');
  // the transport is back (fake back = +20 s), nothing re-read the colony: the same stock must not be planned again
  R.at(T0 + 25000);
  delete M.meta.repSkip;
  assert.equal(await step(), 0, 'no second trip from the stale stock');
  assert.equal(R.sends().length, 1);
  // a page of the colony shows the stock after the send: the correction stops (no double subtraction)
  raw.p2.res = { t: T0 + 30000, metal: { amount: 5e9 - first.params.cargo.metal }, crystal: { amount: 0 }, deuterium: { amount: 12e9 - first.params.cargo.deuterium - 340000 } };
  Object.assign(avail.p2, { metal: raw.p2.res.metal.amount, crystal: 0, deuterium: raw.p2.res.deuterium.amount });
  M.meta.repSkip = {};
  R.at(T0 + 35000);
  await setRaw();
  const u = OGX.botDebris._availOf(R.wctx, p2);
  assert.deepEqual(JSON.parse(JSON.stringify(u)), avail.p2, 'after the read the available stock is the state\'s');
  assert.ok(u.deuterium >= 2.4e9, 'the 2 h reserve is still on the colony: ' + u.deuterium);
});
