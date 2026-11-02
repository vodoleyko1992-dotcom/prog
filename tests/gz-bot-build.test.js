'use strict';
// botbuild (strategy-plan payback rule + TBot build rules + research) end to end: the suite in a browser against the WORLD mode of
// the GALAXYZ mock (tests/gz-world.js; scenarios fixtures/galaxyz/bot-scenarios/botbuild-*.json: two planets 254102 [2:68:5] and
// 254103 [2:68:6], production / energy / storage from the spec, fixed build and research times).
//   node tests/gz-bot-build.test.js
// Every test also checks: no [OGX errors / bot console errors, and every botbuild action (queued or refused) has a preceding
// botbuild:decision of the same worker run.
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const HOME = 254102;
const COLONY = 254103;
const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botexpo'];
const FAST = { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botcore.maxBuildsPerHour': 200 };
const LIVE = { 'botcore.master': true, 'botcore.dryRun': false, 'botbuild.on': true };
const settings = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])), FAST, extra);
// dis_exp90 params as embedded in botbuild.js (copied from ogamex_strategy_plan.json, strategies.dis_exp90.policy.params)
const DIS = { vC: 4.5891, vD: 6.3264, wM: 0.7307, wC: 0.9666, wD: 1.5173, w_plasma: 1.3386 };

const leader = (env) => env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 30000, label: 'leader' });
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
/** Every botbuild action (queued or refused at enqueue) is preceded by a botbuild:decision of the same run. Returns the count. */
async function decisionsFirst(env, what) {
  const ev = await env.journal();
  const acts = ev.filter((e) => (e.k === 'botcore:action-queued' || e.k === 'botcore:action-refused') && e.d && e.d.module === 'botbuild' && e.d.run);
  const queued = new Set(ev.filter((e) => e.k === 'botcore:action-queued').map((e) => e.d && e.d.action));
  let n = 0;
  for (const a of acts) {
    if (a.k === 'botcore:action-refused' && a.d.action && queued.has(a.d.action)) continue;
    n++;
    const dec = ev.find((e) => e.k === 'botbuild:decision' && e.d && e.d.run === a.d.run && e.t <= a.t);
    assert.ok(dec, what + ': decision before ' + a.k + ' ' + a.d.type + ' (' + (a.d.why || '') + ')');
  }
  return n;
}
/** Build / research / shipyard POSTs since launch, in order. */
const posts = (env) => env.server.requests.filter((r) => r.t >= env.launchedAt && r.method === 'POST' && /^(buildings|research|shipyard)$/i.test(r.page || ''));
const formId = (r) => +((r.form || {}).building !== undefined ? r.form.building : (r.form || {}).tech);
function spec(name, mutate) { const s = JSON.parse(JSON.stringify(W.loadScenario(name))); if (mutate) mutate(s); return s; }

/**
 * Independent payback ranking (test's own formulas, BOT_DESIGN §8.3) for the mines of every planet and 131-133:
 * gain/h = Δ(2Moons mine formula) x 22000 (no officers, 131-133 at 0), price by vC/vD; payback = cost MSU / gain MSU x weight.
 */
