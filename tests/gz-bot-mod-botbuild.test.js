'use strict';
// botbuild: module unit checks of the pure planner (node sandbox, the file as the extension loads it, with the real core calc/catalog).
//   settings = BOT_CONTRACT C5 botbuild (all off), embedded policies = the strategy plan params, payback numbers, energy fix,
//   storage rules (cap, hours, price > capacity, overflow), fields (0 free, last field -> terraformer), 2Moons queue rules
//   (31 during research, research while 6/31 queued, 15/21 while the shipyard works, units while 15/21 queued), 124 odd-level
//   price, no plasma, par_tol, infrastructure (rho_R needs the game speed), IRN, expedition slots, cooldown.
//   node tests/gz-bot-mod-botbuild.test.js
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
const CFG = { satAheadLevels: 1, buildings: true, research: true, energy: true, storageHours: 4, fieldsReserve: 1, ensureExpoSlots: true, university: true, moons: false, defense: false };

function view(id, o = {}) {
  const v = {
    id, key: 'p' + id, coords: o.coords || '2:68:' + (id - 254097), name: 'P' + id, isMoon: false, tempMax: o.tempMax !== undefined ? o.tempMax : 40,
    fieldsUsed: o.fieldsUsed !== undefined ? o.fieldsUsed : 60, fieldsMax: o.fieldsMax || 163,
    levels: Object.assign({ 1: 12, 2: 10, 3: 8, 4: 12, 14: 4, 21: 4, 22: 8, 23: 8, 24: 8, 31: 8 }, o.levels || {}), t: NOW,
    res: {}, energy: o.energy === undefined ? { production: 5000, consumption: 2600 } : o.energy,
    queue: o.queue || { known: true, busy: false, items: [], end: null }, shipyard: o.shipyard === undefined ? { known: true, items: [], t: NOW } : o.shipyard,
    perSat: o.perSat || null, percents: {}, defense: o.defense || null,
  };
  const stock = o.stock || [2e6, 1e6, 5e5]; const ph = o.perHour || [40000, 20000, 10000]; const st = o.storage || [8e6, 8e6, 8e6];
  ['metal', 'crystal', 'deuterium'].forEach((r, i) => { v.res[r] = { amount: stock[i], storage: st[i], perHour: ph[i] }; });
  return v;
}
function input(sb, views, o = {}) {
  const L = sb.OGX.botBuild._lib;
  const pol = L.policyParams(o.policy || 'dis_exp90', o.json);
  return Object.assign({
    now: NOW, P: pol.params, policyName: pol.name, cfg: Object.assign({}, CFG, o.cfg || {}), views: Object.fromEntries(views.map((v) => [v.id, v])), order: views.map((v) => v.id),
    research: { levels: Object.assign({ 106: 12, 108: 12, 113: 12, 117: 10, 124: 9 }, o.research || {}), queue: o.rqueue || { known: true, busy: false, items: [] } },
    factors: sb.OGX.calc.factors({}), officers: {}, gameSpeed: o.gameSpeed || null, planets: o.planets || { used: views.length, max: 6 }, cooldowns: o.cooldowns || {}, reserved: {}, deutReserve: 0,
  }, o.extra || {});
}
const plan = (sb, views, o) => sb.OGX.botBuild._lib.plan(input(sb, views, o));
const steps = (out) => J(out.actions.map((a) => [a.step.kind, a.step.id, a.step.bodyId]));

T.test('module definition: name, title, contract C5 settings with defaults (tactic, storages auto = 0, lab 22, shipyard 14), everything on (0.3.2), Russian labels', () => {
  const sb = sandbox();
  const def = sb.OGX.modules.botbuild;
  assert.equal(def.title, 'Бот: стройка и исследования');
  const want = { on: true, policy: 'tactic', policyJson: {}, buildings: true, research: true, energy: true, storageHours: 0, labTarget: 22, shipyardTarget: 14,
    fieldsReserve: 1, maxRetries: 3, ensureExpoSlots: true, university: true, randomOrder: true, moons: true, defense: true, queueDepth: 5, satAheadLevels: 10, satBatchMaxMin: 30, surplusMines: true, needAheadMin: 45 };
  assert.deepEqual(Object.keys(def.settings).sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) assert.deepEqual(J(def.settings[k].default), v, k);
  assert.deepEqual(J(def.settings.policy.options.map((o) => o.value)), ['tactic', 'col_mine90', 'dis_exp90', 'custom']);
  assert.equal(def.settings.labTarget.min, 22, 'the lab target never below 22'); assert.equal(def.settings.shipyardTarget.min, 14);
  for (const [k, s] of Object.entries(def.settings)) assert.ok(/[а-яё]/i.test(s.label), k + ': Russian label');
});

T.test('embedded policies = strategies.<name>.policy.params of the strategy plan; custom policyJson on top of col_mine90', () => {
  const sb = sandbox();
  const P = J(sb.OGX.botBuild.POLICIES);
  const EXPECT = {
    col_mine90: { vC: 3.6564, vD: 4.4077, wM: 1.5716, wC: 1.2823, wD: 2.2721, w_plasma: 3.3939, w_col: 0.4414, beta_col: 0.3546, w_crawl: 2.8071, w_exp: 0.6028, kappa: 0.3525, rho_R: 0.4357, rho_L: 0.1714, psi: 0.1344, par_tol: 0.0133, w_sat: 0.6394, w_fus: 1.0817, col_pattern: 0, overflow: 0, irn: 1 },
    dis_exp90: { vC: 4.5891, vD: 6.3264, wM: 0.7307, wC: 0.9666, wD: 1.5173, w_plasma: 1.3386, w_col: 0.4748, beta_col: 0.6312, w_crawl: 0.5105, w_exp: 1.4857, kappa: 1.7746, rho_R: 0.989, rho_L: 0.951, psi: 1.1909, par_tol: 0, w_sat: 3, w_fus: 1.4862, col_pattern: 0, overflow: 1, irn: 0 },
  };
  assert.deepEqual(P, EXPECT);
  const planFile = '/mnt/project-files/ogamex-strategy/ogamex_strategy_plan.json';
  if (fs.existsSync(planFile)) {
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    for (const n of ['col_mine90', 'dis_exp90']) assert.deepEqual(P[n], plan.strategies[n].policy.params, n + ' = the plan file');
  }
  const L = sb.OGX.botBuild._lib;
  const c = J(L.policyParams('custom', { params: { w_plasma: 0.5, bogus: 1, vC: 'x' } }));
  assert.equal(c.name, 'custom'); assert.equal(c.params.w_plasma, 0.5); assert.equal(c.params.vC, EXPECT.col_mine90.vC);
  assert.equal(c.warnings.length, 2);
  assert.equal(J(L.policyParams('nonsense')).name, 'col_mine90');
});

T.test('payback = cost MSU / Δproduction MSU x weight (x22000, 131-133 bonus); the best payback per queue is ordered', () => {
  const sb = sandbox();
  const home = view(254102, { levels: { 1: 12 } });
  const out = plan(sb, [home], { research: { 131: 3 } });
  const P = sb.OGX.botBuild._lib.policyParams('dis_exp90').params;
  const m = out.candidates.find((c) => c.item === 1);
  const gain = 30 * (13 * Math.pow(1.1, 13) - 12 * Math.pow(1.1, 12)) * 22000 * (1 + 0.02 * 3);
  assert.ok(Math.abs(m.gainMsu - gain) < 1e-6 * gain, `metal gain ${m.gainMsu} vs ${gain}`);
  const cost = Math.floor(60 * Math.pow(1.5, 12)) + Math.floor(15 * Math.pow(1.5, 12)) * P.vC;
  assert.ok(Math.abs(m.costMsu - cost) < 1e-6, 'cost MSU');
  assert.ok(Math.abs(m.payback - cost / gain * P.wM) < 1e-9, 'payback x wM');
  const r = out.candidates.find((c) => c.item === 132);
  const sumC = 20 * 10 * Math.pow(1.1, 10) * 22000;
  assert.ok(Math.abs(r.gainMsu - 0.02 * sumC * P.vC) < 1e-6 * r.gainMsu, '132 gain = 2 % of the mine part');
  const sorted = out.candidates.map((c) => c.payback);
  assert.deepEqual(sorted, sorted.slice().sort((a, b) => a - b), 'ascending');
  assert.deepEqual(J(out.actions.map((a) => a.step.queue)).sort(), ['b:254102', 'r'], 'one order per queue');
  assert.ok(!out.candidates.some((c) => c.item === 122 || c.steps.some((s) => s.id === 122)), 'plasma 122 is never a candidate');
});

