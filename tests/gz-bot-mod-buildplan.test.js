'use strict';
// botbuild v2: John's build-up tactic (policy 'tactic', rules of planet_buildup_rules.json + John's overrides) on an empire like
// John's (main planet ~45 mines, colonies at low levels, no 217 yet). Pure planner OGX.botBuild.plan and OGX.botBuild.longTermPlan
// in a node sandbox with the real core calc/catalog: storages «авто» (full / below the next mine price / below max(3 h, sleep) when
// cheaper than the next mine; otherwise after the mines), robots 10 / nanites 10 / shipyard 14 / lab 22 (never
// below), the lowest mine across all planets (colonies first), 217 then 219 unlock research first, astrophysics until the planet cap,
// stages S1 -> S2 -> ..., satellites only for energy, the lab holds a research start.
//   node tests/gz-bot-mod-buildplan.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const ROOT = path.resolve(__dirname, '..');
const FILES = ['shared/core/00-ogx.js', 'shared/core/01-util.js', 'shared/core/08-catalog-data.js', 'shared/core/09-catalog.js', 'shared/core/10-calc.js',
  'ogamex-bot/modules/botbuild/botbuild.js'];
function sandbox() {
  const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  return sb;
}
const J = (v) => JSON.parse(JSON.stringify(v));
const NOW = 1793347417000;
const MAIN = 254102; const COL_A = 254103; const COL_B = 254104;
const CFG = { buildings: true, research: true, energy: true, storageHours: 0, labTarget: 22, shipyardTarget: 14, fieldsReserve: 1, ensureExpoSlots: false, university: true, moons: false, defense: false };
// John-like research: no 217 (110 14 / 111 10 / 114 10 / 117 15 missing), astrophysics 12, production techs low
const RESEARCH = { 106: 12, 108: 10, 109: 10, 110: 10, 111: 8, 113: 12, 114: 8, 115: 12, 117: 12, 118: 8, 120: 12, 124: 12, 131: 8, 133: 8, 123: 6 };
const STORE = { metal: 22, crystal: 23, deuterium: 24 };

/** A planet view; production = the core model (x22000), storage = calc.storageCapacity of its stores, stock = share of the storage. */
function view(sb, id, coords, levels, o = {}) {
  const C = sb.OGX.calc;
  const lv = Object.assign({}, levels);
  const pr = C.production({ levels: lv, ships: { 212: 1e9 }, tempMax: 40, research: o.research || RESEARCH, factors: C.factors({}) });
  const v = {
    id, key: 'p' + id, coords, name: o.name || 'P' + id, isMoon: false, tempMax: 40, fieldsUsed: o.fieldsUsed !== undefined ? o.fieldsUsed : 150, fieldsMax: o.fieldsMax || 400,
    levels: lv, t: NOW, res: {},
    energy: { production: o.eprod !== undefined ? o.eprod : pr.energy.consumption + 1e9, consumption: pr.energy.consumption },
    queue: o.queue || { known: true, busy: false, items: [], end: null }, shipyard: { known: true, items: [], t: NOW }, perSat: null, percents: {},
  };
  for (const r of ['metal', 'crystal', 'deuterium']) {
    const st = C.storageCapacity(lv[STORE[r]] || 0);
    v.res[r] = { amount: o.stock !== undefined ? o.stock : Math.floor(st * 0.9), storage: st, perHour: o.perHour !== undefined ? o.perHour : pr.perHour[r] };
  }
  return v;
}
/** John's empire: main 45/40/39 with lab 22, colony A 28/23/22 (short storages, nanites 5, shipyard 8, lab 10), fresh colony B. */
function empire(sb, over = {}) {
  return [
    view(sb, MAIN, '2:68:5', Object.assign({ 1: 45, 2: 40, 3: 39, 14: 20, 15: 10, 21: 14, 22: 26, 23: 26, 24: 25, 31: 22 }, over.main), over.mainO),
    view(sb, COL_A, '2:68:6', Object.assign({ 1: 28, 2: 23, 3: 22, 14: 15, 15: 5, 21: 8, 22: 10, 23: 10, 24: 10, 31: 10 }, over.a), over.aO),
    view(sb, COL_B, '2:68:7', Object.assign({ 1: 3, 2: 1, 3: 0, 14: 2, 21: 0, 22: 9, 23: 9, 24: 9 }, over.b), over.bO),
  ];
}
function input(sb, views, o = {}) {
  const pol = sb.OGX.botBuild._lib.policyParams(o.policy || 'tactic');
  return {
    now: NOW, P: pol.params, policyName: pol.name, cfg: Object.assign({}, CFG, o.cfg || {}), views: Object.fromEntries(views.map((v) => [v.id, v])), order: views.map((v) => v.id),
    research: { levels: Object.assign({}, RESEARCH, o.research || {}), queue: o.rqueue || { known: true, busy: false, items: [] } },
    factors: sb.OGX.calc.factors({}), officers: {}, gameSpeed: o.gameSpeed || null, planets: o.planets || { used: views.length, max: 9 }, astroCapped: !!o.astroCapped,
    cooldowns: {}, reserved: {}, deutReserve: 0,
  };
}
const plan = (sb, views, o) => sb.OGX.botBuild.plan(input(sb, views, o));
const ltp = (sb, views, o = {}) => sb.OGX.botBuild.longTermPlan(Object.assign(input(sb, views, o), { steps: o.steps || 12 }));
const act = (out, body) => out.actions.find((a) => a.step.bodyId === body && a.step.kind !== 'research');
const researchAct = (out) => out.actions.find((a) => a.step.kind === 'research');
// colonies with a done foundation and big storages (mines only left)
const BUILT = { 14: 10, 15: 10, 21: 14, 22: 26, 23: 26, 24: 25 };

T.test('API: OGX.botBuild.plan / longTermPlan are the pure functions; the tactic is the default policy; rules copied as data', () => {
  const sb = sandbox();
  const B = sb.OGX.botBuild;
  assert.equal(typeof B.plan, 'function'); assert.equal(typeof B.longTermPlan, 'function');
  assert.equal(B.SETTINGS.policy.default, 'tactic');
  assert.equal(B.BUILDUP.schema, 'ogamex-galaxyz-buildup/2');
  assert.deepEqual(J(B.BUILDUP.stages.slice(1).map((s) => s.mines[1])), [45, 50, 55, 60, 65]);
  const file = '/mnt/project-files/ogamex-strategy/galaxyz/planet_buildup_rules.json';
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const st of j.stages.filter((x) => x.mine_targets)) {
      const mine = B.BUILDUP.stages.find((x) => x.id === st.id);
      assert.deepEqual(J(mine.mines), st.mine_targets, st.id + ' mine targets = the rules file');
      assert.deepEqual(J(mine.stores), st.store12h_targets, st.id + ' storage reference = the rules file');
    }
  }
  const P = B._lib.policyParams('tactic');
  assert.equal(P.name, 'tactic'); assert.equal(P.params.tactic, 1); assert.equal(P.params.overflow, 0);
  // no request / state access: the sandbox has neither OGX.http nor OGX.state
  assert.equal(sb.OGX.state, undefined);
  const L = ltp(sb, empire(sb));
  assert.equal(L.planets.length, 3);
});