function expectedRanking(s, P) {
  const raw = { 1: (L) => 30 * L * Math.pow(1.1, L), 2: (L) => 20 * L * Math.pow(1.1, L), 3: (L, t) => 10 * L * Math.pow(1.1, L) * (1.28 - 0.002 * t) };
  const base = { 1: [60, 15, 0], 2: [48, 24, 0], 3: [225, 75, 0] };
  const val = [1, P.vC, P.vD];
  const w = { 1: P.wM, 2: P.wC, 3: P.wD };
  const out = [];
  const sum = { 1: 0, 2: 0, 3: 0 };
  for (const b of s.bodies) {
    for (const id of [1, 2, 3]) {
      const L = +(b.levels[id] || 0);
      sum[id] += raw[id](L, b.tempMax) * 22000;
      const gain = (raw[id](L + 1, b.tempMax) - raw[id](L, b.tempMax)) * 22000 * val[id - 1];
      const c = base[id].map((x) => Math.floor(x * Math.pow(1.5, L)));
      const cost = c[0] + c[1] * P.vC + c[2] * P.vD;
      out.push({ kind: 'building', id, level: L + 1, bodyId: b.id, payback: cost / gain * w[id] });
    }
  }
  const rp = { 131: [750, 500, 250], 132: [1000, 750, 500], 133: [1250, 1000, 750] };
  for (const [id, c] of Object.entries(rp)) {
    const r = +id - 130;
    const L = +(s.player.research[id] || 0);
    const cc = c.map((x) => Math.floor(x * Math.pow(2, L)));
    const cost = cc[0] + cc[1] * P.vC + cc[2] * P.vD;
    out.push({ kind: 'research', id: +id, level: L + 1, bodyId: HOME, payback: cost / (0.02 * sum[r] * val[r - 1]) * P.w_plasma });
  }
  return out.sort((a, b) => a.payback - b.payback);
}

T.test('two planets, dis_exp90: candidates journaled (top 5 with payback), the first POST = the best payback (building, cp of that body); one order per queue', async () => {
  const s = spec('botbuild-payback');
  const env = await B.launchBot({ world: s, settings: settings(Object.assign({}, LIVE, { 'botbuild.policy': 'dis_exp90' })) });
  try {
    await leader(env);
    const exp = expectedRanking(s, DIS);
    const best = exp[0];
    assert.equal(best.kind, 'building', 'scenario: the best payback is a building: ' + JSON.stringify(exp.slice(0, 3)));
    const cand = await env.waitJournal('botbuild:candidates', { timeoutMs: 60000 });
    const top = cand.d.top;
    assert.equal(cand.d.policy, 'dis_exp90');
    assert.equal(top.length, 5, 'top 5 journaled');
    for (let i = 0; i < 5; i++) {
      assert.equal(top[i].id, exp[i].id, `rank ${i + 1}: ${JSON.stringify(top[i])} vs ${JSON.stringify(exp[i])}`);
      assert.equal(top[i].bodyId, exp[i].bodyId, `rank ${i + 1} body`);
      assert.ok(Math.abs(top[i].payback - exp[i].payback) <= 1e-3 * Math.max(1, exp[i].payback) + 1e-3, `rank ${i + 1} payback ${top[i].payback} ≈ ${exp[i].payback}`);
    }
    await env.until(() => posts(env).length >= 3, { timeoutMs: 60000, label: 'three orders' });
    const p = posts(env);
    assert.equal(p[0].page.toLowerCase(), 'buildings');
    assert.equal(String(p[0].form.cmd), 'insert');
    assert.equal(formId(p[0]), best.id, 'first POST building = best payback id');
    assert.equal(+p[0].cp, best.bodyId, 'first POST with cp of that body');
    // one order per queue: the best step of the other planet and the best research (lab 8 on HOME)
    const other = exp.find((x) => x.kind === 'building' && x.bodyId !== best.bodyId);
    const res = exp.find((x) => x.kind === 'research');
    const second = p.find((r) => r.page.toLowerCase() === 'buildings' && +r.cp === other.bodyId);
    assert.ok(second && formId(second) === other.id, 'the other planet builds its best: ' + JSON.stringify(p.map((r) => [r.page, r.cp, r.form])));
    const rr = p.find((r) => r.page.toLowerCase() === 'research');
    assert.ok(rr && formId(rr) === res.id && +rr.cp === HOME, 'research: best of 131-133 from the lab planet: ' + JSON.stringify(rr && rr.form));
    assert.equal(p.filter((r) => r.page.toLowerCase() === 'buildings' && +r.cp === best.bodyId).length, 1, 'one building order per planet queue');
    const W0 = env.world;
    assert.deepEqual(W0.log.builds.filter((b) => b.kind === 'buildings').map((b) => [b.bodyId, b.id]).sort(), [[best.bodyId, best.id], [other.bodyId, other.id]].sort(), 'world queues');
    await env.waitJournal('botbuild:build-start', { pred: (e) => e.d && e.d.step && e.d.step.id === best.id && !e.d.dry, timeoutMs: 30000 });
    await env.waitJournal('botbuild:research-start', { timeoutMs: 30000 });
    await env.waitJournal('botbuild:choose', { pred: (e) => e.d && e.d.reason === 'payback' });
    const n = await decisionsFirst(env, 'payback');
    assert.ok(n >= 6, 'reads + orders journaled with decisions: ' + n);
    await clean(env, 'payback');
  } finally { await env.close(); }
}, { timeout: 180000 });

