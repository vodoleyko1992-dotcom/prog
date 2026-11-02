'use strict';
// botexpo 1.1 pure rules (no browser): learn mode (which expedition fleet brings the most DM per hour), DM search with collectors
// (mission 11: chance, split of collectors over the free places, DM in the return text), DM counter gain, routes to own moons.
//   node tests/gz-bot-expo-dm.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'ogamex-bot', 'modules', 'botexpo', 'botexpo.js');
const SIM = require(path.join(ROOT, 'ogamex-bot', 'modules', 'botsim', 'botsim.js'));
const CAT = SIM.loadCatalog(path.join(ROOT, 'shared', 'core', '08-catalog-data.js'));

function load() {
  const window = { OGX: { module: () => {}, botSim: SIM, catalog: CAT } };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { window, setTimeout, clearTimeout, console }, { filename: FILE });
  const L = {};
  for (const [k, v] of Object.entries(window.OGX.botExpo._lib)) L[k] = (...a) => { const r = v(...a); return r === undefined || r === null ? r : JSON.parse(JSON.stringify(r)); };
  return L;
}

T.test('learn candidates: default list, JSON string, bad entries dropped, keys with ships and staytime', () => {
  const L = load();
  const d = L.learnCandidates([]);
  assert.deepEqual(d.map((c) => c.key), ['1x210@1h', '100x210@1h', '2000x210@1h', '10000x210@1h', '1x210@2h']);
  const c = L.learnCandidates('[{"ships":{"210":50,"217":"2"},"stay":3},{"ships":{}},null,{"210":5},{"ships":{"210":50,"217":2},"stay":3}]');
  assert.deepEqual(c, [{ key: '50x210+2x217@3h', ships: { 210: 50, 217: 2 }, stay: 3 }, { key: '5x210@1h', ships: { 210: 5 }, stay: 1 }]);
  assert.equal(L.learnCandidates('not json').length, 5, 'broken JSON -> defaults');
});

T.test('learn pick: untried first (fewest trips), then the best DM per hour, explore share on another; keep probes for spying', () => {
  const L = load();
  const cands = L.learnCandidates([{ ships: { 210: 1 } }, { ships: { 210: 100 } }, { ships: { 210: 5000 } }]);
  const have = { 210: 6000 };
  let p = L.learnPick(cands, {}, have, { minTrips: 2, keep: { 210: 2000 } });
  assert.equal(p.key, '1x210@1h'); assert.equal(p.phase, 'explore');
  const st = { '1x210@1h': { trips: 2, dm: 12, hours: 2 }, '100x210@1h': { trips: 1, dm: 90, hours: 1 } };
  p = L.learnPick(cands, st, have, { minTrips: 2, keep: { 210: 2000 } });
  assert.equal(p.key, '100x210@1h', '5000 probes do not fit above keep 2000, 100x210 still young');
  st['100x210@1h'] = { trips: 2, dm: 180, hours: 2 };
  p = L.learnPick(cands, st, have, { minTrips: 2, keep: { 210: 2000 }, rnd: () => 0.99 });
  assert.equal(p.key, '100x210@1h'); assert.equal(p.phase, 'best');
  p = L.learnPick(cands, st, have, { minTrips: 2, keep: { 210: 2000 }, explore: 0.1, rnd: () => 0.05 });
  assert.equal(p.key, '1x210@1h'); assert.equal(p.phase, 'check');
  assert.equal(L.learnPick(cands, st, { 210: 0 }, {}), null, 'no ships -> null');
});

T.test('learn add: trips, DM, hours, black hole losses; rate = DM per hour', () => {
  const L = load();
  let s = {};
  s = L.learnAdd(s, 'k', { dm: 40, hours: 1.01 });
  s = L.learnAdd(s, 'k', { dm: 0, hours: 1, lost: true });
  assert.deepEqual(s, { k: { trips: 2, dm: 40, hours: 2.01, lost: 1 } });
  assert.ok(Math.abs(L.learnRate(s.k) - 40 / 2.01) < 1e-9);
  assert.equal(L.learnRate({ trips: 0, dm: 0, hours: 0 }), null);
});

T.test('probe stock: 2 x expedition slots x probes per slot + keep, or the setting', () => {
  const L = load();
  assert.equal(L.probeTarget({ slots: 4, perSlot: 5000, keep: 2000 }), 42000, 'John: 4 slots x 5000');
  assert.equal(L.probeTarget({ stock: 60000, slots: 4, perSlot: 5000, keep: 2000 }), 60000);
  assert.equal(L.probeTarget({ slots: 0, perSlot: 5000, keep: 2000 }), 2000);
  assert.equal(L.probeTarget({}), 0);
});