T.test('energy: deficit -> satellites ceil(deficit / per-satellite) (page value first, formula (Tmax+160)/6 x (1+Energy) otherwise); no shipyard -> cheapest chain', () => {
  const sb = sandbox();
  const col = { policy: 'col_mine90' };   // w_sat 0.64 (dis_exp90 prices satellites x3: solar can win there)
  let out = plan(sb, [view(254102, { energy: { production: 2000, consumption: 2600 } })], col);
  let e = out.notes.find((n) => n.event === 'energy');
  assert.equal(e.data.deficit, 600);
  assert.equal(e.data.fix.kind, 'sat'); assert.equal(e.data.fix.perSatSrc, 'formula');
  assert.equal(e.data.fix.n, Math.ceil(600 / (200 / 6)));
  assert.deepEqual(steps(out)[0], ['units', 212, 254102], 'satellites first');
  assert.equal(out.actions[0].step.n, 18);
  assert.ok(out.reads.some((r) => r.page === 'resources'), 'asks for page=resources (per-satellite output)');
  out = plan(sb, [view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 30817 / 797 } })], col);
  assert.equal(out.actions[0].step.n, 16, 'page value 38.67 -> 16');
  // queued satellites count: no second order
  out = plan(sb, [view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 30817 / 797 }, shipyard: { known: true, items: [{ id: 212, count: 16 }], t: NOW } })], col);
  assert.ok(!out.notes.some((n) => n.event === 'energy'), 'queued satellites cover the deficit');
  // unknown shipyard queue -> read first
  out = plan(sb, [view(254102, { energy: { production: 2000, consumption: 2600 }, shipyard: null })], col);
  assert.ok(out.reads.some((r) => r.page === 'shipyard' && r.bodyId === 254102));
  assert.ok(!out.actions.some((a) => a.step.kind === 'units'));
  // 15/21 in the building queue -> no units
  out = plan(sb, [view(254102, { energy: { production: 2000, consumption: 2600 }, queue: { known: true, busy: true, items: [{ id: 21, level: 5 }] } })], col);
  assert.ok(!out.actions.some((a) => a.step.kind === 'units') && out.skipped.some((s) => s.cand.rule === 'energy'), 'satellites wait for 15/21 (the solar fallback needs the busy building queue)');
  // no shipyard: the satellite option costs robots 2 + shipyard 1 too; solar may win
  out = plan(sb, [view(254102, { levels: { 21: 0, 14: 0 }, energy: { production: 2000, consumption: 2600 } })], col);
  e = out.notes.find((n) => n.event === 'energy');
  assert.ok(['sat', 'solar', 'fusion'].includes(e.data.fix.kind));
  const alts = e.data.fix.alternatives.map((a) => a.costMsu);
  assert.deepEqual(alts, alts.slice().sort((a, b) => a - b), 'cheapest first');
  // a mine whose extra use creates a deficit carries the fix in its price and first step
  out = plan(sb, [view(254102, { energy: { production: 2650, consumption: 2600 } })], col);
  const m = out.candidates.find((c) => c.item === 1);
  assert.ok(m.fix && m.steps[0].kind === 'units' && m.steps[0].id === 212, 'metal mine 13 needs satellites first: ' + JSON.stringify(m.fix));
});

T.test('storages: at the cap -> storage; capacity below storageHours of production -> storage (order D, C, M); price > capacity -> storage first; overflow while waiting (dis_exp90)', () => {
  const sb = sandbox();
  let out = plan(sb, [view(254102, { stock: [9e6, 1e6, 5e5] })]);
  assert.deepEqual(steps(out)[0], ['building', 22, 254102]);
  assert.equal(out.candidates[0].rule, 'storageFull');
  // below storageHours (4 h) and not dearer than the cheapest next mine (mines 25: crystal mine 26 = 1.8M; tank 9 = 512k) -> first
  out = plan(sb, [view(254102, { levels: { 1: 25, 2: 25, 3: 25 }, perHour: [40000, 3e6, 3e6] })]);
  assert.equal(out.candidates[0].rule, 'storageHours'); assert.equal(out.candidates[0].item, 24, 'deuterium first');
  assert.equal(out.candidates[1].item, 23);
  // dearer than the cheapest next mine (mines 12/10/8: a few thousand) -> storageLate, after every mine (payback order too)
  out = plan(sb, [view(254102, { perHour: [40000, 3e6, 3e6] })]);
  const late = out.candidates.map((c, i) => [c, i]).filter(([c]) => c.rule === 'storageLate');
  assert.deepEqual(J(late.map(([c]) => c.item)), [24, 23]);
  const mineIdx = out.candidates.map((c, i) => ([1, 2, 3].includes(c.item) ? i : -1)).filter((i) => i >= 0);
  assert.ok(mineIdx.length && Math.min(...late.map(([, i]) => i)) > Math.max(...mineIdx), 'stores after the mines');
  // capacity below 1.1 x the next mine price in that resource (crystal of deuterium mine 26 = 1.9M > 1M) -> storageNeed first
  out = plan(sb, [view(254102, { levels: { 1: 25, 2: 25, 3: 25 }, storage: [8e6, 1e6, 8e6], stock: [2e6, 5e5, 5e5] })]);
  assert.equal(out.candidates[0].rule, 'storageNeed'); assert.equal(out.candidates[0].item, 23);
  assert.deepEqual(steps(out)[0], ['building', 23, 254102]);
  // auto (0): 3 h of production
  const L = sb.OGX.botBuild._lib;
  assert.equal(L.storageHoursOf({ storageHours: 0 }), 3);
  out = plan(sb, [view(254102, { levels: { 1: 25, 2: 25, 3: 25 }, perHour: [40000, 2e6, 3e6] })], { cfg: { storageHours: 0 } });
  assert.deepEqual(J(out.candidates.filter((c) => c.rule === 'storageHours').map((c) => c.item)), [24], 'only deuterium: 8M < 3 h x 3M, crystal 8M >= 3 h x 2M');
  // price above capacity: crystal storage 1 (100 000 x 5 x ...) vs a mine needing more crystal
  out = plan(sb, [view(254102, { levels: { 2: 30 }, storage: [8e9, 1e5, 8e9], stock: [1e9, 5e4, 1e8], perHour: [1, 1, 1] })], { cfg: { research: false } });
  const st = out.notes.find((n) => n.event === 'storage' && n.data.rule === 'price');
  assert.ok(st, 'price > capacity journaled');
  assert.ok(out.actions.concat(out.waits, out.skipped).some((a) => a.step && a.step.id === 23), 'crystal storage instead of the crystal mine');
  // overflow: the best step waits longer than metal takes to fill -> metal storage first (overflow 1), col_mine90 (overflow 0) waits
  const v = () => view(254102, { stock: [7.9e6, 0, 0], perHour: [1e6, 1, 1], storage: [8e6, 8e6, 8e6] });
  out = plan(sb, [v()], { cfg: { research: false } });
  assert.ok(out.notes.some((n) => n.event === 'storage' && n.data.rule === 'overflow'), 'overflow journaled');
  assert.deepEqual(steps(out), [['building', 22, 254102]]);
  out = plan(sb, [v()], { policy: 'col_mine90', cfg: { research: false } });
  assert.ok(!out.notes.some((n) => n.event === 'storage' && n.data.rule === 'overflow'));
  assert.equal(out.actions.length, 0); assert.equal(out.waits.length, 1);
});