T.test('energy deficit 600 -> satellites ceil(deficit / per-satellite output from page=resources) ordered on that planet first', async () => {
  const env = await B.launchBot({ world: 'botbuild-energy', settings: settings(LIVE) });
  try {
    await leader(env);
    await env.until(() => posts(env).length >= 1, { timeoutMs: 60000, label: 'first order' });
    const p = posts(env)[0];
    assert.equal(p.page.toLowerCase(), 'shipyard', 'first order is the shipyard: ' + p.url);
    assert.equal(String(p.mode || p.query.mode).toLowerCase(), 'fleet');
    assert.equal(+p.cp, HOME);
    const ev = await env.waitJournal('botbuild:energy', { pred: (e) => e.d && e.d.body === HOME && e.d.fix && e.d.fix.perSatSrc === 'page' });
    assert.equal(ev.d.deficit, 600);
    assert.equal(ev.d.fix.kind, 'sat');
    assert.ok(Math.abs(ev.d.fix.perSat - 30817 / 797) < 1e-6, 'per satellite = 212 row of page=resources (30 817 / 797): ' + ev.d.fix.perSat);
    const n = Math.ceil(600 / (30817 / 797));
    assert.equal(n, 16);
    // 0.3.2: one order = the deficit + the energy of the next satAheadLevels (10) levels of all three mines (stock pays)
    assert.ok(ev.d.fix.n > n, 'deficit + headroom: ' + ev.d.fix.n);
    assert.equal(+p.form['fmenge[212]'], ev.d.fix.n, 'fmenge[212] = ' + JSON.stringify(p.form));
    const reads = env.server.requests.filter((r) => r.t >= env.launchedAt && r.method === 'GET' && /^resources$/i.test(r.page || '') && +r.cp === HOME);
    assert.ok(reads.length >= 1, 'page=resources read with cp');
    const sy = env.server.requests.filter((r) => r.t >= env.launchedAt && r.method === 'GET' && /^shipyard$/i.test(r.page || '') && +r.cp === HOME && r.t < p.t);
    assert.ok(sy.length >= 1, 'shipyard queue read before the order');
    const wb = env.world.log.builds.find((b) => b.kind === 'shipyard');
    assert.deepEqual(wb.accepted, { 212: ev.d.fix.n }, 'world shipyard accepted the satellites');
    await env.waitJournal('botbuild:build-start', { pred: (e) => e.d && e.d.step && e.d.step.id === 212 && !e.d.dry });
    await env.waitJournal('botbuild:choose', { pred: (e) => e.d && e.d.reason === 'rule:energy' });
    await decisionsFirst(env, 'energy');
    await clean(env, 'energy');
  } finally { await env.close(); }
}, { timeout: 150000 });