T.test('storages «авто» (John 2026-11-01, mines first): auto = 3 h or the sleep length, the 12 h minimum is gone; manual hours still allowed', () => {
  const sb = sandbox();
  const L = sb.OGX.botBuild._lib;
  assert.equal(L.tacticCfg({ storageHours: 0 }).storageHours, 3, 'auto = 3 h of production');
  assert.equal(L.tacticCfg({}).storageHours, 3);
  assert.equal(L.tacticCfg({ storageHours: 4 }).storageHours, 4, 'manual 4 h is no longer raised to 12');
  assert.equal(L.tacticCfg({ storageHours: 12 }).storageHours, 12);
  assert.equal(sb.OGX.botBuild.SETTINGS.storageHours.default, 0);
  // the night sleep of botcore on 01:30-07:30 -> 6 h; across midnight 23:00-05:00 -> 6 h; a short sleep keeps the 3 h minimum
  const sleep = (on, from, to) => { sb.OGX.settings = { get: (k) => ({ 'botcore.sleepOn': on, 'botcore.sleepFrom': from, 'botcore.sleepTo': to })[k] }; };
  sleep(true, '01:30', '07:30'); assert.equal(L.storageHoursOf({ storageHours: 0 }), 6, 'sleep 01:30-07:30 -> 6 h');
  sleep(true, '23:00', '05:00'); assert.equal(L.storageHoursOf({ storageHours: 0 }), 6);
  sleep(true, '01:30', '03:00'); assert.equal(L.storageHoursOf({ storageHours: 0 }), 3, 'at least 3 h');
  sleep(false, '01:30', '07:30'); assert.equal(L.storageHoursOf({ storageHours: 0 }), 3, 'sleep off -> 3 h');
  sleep(true, '01:30', '07:30'); assert.equal(L.storageHoursOf({ storageHours: 2 }), 2, 'manual hours beat the auto value');
  // the plan uses the auto value (sleep 6 h): main metal store 17 (1.86e9) < 6 h of 2.5e9/h, cheaper than the next crystal mine
  const out = plan(sb, empire(sb, { main: { 22: 17 }, a: BUILT, b: BUILT }));
  assert.ok(out.notes.some((n) => n.event === 'storage' && n.data.body === MAIN && /6 ч/.test(n.what)), J(out.notes.filter((n) => n.event === 'storage').map((n) => n.what)));
  delete sb.OGX.settings;
});

T.test('storage cheaper than the cheapest next mine and below the hour target -> storageHours first (before the foundation and the mines)', () => {
  const sb = sandbox();
  // main: metal store 17 (1.86e9) < 3 h x 2.5e9/h; store 18 costs 524M <= crystal mine 41 (796M); capacity >= 1.1 x next mine metal (1.82e9)
  const out = plan(sb, empire(sb, { main: { 22: 17, 15: 9 }, a: BUILT, b: BUILT }));
  const a = act(out, MAIN);
  assert.ok(a, 'main orders: ' + J(out.skipped.filter((s) => s.cand.bodyId === MAIN).map((s) => s.cand.label + ': ' + s.reason)));
  assert.equal(a.cand.rule, 'storageHours');
  assert.deepEqual([a.step.id, a.step.level], [22, 18]);
  const st = out.notes.find((n) => n.event === 'storage' && n.data.body === MAIN && n.data.res === 'metal');
  assert.ok(st && /3 ч/.test(st.what), 'journaled with the auto 3 h: ' + (st && st.what));
  assert.ok(out.skipped.some((s) => s.cand.bodyId === MAIN && s.cand.rule === 'foundation'), 'the foundation (nanites 10) waits for the store (one queue)');
  // the long-term plan of the main planet starts with the same store
  const pm = ltp(sb, empire(sb, { main: { 22: 17 }, a: BUILT, b: BUILT })).planets.find((p) => p.id === MAIN);
  assert.equal(pm.steps[0].rule, 'storageHours'); assert.equal(pm.steps[0].id, 22);
});

T.test('storage capacity below 1.1 x the next mine level price in that resource -> storageNeed first (hard)', () => {
  const sb = sandbox();
  // main: metal store 16 (1.02e9) < 1.1 x the metal of deuterium mine 40 (1.66e9)
  const out = plan(sb, empire(sb, { main: { 22: 16 }, a: BUILT, b: BUILT }));
  const a = act(out, MAIN);
  assert.equal(a.cand.rule, 'storageNeed');
  assert.deepEqual([a.step.id, a.step.level], [22, 17]);
  assert.ok(out.notes.some((n) => n.event === 'storage' && n.data.rule === 'storageNeed' && /цены следующей шахты/.test(n.what)));
  const c = out.candidates.filter((x) => x.bodyId === MAIN);
  assert.equal(c[0].rule, 'storageNeed', 'ranked first on the planet: ' + J(c.map((x) => x.rule)));
  const pm = ltp(sb, empire(sb, { main: { 22: 16 }, a: BUILT, b: BUILT })).planets.find((p) => p.id === MAIN);
  assert.equal(pm.steps[0].rule, 'storageNeed');
  assert.ok(pm.blockers.some((x) => /меньше цены следующей шахты/.test(x)), J(pm.blockers));
});

T.test('storage dearer than the cheapest next mine (below the hour target) -> storageLate, ranked after the mines; full store -> storageFull', () => {
  const sb = sandbox();
  // colony A, foundation done, stores 10 (26.8M, minutes of production): store 11 (2-4M) is dearer than crystal mine 24 (0.8M)
  const v = empire(sb, { a: Object.assign({}, BUILT, { 22: 10, 23: 10, 24: 10 }) });
  const out = plan(sb, v);
  const c = out.candidates.filter((x) => x.bodyId === COL_A);
  const late = c.filter((x) => x.rule === 'storageLate');
  assert.deepEqual(J(late.map((x) => x.item)).sort(), [22, 23, 24], J(c.map((x) => x.rule + ':' + x.item)));
  const lastMine = Math.max(...c.map((x, i) => (x.rule === 'mine' ? i : -1)));
  assert.ok(lastMine >= 0 && c.findIndex((x) => x.rule === 'storageLate') > lastMine, 'stores after the mines: ' + J(c.map((x) => x.rule + ':' + x.item)));
  assert.ok(!c.some((x) => x.rule === 'storageHours'));
  // the default empire: colony A orders its foundation; nanites 6 (32M metal) do not fit the 26.8M store -> that store first
  const out2 = plan(sb, empire(sb));
  const a = act(out2, COL_A);
  assert.equal(a.cand.rule, 'foundation');
  assert.deepEqual([a.step.id, a.step.level], [22, 11], 'price above the capacity: metal store first');
  const pa = ltp(sb, empire(sb)).planets.find((p) => p.id === COL_A);
  assert.equal(pa.steps[0].rule, 'storageNeed'); assert.equal(pa.steps[0].id, 22);
  assert.match(pa.steps[0].why, /больше хранилища/);
  assert.ok(!pa.steps.some((s) => s.rule === 'storageHours'), 'no dear store by hours: ' + J(pa.steps.map((s) => s.label + '/' + s.rule)));
  // a full store goes first
  const full = empire(sb, { a: Object.assign({}, BUILT, { 22: 10, 23: 10, 24: 10 }) });
  full[1].res.crystal.amount = full[1].res.crystal.storage;
  const out3 = plan(sb, full);
  assert.equal(act(out3, COL_A).cand.rule, 'storageFull');
  assert.equal(act(out3, COL_A).step.id, 23);
  assert.equal(ltp(sb, full).planets.find((p) => p.id === COL_A).steps[0].rule, 'storageFull');
});