T.test('fields: none free incl. queue -> no building; exactly one free -> terraformer only (chain if nanite missing); reserve keeps the last field', () => {
  const sb = sandbox();
  let out = plan(sb, [view(254102, { fieldsUsed: 163 })], { cfg: { research: false } });
  assert.equal(out.actions.length, 0);
  assert.ok(out.notes.some((n) => n.event === 'fields' && n.data.free === 0));
  out = plan(sb, [view(254102, { fieldsUsed: 162, levels: { 15: 1 } })], { cfg: { research: false } });
  assert.deepEqual(steps(out), [['building', 33, 254102]]);
  out = plan(sb, [view(254102, { fieldsUsed: 161, levels: { 15: 1 }, queue: { known: true, busy: true, items: [{ id: 1, level: 13 }] } })], { cfg: { research: false } });
  assert.ok(out.candidates.some((c) => c.item === 33 && c.rule === 'fields'), 'queue counts: 161 + 1 queued of 163 -> 1 free');
  out = plan(sb, [view(254102, { fieldsUsed: 162, levels: { 15: 0, 14: 10 } })], { cfg: { research: false } });
  const t = out.candidates.find((c) => c.item === 33);
  assert.equal(t.steps[0].id, 15, 'chain: nanite first');
  assert.equal(out.actions.length, 0, 'the nanite would take the reserved last field: nothing');
  // terraformer energy price above production -> satellites first
  out = plan(sb, [view(254102, { fieldsUsed: 162, levels: { 15: 1 }, energy: { production: 600, consumption: 500 } })], { cfg: { research: false } });
  assert.deepEqual(steps(out)[0], ['units', 212, 254102]);
});

T.test('fields: the tooltip lags one field behind the levels (log 2026-11-01 [2:68:14] 189/189) -> Σ levels counts, the last field goes to the terraformer', () => {
  const sb = sandbox();
  const L = sb.OGX.botBuild._lib;
  // [2:68:14] right before the deuterium synthesizer 28: Σ levels 188 of 189, the planet-list tooltip still said 187
  const lv = { 1: 38, 2: 34, 3: 27, 4: 14, 14: 10, 15: 10, 21: 14, 22: 15, 23: 14, 24: 12, 31: 0, 33: 0 };
  assert.equal(L.levelFields(lv), 188);
  assert.equal(L.levelFields({ 1: 5, 2: 3, 212: 400, 113: 12 }), 8, 'ships / research ids never count');
  let out = plan(sb, [view(254113, { fieldsUsed: 187, fieldsMax: 189, levels: lv })], { cfg: { research: false } });
  assert.ok(out.candidates.some((c) => c.item === 33 && c.rule === 'fields'), 'one free field by levels -> terraformer');
  assert.ok(out.actions.every((a) => a.step.id === 33 || a.step.kind !== 'building'), 'no other building takes the last field');
  const n = out.notes.find((x) => x.event === 'fields');
  assert.equal(n.data.used, 188); assert.equal(n.data.tip, 187);
  // full planet: a clear hint (the game refuses the terraformer too), no building
  out = plan(sb, [view(254113, { fieldsUsed: 189, fieldsMax: 189, levels: Object.assign({}, lv, { 3: 28 }) })], { cfg: { research: false } });
  assert.equal(out.actions.filter((a) => a.step.kind === 'building').length, 0);
  const full = out.notes.find((x) => x.event === 'fields' && x.data.free === 0);
  assert.equal(full.data.stuck, true); assert.ok(/снесите вручную 1 уровень/.test(full.what));
  // a higher tooltip (e.g. imperium after a demolition the levels missed) is kept: max, never lower
  const w = view(254113, { fieldsUsed: 170, levels: { 1: 10 } });
  assert.equal(L.syncFields(w), 0); assert.equal(w.fieldsUsed, 170);
});

T.test('2Moons queue rules: 31 never during research, no research while 6/31 queued on the lab planet, 15/21 not while the shipyard works, only empty queues', () => {
  const sb = sandbox();
  const json = { w_plasma: 1e-6 };
  // research running: the 131 chain wants lab 5 -> blocked; a mine is ordered instead
  let out = plan(sb, [view(254102, { levels: { 31: 4 } })], { policy: 'custom', json, rqueue: { known: true, busy: true, items: [{ id: 108, level: 13 }] } });
  assert.ok(out.skipped.some((s) => s.cand.steps[0].id === 31 && /идёт исследование/.test(s.reason)));
  assert.ok(!out.actions.some((a) => a.step.id === 31));
  assert.ok(out.actions.some((a) => a.step.kind === 'building' && [1, 2, 3].includes(a.step.id)));
  out = plan(sb, [view(254102, { levels: { 31: 4 } })], { policy: 'custom', json });
  assert.deepEqual(steps(out)[0], ['building', 31, 254102], 'without research the lab is the chain step');
  // 31 queued on the lab planet -> research blocked
  out = plan(sb, [view(254102, { queue: { known: true, busy: true, items: [{ id: 31, level: 9 }] } })]);
  assert.ok(!out.actions.some((a) => a.step.kind === 'research'));
  assert.ok(out.skipped.some((s) => s.cand.kind === 'research' && /лаборатория/.test(s.reason)));
  // shipyard busy -> 15/21 blocked (robots rule via custom policy + game speed)
  out = plan(sb, [view(254102, { levels: { 14: 10 }, shipyard: { known: true, items: [{ id: 202, count: 5 }], t: NOW } })], { policy: 'custom', json: { rho_R: 0, psi: 1e9 }, gameSpeed: 1, research: { 108: 12 }, cfg: { research: false } });
  assert.ok(!out.actions.some((a) => a.step.id === 15), 'nanite not while the shipyard works');
  assert.ok(out.actions.some((a) => a.step.id === 14), 'robots instead');
  // busy building queue -> no second item (only paid items)
  out = plan(sb, [view(254102, { queue: { known: true, busy: true, items: [{ id: 1, level: 13 }] } })], { cfg: { research: false } });
  assert.equal(out.actions.length, 0);
});

T.test('124: a new planet only when all slots are used; odd level -> price of two levels; ensureExpoSlots -> 108', () => {
  const sb = sandbox();
  let out = plan(sb, [view(254102)], { planets: { used: 6, max: 6 }, research: { 124: 9 } });
  let c = out.candidates.find((x) => x.item === 124);
  assert.equal(c.level, 11, 'from 9 (odd) the next planet needs 11');
  const L = sb.OGX.botBuild._lib;
  const two = L.costRange(124, 9, 11);
  assert.ok(Math.abs(c.cost.metal - two.metal) < 1 && Math.abs(c.cost.crystal - two.crystal) < 1, 'two levels priced');
  assert.equal(c.weight, L.policyParams('dis_exp90').params.w_col);
  out = plan(sb, [view(254102)], { planets: { used: 6, max: 6 }, research: { 124: 10 } });
  c = out.candidates.find((x) => x.item === 124);
  assert.equal(c.level, 11, 'from 10 (even) one level');
  out = plan(sb, [view(254102)], { planets: { used: 2, max: 6 } });
  assert.ok(!out.candidates.some((x) => x.item === 124), 'free planet slots: no 124');
  out = plan(sb, [view(254102)], { research: { 124: 16, 108: 3 } });
  c = out.candidates.find((x) => x.item === 108);
  assert.equal(c.rule, 'expoSlots', '4 expeditions + 1 > 4 slots');
  assert.deepEqual(steps(out).find((s) => s[0] === 'research'), ['research', 108, 254102]);
});

T.test('par_tol: another queue may start only if it delays the waiting best step by <= par_tol x wait', () => {
  const sb = sandbox();
  // the best (crystal mine on home) waits; research on the same (lab) planet is affordable
  const v = () => view(254102, { stock: [5e6, 1000, 5e6], perHour: [40000, 1000, 10000], levels: { 2: 10 } });
  let out = plan(sb, [v()], { policy: 'custom', json: { par_tol: 0, wM: 1e6, wD: 1e6, w_plasma: 1e3 } });
  assert.equal(out.waits[0].cand.item, 2);
  assert.ok(out.skipped.some((s) => s.cand.kind === 'research' && /par_tol/.test(s.reason)), 'par_tol 0: research waits');
  out = plan(sb, [v()], { policy: 'custom', json: { par_tol: 1e9, wM: 1e6, wD: 1e6, w_plasma: 1e3 } });
  assert.ok(out.actions.some((a) => a.step.kind === 'research'), 'large par_tol: research runs in parallel');
});