T.test('metal at the storage cap -> metal storage ordered first on that planet', async () => {
  const env = await B.launchBot({ world: 'botbuild-storage', settings: settings(LIVE) });
  try {
    await leader(env);
    await env.until(() => posts(env).some((r) => r.page.toLowerCase() === 'buildings' && +r.cp === HOME), { timeoutMs: 60000, label: 'order on HOME' });
    const p = posts(env).filter((r) => r.page.toLowerCase() === 'buildings' && +r.cp === HOME);
    assert.equal(formId(p[0]), 22, 'metal storage on HOME: ' + JSON.stringify(p[0].form));
    assert.equal(formId(posts(env)[0]), 22, 'the very first order is the storage (forced rule before payback)');
    const ev = await env.waitJournal('botbuild:storage', { pred: (e) => e.d && e.d.body === HOME && e.d.res === 'metal' });
    assert.equal(ev.d.rule, 'storageFull');
    assert.equal(ev.d.storage, 1275000, 'storage from the ticker limit (level 5)');
    await env.waitJournal('botbuild:choose', { pred: (e) => e.d && e.d.reason === 'rule:storageFull' });
    assert.ok(env.world.log.builds.some((b) => b.kind === 'buildings' && b.bodyId === HOME && b.id === 22 && b.level === 6), 'world queued metal storage 6');
    await decisionsFirst(env, 'storage');
    await clean(env, 'storage');
  } finally { await env.close(); }
}, { timeout: 150000 });

T.test('exactly one free field -> terraformer; no other building takes the last field', async () => {
  const env = await B.launchBot({ world: 'botbuild-fields', settings: settings(LIVE) });
  try {
    await leader(env);
    await env.until(() => posts(env).some((r) => r.page.toLowerCase() === 'buildings' && +r.cp === HOME), { timeoutMs: 60000, label: 'order on HOME' });
    await new Promise((r) => setTimeout(r, 4000));
    const p = posts(env).filter((r) => r.page.toLowerCase() === 'buildings' && +r.cp === HOME);
    assert.deepEqual(p.map(formId), [33], 'only the terraformer on HOME: ' + JSON.stringify(p.map((r) => r.form)));
    const ev = await env.waitJournal('botbuild:fields', { pred: (e) => e.d && e.d.body === HOME && e.d.free === 1 });
    assert.ok(/терраформер/i.test(ev.w), ev.w);
    await env.waitJournal('botbuild:choose', { pred: (e) => e.d && e.d.reason === 'rule:fields' && e.d.step.id === 33 });
    assert.ok(env.world.log.builds.some((b) => b.kind === 'buildings' && b.bodyId === HOME && b.id === 33), 'world queued the terraformer');
    assert.ok(posts(env).some((r) => r.page.toLowerCase() === 'buildings' && +r.cp === COLONY), 'the colony (free fields) still builds');
    await decisionsFirst(env, 'fields');
    await clean(env, 'fields');
  } finally { await env.close(); }
}, { timeout: 150000 });

T.test('research: buildings off -> the best of 131-133 by payback, never plasma 122 (not even a candidate)', async () => {
  const s = spec('botbuild-payback');
  const env = await B.launchBot({ world: s, settings: settings(Object.assign({}, LIVE, { 'botbuild.policy': 'dis_exp90', 'botbuild.buildings': false })) });
  try {
    await leader(env);
    await env.until(() => posts(env).length >= 1, { timeoutMs: 60000, label: 'research order' });
    await new Promise((r) => setTimeout(r, 3000));
    const p = posts(env);
    assert.deepEqual(p.map((r) => r.page.toLowerCase()), ['research'], 'only a research order: ' + JSON.stringify(p.map((r) => r.url)));
    const best = expectedRanking(s, DIS).find((x) => x.kind === 'research');
    assert.ok([131, 132, 133].includes(formId(p[0])), 'production research');
    assert.equal(formId(p[0]), best.id, 'the best production research by payback');
    assert.equal(+p[0].cp, HOME, 'cp = lab planet');
    const cands = await env.journal({ kind: 'botbuild:candidates' });
    assert.ok(cands.length >= 1);
    for (const c of cands) for (const t of c.d.top) assert.notEqual(t.id, 122, 'plasma 122 is never a candidate');
    assert.ok(!env.server.requests.some((r) => r.method === 'POST' && formId(r) === 122), 'no plasma order');
    assert.ok(env.world.researchQueue.some((q) => q.id === best.id), 'world research running');
    await decisionsFirst(env, 'research');
    await clean(env, 'research');
  } finally { await env.close(); }
}, { timeout: 150000 });