T.test('foundation per planet: robots 10, nanites 10, shipyard to 14 (never beyond, shipyardTarget below 14 is raised)', () => {
  const sb = sandbox();
  const v = empire(sb, { a: { 22: 26, 23: 26, 24: 25, 15: 10 } });
  let out = plan(sb, v, { cfg: { shipyardTarget: 10 } });
  const yard = out.candidates.filter((c) => c.item === 21 && c.rule === 'foundation');
  assert.ok(yard.length >= 1);
  for (const c of yard) assert.equal(c.target, 14, c.label);
  const a = act(out, COL_A);
  assert.deepEqual([a.step.id, a.step.level, a.cand.target], [21, 9, 14], 'colony A: shipyard 9 of 14');
  assert.ok(!out.candidates.some((c) => c.item === 21 && c.bodyId === MAIN), 'main has shipyard 14: nothing');
  const L = ltp(sb, v, { steps: 40 });
  const steps = L.planets.find((p) => p.id === COL_A).steps.filter((s) => s.id === 21);
  assert.deepEqual(J(steps.map((s) => s.level)), [9, 10, 11, 12, 13, 14], 'shipyard steps up to 14 and no further');
  // fresh colony B: robots first (nanites need robots 10)
  const pb = L.planets.find((p) => p.id === COL_B);
  const f = pb.steps.filter((s) => s.rule === 'foundation').map((s) => s.id + ':' + s.level);
  assert.equal(f[0], '14:3');
  assert.ok(f.indexOf('14:10') < f.indexOf('15:1'), 'robots 10 before nanites: ' + f.join(' '));
  // raising the target is honoured
  out = plan(sb, empire(sb, { a: { 22: 26, 23: 26, 24: 25, 15: 10, 21: 14 } }), { cfg: { shipyardTarget: 16 } });
  assert.ok(out.candidates.some((c) => c.item === 21 && c.bodyId === COL_A && c.target === 16));
});

T.test('lab: never planned below the 22 target (labTarget 15 is raised to 22); from S2 on every planet; in S1 only once the planet met its mine targets', () => {
  const sb = sandbox();
  // S1 (colonies lag): no lab on colony A (mines 28), none on the main (lab 22)
  let out = plan(sb, empire(sb, { a: BUILT }), { cfg: { labTarget: 15 } });
  assert.ok(!out.candidates.some((c) => c.item === 31 && c.rule === 'lab'), 'S1: no lab for a lagging colony');
  // S2: every planet at 45/45/41 -> lab to 22 everywhere
  const s2 = { 1: 45, 2: 45, 3: 41 };
  const v = empire(sb, { main: { 2: 45, 3: 41 }, a: Object.assign({}, BUILT, s2), b: Object.assign({}, BUILT, s2, { 31: 4 }) });
  out = plan(sb, v, { cfg: { labTarget: 15 } });
  assert.equal(out.stage.id, 'S2');
  const labs = out.candidates.filter((c) => c.item === 31 && c.rule === 'lab');
  assert.deepEqual(J(labs.map((c) => c.bodyId)).sort(), [COL_A, COL_B]);
  for (const c of labs) { assert.equal(c.target, 22, c.label); assert.match(c.label, /цель 22/); }
  assert.deepEqual([act(out, COL_A).step.id, act(out, COL_A).step.level], [31, 11]);
  // lab ordered now -> no research start this cycle (2Moons refuses the lab during research)
  assert.equal(researchAct(out), undefined, 'research held for the lab');
  assert.ok(out.skipped.some((s) => s.cand.kind === 'research' && /ждём лабораторию/.test(s.reason)));
  // a raised target is honoured
  out = plan(sb, v, { cfg: { labTarget: 24 } });
  assert.ok(out.candidates.some((c) => c.item === 31 && c.bodyId === MAIN && c.target === 24), 'main 22 -> 24');
  // long term: lab steps up to 22 and not beyond
  const L = ltp(sb, v, { steps: 30, cfg: { labTarget: 15 } });
  const ls = L.planets.find((p) => p.id === COL_A).steps.filter((s) => s.id === 31).map((s) => s.level);
  assert.equal(ls[0], 11); assert.equal(ls[ls.length - 1], 22);
  assert.ok(ls.every((l) => l <= 22));
  assert.equal(L.targets.labTarget, 22);
  // research running: the lab is blocked, the colony goes on with its mines
  out = plan(sb, v, { rqueue: { known: true, busy: true, items: [{ id: 110, level: 11 }] } });
  assert.ok(out.skipped.some((s) => s.cand.item === 31 && /идёт исследование/.test(s.reason)));
  assert.equal(act(out, COL_A).cand.rule, 'mine');
});