T.test('infrastructure: robots when the step takes longer than rho_R x time to earn the robots (needs the game speed); IRN with irn = 1', () => {
  const sb = sandbox();
  const json = { rho_R: 0, psi: 1e9 };
  let out = plan(sb, [view(254102)], { policy: 'custom', json, cfg: { research: false } });
  assert.ok(!out.actions.some((a) => a.step.id === 14), 'unknown game speed: no time rule');
  out = plan(sb, [view(254102)], { policy: 'custom', json, gameSpeed: 1, cfg: { research: false } });
  assert.deepEqual(steps(out), [['building', 14, 254102]]);
  assert.ok(out.actions[0].why.some((w) => /инфраструктура/.test(w)));
  // IRN: two other labs, the next research costs more than IRN 1
  const views = [view(254102, { levels: { 31: 12 } }), view(254103, { levels: { 31: 10 } }), view(254104, { levels: { 31: 10 } })];
  out = plan(sb, views, { policy: 'col_mine90', research: { 131: 12, 132: 12, 133: 12, 114: 8 }, cfg: { buildings: false } });
  assert.deepEqual(steps(out).find((s) => s[0] === 'research'), ['research', 123, 254102]);
});

T.test('cooldown blocks the item; reqSteps and the queue parser helpers', () => {
  const sb = sandbox();
  let out = plan(sb, [view(254102)], { cfg: { research: false } });
  const best = out.actions[0].step;
  out = plan(sb, [view(254102)], { cfg: { research: false }, cooldowns: { [best.bodyId + ':' + best.id]: NOW + 1000 } });
  assert.ok(out.skipped.some((s) => s.cand.steps[0].id === best.id && /пауза/.test(s.reason)));
  assert.notEqual(out.actions[0].step.id, best.id);
  const L = sb.OGX.botBuild._lib;
  assert.deepEqual(J(L.reqSteps(131, { levels: { 31: 6 } }, { 113: 4 })), [{ id: 31, level: 7, kind: 'building' }, { id: 31, level: 8, kind: 'building' }, { id: 113, level: 5, kind: 'research' }]);
  assert.deepEqual(J(L.reqSteps(212, { levels: { 14: 1, 21: 0 } }, {})), [{ id: 14, level: 2, kind: 'building' }, { id: 21, level: 1, kind: 'building' }]);
  assert.equal(L.reqsMet(33, { levels: { 15: 1 } }, { 113: 12 }), true);
});

T.test('game speed seed (Aeternum x3040), queue end estimates, cached views: queue ends applied, stale after an end / order, fresh only after a read', () => {
  const sb = sandbox();
  const L = sb.OGX.botBuild._lib; const M = sb.OGX.botBuild._M; const C = sb.OGX.calc;
  assert.equal(L.SEED_SPEED, 3040);
  assert.equal(L.speedOf(), 3040, 'not learned yet: the measured Aeternum speed');
  // measured: build h = (M + C) / (7.6e6 x (1 + robots) x 2^nanites)
  const c = C.cost(1, 30);
  const sec = C.buildTime(1, 30, { robotics: 10, nanite: 5, gameSpeed: L.speedOf(), factors: C.factors({}) });
  assert.ok(Math.abs(sec - Math.floor((c.metal + c.crystal) / (7.6e6 * 11 * 32) * 3600)) <= 1, 'build time ' + sec);
  M.gameSpeed = { value: 1500, samples: [1500] };
  assert.equal(L.speedOf(), 1500, 'learned from a real order beats the seed');
  M.gameSpeed = null;
  // a busy queue without timers: ends chained from the read time at the game speed
  const v = view(254102, { levels: { 14: 10, 15: 5 } });
  const q = L.estimateQueue({ known: true, busy: true, items: [{ id: 1, level: 13, end: null }, { id: 2, level: 11, end: null }], end: null }, v, 'building', NOW);
  const t1 = C.buildTime(1, 13, { robotics: 10, nanite: 5, gameSpeed: 3040, factors: C.factors({}) });
  const t2 = C.buildTime(2, 11, { robotics: 10, nanite: 5, gameSpeed: 3040, factors: C.factors({}) });
  assert.equal(q.items[0].end, NOW + Math.max(1, t1) * 1000);
  assert.equal(q.end, NOW + (Math.max(1, t1) + Math.max(1, t2)) * 1000);
  assert.equal(q.est, true);
  // an item without id / level: no estimate (unknown stays unknown)
  const q2 = L.estimateQueue({ known: false, busy: true, items: [{ id: null, level: null, end: null }], end: null }, v, 'building', NOW);
  assert.equal(q2.end, null);
  // queue ends passed: levels / field / storage capacity applied to the cache, the view becomes stale (re-read before an order)
  const w = view(254102, { levels: { 22: 8 } });
  w.readAt = NOW; w.stale = false;
  w.queue = { known: true, busy: true, items: [{ id: 22, level: 9, end: NOW + 1000 }, { id: 1, level: 13, end: NOW + 5000 }], end: NOW + 5000 };
  M.views = { 254102: w };
  assert.equal(L.freshView(w, NOW + 500), true, 'read 0.5 s ago, nothing changed');
  L.advanceViews(NOW + 2000);
  assert.equal(w.levels[22], 9); assert.equal(w.fieldsUsed, 61); assert.equal(w.res.metal.storage, C.storageCapacity(9, { factors: C.factors({}) }));
  assert.equal(w.queue.items.length, 1); assert.equal(w.queue.busy, true);
  assert.equal(w.stale, true); assert.equal(L.freshView(w, NOW + 2000), false, 'stale after a queue end');
  L.advanceViews(NOW + 6000);
  assert.equal(w.levels[1], 13); assert.deepEqual(J(w.queue), { known: true, busy: false, items: [], end: null, ended: true });
  assert.equal(L.freshView(w, NOW + 70000), false);
  // research queue end: research levels applied
  M.research = { levels: { 131: 3 }, queue: { known: true, busy: true, items: [{ id: 131, level: 4, end: NOW + 1000 }], end: NOW + 1000 }, readAt: NOW };
  L.advanceViews(NOW + 2000);
  assert.equal(M.research.levels[131], 4); assert.equal(M.research.queue.busy, false); assert.equal(M.research.stale, true);
  M.views = {}; M.research = null;
});