T.test('orders that finish at once (fast server): verified by level + 1 on the answer page / stock drop, no action-verify-fail', async () => {
  // verify-r2: 2 of 9 build.research orders logged action-verify-fail although the world accepted them (finished immediately)
  const s = spec('botbuild-payback', (x) => { x.universe.researchTimeSec = 0; x.universe.buildTimeSec = 0; });
  const env = await B.launchBot({ world: s, settings: settings(Object.assign({}, LIVE, { 'botbuild.policy': 'dis_exp90' })) });
  try {
    await leader(env);
    await env.until(() => posts(env).filter((r) => /research/i.test(r.page)).length >= 1 && posts(env).filter((r) => /buildings/i.test(r.page)).length >= 1,
      { timeoutMs: 120000, label: 'a research and a building order' });
    await env.until(async () => (await env.journal({ kind: 'botcore:action-done' })).filter((e) => e.d && /^build\./.test(e.d.type)).length >= 2, { timeoutMs: 30000, label: 'done events' });
    const builds = env.world.log.builds.filter((b) => b.ok !== false);
    assert.ok(builds.length >= 2, 'world accepted the orders: ' + JSON.stringify(env.world.log.builds));
    const fails = await env.journal({ kind: 'botcore:action-verify-fail' });
    assert.deepEqual(fails.map((e) => e.w), [], 'no false verify failures');
    const done = (await env.journal({ kind: 'botcore:action-done' })).filter((e) => e.d && /^build\./.test(e.d.type));
    assert.ok(done.every((e) => e.d.verified !== false), JSON.stringify(done.map((e) => e.d)));
    assert.equal((await env.botStatus()).consecutiveErrors, 0);
    await clean(env, 'instant');
  } finally { await env.close(); }
}, { timeout: 200000 });

