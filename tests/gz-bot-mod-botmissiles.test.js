'use strict';
// botmissiles pure rules (no browser): module definition and C5 defaults, the missile need (OGX.missiles.math.plan, checked
// against the 2Moons PHP case of specs/galaxyz/tools/missiles/mip_cases.json), silo capacity (getMaxConstructibleRockets),
// the wave rule (build / ready / yard / partial / empty / cap / siloFull), launcher choice, silo request, small helpers.
// Loaded in a vm sandbox with the real core (00-ogx, 01-util, catalog) and the Infinity missiles math.
//   node tests/gz-bot-mod-botmissiles.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'ogamex-bot', 'modules', 'botmissiles', 'botmissiles.js');
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs/galaxyz/tools/missiles/mip_cases.json'), 'utf8'));

function load() {
  const sb = { console, setTimeout, clearTimeout };
  sb.window = sb; sb.OGX = {};
  vm.createContext(sb);
  for (const f of ['00-ogx.js', '01-util.js', '08-catalog-data.js', '09-catalog.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared/core', f), 'utf8'), sb, { filename: f });
  const mods = [];
  sb.OGX.module = (def) => mods.push(def);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ogamex-infinity/modules/missiles/missiles.js'), 'utf8'), sb, { filename: 'missiles.js' });
  mods.length = 0;
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sb, { filename: FILE });
  const L = {};
  for (const [k, v] of Object.entries(sb.OGX.botMissiles._lib)) {
    L[k] = typeof v === 'function' ? (...a) => { const r = v(...a); return r === undefined || r === null || (typeof r.has === 'function' && typeof r.add === 'function') ? r : JSON.parse(JSON.stringify(r)); } : JSON.parse(JSON.stringify(v));
  }
  return { L, mods: mods.map((m) => Object.assign({}, m, { settings: JSON.parse(JSON.stringify(m.settings)) })), OGX: sb.OGX };
}

T.test('module definition: name, title, every C5 setting with its default (on by default), Russian labels', () => {
  const { mods, OGX } = load();
  assert.equal(mods.length, 1);
  const m = mods[0];
  assert.equal(m.name, 'botmissiles'); assert.equal(m.title, 'Бот: ракеты');
  const want = { on: true, buildMissiles: true, buildSilo: true, targets: [], exclude: [], maxReportAgeMin: 180, reservePct: 10, defTech: '110', maxPerTarget: 2000, maxPerDay: 5000 };
  assert.deepEqual(Object.keys(m.settings).sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) assert.deepEqual(m.settings[k].default, v, k);
  assert.deepEqual(m.settings.defTech.options.map((o) => o.value), ['110', '111']);
  for (const [k, d] of Object.entries(m.settings)) assert.ok(/[а-яё]/i.test(d.label), 'russian label ' + k);
  assert.equal(OGX.botMissiles.version, '1.0.0');
  assert.equal(typeof m.init, 'function');
});

T.test('needFor: the PHP case (Kovacs Prime, weapons 14 / shield 13, 20 ABM) needs 71; reservePct adds on top of the hits only', () => {
  const { L } = load();
  const php = CASES.find((c) => c.case.def && c.case.def[401] === 1500 && c.case.weapons === 14);
  assert.ok(php, 'PHP case present');
  const def = Object.assign({}, php.case.def); delete def[502];
  const intel = { defense: def, abm: php.case.def[502], ipm: 0, research: { 110: php.case.shield } };
  const r0 = L.needFor({ intel, research: { 109: php.case.weapons, 110: 0 }, reservePct: 0 });
  assert.equal(r0.need, 71); assert.equal(r0.abm, 20); assert.equal(r0.defLeft, 1500 + 900 + 120 + 12 + 1 + 1);
  const r10 = L.needFor({ intel, research: { 109: 14 }, reservePct: 10 });
  assert.equal(r10.need, 71 + Math.ceil((71 - 20) * 0.1), '+10 % of the 51 hits');
  // unknown target shield: our own level (the safe side) -> more missiles than with a weaker target
  const own = L.needFor({ intel: { defense: def, abm: 20 }, research: { 109: 14, 110: 20 }, reservePct: 0 });
  assert.ok(own.need > 71, 'own shield 20 > 13');
  // defTech 111 reads the armour level instead
  const arm = L.needFor({ intel: { defense: def, abm: 20, research: { 110: 13, 111: 0 } }, research: { 109: 14 }, defTech: 111, reservePct: 0 });
  assert.ok(arm.need < 71, 'armour 0 < shield 13');
});