T.test('every planet with a free queue gets its order in the same run; a shipyard page is asked only where the plan wants a shipyard step', () => {
  const sb = sandbox();
  const views = [254102, 254103, 254104].map((id) => view(id, { stock: [7e6, 7e6, 7e6] }));
  let out = plan(sb, views, { cfg: { research: false } });
  assert.deepEqual(J(out.actions.map((a) => a.step.bodyId)).sort(), [254102, 254103, 254104], 'one order per planet queue: ' + J(out.actions.map((a) => a.cand.label)));
  assert.deepEqual(J(out.reads), [], 'no page needed: the cached views plan everything');
  // an energy deficit (satellites) with an unknown shipyard queue: that shipyard page only
  const e = [view(254102, { energy: { production: 2000, consumption: 2600 }, shipyard: null }), view(254103, { shipyard: null })];
  out = plan(sb, e, { policy: 'col_mine90', cfg: { research: false } });
  assert.deepEqual(J(out.reads.filter((r) => r.page === 'shipyard').map((r) => [r.page, r.bodyId])), [['shipyard', 254102]]);
  // the building queue busy: nanites / shipyard steps there do not ask for the shipyard page
  const nan = (queue) => view(254102, { levels: { 15: 0, 14: 10 }, shipyard: null, queue });
  out = plan(sb, [nan()], { policy: 'tactic', cfg: { research: false } });
  assert.ok(out.reads.some((r) => r.page === 'shipyard' && r.bodyId === 254102), 'free queue: nanites 1 need the shipyard queue: ' + J(out.reads));
  out = plan(sb, [nan({ known: true, busy: true, items: [{ id: 1, level: 13, end: NOW + 60000 }], end: NOW + 60000 })], { policy: 'tactic', cfg: { research: false } });
  assert.ok(!out.reads.some((r) => r.page === 'shipyard'), J(out.reads));
  // domes on: the defense page only right before a dome order, i.e. for a planet whose dome counts are unknown AND whose dome is
  // buildable and affordable now (page=imperium fills the counts otherwise); never a per-run read
  const dr = { 110: 6 };
  out = plan(sb, [view(254102, { defense: null }), view(254103, { defense: { 407: 1, 408: 1 } })], { cfg: { defense: true, research: false }, research: dr });
  assert.deepEqual(J(out.reads.filter((r) => r.mode === 'defense').map((r) => r.bodyId)), [254102]);
  assert.ok(!out.actions.some((a) => a.step.kind === 'units'), 'no dome order before the defense page was read');
  out = plan(sb, [view(254102, { defense: null, stock: [0, 0, 0], perHour: [1, 1, 1] })], { cfg: { defense: true, research: false }, research: dr });
  assert.deepEqual(J(out.reads.filter((r) => r.mode === 'defense')), [], 'dome not affordable: no defense page');
  out = plan(sb, [view(254102, { defense: null })], { cfg: { defense: true, research: false } });
  assert.deepEqual(J(out.reads.filter((r) => r.mode === 'defense')), [], 'domes not researched: no defense page');
  // a shipyard page that failed to read is not asked again for 10 min
  out = plan(sb, [Object.assign(nan(), { yardFailT: NOW - 60000 })], { policy: 'tactic', cfg: { research: false } });
  assert.ok(!out.reads.some((r) => r.page === 'shipyard'), 'failed read: no retry within 10 min');
});

T.test('shipyard reads only right before an order: nanites / units waiting for resources do not read the shipyard page; a busy cached shipyard blocks', () => {
  const sb = sandbox();
  const poor = view(254102, { levels: { 15: 0, 14: 10 }, shipyard: null, stock: [0, 0, 0], perHour: [100, 100, 100] });
  let out = plan(sb, [poor], { policy: 'tactic', cfg: { research: false } });
  assert.ok(!out.reads.some((r) => r.page === 'shipyard'), 'nanites wait for resources: no shipyard read ' + J(out.reads));
  assert.ok(out.waits.some((w) => w.step.id === 15), 'nanites wait ' + J(out.waits.map((w) => w.cand.label)));
  // a stale (not fresh) cached shipyard queue with items still running: the step is blocked without a read
  const busy = view(254102, { levels: { 15: 0, 14: 10 }, shipyard: { known: true, items: [{ id: 202, count: 5 }], t: NOW - 3600000, end: NOW + 600000 } });
  out = plan(sb, [busy], { policy: 'tactic', cfg: { research: false } });
  assert.ok(!out.reads.some((r) => r.page === 'shipyard'));
  assert.ok(out.skipped.some((s) => s.cand.item === 15 && /верфь работает/.test(s.reason)), J(out.skipped.map((s) => s.reason)));
  // affordable with a stale shipyard view: read now, order after the read (fresh view -> action)
  const ok = view(254102, { levels: { 15: 0, 14: 10 }, shipyard: { known: true, items: [], t: NOW - 3600000 } });
  out = plan(sb, [ok], { policy: 'tactic', cfg: { research: false } });
  assert.ok(out.reads.some((r) => r.page === 'shipyard' && r.bodyId === 254102));
  assert.ok(!out.actions.some((a) => a.step.id === 15));
  ok.shipyard.t = NOW;
  out = plan(sb, [ok], { policy: 'tactic', cfg: { research: false } });
  assert.ok(out.actions.some((a) => a.step.id === 15), 'fresh shipyard: nanites ordered ' + J(out.actions.map((a) => a.cand.label)));
});

T.test('reads right before an order bypass the core read cache (fresh: true); planning reads may take a cached answer', async () => {
  const sb = sandbox();
  const L = sb.OGX.botBuild._lib;
  const specs = [];
  const wctx = { decide() {}, rec() {}, now: () => NOW, act: async (spec) => { specs.push(J(spec)); return { ok: false, refused: 'test' }; } };
  await L.readPage(wctx, 'buildings', 254102, 'план');
  await L.readBody(wctx, 254102, 'свежие данные перед заказом', { fresh: true });
  await L.readResearch(wctx, 254102, 'свежая очередь исследований перед заказом', { fresh: true });
  await L.readShipyard(wctx, 254102, 'верфь перед заказом', 'defense', { fresh: true });
  await L.readBody(wctx, 254102, 'данные устарели');
  assert.deepEqual(specs.map((s) => [s.params.page, s.params.mode || null, s.fresh]),
    [['buildings', null, false], ['buildings', null, true], ['research', null, true], ['shipyard', 'defense', true], ['buildings', null, false]], J(specs));
});

T.test('0.3.2 tactic: a planet above the stage target builds its next mine from its own surplus (mineSurplus), never waits or asks a delivery for it; other planets\' delivery needs stay in stock', () => {
  const sb = sandbox();
  const base = { 14: 10, 15: 10, 21: 14, 31: 22, 22: 30, 23: 30, 24: 30 };
  const big = [1e12, 1e12, 1e12]; const st = [1e13, 1e13, 1e13];
  const main = view(254102, { levels: Object.assign({}, base, { 1: 50, 2: 46, 3: 43 }), stock: big, storage: st, perHour: [1e9, 5e8, 2e8], energy: { production: 5e7, consumption: 1e5 }, fieldsMax: 900 });
  const col = view(254103, { levels: Object.assign({}, base, { 1: 30, 2: 28, 3: 25 }), stock: [1e9, 1e9, 1e9], storage: st, perHour: [1e8, 5e7, 2e7], energy: { production: 5e7, consumption: 1e5 }, fieldsMax: 900 });
  const o = { policy: 'tactic', cfg: { research: false, queueDepth: 1 } };
  let out = plan(sb, [main, col], o);
  const onMain = out.actions.find((a) => a.step.bodyId === 254102);
  assert.ok(onMain && onMain.cand.rule === 'mineSurplus' && [1, 2, 3].includes(onMain.step.id), 'main builds a mine above S1 from its stock: ' + J(out.actions.map((a) => a.cand.label)));
  assert.ok(out.actions.some((a) => a.step.bodyId === 254103 && a.cand.rule === 'mine'), 'the colony still builds its lowest mine');
  assert.ok(!out.waits.some((w) => w.cand.rule === 'mineSurplus'), 'a surplus mine never waits');
  // the colony waits for a delivery of 2e12: the main keeps that in stock, no surplus mine
  out = plan(sb, [main, col], Object.assign({}, o, { extra: { exportKeep: { 254103: { metal: 2e12, crystal: 0, deuterium: 0 } } } }));
  assert.ok(!out.actions.some((a) => a.step.bodyId === 254102 && a.cand.rule === 'mineSurplus'), 'surplus after the other planets\' needs');
  assert.ok(out.skipped.some((s) => s.cand.rule === 'mineSurplus' && /излишки/.test(s.reason)));
  // the setting off: no mine above the stage target
  out = plan(sb, [main, col], { policy: 'tactic', cfg: { research: false, queueDepth: 1, surplusMines: false } });
  assert.ok(!out.candidates.some((c) => c.rule === 'mineSurplus'));
});