T.test('DM search (Xterium rule): chance 15 % + 0.25 % per ship up to 30 % (60 ships), expected DM = chance x 850.5', () => {
  const L = load();
  assert.equal(L.dmChance(0), 0);
  assert.ok(Math.abs(L.dmChance(1) - 0.1525) < 1e-12);
  assert.ok(Math.abs(L.dmChance(60) - 0.3) < 1e-12);
  assert.ok(Math.abs(L.dmChance(1000) - 0.3) < 1e-12);
  assert.ok(Math.abs(L.dmExpected(60) - 255.15) < 1e-9);
  // vanilla 2Moons rule still computable
  assert.equal(L.dmChance(80, { base: 30, perShip: 0.25, max: 50 }), 0.5);
});

T.test('DM search: collectors split over the free places (each fleet >= 1 ship, even shares, cap per fleet)', () => {
  const L = load();
  assert.deepEqual(L.allocateCollectors(10, 5, 80), [2, 2, 2, 2, 2]);
  assert.deepEqual(L.allocateCollectors(11, 5, 80), [3, 2, 2, 2, 2]);
  assert.deepEqual(L.allocateCollectors(3, 5, 80), [1, 1, 1]);
  assert.deepEqual(L.allocateCollectors(1000, 5, 80), [80, 80, 80, 80, 80]);
  assert.deepEqual(L.allocateCollectors(0, 5, 80), []);
  assert.deepEqual(L.allocateCollectors(50, 0, 80), []);
  // the split never lowers the summed chance against one big fleet
  const sum = (a) => a.reduce((x, n) => x + L.dmChance(n), 0);
  assert.ok(sum(L.allocateCollectors(10, 5)) > sum([10]));
});

T.test('DM amount from a return text (ru/en, thousands separators), none -> null', () => {
  const L = load();
  assert.equal(L.dmFromText('Ваш флот вернулся. Найдено 1.234 Тёмная материя'), 1234);
  assert.equal(L.dmFromText('Флот доставил груз: Металл 0, Кристалл 0, Дейтерий 0 и Тёмная материя 43.'), 43);
  assert.equal(L.dmFromText('The fleet brings Dark Matter 850'), 850);
  assert.equal(L.dmFromText('Флот вернулся на планету без находок'), null);
});

T.test('DM counter gain: only increases count (spending does not hide finds), per hour over the window', () => {
  const L = load();
  const H = 3600000;
  const g = L.dmGain([{ t: 0, dm: 100 }, { t: H, dm: 600 }, { t: 2 * H, dm: 100 }, { t: 3 * H, dm: 400 }], 3 * H, 24 * H);
  assert.deepEqual(g, { gain: 800, hours: 3, perHour: 800 / 3 });
  assert.equal(L.dmGain([{ t: 0, dm: 1 }], 0), null);
});

T.test('DM routes: every own moon launched from its planet; dmTargets narrows; no moon -> none', () => {
  const L = load();
  const bodies = {
    p1: { id: 1, key: 'p1', coords: '2:68:5', type: 'planet', order: 1 },
    m1: { id: 11, key: 'm1', coords: '2:68:5', type: 'moon', order: 2 },
    p2: { id: 2, key: 'p2', coords: '2:68:8', type: 'planet', order: 3 },
    m2: { id: 12, key: 'm2', coords: '2:68:8', type: 'moon', order: 4 },
  };
  const r = L.dmRoutes(bodies, []);
  assert.deepEqual(r.map((x) => [x.origin.id, x.target, x.tkey]), [[1, { galaxy: 2, system: 68, position: 5, type: 3 }, '2:68:5:3'], [2, { galaxy: 2, system: 68, position: 8, type: 3 }, '2:68:8:3']]);
  assert.deepEqual(L.dmRoutes(bodies, [12]).map((x) => x.origin.id), [2]);
  assert.deepEqual(L.dmRoutes({ p1: bodies.p1, p2: bodies.p2 }, []), []);
});

T.test('learn pick: trips in flight count as tried, so one round spreads over the candidates', () => {
  const L = load();
  const cands = L.learnCandidates([{ ships: { 210: 1 } }, { ships: { 210: 20 } }]);
  assert.equal(L.learnPick(cands, {}, { 210: 100 }, { minTrips: 3, pending: { '1x210@1h': 1 } }).key, '20x210@1h');
  assert.equal(L.learnPick(cands, {}, { 210: 100 }, { minTrips: 3, pending: { '1x210@1h': 1, '20x210@1h': 1 } }).key, '1x210@1h');
});

T.test('DM amount: upstream return texts of mission 11 (sys_expe_back_home_with_dm, en and ru)', () => {
  const L = load();
  assert.equal(L.dmFromText('Your fleet has returned from the expedition. They found (Dark Matter)1.040 but the ships were scrapped. the Dark Matter was saved.'), 1040);
  assert.equal(L.dmFromText('Ваш флот вернулся из экспедиции. Найдено Тёмная материя (847), но корабли были сильно повреждены и их пришлось покинуть. Тёмная материя была доставлена на планету в аварийных капсулах.'), 847);
  assert.equal(L.dmFromText('Ваш флот вернулся из экспедиции ни с чем.'), null);
});