T.test('needFor: the botmissiles.json target (1200 + 300, 10 ABM, shield 3; our weapons 10) ≈ 29 = wave 25 + 4', () => {
  const { L } = load();
  const r = L.needFor({ intel: { defense: { 401: 1200, 402: 300 }, abm: 10, ipm: 0, research: { 110: 3 } }, research: { 109: 10, 110: 10 } });
  assert.equal(r.plan.needAll, 27); assert.equal(r.need, 29); assert.equal(r.defLeft, 1500);
  // only ABM / IPM left: nothing to destroy
  const none = L.needFor({ intel: { defense: {}, abm: 10, ipm: 0 }, research: { 109: 10 } });
  assert.equal(none.need, 0); assert.equal(none.defLeft, 0);
  assert.equal(L.defLeftOf({ defense: { 401: 3, 407: 1, 502: 9, 503: 4 } }), 4, 'ABM / IPM are not counted');
});

T.test('siloFree: silo x 10 slots, IPM 2, ABM 1, queued units too (getMaxConstructibleRockets)', () => {
  const { L } = load();
  assert.equal(L.siloFree({ silo: 4 }), 40);
  assert.equal(L.siloFree({ silo: 4, abm: 10, ipm: 5, queuedAbm: 2, queuedIpm: 3 }), 40 - 10 - 10 - 2 - 6);
  assert.equal(L.siloFree({ silo: 3, abm: 10, ipm: 15 }), 0, 'never negative');
});

T.test('wave: build up to the silo, launch when ready, wait for the yard, partial / empty, caps and a silo full of ABM', () => {
  const { L } = load();
  // silo 5 = 25 IPM: the first wave of a 29-missile need is 25, built first
  assert.deepEqual(L.wave({ need: 29, ipm: 0, silo: 5 }), { launch: 0, build: 25, wait: true, reason: 'build', capLeft: 2000, goal: 25, siloCapIpm: 25 });
  assert.equal(L.wave({ need: 29, ipm: 25, silo: 5 }).launch, 25);
  assert.equal(L.wave({ need: 29, ipm: 25, silo: 5 }).reason, 'ready');
  // a small need: just that many
  assert.deepEqual(L.wave({ need: 3, ipm: 0, silo: 5 }).build, 3);
  assert.deepEqual(L.wave({ need: 3, ipm: 10, silo: 5 }).launch, 3, 'never more than the need');
  // some built, the rest in the yard: wait
  const y = L.wave({ need: 29, ipm: 5, silo: 5, queuedIpm: 20 });
  assert.equal(y.reason, 'yard'); assert.equal(y.wait, true); assert.equal(y.launch, 0);
  // building not allowed: launch what is there, else nothing
  assert.equal(L.wave({ need: 29, ipm: 7, silo: 5, buildAllowed: false }).reason, 'partial');
  assert.equal(L.wave({ need: 29, ipm: 7, silo: 5, buildAllowed: false }).launch, 7);
  assert.equal(L.wave({ need: 29, ipm: 0, silo: 5, buildAllowed: false }).reason, 'empty');
  // caps: per target and per day
  assert.equal(L.wave({ need: 30, ipm: 0, silo: 5, launched: 2000 }).reason, 'cap');
  const day = L.wave({ need: 30, ipm: 20, silo: 5, dayLaunched: 4990 });
  assert.equal(day.capLeft, 10); assert.equal(day.launch, 10);
  assert.equal(L.wave({ need: 0, ipm: 20, silo: 5 }).reason, 'none');
  // ABM fill the silo: no room for one IPM
  assert.equal(L.wave({ need: 10, ipm: 0, abm: 40, silo: 4 }).reason, 'siloFull');
  assert.equal(L.wave({ need: 10, ipm: 0, abm: 39, silo: 4 }).reason, 'siloFull', 'one free slot < 2 for an IPM');
});