T.test('mines: the lowest rank (level + 0 / 5 / 11) across ALL planets goes first, colonies before the main; planets never idle for each other', () => {
  const sb = sandbox();
  const v = empire(sb, { a: BUILT, b: Object.assign({}, BUILT, { 1: 30, 2: 26, 3: 20 }) });
  let out = plan(sb, v, { cfg: { research: false } });
  assert.equal(out.stage.id, 'S1');
  const mines = out.candidates.filter((c) => c.rule === 'mine');
  assert.deepEqual(J(mines.map((c) => c.rank)), J(mines.map((c) => c.rank)).sort((a, b) => a - b), 'ascending rank');
  // colony A: metal 28 (rank 28), crystal 23 (rank 28); colony B: metal 30; main: crystal 40 (rank 45), deut 39 (rank 50)
  // John 2026-11-01 «планеты не ждут друг друга»: the lowest goes first, every other planet with a free queue starts its own lowest
  // mine from its own stock in the same run
  assert.equal(out.actions[0].step.bodyId, COL_A, 'the lowest planet first: ' + J(out.actions.map((a) => a.cand.label)));
  assert.ok([1, 2].includes(out.actions[0].step.id));
  assert.deepEqual(J(out.actions.map((a) => a.step.bodyId)).sort(), J([COL_A, COL_B, MAIN]).sort(), 'one mine per free planet queue');
  const mainA = out.actions.find((a) => a.step.bodyId === MAIN);
  assert.ok(mainA.why.some((w) => /не ждём шахту другой планеты/.test(w)), J(mainA.why));
  assert.ok(!out.candidates.some((c) => c.bodyId === MAIN && c.item === 1 && c.rule === 'mine'), 'main metal 45 = S1 target: no stage candidate');
  // 0.3.2: above the stage target only from the planet's own surplus (rule mineSurplus, ranked after every stage mine)
  const sur = out.candidates.find((c) => c.bodyId === MAIN && c.item === 1);
  assert.ok(sur && sur.rule === 'mineSurplus', 'main metal 46: surplus candidate');
  assert.ok(out.candidates.indexOf(sur) > Math.max(...out.candidates.map((c, i) => (c.rule === 'mine' ? i : -1))), 'after every stage mine');
  // colony A busy building: the others still build their own affordable mines; a higher mine they cannot pay is skipped (no wait,
  // no reservation, no delivery request)
  const vb = empire(sb, { a: BUILT, b: Object.assign({}, BUILT, { 1: 30, 2: 26, 3: 20 }), mainO: { stock: 0, perHour: 1 } });
  vb[1].queue = { known: true, busy: true, items: [{ id: 1, level: 29 }], end: NOW + 60000 };
  out = plan(sb, vb, { cfg: { research: false } });
  assert.ok(out.actions.some((a) => a.step.bodyId === COL_B && a.cand.rule === 'mine'), 'colony B builds while A is busy: ' + J(out.actions.map((a) => a.cand.label)));
  assert.ok(!out.waits.some((w) => w.step.bodyId === MAIN && w.cand.rule === 'mine'), 'the poor main does not wait / request a delivery for a higher mine');
  const main = out.skipped.find((s) => s.cand.bodyId === MAIN && s.cand.rule === 'mine');
  assert.match(main.reason, /сначала самая низкая шахта/);
  // colony A cannot afford its mine for a long time (no stock, tiny production): colony B and then the main may build
  const vw = empire(sb, { a: BUILT, b: Object.assign({}, BUILT, { 1: 30, 2: 26, 3: 20 }), aO: { stock: 0, perHour: 1 } });
  out = plan(sb, vw, { cfg: { research: false } });
  assert.ok(out.waits.some((w) => w.step.bodyId === COL_A), 'colony A waits');
  assert.ok(out.actions.some((a) => a.step.bodyId === COL_B && a.cand.rule === 'mine'), 'colony B builds its lowest mine');
  // ties: the colony before the main planet
  const tie = empire(sb, { main: { 1: 45, 2: 45, 3: 39 }, a: Object.assign({}, BUILT, { 1: 45, 2: 45, 3: 39 }), b: Object.assign({}, BUILT, { 1: 45, 2: 45, 3: 39 }) });
  out = plan(sb, tie, { cfg: { research: false } });
  const d = out.candidates.filter((c) => c.rule === 'mine' && c.item === 3);
  assert.deepEqual(J(d.map((c) => c.bodyId)), [COL_A, COL_B, MAIN], 'deuterium 40 everywhere: colonies first, the main (lab 22) last');
  assert.equal(out.actions[0].step.bodyId, COL_A);
});

T.test('research: the 217 unlock chain first, then 219, then astrophysics until the planet cap, then the shortest production tech', () => {
  const sb = sandbox();
  const v = empire(sb, { a: BUILT, b: BUILT });
  let out = plan(sb, v);
  let r = researchAct(out);
  assert.equal(r.cand.rule, 'unlock'); assert.equal(r.cand.unlock, 217);
  assert.ok([110, 111, 114, 117].includes(r.step.id), '217 needs 110 14, 111 10, 114 10, 117 15: ' + r.step.id);
  assert.equal(r.step.bodyId, MAIN, 'on the lab planet');
  const order = out.candidates.filter((c) => c.kind === 'research' || c.rule === 'unlock').map((c) => c.rule + ':' + (c.unlock || c.item));
  assert.deepEqual(J(order.slice(0, 3)), ['unlock:217', 'unlock:219', 'research:124'], order.join(' '));
  // 217 open -> 219 chain
  const r217 = { 110: 14, 111: 10, 114: 10, 117: 15 };
  out = plan(sb, v, { research: r217 });
  r = researchAct(out);
  assert.equal(r.cand.unlock, 219);
  // both open -> astrophysics (planet cap not reached)
  const r219 = Object.assign({}, r217, { 109: 15, 110: 15, 111: 15, 118: 8 });
  out = plan(sb, v, { research: r219 });
  assert.equal(researchAct(out).step.id, 124);
  // planet cap reached -> the cheapest production tech below the stage target (132 at 0)
  out = plan(sb, v, { research: r219, astroCapped: true });
  assert.equal(researchAct(out).step.id, 132);
  assert.ok(!out.candidates.some((c) => c.item === 124), 'no astrophysics at the cap');
  // the long-term research path follows the same order and reports the missing 219 shipyard level
  const L = ltp(sb, v);
  assert.ok(L.research.path.length >= 4);
  assert.ok(L.research.path.slice(0, 4).every((s) => s.rule === 'unlock'), JSON.stringify(L.research.path.map((s) => s.label)));
  const u = L.research.unlock;
  assert.equal(u[0].id, 217); assert.equal(u[0].done, false);
  assert.ok(u[0].missing.some((m) => /14$/.test(m)), 'Shield 14 missing: ' + u[0].missing.join(', '));
  assert.ok(u[1].missing.some((m) => /Верфь 15/.test(m)), '219 needs shipyard 15: ' + u[1].missing.join(', '));
  // planet cap detection: 2 astrophysics levels without a new planet
  const lib = sb.OGX.botBuild._lib;
  assert.equal(lib.astroCappedOf({ 12: 9 }, 12, 9), false);
  assert.equal(lib.astroCappedOf({ 12: 9, 14: 9 }, 14, 9), true);
  assert.equal(lib.astroCappedOf({ 12: 9, 14: 10 }, 14, 10), false);
});

T.test('lab network 123 = planets with lab 22 minus 1 (time / 2 against the production techs)', () => {
  const sb = sandbox();
  const s2 = { 1: 45, 2: 45, 3: 41, 31: 22 };
  const v = empire(sb, { main: { 2: 45, 3: 41 }, a: Object.assign({}, BUILT, s2), b: Object.assign({}, BUILT, s2) });
  const r219 = { 109: 15, 110: 15, 111: 15, 114: 10, 117: 15, 118: 8, 123: 0, 131: 20, 132: 20, 133: 20 };
  const out = plan(sb, v, { research: r219, astroCapped: true });
  assert.equal(out.stage.irnTarget, 2);
  const c = out.candidates.find((x) => x.item === 123);
  assert.ok(c, 'IRN candidate');
  assert.match(c.label, /сеть лабораторий/);
  assert.equal(researchAct(out).step.id, 123, 'IRN 1 is far cheaper than 131-133 at 21');
  const none = plan(sb, v, { research: Object.assign({}, r219, { 123: 2 }), astroCapped: true });
  assert.ok(!none.candidates.some((x) => x.item === 123), 'IRN at the target: no candidate');
});