T.test('0.3.2 satellites: one order covers the deficit plus satAheadLevels levels of all three mines when the stock pays; a poor planet orders the deficit only', () => {
  const sb = sandbox();
  const col = { policy: 'col_mine90' };
  const mk = (stock) => view(254102, { levels: { 1: 30, 2: 28, 3: 25 }, energy: { production: 2000, consumption: 2600 }, perSat: { value: 30 }, stock });
  let out = plan(sb, [mk([1e9, 1e9, 1e9])], Object.assign({}, col, { cfg: { satAheadLevels: 10 } }));
  const sat = out.actions.find((a) => a.step.kind === 'units' && a.step.id === 212);
  assert.ok(sat, 'satellites ordered');
  const lv = (k) => ({ 1: 30 + k, 2: 28 + k, 3: 25 + k });
  const cons = (l) => sb.OGX.calc.production({ levels: l, percents: {}, ships: { 212: 1e9 }, tempMax: 40, research: {}, factors: sb.OGX.calc.factors({}) }).energy.consumption;
  const want = Math.ceil((600 + cons(lv(10)) - cons(lv(0))) / 30);
  assert.equal(sat.step.n, want, 'deficit + headroom of 10 levels x 3 mines');
  out = plan(sb, [mk([1e9, 1000, 1e9])], Object.assign({}, col, { cfg: { satAheadLevels: 10 } }));
  const small = out.actions.find((a) => a.step.kind === 'units' && a.step.id === 212) || out.waits.find((w) => w.step.kind === 'units');
  assert.equal(small.step.n, 20, 'no crystal for the big order: the deficit only (600 / 30)');
});

// ---------------------------------------------------------------------------------------------- independent audit 2026-11-02
T.test('audit satellites (botbuild-3/4/5, journal-6): a batch is capped by yard time, none while the yard holds satellites, queued satellites count for the energy price and for the mines', () => {
  const sb = sandbox();
  const L = sb.OGX.botBuild._lib; const C = sb.OGX.calc;
  const col = { policy: 'col_mine90' };
  const rich = { levels: { 1: 45, 2: 45, 3: 41, 21: 14, 15: 10 }, perSat: { value: 30 }, stock: [1e12, 1e12, 1e12], storage: [1e13, 1e13, 1e13] };
  const satAct = (out) => out.actions.find((a) => a.step.kind === 'units' && a.step.id === 212);
  // (a) deficit 1 000 + 10 levels x 3 mines = thousands of satellites (hours of yard at 1 s / unit): capped at 30 min = 1 800
  const unit = Math.max(1, C.unitTime(212, { shipyard: 14, nanite: 10, gameSpeed: L.SEED_SPEED, factors: C.factors({}) }));
  assert.equal(unit, 1, 'Aeternum: one satellite per second (the 1 s floor)');
  let out = plan(sb, [view(254102, Object.assign({ energy: { production: 2000, consumption: 3000 } }, rich))], Object.assign({}, col, { cfg: { satAheadLevels: 10, research: false } }));
  let a = satAct(out);
  assert.ok(a, 'satellites ordered');
  assert.equal(a.step.n, 1800, 'capped at 30 min of yard: ' + a.step.n);
  const e = out.notes.find((n) => n.event === 'energy');
  assert.ok(e.data.fix.partial && e.data.fix.cap === 1800 && e.data.fix.nWanted > 1800, J(e.data.fix));
  assert.match(e.what, /партия не дольше 30 мин верфи \(1 с\/шт\.\) → ×1800/);
  assert.ok(a.why.some((w) => /нехватка 1000 → ×34/.test(w) && /\+10 ур\. всех шахт/.test(w) && /×1800/.test(w)), 'the order explains itself: ' + J(a.why));
  out = plan(sb, [view(254102, Object.assign({ energy: { production: 2000, consumption: 3000 } }, rich))], Object.assign({}, col, { cfg: { satAheadLevels: 10, satBatchMaxMin: 10, research: false } }));
  assert.equal(satAct(out).step.n, 600, '10 min -> 600');
  out = plan(sb, [view(254102, Object.assign({ energy: { production: 2000, consumption: 3000 } }, rich))], Object.assign({}, col, { cfg: { satAheadLevels: 10, satBatchMaxMin: 0, research: false } }));
  assert.ok(satAct(out).step.n > 1800, '0 = no cap: ' + satAct(out).step.n);
  // the deficit alone above the cap: the cap now, the rest in the next batch (the candidate is the satellites alone)
  out = plan(sb, [view(254102, Object.assign({ energy: { production: 0, consumption: 100000 } }, rich))], Object.assign({}, col, { cfg: { satAheadLevels: 1, research: false } }));
  a = satAct(out);
  assert.equal(a.step.n, 1800); assert.ok(a.cand.rule === 'energy' && a.cand.steps.length === 1);
  assert.ok(a.why.some((w) => /остальное следующим заказом/.test(w)), J(a.why));
  // (b) satellites still in the yard: no second batch, the deficit candidate says why (the tactic: satellites only; the payback
  // policies fall back to the solar plant there)
  out = plan(sb, [view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 30 }, shipyard: { known: true, items: [{ id: 212, count: 10 }], t: NOW, end: NOW + 60000 } })], { policy: 'tactic', cfg: { research: false } });
  assert.ok(!satAct(out), 'no new batch while 10 are queued');
  const sk = out.skipped.find((s) => s.cand.rule === 'energy');
  assert.ok(sk && /ждём спутники из очереди верфи \(×10\)/.test(sk.reason), sk && sk.reason);
  out = plan(sb, [view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 30 }, shipyard: { known: true, items: [{ id: 212, count: 10 }], t: NOW, end: NOW + 60000 } })], Object.assign({}, col, { cfg: { research: false } }));
  assert.ok(!satAct(out) && out.actions.some((x) => x.step.id === 4), 'payback policy: the solar plant instead of a second batch');
  // (c) the queued batch covers the deficit and the next mine: the mine is ordered now, without a satellite step (energy credited as pending)
  out = plan(sb, [view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 30 }, shipyard: { known: true, items: [{ id: 212, count: 25 }], t: NOW, end: NOW + 60000 } })], Object.assign({}, col, { cfg: { research: false } }));
  assert.ok(!out.notes.some((n) => n.event === 'energy'), 'no deficit: the queue covers it');
  const m = out.actions.find((x) => x.step.kind === 'building' && [1, 2, 3].includes(x.step.id));
  assert.ok(m && !m.cand.fix, 'a mine ordered in the same pass, no satellite step: ' + J(out.actions.map((x) => [x.step.kind, x.step.id, x.step.n])));
  // (d) energy price (terraformer 9 = 256 000 > production 130 000): satellites already queued count — the step waits for them instead of a new batch
  const terra = (shipyard, cfg) => plan(sb, [view(254102, { fieldsUsed: 162, levels: { 15: 1, 33: 8, 21: 14 }, energy: { production: 130000, consumption: 500 }, stock: [1e12, 1e12, 1e12], storage: [1e13, 1e13, 1e13], shipyard })], { cfg: Object.assign({ research: false }, cfg || {}) });
  out = terra({ known: true, items: [{ id: 212, count: 3780 }], t: NOW, end: NOW + 3780000 });
  assert.ok(!satAct(out), 'no new batch');
  assert.ok(out.skipped.some((s) => s.cand.item === 33 && /ждём спутники из очереди верфи \(×3780\)/.test(s.reason)), J(out.skipped.map((s) => s.reason)));
  out = terra({ known: true, items: [], t: NOW }, { satBatchMaxMin: 0 });
  a = satAct(out);
  assert.ok(a && a.step.n === Math.ceil(126000 / (200 / 6)), 'empty yard: one batch for the missing 126 000: ' + (a && a.step.n));
  assert.equal(out.actions.filter((x) => x.step.kind === 'units').length, 1);
  out = terra({ known: true, items: [], t: NOW });
  assert.equal(satAct(out).step.n, 1800, 'with the default cap: 1 800 now');
  // (e) advanceViews: a yard queue that ended is credited to the production, not dropped (energyBalance stays >= 0); the yard is not fresh
  const M = sb.OGX.botBuild._M;
  const w = view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 38.67 }, shipyard: { known: true, items: [{ id: 212, count: 16 }], t: NOW, end: NOW + 10000 } });
  M.views = { 254102: w };
  assert.ok(L.energyBalance(w, C.factors({})) >= 0);
  L.advanceViews(NOW + 20000);
  assert.deepEqual(J(w.shipyard.items), []); assert.equal(w.shipyard.t, 0);
  assert.ok(Math.abs(w.energy.production - (2000 + 16 * 38.67)) < 1e-6, 'credited: ' + w.energy.production);
  assert.equal(w.energy.credited, 16);
  assert.ok(L.energyBalance(w, C.factors({})) >= 0, 'no deficit after the queue end: no re-order');
  M.views = {};
});