T.test('launchersFor: planets with silo >= 4 in range (same galaxy, impulse x 5 - 1), most IPM first; moons / locked / bad / out of range excluded', () => {
  const { L } = load();
  const bodies = {
    p1: { id: 1, key: 'p1', type: 'planet', coords: '2:68:5', levels: { 44: 5 }, defense: { 503: 3 }, defenseT: 1 },
    p2: { id: 2, key: 'p2', type: 'planet', coords: '2:70:8', levels: { 44: 4 }, defense: { 503: 10 }, defenseT: 1 },
    p3: { id: 3, key: 'p3', type: 'planet', coords: '2:68:6', levels: { 44: 2 } },
    m4: { id: 4, key: 'm4', type: 'moon', isMoon: true, coords: '2:68:5', levels: { 44: 9 } },
    p5: { id: 5, key: 'p5', type: 'planet', coords: '3:68:5', levels: { 44: 9 } },
    p6: { id: 6, key: 'p6', type: 'planet', coords: '2:90:5', levels: { 44: 9 } },
  };
  assert.deepEqual(L.launchersFor({ bodies, coords: '2:68:13', impulse: 4 }).map((b) => b.id), [2, 1], 'most IPM, no moon, other galaxy, 22 systems away (range 19)');
  assert.deepEqual(L.launchersFor({ bodies, coords: '2:68:13', impulse: 5 }).map((b) => b.id), [2, 1, 6], 'range 24 reaches 2:90');
  assert.deepEqual(L.launchersFor({ bodies, coords: '2:68:13', impulse: 1 }).map((b) => b.id), [2, 1], 'range 4');
  assert.deepEqual(L.launchersFor({ bodies, coords: '2:73:13', impulse: 1 }).map((b) => b.id), [2], '2:68 is 5 systems away, 2:70 is 3');
  assert.deepEqual(L.launchersFor({ bodies, coords: '2:68:13', impulse: 0 }), [], 'no impulse drive');
  assert.deepEqual(L.launchersFor({ bodies, coords: '2:68:13', impulse: 4, locked: (k) => k === 'p2' }).map((b) => b.id), [1], 'threat lock');
  assert.deepEqual(L.launchersFor({ bodies, coords: '2:68:13', impulse: 4, now: 100, bad: { 2: 200 } }).map((b) => b.id), [1], 'refused launcher, for an hour');
  assert.deepEqual(L.launchersFor({ bodies, coords: '2:68:13', impulse: 4, now: 300, bad: { 2: 200 } }).map((b) => b.id), [2, 1], 'the hour passed');
  // unknown missile counts sort after known ones; then the larger silo, then the nearer system
  const b2 = { a: { id: 7, key: 'p7', coords: '2:60:1', levels: { 44: 4 } }, b: { id: 8, key: 'p8', coords: '2:66:1', levels: { 44: 4 } }, c: { id: 9, key: 'p9', coords: '2:61:1', levels: { 44: 6 } } };
  assert.deepEqual(L.launchersFor({ bodies: b2, coords: '2:64:1', impulse: 3 }).map((b) => b.id), [9, 8, 7]);
});

T.test('siloWant: the own planet (silo < 4) with the most targets in range; none in range -> null', () => {
  const { L } = load();
  const planets = [
    { id: 1, key: 'p1', coords: '2:68:5', levels: { 44: 0 } },
    { id: 2, key: 'p2', coords: '2:80:5', levels: { 44: 2 } },
    { id: 3, key: 'p3', coords: '2:69:5', levels: { 44: 1 } },
    { id: 4, key: 'm4', coords: '2:68:5', type: 'moon', isMoon: true, levels: {} },
    { id: 5, key: 'p5', coords: '2:68:7', levels: { 44: 4 } },
  ];
  assert.deepEqual(L.siloWant({ planets, targets: ['2:68:13', '2:70:1', '2:81:2'], impulse: 1 }), { id: 3, key: 'p3', coords: '2:69:5', inRange: 2 }, 'p1 and p3 both reach 2, p3 has the higher silo');
  assert.equal(L.siloWant({ planets, targets: ['2:81:2', '2:84:2'], impulse: 1 }).id, 2);
  assert.equal(L.siloWant({ planets, targets: ['5:1:1'], impulse: 9 }), null);
});

T.test('small helpers: launchedSince, parseKeys, queuedUnits, flightMs (GetMIPDuration + 10 s), stateRu', () => {
  const { L } = load();
  assert.equal(L.launchedSince([{ t: 10, n: 5 }, { t: 20, n: 7 }, { t: 30, n: 1 }], 15), 8);
  assert.deepEqual([...L.parseKeys(['2:68:13', ' 1:2:3:3 ', 'bad', '1:2:3:2', 7])], ['2:68:13:1', '1:2:3:3']);
  assert.deepEqual([...L.parseKeys(null)], []);
  assert.equal(L.queuedUnits({ queued: [{ id: 503, amount: 4 }, { id: 502, amount: 9 }, { id: 503, amount: 1 }] }, 503), 5);
  assert.equal(L.queuedUnits(null, 503), 0);
  assert.equal(L.flightMs('2:68:5', '2:70:1', 7), Math.round(150 / 7) * 1000 + 10000);
  assert.equal(L.flightMs('2:68:5', '2:68:13', 7000), 5000 + 10000, 'MIN_FLEET_TIME 5 s');
  assert.equal(L.stateRu('flying'), 'ракеты летят'); assert.equal(L.stateRu('cleared'), 'оборона снесена');
  assert.deepEqual(L.NO_FIGHT, [502, 503]);
});