T.test('stages: S1 while a colony lags; all at 45/45/41 -> S2; all at 50/50/46 -> S3; progress percent and per-planet progression', () => {
  const sb = sandbox();
  const lib = sb.OGX.botBuild._lib;
  let L = ltp(sb, empire(sb));
  assert.equal(L.stage.id, 'S1');
  const cur = L.stages.filter((s) => s.current);
  assert.deepEqual(J(cur.map((s) => s.id)), ['S1']);
  assert.ok(L.stages[0].pct > 0 && L.stages[0].pct < 100);
  assert.ok(L.stages.every((s, i) => i === 0 || s.pct <= L.stages[i - 1].pct), 'later stages have less progress');
  assert.match(L.summary, /Этап S1/);
  // the main planet already met S1: its own steps continue with S2 targets
  const pm = L.planets.find((p) => p.id === MAIN);
  assert.ok(pm.steps.some((s) => s.rule === 'mine' && s.stage === 'S1'), 'main crystal 41..45 in S1');
  // a planet in the foundation is shown as S0
  assert.equal(L.planets.find((p) => p.id === COL_B).stage, 'S0');
  const s2 = { 1: 45, 2: 45, 3: 41 };
  L = ltp(sb, empire(sb, { main: { 2: 45, 3: 41 }, a: Object.assign({}, BUILT, s2, { 31: 22 }), b: Object.assign({}, BUILT, s2) }));
  assert.equal(L.stage.id, 'S2');
  assert.equal(L.stages[0].done, true);
  const p = L.planets.find((x) => x.id === COL_A);
  assert.ok(p.steps.some((s) => s.rule === 'mine' && s.stage === 'S2'));
  const s3 = { 1: 50, 2: 50, 3: 46 };
  const out = plan(sb, empire(sb, { main: s3, a: Object.assign({}, BUILT, s3, { 31: 22 }), b: Object.assign({}, BUILT, s3, { 31: 22 }) }), { cfg: { research: false } });
  assert.equal(out.stage.id, 'S3');
  assert.ok(out.candidates.filter((c) => c.rule === 'mine').every((c) => /цель S3/.test(c.label)));
  assert.deepEqual(J(lib.stageAt(6).mines), { 1: 70, 2: 70, 3: 66 }, 'after S5: +5 per stage');
  assert.equal(lib.empireStage([]).id, 'S1');
});

T.test('energy: a deficit and a mine that needs more energy are fixed by satellites only (no solar plant / fusion in the tactic)', () => {
  const sb = sandbox();
  const v = empire(sb, { a: BUILT, b: BUILT });
  v[1].energy = { production: 1000, consumption: 5000 };
  let out = plan(sb, v, { cfg: { research: false } });
  const e = out.notes.find((n) => n.event === 'energy' && n.data.body === COL_A);
  assert.equal(e.data.fix.kind, 'sat');
  assert.deepEqual(J(e.data.fix.alternatives.map((x) => x.kind)), ['sat'], 'only satellites offered');
  const a = out.actions.find((x) => x.step.bodyId === COL_A);
  assert.deepEqual([a.step.kind, a.step.id], ['units', 212]);
  assert.ok(!out.candidates.some((c) => c.steps.some((s) => s.id === 4 || s.id === 12)), 'no solar plant / fusion step anywhere');
  // the long-term plan puts the satellites first, too
  const L = ltp(sb, v);
  const pa = L.planets.find((p) => p.id === COL_A);
  assert.equal(pa.steps[0].id, 212);
  assert.equal(pa.steps[0].n, Math.ceil(4000 / (200 / 6)));
  assert.ok(pa.blockers.some((b) => /Дефицит энергии/.test(b)));
  // no shipyard yet: the long-term plan builds the satellites' prerequisites (robots 2, shipyard 1) before them
  const v2 = empire(sb, { b: { 14: 1, 21: 0 } });
  v2[2].energy = { production: 0, consumption: 50 };
  const pb = ltp(sb, v2).planets.find((p) => p.id === COL_B);
  assert.deepEqual(J(pb.steps.slice(0, 3).map((s) => s.id + ':' + (s.level || s.n))), ['14:2', '21:1', '212:' + Math.ceil(50 / (200 / 6))]);
  assert.equal(pb.steps[0].rule, 'energy');
});

T.test('long-term plan: costs and ETA at the current production, fields blocker, state views; the payback policies stay available', () => {
  const sb = sandbox();
  const v = empire(sb, { a: BUILT, b: BUILT, aO: { stock: 0 } });
  const L = ltp(sb, v);
  const pa = L.planets.find((p) => p.id === COL_A);
  const s0 = pa.steps[0];
  const ph = pa.perHour;
  const exp = Math.max(...['metal', 'crystal', 'deuterium'].map((r) => (s0.cost[r] > 0 ? s0.cost[r] / ph[r] : 0)));
  assert.ok(Math.abs(s0.etaH - exp) < 1e-9, `ETA ${s0.etaH} = price / production ${exp}`);
  assert.ok(pa.steps.every((s, i) => i === 0 || s.etaH >= pa.steps[i - 1].etaH), 'cumulative ETA');
  assert.ok(pa.blockers.some((b) => /Не хватает/.test(b)), JSON.stringify(pa.blockers));
  assert.ok(L.next.length === 3 && L.next[0].step, 'one next step per planet');
  // fields: few free fields -> terraformer in the plan and a blocker
  const vf = empire(sb, { a: BUILT, b: BUILT, aO: { fieldsUsed: 399, fieldsMax: 400 } });
  const Lf = ltp(sb, vf, { cfg: { research: false } });
  const pf = Lf.planets.find((p) => p.id === COL_A);
  assert.equal(pf.steps[0].id, 33);
  assert.ok(pf.blockers.some((b) => /Поля кончаются/.test(b)));
  // views from the core state
  const lib = sb.OGX.botBuild._lib;
  const views = lib.viewsFromState({ p1: { key: 'p1', id: 1, type: 'planet', coords: '2:68:9', name: 'X', levels: { 1: 5, 22: 2 }, res: { t: NOW, metal: { amount: 10, storage: 100, perHour: 5 }, crystal: { amount: 1, storage: 100, perHour: 1 }, deuterium: { amount: 0, storage: 100, perHour: 0 } },
    energy: { production: 10, consumption: 4 }, ships: { 212: 7 }, queues: { building: null, t: NOW } }, m2: { key: 'm2', id: 2, type: 'moon', levels: { 41: 1 } } });
  assert.deepEqual(Object.keys(views), ['1']);
  assert.equal(views[1].sats, 7); assert.equal(views[1].res.metal.perHour, 5); assert.deepEqual(J(views[1].energy), { production: 10, consumption: 4 });
  // the payback policy still plans by payback (no tactic rules)
  const pb = plan(sb, empire(sb, { a: BUILT, b: BUILT }), { policy: 'col_mine90', cfg: { storageHours: 4 } });
  assert.ok(!pb.candidates.some((c) => ['mine', 'foundation', 'lab', 'unlock'].includes(c.rule)));
  assert.equal(pb.stage, null);
});