T.test('audit (missed-2): after a satellite order the answer page\'s queue time is the yard end — the x3000 estimate is not added on top; no premature energy credit', async () => {
  const sb = sandbox();
  const L = sb.OGX.botBuild._lib; const M = sb.OGX.botBuild._M; const C = sb.OGX.calc;
  const v = view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 38.67 } });
  M.views = { 254102: v }; M.retries = {}; M.cooldowns = {}; M.factors = C.factors({});
  let parsed = { items: [{ id: 212, count: 30 }], totalSecs: 180 };
  sb.OGX.parse = { gz: { shipyardQueue: () => parsed } };
  const recs = [];
  const wctx = { decide() {}, rec: (k, w, d) => recs.push({ k, w, d }), now: () => NOW, store: { set: async () => {} }, act: async () => ({ ok: true, verified: true, at: NOW, data: { doc: {}, how: 'test' } }) };
  const step = { kind: 'units', id: 212, n: 30, bodyId: 254102, cost: { metal: 0, crystal: 60000, deuterium: 0 }, queue: 's:254102' };
  const cand = { label: 'Энергия [2:68:5]: спутники ×30', rule: 'energy', steps: [step], cost: step.cost, costMsu: 1, payback: -1, fix: { kind: 'sat', n: 30, why: 'спутники ×30: нехватка 600 → ×16, +2 ур. всех шахт → ×30' } };
  let r = await L.execute(wctx, { cand, step, why: [cand.fix.why] }, { maxRetries: 3 });
  assert.equal(r.ok, true);
  assert.equal(v.shipyard.end, NOW + 180000, 'end = the page\'s remaining time (30 x 6 s), not + the 30 s estimate: ' + (v.shipyard.end - NOW));
  assert.deepEqual(J(v.shipyard.items), [{ id: 212, count: 30 }]); assert.equal(v.shipyard.t, NOW);
  assert.equal(v.energy.production, 2000, 'nothing credited while the satellites are queued');
  assert.ok(L.energyBalance(v, C.factors({})) > 0, 'the queue is the pending credit');
  assert.ok(recs.some((x) => x.k === 'build-start' && x.d.step.n === 30));
  // the answer did not parse: the estimate (1 s per unit at x3040) from the order time
  parsed = null;
  const v2 = view(254103, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 38.67 } });
  M.views[254103] = v2;
  r = await L.execute(wctx, { cand, step: Object.assign({}, step, { bodyId: 254103, queue: 's:254103' }), why: [] }, { maxRetries: 3 });
  assert.equal(r.ok, true);
  assert.equal(v2.shipyard.end, NOW + 30000, 'estimate: 30 x 1 s');
  assert.deepEqual(J(v2.shipyard.items), [{ id: 212, count: 30 }]);
  M.views = {}; delete sb.OGX.parse;
});

T.test('audit journal-18: a busy queue of unknown content wakes the bot for its 60 s re-read (not the 10–20 min pause); a known end wakes at the end; the research queue alike', async () => {
  const sb = sandbox();
  const B = sb.OGX.botBuild; const L = B._lib; const M = B._M;
  const v = view(254102, {});
  v.key = 'p254102'; v.readAt = NOW - 20000; v.t = NOW - 20000; v.queue = { known: false, busy: true, items: [], end: null };
  M.views = { 254102: v }; M.bodies = [{ id: 254102, coords: '2:68:5' }]; M.research = null; M.factors = sb.OGX.calc.factors({}); M.resIds = []; M.needSig = null; M.needSince = {}; M.plan = null;
  sb.OGX.bot = { needs: { set: () => {} }, reservations: { list: () => [] }, randMs: (a) => a[0], isActive: () => true };
  const wctx = { rec: () => {}, flights: () => [], now: () => NOW, reserve: () => 'r', release: () => {} };
  const out = { notes: [], candidates: [], skipped: [], actions: [], waits: [], reads: [], lab: null, stage: null };
  const cfg = { research: true, queueDepth: 1 };
  const pol = L.policyParams('tactic');
  let r = await L.act(wctx, cfg, pol, out);
  assert.equal(r.nextAt, NOW - 20000 + 60000 + 1000, 'wake at readAt + UNKNOWN_Q_MS (+ 1 s jitter): ' + J(r));
  // the read was due in this run and did not happen (failed / refused): retried UNKNOWN_Q_MS later, never every 2-3 s (rev-botbuild-1)
  v.readAt = NOW - 90000; v.t = NOW - 90000;
  r = await L.act(wctx, cfg, pol, out);
  assert.equal(r.nextAt, NOW + 60000 + 1000, 'overdue re-read: +60 s, not +1 s: ' + J(r));
  // a moon with a busy queue of unknown content while moons are off: refresh() never reads it, no wake for it
  v.isMoon = true; v.readAt = NOW - 20000; v.t = NOW - 20000;
  r = await L.act(wctx, cfg, pol, out);
  assert.ok(r.nextAt >= NOW + 600000, 'moon with moons off: the 10–20 min pause: ' + J(r));
  r = await L.act(wctx, Object.assign({}, cfg, { moons: true }), pol, out);
  assert.equal(r.nextAt, NOW - 20000 + 60000 + 1000, 'moons on: the re-read wake');
  v.isMoon = false;
  // a known end: wake at the end
  v.queue = { known: true, busy: true, items: [{ id: 1, level: 30, end: NOW + 300000 }], end: NOW + 300000 };
  r = await L.act(wctx, cfg, pol, out);
  assert.equal(r.nextAt, NOW + 300000 + 1000);
  // the research queue: busy without end -> the 60 s re-read; not with research off; with an end -> the end
  v.queue = { known: true, busy: false, items: [], end: null };
  M.research = { levels: {}, queue: { known: false, busy: true, items: [], end: null }, t: NOW - 50000, readAt: NOW - 50000 };
  r = await L.act(wctx, cfg, pol, out);
  assert.equal(r.nextAt, NOW - 50000 + 60000 + 1000, 'research re-read wake: ' + J(r));
  r = await L.act(wctx, Object.assign({}, cfg, { research: false }), pol, out);
  assert.ok(r.nextAt >= NOW + 600000, 'research off: no re-read wake, the 10–20 min pause: ' + J(r));
  // research known only from the imperium, no read since long ago: one retry per UNKNOWN_Q_MS; without a lab no wake at all
  M.research = { src: 'imperium', levels: {}, queue: { known: false, busy: null, items: [], end: null }, t: NOW - 600000, readAt: NOW - 600000 };
  r = await L.act(wctx, cfg, pol, out);
  assert.ok(r.nextAt >= NOW + 60000, 'imperium research, overdue: >= 60 s: ' + J(r));
  v.levels[31] = 0;
  r = await L.act(wctx, cfg, pol, out);
  assert.ok(r.nextAt >= NOW + 600000, 'no lab: page=research is never read, no re-read wake: ' + J(r));
  v.levels[31] = 8;
  M.research = { levels: {}, queue: { known: false, busy: true, items: [], end: null }, t: NOW - 50000, readAt: NOW - 50000 };
  M.research.queue = { known: true, busy: true, items: [{ id: 108, level: 10, end: NOW + 120000 }], end: NOW + 120000 };
  r = await L.act(wctx, cfg, pol, out);
  assert.equal(r.nextAt, NOW + 120000 + 1000, 'a running research with a known end: wake at the end, no read before it');
  M.views = {}; M.research = null; M.bodies = [];
});