T.test('lab 31 is not queued while a research runs (131 needs lab 8); after the research ends the lab is ordered', async () => {
  const s = spec('botbuild-lab', (x) => { x.universe.buildTimeSec = 5; });
  const env = await B.launchBot({ world: s, settings: settings({ 'botbuild.on': true, 'botcore.dryRun': false, 'botbuild.policy': 'custom', 'botbuild.policyJson': { w_plasma: 0.00001 } }) });
  try {
    const Wd = env.world;
    const o = Wd.order('research', HOME, { cmd: 'insert', id: 108 });
    assert.ok(o.ok, 'research started in the world: ' + JSON.stringify(o));
    const resEnd = Wd.researchQueue[0].end;
    assert.ok(resEnd > Wd.clock.nowUnix());
    await env.setSettings({ 'botcore.master': true });
    await leader(env);
    const sk = await env.waitJournal('botbuild:skip', { pred: (e) => /идёт исследование/.test(e.w || '') && e.d && e.d.cand && e.d.cand.first && e.d.cand.first.id === 31, timeoutMs: 60000 });
    assert.ok(sk.d.cand.label && /131|металла|добычи/i.test(sk.d.cand.label + ''), 'the blocked candidate is the 131-133 chain: ' + sk.d.cand.label);
    await env.until(() => Wd.log.events.some((e) => e.kind === 'research-done'), { timeoutMs: 90000, label: 'research done' });
    await env.until(() => posts(env).some((r) => r.page.toLowerCase() === 'buildings' && formId(r) === 31), { timeoutMs: 120000, label: 'lab ordered after the research' });
    const labPosts = posts(env).filter((r) => r.page.toLowerCase() === 'buildings' && formId(r) === 31);
    for (const r of labPosts) assert.ok(r.t / 1000 >= resEnd - 1, `lab POST at ${r.t / 1000} not before the research end ${resEnd}`);
    assert.ok(!Wd.log.refusals.some((x) => /research running/.test(x.why)), 'the world never had to refuse 31 during research');
    assert.equal(posts(env).filter((r) => r.page.toLowerCase() === 'research').length, 0, 'no research order while nothing researchable / lab queued');
    await decisionsFirst(env, 'lab');
    await clean(env, 'lab');
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('build not verified (silent refusal): retried up to maxRetries, then a 30-min cooldown for that item and another step is chosen', async () => {
  const s = spec('botbuild-payback');
  const env = await B.launchBot({ world: s, settings: settings(Object.assign({}, LIVE, { 'botbuild.policy': 'dis_exp90', 'botbuild.research': false, 'botbuild.maxRetries': 2 })) });
  try {
    const Wd = env.world;
    const orig = Wd.order;
    Wd.order = (kind, bodyId, prm) => {
      if (kind === 'buildings' && +bodyId === COLONY && prm && prm.cmd === 'insert') { Wd.log.refusals.push({ t: Wd.clock.nowUnix(), kind, why: 'test: silent refusal', bodyId, id: prm.id }); return { ok: false, error: 'test' }; }
      return orig(kind, bodyId, prm);
    };
    await leader(env);
    const best = expectedRanking(s, DIS).find((x) => x.kind === 'building' && x.bodyId === COLONY);
    const cd = await env.waitJournal('botbuild:build-verify', { pred: (e) => e.d && e.d.ok === false && e.d.cooldownUntil, timeoutMs: 150000 });
    assert.equal(cd.d.step.id, best.id);
    assert.equal(cd.d.step.bodyId, COLONY);
    assert.equal(cd.d.tries, 2);
    assert.ok(cd.d.cooldownUntil - cd.t > 29 * 60000, '30-min cooldown');
    const tries = posts(env).filter((r) => +r.cp === COLONY && formId(r) === best.id);
    assert.equal(tries.length, 2, 'exactly maxRetries attempts');
    const vf = await env.journal({ kind: 'botcore:action-verify-fail' });
    assert.ok(vf.length >= 2, 'executor journaled the failed verifications');
    await env.until(() => posts(env).some((r) => +r.cp === COLONY && r.page.toLowerCase() === 'buildings' && formId(r) !== best.id), { timeoutMs: 200000, label: 'another colony step' });
    assert.equal(posts(env).filter((r) => +r.cp === COLONY && formId(r) === best.id).length, 2, 'no attempt of the cooled item');
    const sk = await env.journal({ kind: 'botbuild:skip' });
    assert.ok(sk.some((e) => /пауза после/.test(e.w || '')), 'cooldown shown as a skip reason');
    await decisionsFirst(env, 'verify');
    await clean(env, 'verify');
  } finally { await env.close(); }
}, { timeout: 330000 });

T.test('colony short of resources: its step waits and a need is published (bot:needs); no reservation until a delivery flies there', async () => {
  const env = await B.launchBot({ world: 'botbuild-colony', settings: settings(Object.assign({}, LIVE, { 'botbuild.policy': 'dis_exp90' })) });
  try {
    await leader(env);
    const w = await env.waitJournal('botbuild:wait', { pred: (e) => e.d && e.d.step && e.d.step.bodyId === COLONY, timeoutMs: 60000 });
    assert.equal(w.d.waitSec, null, 'no production: it would never be affordable by itself');
    const page = await env.page();
    const needs = await env.evalOgx(page, () => OGX.bot.needs.list());
    const n = needs.find((x) => x.bodyKey === 'p' + COLONY);
    assert.ok(n, 'need for the colony: ' + JSON.stringify(needs));
    assert.equal(n.owner, 'botbuild');
    assert.equal(n.forItem.id, w.d.step.id);
    assert.deepEqual(n.res, { metal: w.d.step.cost.metal, crystal: w.d.step.cost.crystal, deuterium: w.d.step.cost.deuterium }, 'missing = full price (stock 0)');
    assert.deepEqual(n.min, n.res, 'payback policy: no chain (the waiting step only)');
    assert.equal(n.planKey, 'botbuild:p' + COLONY);
    assert.ok(Number.isFinite(n.wantedBy) && Number.isFinite(n.priority));
    // John 2026-11-01: a waiting planet reserves only for a delivery that is on its way (none here): its stock stays usable
    const resv = await env.evalOgx(page, () => OGX.bot.reservations.list());
    assert.ok(!resv.some((r) => r.module === 'botbuild' && r.bodyKey === 'p' + COLONY), 'nothing reserved on the colony: ' + JSON.stringify(resv));
    assert.ok(!posts(env).some((r) => +r.cp === COLONY), 'nothing ordered on the colony');
    assert.ok(posts(env).some((r) => +r.cp === HOME), 'the home planet still builds');
    await decisionsFirst(env, 'colony');
    await clean(env, 'colony');
  } finally { await env.close(); }
}, { timeout: 150000 });

T.test('dry-run (default): orders are planned and journaled with the exact form, nothing mutating reaches the server', async () => {
  const s = spec('botbuild-payback');
  const env = await B.launchBot({ world: s, settings: settings({ 'botcore.master': true, 'botbuild.on': true, 'botbuild.policy': 'dis_exp90' }) });
  try {
    await leader(env);
    const best = expectedRanking(s, DIS)[0];
    const dry = await env.waitJournal('botcore:action-dry', { pred: (e) => e.d && e.d.module === 'botbuild' && e.d.type === 'build.building', timeoutMs: 60000 });
    const rq = dry.d.requests[0];
    assert.equal(rq.method, 'POST'); assert.equal(rq.page, 'buildings');
    assert.deepEqual(rq.form, { cmd: 'insert', building: best.id });
    assert.equal(rq.cp, best.bodyId);
    await env.waitJournal('botbuild:build-start', { pred: (e) => e.d && e.d.dry === true });
    await new Promise((r) => setTimeout(r, 3000));
    assert.deepEqual(env.mutating().map((r) => r.method + ' ' + r.url), [], 'no POST in dry-run');
    assert.equal(env.world.log.builds.length, 0);
    await decisionsFirst(env, 'dry');
    await clean(env, 'dry');
  } finally { await env.close(); }
}, { timeout: 150000 });

T.test('master switch off (botbuild.on, dry-run off): nothing at all; sleep window: nothing either', async () => {
  const env = await B.launchBot({ world: 'botbuild-payback', settings: settings({ 'botcore.master': false, 'botcore.dryRun': false, 'botbuild.on': true }) });
  try {
    await new Promise((r) => setTimeout(r, 22000));
    assert.deepEqual((await env.journal({ kind: /^botbuild:/ })).map((e) => e.k), [], 'no botbuild events');
    assert.deepEqual(env.mutating().map((r) => r.method + ' ' + r.url), []);
    assert.equal(env.world.log.builds.length, 0);
    assert.equal((await env.botStatus()).state, 'off');
    // sleep window around the current server wall time (UTC+2): the build worker does not run
    const wall = new Date(Date.now() + 7200 * 1000);
    const hh = (h) => String((h + 24) % 24).padStart(2, '0') + ':00';
    await env.setSettings({ 'botcore.sleepOn': true, 'botcore.sleepFrom': hh(wall.getUTCHours() - 1), 'botcore.sleepTo': hh(wall.getUTCHours() + 2), 'botcore.master': true });
    await env.until(async () => { const s = await env.botStatus(); return s && s.state === 'sleeping'; }, { timeoutMs: 30000, label: 'sleeping' });
    await new Promise((r) => setTimeout(r, 22000));
    assert.deepEqual(env.mutating().map((r) => r.method + ' ' + r.url), [], 'nothing sent while asleep');
    assert.equal(env.world.log.builds.length, 0);
    assert.deepEqual((await env.journal({ kind: /^botbuild:(decision|choose|build-start|research-start)$/ })).map((e) => e.k), [], 'no build decisions while asleep');
    await clean(env, 'off/sleep');
  } finally { await env.close(); }
}, { timeout: 150000 });