// ---------------------------------------------------------------------------------------------- review fixes (regressions)
const BR = { 109: 15, 110: 15, 111: 15, 114: 10, 117: 15, 118: 8 };   // 217 + 219 research done
T.test('lab vs research in one cycle: a lab step on the lab planet from ANY rule (unlock) holds the research start', () => {
  const sb = sandbox();
  const main = view(sb, MAIN, '2:68:5', Object.assign({}, BUILT, { 1: 40, 2: 40, 3: 39, 31: 6 }));
  const out = plan(sb, [main], { research: { 110: 14, 111: 10, 114: 9, 117: 15, 109: 15, 118: 8 }, astroCapped: true });
  const lab = out.actions.filter((a) => a.step.kind === 'building' && a.step.id === 31 && a.step.bodyId === MAIN);
  assert.equal(lab.length, 1, 'lab 7 ordered for the 217 chain');
  assert.equal(out.actions.filter((a) => a.step.kind === 'research').length, 0, 'no research in the same cycle: ' + J(out.actions.map((a) => a.cand.label)));
  assert.ok(out.skipped.some((s) => s.step && s.step.kind === 'research' && /ждём лабораторию/.test(s.reason)));
});

T.test('lowest-mine hold: a long non-mine queue (lab 10 h) on the lowest planet does not freeze the mines elsewhere', () => {
  const sb = sandbox();
  const main = view(sb, MAIN, '2:68:5', Object.assign({ 1: 40, 2: 40, 3: 39, 31: 22 }, BUILT));
  const col = view(sb, COL_A, '2:68:6', Object.assign({ 1: 30, 2: 30, 3: 28, 31: 22 }, BUILT), { queue: { known: true, busy: true, items: [{ id: 31, level: 23, end: NOW + 10 * 3600000 }], end: NOW + 10 * 3600000 } });
  const out = plan(sb, [main, col], { research: BR, astroCapped: true });
  const m = act(out, MAIN);
  assert.ok(m && [1, 2, 3].includes(m.step.id), 'a mine on the main: ' + J(out.actions.map((a) => a.cand.label)));
  // a short busy queue (30 min) on the lowest planet: the main still builds its own affordable mine (planets never idle for each other)
  const col2 = view(sb, COL_A, '2:68:6', Object.assign({ 1: 30, 2: 30, 3: 28, 31: 22 }, BUILT), { queue: { known: true, busy: true, items: [{ id: 1, level: 31, end: NOW + 1800000 }], end: NOW + 1800000 } });
  const out2 = plan(sb, [main, col2], { research: BR, astroCapped: true });
  assert.ok(out2.actions.some((a) => a.step.bodyId === MAIN && [1, 2, 3].includes(a.step.id)), 'not held behind the colony mine: ' + J(out2.actions.map((a) => a.cand.label)));
  // ... but not when the main cannot pay it now: then it is skipped, not a wait
  const poorMain = view(sb, MAIN, '2:68:5', Object.assign({ 1: 40, 2: 40, 3: 39, 31: 22 }, BUILT), { stock: 0, perHour: 1 });
  const out2b = plan(sb, [poorMain, col2], { research: BR, astroCapped: true });
  assert.ok(!out2b.waits.some((w) => w.step.bodyId === MAIN && w.cand.rule === 'mine'), J(out2b.waits.map((w) => w.cand.label)));
  // a queue whose end passed counts as free
  const col3 = view(sb, COL_A, '2:68:6', Object.assign({ 1: 30, 2: 30, 3: 28, 31: 22 }, BUILT), { queue: { known: true, busy: true, items: [{ id: 31, level: 23, end: NOW - 60000 }], end: NOW - 60000 } });
  const out3 = plan(sb, [main, col3], { research: BR, astroCapped: true });
  assert.ok(!out3.skipped.some((s) => s.cand.bodyId === COL_A && s.reason === 'очередь построек занята'), 'ended queue is not busy');
});

T.test('planet count [x / y] unknown: astrophysics only up to the json cap (3 + astro / 2, max 14 -> 22), then the production techs', () => {
  const sb = sandbox();
  const views = [view(sb, MAIN, '2:68:5', Object.assign({ 1: 45, 2: 45, 3: 41, 31: 22 }, BUILT))];
  const run = (a) => { const i = input(sb, views, { research: Object.assign({ 124: a }, BR) }); i.planets = null; return sb.OGX.botBuild.plan(i); };
  assert.equal(researchAct(run(12)).step.id, 124, 'below the fallback cap: astrophysics first');
  assert.equal(researchAct(run(21)).step.id, 124);
  for (const a of [22, 30]) assert.notEqual(researchAct(run(a)).step.id, 124, 'astro ' + a + ': cap reached, no endless astrophysics');
  assert.ok(run(12).notes.some((n) => n.event === 'planets' && /не прочитано/.test(n.what)), 'journaled: count unknown');
  assert.equal(sb.OGX.botBuild._lib.astroCappedOf(null, 22, 0), true);
  assert.equal(sb.OGX.botBuild._lib.astroCappedOf(null, 21, 0), false);
  const i = Object.assign(input(sb, views, { research: Object.assign({ 124: 12 }, BR) }), { steps: 12 }); i.planets = null;
  const L = sb.OGX.botBuild.longTermPlan(i);
  assert.ok(!L.research.path.some((p) => p.id === 124 && p.level > 22), 'long-term path stops astrophysics at 22');
});

T.test('fields unknown (0 / 0 or null): never read as «no free fields» — buildings are still planned and noted', () => {
  const sb = sandbox();
  const views = [view(sb, MAIN, '2:68:5', Object.assign({ 1: 45, 2: 40, 3: 39, 31: 22 }, BUILT), { fieldsUsed: 0, fieldsMax: 0 }), view(sb, COL_B, '2:68:8', { 1: 0, 2: 0, 3: 0 })];
  views[1].fieldsUsed = null; views[1].fieldsMax = null;
  const out = plan(sb, views);
  assert.ok(!out.skipped.some((s) => s.reason === 'нет свободных полей'), J([...new Set(out.skipped.map((s) => s.reason))]));
  assert.ok(out.actions.some((a) => a.step.kind === 'building'), 'a building ordered: ' + J(out.actions.map((a) => a.cand.label)));
  assert.ok(out.notes.some((n) => n.event === 'fields' && /неизвестно/.test(n.what)));
  assert.ok(!out.candidates.some((c) => c.item === 33), 'no terraformer on unknown fields');
});

T.test('the hour target counts the next mine level; a store dearer than that mine waits behind it (storageLate)', () => {
  const sb = sandbox();
  const v = view(sb, MAIN, '2:68:5', Object.assign({ 1: 44, 2: 45, 3: 41, 31: 22 }, BUILT), { stock: 1000 });
  for (const r of ['metal', 'crystal', 'deuterium']) v.res[r].storage = Math.ceil(12 * v.res[r].perHour) + 1;
  const out = plan(sb, [v], { research: BR, astroCapped: true, cfg: { storageHours: 12 } });
  const st = out.notes.filter((n) => n.event === 'storage' && n.data.res === 'metal');
  assert.ok(st.length && st[0].data.perHourNext > v.res.metal.perHour, 'metal store noted with the next mine production: ' + J(out.notes.filter((n) => n.event === 'storage').map((n) => n.what)));
  assert.equal(st[0].data.rule, 'storageLate', 'store 27 (67e9) is dearer than metal mine 45');
  const first = out.actions.concat(out.waits).find((x) => x.step.bodyId === MAIN && x.step.kind === 'building');
  assert.ok(first && first.step.id === 1, 'the mine before the store: ' + (first && first.cand.label));
});