T.test('review rev-botbuild-3: a page=buildings read in the middle of a satellite batch keeps only the unbuilt rest pending; advanceViews credits only that rest', async () => {
  const sb = sandbox();
  const L = sb.OGX.botBuild._lib; const M = sb.OGX.botBuild._M; const C = sb.OGX.calc;
  M.factors = C.factors({});
  const T0 = NOW - 60000;
  const old = view(254102, { energy: { production: 1000, consumption: 1600 }, perSat: { value: 38.7 }, shipyard: { known: true, items: [{ id: 212, count: 20 }], t: T0, end: T0 + 120000 } });
  M.views = { 254102: old };
  // the page at T0 + 60 s: 10 of 20 built, already in its production (1000 + 10 x 38.7)
  sb.OGX.parse = { gz: { bodies: () => ({ list: [{ id: 254102, coords: '2:68:5', name: 'P', isMoon: false, selected: true, tip: {} }] }), techItems: () => [{ id: 1, value: 12 }, { id: 21, value: 4 }],
    resources: () => ({ energy: { production: 1387, consumption: 1600 }, metal: { amount: 1, storage: 1e6, perHour: 1 }, crystal: { amount: 1, storage: 1e6, perHour: 1 }, deuterium: { amount: 1, storage: 1e6, perHour: 1 } }),
    queueBox: () => ({ empty: true }) } };
  sb.OGX.state = { bodies: async () => ({}) };
  const wctx = { rec() {}, now: () => NOW };
  const v = await L.viewFromDoc(wctx, 254102, { doc: {}, at: NOW });
  assert.equal(L.queuedSats(v), 10, 'half the batch time passed: 10 left pending, not 20: ' + J(v.shipyard));
  assert.equal(v.shipyard.t, T0, 'freshness of the yard view unchanged'); assert.equal(v.shipyard.end, T0 + 120000);
  assert.ok(Math.abs(L.energyBalance(v, M.factors) - (1387 - 1600 + 10 * 38.7)) < 1e-6, 'balance = page + rest: ' + L.energyBalance(v, M.factors));
  // a second read 30 s later: from the last base, 5 left
  const v2 = await L.viewFromDoc(wctx, 254102, { doc: {}, at: NOW + 30000 });
  assert.equal(L.queuedSats(v2), 5, J(v2.shipyard));
  // queue end: advanceViews credits the 5 still pending on top of the last page value
  L.advanceViews(T0 + 130000);
  assert.ok(Math.abs(v2.energy.production - (1387 + 5 * 38.7)) < 1e-6, 'credited only the rest: ' + v2.energy.production);
  assert.deepEqual(J(v2.shipyard.items), []);
  // mixed queue: the earlier item is built first
  const mixed = L.yardLeftAt({ known: true, items: [{ id: 202, count: 10 }, { id: 212, count: 10 }], t: T0, end: T0 + 100000 }, T0 + 10000, { 21: 4 });
  assert.equal(L.queuedSats({ shipyard: mixed }), 10, 'satellites behind small cargos: none built yet ' + J(mixed));
  M.views = {}; delete sb.OGX.parse; delete sb.OGX.state;
});

T.test('review rev-botbuild-4: a yard queue listed without a time gets the unit-time estimate; satellites queued without an end ask for a shipyard re-read instead of blocking for good', async () => {
  const sb = sandbox();
  const L = sb.OGX.botBuild._lib; const M = sb.OGX.botBuild._M; const C = sb.OGX.calc;
  M.factors = C.factors({});
  const v = view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 30 } });
  M.views = { 254102: v };
  sb.OGX.parse = { gz: { bodies: () => ({ list: [{ id: 254102, selected: true }] }), shipyardQueue: () => ({ items: [{ id: 212, count: 40 }], totalSecs: 0 }), techItems: () => [] } };
  const wctx = { decide() {}, rec() {}, now: () => NOW, act: async () => ({ ok: true, at: NOW, data: { doc: {} } }) };
  await L.readShipyard(wctx, 254102, 'test');
  assert.ok(v.shipyard.end > NOW, 'estimated end: ' + J(v.shipyard));
  delete sb.OGX.parse;
  // a stale yard view holding satellites without an end: blocked, but the shipyard page is asked for
  const stuck = view(254102, { energy: { production: 2000, consumption: 2600 }, perSat: { value: 30 }, shipyard: { known: true, items: [{ id: 212, count: 10 }], t: NOW - 3600000, end: null } });
  let out = plan(sb, [stuck], { policy: 'tactic', cfg: { research: false } });
  assert.ok(out.skipped.some((s) => s.cand.rule === 'energy' && /ждём спутники из очереди верфи/.test(s.reason)), J(out.skipped.map((s) => s.reason)));
  assert.ok(out.reads.some((r) => r.page === 'shipyard' && r.bodyId === 254102), 'shipyard re-read asked: ' + J(out.reads));
  // with a known end: no extra read (advanceViews clears it at the end)
  stuck.shipyard.end = NOW + 60000;
  out = plan(sb, [stuck], { policy: 'tactic', cfg: { research: false } });
  assert.ok(!out.reads.some((r) => r.page === 'shipyard'), J(out.reads));
  M.views = {};
});

T.test('audit botbuild-12: research times count the IRN labs (calc.effectiveLab) — calibration sample, queued research end', async () => {
  const sb = sandbox();
  const B = sb.OGX.botBuild; const L = B._lib; const M = B._M; const C = sb.OGX.calc;
  const factors = C.factors({});
  const lab = view(254102, { levels: { 31: 22, 6: 0 } });
  const others = [254103, 254104, 254105, 254106].map((id) => view(id, { levels: { 31: 22 } }));
  M.views = Object.fromEntries([lab].concat(others).map((v) => [v.id, v])); M.research = { levels: { 123: 12, 124: 18 } }; M.factors = factors; M.gameSpeed = null; M.retries = {}; M.cooldowns = {};
  const eff = C.effectiveLab(124, 22, [22, 22, 22, 22], 12);
  assert.equal(eff, 22 * 5, 'four labs 22 join the network (IRN 12 allows up to 12)');
  assert.equal(L.effLabOf(124, lab, M.views, M.research.levels), eff);
  assert.equal(L.effLabOf(124, lab, Object.values(M.views), M.research.levels), eff, 'array of views');
  assert.equal(L.effLabOf(124, lab, M.views, { 123: 0 }), 22, 'no network: the lab alone');
  assert.equal(L.effLabOf(124, lab, M.views, null), 22, 'network level unknown: the lab alone');
  assert.equal(L.effLabOf(124, lab, M.views, { 123: 2 }), 22 * 3, 'IRN 2: the two best other labs');
  const step = { kind: 'research', id: 124, level: 19, bodyId: 254102, cost: C.cost(124, 19) };
  const t1 = L.stepTime1(step, lab, factors);
  assert.equal(t1, C.researchTime(124, 19, { labLevel: eff, university: 0, gameSpeed: 1, factors }));
  assert.ok(t1 < C.researchTime(124, 19, { labLevel: 22, university: 0, gameSpeed: 1, factors }) / 4, 'about 5x shorter than the lab-22 formula: ' + t1);
  // calibrate: the answer page shows the rest at x3040 with the network -> the sample is ~3040, not ~14 700
  const rest = Math.round(C.researchTime(124, 19, { labLevel: eff, university: 0, gameSpeed: 3040, factors }));
  assert.ok(rest >= 5, 'rest ' + rest);
  sb.OGX.parse = { gz: { queueBox: () => ({ items: [{ id: 124, level: 19, restSec: rest }] }) } };
  sb.OGX.state = { player: async () => ({}), factors: async () => factors };
  const recs = [];
  const wctx = { rec: (k, w, d) => recs.push({ k, w, d }), now: () => NOW, store: { set: async () => {} } };
  await L.calibrate(wctx, step, {}, NOW);
  assert.ok(M.gameSpeed && Math.abs(M.gameSpeed.value - 3040) / 3040 < 0.05, 'sample ~3040: ' + J(M.gameSpeed));
  // estimateQueue: a queued research without an end (second item) ends after the IRN time at the game speed
  const gs = L.speedOf();
  const q = L.estimateQueue({ known: true, busy: true, items: [{ id: 124, level: 19, end: NOW + 60000 }, { id: 131, level: 21, end: null }], end: NOW + 60000 }, lab, 'research', NOW, M.research.levels);
  const want = NOW + 60000 + Math.max(1, C.researchTime(131, 21, { labLevel: C.effectiveLab(131, 22, [22, 22, 22, 22], 12), university: 0, gameSpeed: gs, factors })) * 1000;
  assert.equal(q.items[1].end, want, 'end with the network labs');
  M.views = {}; M.research = null; M.gameSpeed = null;
});