T.test('«План застройки» from the core state: a building queue that ended long ago is not busy; its item is built (level, field)', () => {
  const sb = sandbox();
  const bodies = { p5: { id: 5, key: 'p5', type: 'planet', coords: '2:68:5', name: 'M', levels: Object.assign({ 1: 45, 2: 45, 3: 41 }, BUILT), fieldsUsed: 300, fieldsMax: 400,
    res: { t: NOW - 2 * 86400000, metal: { amount: 1e9, storage: 4e11, perHour: 4e9 }, crystal: { amount: 1e9, storage: 4e11, perHour: 3e9 }, deuterium: { amount: 1e9, storage: 4e11, perHour: 1e9 } },
    energy: { production: 1e6, consumption: 1e5 }, queues: { t: NOW - 2 * 86400000, building: { objectId: 1, targetLevel: 46, endsAt: NOW - 2 * 86400000 + 30000, queued: [] } } } };
  const v = sb.OGX.botBuild._lib.viewsFromState(bodies, NOW);
  assert.equal(v[5].queue.busy, false);
  assert.deepEqual(J(v[5].queue.items), []);
  assert.equal(v[5].levels[1], 46, 'finished level applied');
  assert.equal(v[5].fieldsUsed, 301, 'its field counted once');
  const L = sb.OGX.botBuild.longTermPlan({ now: NOW, views: v, research: { levels: RESEARCH }, cfg: CFG, factors: sb.OGX.calc.factors({}) });
  assert.ok(!L.planets[0].blockers.some((b) => /Очередь построек занята/.test(b)), J(L.planets[0].blockers));
  // still running -> busy
  bodies.p5.queues.building.endsAt = NOW + 3600000;
  const v2 = sb.OGX.botBuild._lib.viewsFromState(bodies, NOW);
  assert.equal(v2[5].queue.busy, true); assert.equal(v2[5].levels[1], 45);
});

T.test('chain delivery: one need per waiting planet = its chain for the next needAheadMin (sum of step prices − stock, capped by the storage), keep entries, none while a delivery flies there', () => {
  const sb = sandbox();
  const B = sb.OGX.botBuild; const L = B._lib; const M = B._M;
  // colony A: foundation nanites 5 -> 10 waiting, almost no stock and tiny production
  const col = view(sb, COL_A, '2:68:6', Object.assign({}, BUILT, { 1: 28, 2: 23, 3: 22, 15: 5, 31: 22 }), { stock: 1000, perHour: 10 });
  const main = view(sb, MAIN, '2:68:5', Object.assign({ 1: 45, 2: 40, 3: 39, 31: 22 }, BUILT));
  const out = plan(sb, [main, col], { cfg: { research: false } });
  const w = out.waits.find((x) => x.step.bodyId === COL_A);
  assert.ok(w && w.step.id === 15 && w.avail, 'nanites wait with the stock usable now: ' + J(out.waits.map((x) => x.cand.label)));
  // pure helpers: the chain starts with the waiting step, then the planet's own long-term steps while the build time fits
  const lt = B.longTermPlan(Object.assign(input(sb, [main, col], { cfg: { research: false } }), { steps: 24 })).planets.find((p) => p.id === COL_A).steps;
  const gs = L.SEED_SPEED; const factors = sb.OGX.calc.factors({});
  const c45 = L.chainFor({ view: col, first: w.step, steps: lt, aheadMin: 45, gameSpeed: gs, factors });
  const c0 = L.chainFor({ view: col, first: w.step, steps: lt, aheadMin: 0, gameSpeed: gs, factors });
  assert.equal(c0.length, 1, 'needAheadMin 0: the current step only');
  assert.ok(c45.length > 1, 'several steps in 45 min: ' + J(c45.map((s) => s.id + ':' + s.level)));
  assert.deepEqual(J(c45[0]), J(w.step));
  assert.ok(c45.filter((s) => s.id === 15).map((s) => s.level).every((l, i, a) => i === 0 || l === a[i - 1] + 1), 'nanites 6, 7, 8 ... one level each, no duplicate');
  let sec = 0; const lv = Object.assign({}, col.levels);
  for (const s of c45) { if (s.kind === 'building') { sec += sb.OGX.calc.buildTime(s.id, s.level, { robotics: lv[14], nanite: lv[15] || 0, gameSpeed: gs, factors }); lv[s.id] = s.level; } }
  assert.ok(sec <= 45 * 60 + sb.OGX.calc.buildTime(w.step.id, w.step.level, { robotics: col.levels[14], nanite: col.levels[15], gameSpeed: gs, factors }), 'build time within 45 min');
  const n = L.chainNeed({ view: col, chain: c45, first: [w.step], avail: w.avail, at: NOW });
  for (const r of ['metal', 'crystal', 'deuterium']) {
    assert.ok(n.res[r] >= n.min[r], r + ': at least the waiting step');
    assert.ok(n.res[r] <= Math.max(n.min[r], n.room[r]), r + ': capped by the storage room');
    assert.equal(n.min[r], w.missing[r], r + ': min = what the step misses');
  }
  // tiny storage: the delivery fills the store at most (the waiting step itself is still covered)
  const small = JSON.parse(JSON.stringify(col)); small.res.metal.storage = w.step.cost.metal + 5000;
  const n2 = L.chainNeed({ view: small, chain: c45, first: [w.step], avail: w.avail, at: NOW });
  assert.ok(n2.res.metal <= Math.max(n2.min.metal, small.res.metal.storage - 1000), 'storage cap');

  // publishNeeds: one need per planet (planKey), chain inside, keep entries for every planet; published only on change
  const sets = [];
  sb.OGX.bot = { needs: { set: (owner, list) => sets.push(J(list)) }, reservations: { list: () => [] } };
  const reserves = [];
  const wctx = { reserve: (k, res, o) => { reserves.push({ k, res, o }); return 'r' + reserves.length; }, rec: () => {}, flights: () => [] };
  M.views = { [MAIN]: main, [COL_A]: col }; M.research = { levels: RESEARCH }; M.planets = { used: 2, max: 9 }; M.factors = factors; M.resIds = []; M.needSig = null; M.needSince = {};
  const cfg = Object.assign({}, CFG, { research: false, needAheadMin: 45 });
  const pol = L.policyParams('tactic');
  const byBody = new Map([[COL_A, [w]]]);
  L.publishNeeds(wctx, cfg, pol, out, byBody, {}, NOW);
  assert.equal(sets.length, 1);
  const needs = sets[0].filter((x) => x.kind !== 'keep');
  assert.equal(needs.length, 1);
  assert.equal(needs[0].id, 'botbuild:p' + COL_A + ':15:' + w.step.level, 'the need id keeps botbuild:p<id>:<item>:<level>');
  assert.equal(needs[0].planKey, 'botbuild:p' + COL_A);
  assert.ok(needs[0].chain.length > 1 && needs[0].aheadMin === 45);
  assert.ok(needs[0].res.metal > needs[0].min.metal, 'more than one step in one trip: ' + J(needs[0]));
  const keeps = sets[0].filter((x) => x.kind === 'keep');
  assert.deepEqual(keeps.map((k) => k.bodyKey).sort(), ['p' + COL_A, 'p' + MAIN].sort(), 'keep for every planet with a plan');
  assert.ok(keeps.every((k) => k.res === null && k.keep.metal > 0), 'keep entries are not needs (res null)');
  assert.equal(reserves.length, 0, 'no reservation while nothing is on the way: the stock stays usable for others');
  L.publishNeeds(wctx, cfg, pol, out, byBody, {}, NOW + 5000);
  assert.equal(sets.length, 1, 'same needs: not re-published (no wake storm for logistics)');
  // a delivery flies to the colony: no new need for that planet (matched by planet), the waiting step is reserved for it
  L.publishNeeds(wctx, cfg, pol, out, byBody, { ['p' + COL_A]: NOW + 300000 }, NOW + 10000);
  assert.equal(sets.length, 2);
  assert.equal(sets[1].filter((x) => x.kind !== 'keep').length, 0, 'no re-request while the delivery flies');
  assert.equal(reserves.length, 1); assert.equal(reserves[0].k, 'p' + COL_A);
  // needAheadMin 0: the waiting step only (the old behaviour)
  M.needSig = null;
  L.publishNeeds(wctx, Object.assign({}, cfg, { needAheadMin: 0 }), pol, out, byBody, {}, NOW + 20000);
  const n0 = sets[sets.length - 1].find((x) => x.kind !== 'keep');
  assert.deepEqual(n0.res, n0.min); assert.equal(n0.chain.length, 1);
  M.views = {};
});

T.test('queue depth: a busy queue with room is planned past its items (levels advanced, unpaid items off the stock); depth 1 keeps it busy', () => {
  const sb = sandbox();
  const C = sb.OGX.calc;
  // colony A: mines only left, crystal mine 23 -> 24 already queued behind a metal mine 28 -> 29 (head, paid)
  const q = { known: true, busy: true, items: [{ id: 1, level: 29, end: NOW + 60000 }, { id: 2, level: 24, end: null }], end: NOW + 60000 };
  const v = empire(sb, { a: BUILT, b: BUILT }, );
  v[1].queue = q;
  let out = plan(sb, v, { cfg: { research: false, queueDepth: 1 } });
  assert.ok(!act(out, COL_A), 'depth 1: nothing appended to a busy queue');
  out = plan(sb, v, { cfg: { research: false, queueDepth: 5 } });
  const a = act(out, COL_A);
  assert.ok(a, 'depth 5: the next step is appended');
  assert.equal(a.step.kind, 'building');
  if (a.step.id === 1) assert.equal(a.step.level, 30, 'metal mine after the queued 29');
  if (a.step.id === 2) assert.equal(a.step.level, 25, 'crystal mine after the queued 24');
  // the queued crystal mine 24 is unpaid: with exactly its price in stock nothing else fits
  const c24 = C.cost(2, 24);
  const poor = empire(sb, { a: BUILT, b: BUILT }, );
  poor[1].queue = q;
  for (const r of ['metal', 'crystal', 'deuterium']) poor[1].res[r].amount = Math.ceil(c24[r]); poor[1].res.metal.perHour = 0; poor[1].res.crystal.perHour = 0; poor[1].res.deuterium.perHour = 0;
  out = plan(sb, poor, { cfg: { research: false, queueDepth: 5 } });
  assert.ok(!act(out, COL_A), 'the stock is kept for the queued item');
  // a full queue (5 items) is never appended to
  const full = empire(sb, { a: BUILT, b: BUILT }, );
  full[1].queue = { known: true, busy: true, items: [1, 2, 3, 1, 2].map((id, i) => ({ id, level: 30 + i, end: null })), end: NOW + 60000 };
  assert.ok(!act(plan(sb, full, { cfg: { research: false, queueDepth: 5 } }), COL_A), 'queue full');
});

T.test('satellites for a mine come in one order for satAheadLevels levels when the planet pays them; else only for the next level', () => {
  const sb = sandbox();
  const one = empire(sb, { a: BUILT, b: BUILT });
  one[1].energy = { production: 1000, consumption: 1000 };   // balance 0: the next mine needs satellites
  const n1 = (o) => { const a = act(plan(sb, one, { cfg: Object.assign({ research: false }, o) }), COL_A); return a && a.step.id === 212 ? a.step.n : null; };
  const small = n1({ satAheadLevels: 1 });
  const big = n1({ satAheadLevels: 5 });
  assert.ok(small > 0 && big > small * 3, `x5 levels: ${big} satellites instead of ${small}`);
  // a planet that cannot pay the big batch orders only the next level's satellites
  for (const r of ['metal', 'crystal', 'deuterium']) one[1].res[r].amount = 0;
  const pr = one[1].res;
  const unit = sb.OGX.calc.unitCost(212, small);
  const mx = (r) => Math.max(...[1, 2, 3].map((id) => sb.OGX.calc.cost(id, one[1].levels[id] + 1)[r]));
  pr.metal.amount = mx('metal'); pr.crystal.amount = unit.crystal + mx('crystal'); pr.deuterium.amount = unit.deuterium + mx('deuterium');
  for (const r of ['metal', 'crystal', 'deuterium']) pr[r].perHour = 0;
  const n = n1({ satAheadLevels: 5 });
  assert.ok(n === null || n === small, `not payable: ${n} (one level: ${small}, five: ${big})`);
});

T.test('queue depth + fields: queued items count once (Σ built levels + queue), the last free field stays for the terraformer', () => {
  const sb = sandbox();
  const v = empire(sb, { a: BUILT, b: BUILT });
  const lv = v[1].levels;
  const built = Object.entries(lv).reduce((s, [id, l]) => (+id < 100 ? s + l : s), 0);
  // two mines queued, one field left after them -> the terraformer, no third mine
  v[1].queue = { known: true, busy: true, items: [{ id: 1, level: lv[1] + 1, end: NOW + 60000 }, { id: 2, level: lv[2] + 1, end: null }], end: NOW + 60000 };
  v[1].fieldsUsed = built; v[1].fieldsMax = built + 3;
  const out = plan(sb, v, { cfg: { research: false, queueDepth: 5 } });
  const a = act(out, COL_A);
  assert.ok(a && a.step.id === 33, 'the last field: terraformer, got ' + (a && a.step.id));
  assert.equal(v[1].fieldsUsed, built, 'the real view keeps Σ built levels');
});
