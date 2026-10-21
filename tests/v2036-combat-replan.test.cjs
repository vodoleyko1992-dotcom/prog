'use strict';
// 20.36: настоящий выбор/замыкание действия — отменённый план не записывает выполненный ход.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { flowFixture } = require('./warlock-combat-fixture.cjs');

// Изолированный worktree может проверить текущую рабочую реализацию через override.
const source = fs.readFileSync(process.env.L2BOT_COMBAT_SOURCE || path.join(__dirname, '../modules/combat.js'), 'utf8');
function privateSeams(text) {
  const capture = '  if (ctx.pet) { const n = env.actNet?.();';
  const exports = ' return { limitPlan,';
  assert.ok(text.includes(capture), 'battle closure capture point exists');
  assert.ok(text.includes(exports), 'combat exports capture point exists');
  return text.replace(capture,
    '  if (env.captureReplanClosures) return env.captureReplanClosures({ ctx, act, strikeStep, AGAIN });\n' + capture)
    .replace(exports, ' return { replanState: { mpUntil }, limitPlan,');
}

async function fixture() {
  const f = flowFixture('fighter');
  let now = Date.now(), mp = 500, globalUntil = 0, rid = 10, title = 'Safe Mob';
  let pulseChange = null, busyChange = null;
  const deadlines = new Map(), receipts = new Map(), outcomes = new Map(), fired = [];
  const net = { start: 0, done: 0, doneT: 0, ok: true, okN: 0 };
  const info = new Map();
  const names = s => String(s || '').toLowerCase().split(/[,|]/).map(x => x.trim()).filter(Boolean);
  function add(action, name, cost, extra = {}) {
    const b = { action, title: name, disabled: false, getAttribute: () => null };
    f.slots.push(b);
    info.set(b, { c: 'Физ. атака', t: 'PDAM', mp: cost, ...extra });
    return b;
  }
  info.set(f.atk, { c: 'Физ. атака', t: 'PDAM', mp: 0 });
  const provoke = add('provoke', 'Провокація масова', 57, { c: 'Агро', t: 'AGGREDUCE', autoUse: false });
  const whirlwind = add('whirlwind', 'Вихор', 49);
  const thunder = add('thunder_storm', 'Грозова буря', 67);
  const stun = add('stun_attack', 'Оглушення', 10);
  Object.assign(f.env.cfg, {
    warlordAggro: true, nPower: 'Вихор, Грозова буря', nUltra: '', nStun: '',
    nForce: '', nCharge: '', nBuffs: '', nKeyBuffs: '', nDrain: '', nHeal: '',
    skillMpMin: 35, stunEvery: 10, mageProbe: false,
  });
  Object.assign(f.env.rt, {
    char: 'Hero', classCur: { prof: 'human_warlord', slot: 0 }, skills: {}, skillDb: {},
    weaponsT: now, weapons: [{ name: 'Orcish Poleaxe', where: 'надето', wt: 'древковое' }],
  });
  const query = f.env.$q;
  Object.assign(f.env, {
    names, routeLocation: f.location, evidenceOwner: () => 'Hero/0/lease', canAct: () => true,
    battleExitContext: () => 'farm/lease', pvpPending: () => false,
    $q: s => s === '#battle-mob-title' ? { textContent: title + ' · ур.74' } : query(s),
    battleInfo: () => ({ name: title, max: 1000, kind: 'normal', t: now }),
    meMp: () => ({ cur: mp, max: 500, pct: mp / 5 }),
    slotAction: b => b === f.atk ? 'attack' : b.action,
    ilOf: b => info.get(b) || [...info].find(([slot]) => slot.title.toLowerCase() === String(b).toLowerCase())?.[1] || null,
    skillMp: name => [...info].find(([slot]) => slot.title.toLowerCase() === String(name).toLowerCase())?.[1].mp || 0,
    isChargeName: () => false, isForceName: () => false,
    expDmg: name => String(name).toLowerCase() === 'атака' ? 100 : 400,
    actNet: () => net, actReceipt: id => receipts.get(id),
    combatCooldown: {
      globalWait: () => Math.max(0, globalUntil - now),
      skillWait: action => Math.max(0, (deadlines.get(action) || 0) - now),
      skillKnown: action => deadlines.has(action), recentlyGlobalRejected: () => false,
    },
    sleep: async ms => { now += ms; },
    pause: async () => { now += 10; },
    combatPulse: async ms => {
      now += ms;
      if (pulseChange) { const change = pulseChange; pulseChange = null; change(); }
    },
    gameBusy: () => {
      if (busyChange) { const change = busyChange; busyChange = null; change(); }
      return { busy: false, end: 0 };
    },
    fire: b => {
      const id = ++rid, action = f.env.slotAction(b), refusal = outcomes.get(action);
      fired.push(action);
      net.start++; net.startRid = id; net.startOwner = f.env.evidenceOwner();
      net.done = net.start; net.doneT = now; net.action = action; net.ok = !refusal;
      if (!refusal) net.okN++;
      if (refusal === 'cd') deadlines.set(action, now + 1000);
      receipts.set(id, {
        rid: id, owner: net.startOwner, action, ok: !refusal, t: now,
        ...(refusal === 'cd' ? { code: 'skill_cooldown', blockedBy: 'skill' } :
          refusal === 'unavail' ? { code: 'skill_unavailable' } :
          refusal === 'nomp' ? { code: 'not_enough_mp' } : {}),
      });
      return true;
    },
  });
  class ClockDate extends Date { static now() { return now; } }
  f.box.Date = ClockDate;
  vm.runInContext(privateSeams(source), f.box);
  const C = f.box.L2V7Factories.combat(f.env);
  f.env.victory = C.victory;
  f.env.mobHp = C.mobHp;
  f.env.captureReplanClosures = closures => closures;
  const scope = await C.battle();
  assert.equal(typeof scope?.strikeStep, 'function', 'real battle opened');
  scope.ctx.mePct0 = 100;
  return {
    ...f, C, scope, provoke, whirlwind, thunder, stun, fired, outcomes, deadlines,
    now: () => now, advance: ms => { now += ms; }, mp: () => f.env.meMp(),
    setMp: value => { mp = value; }, setTitle: value => { title = value; },
    setGlobal: ms => { globalUntil = now + ms; },
    onPulse: change => { pulseChange = change; }, onBusy: change => { busyChange = change; },
    strike: () => scope.strikeStep(f.env.meMp(), C.mobHp(), ''),
  };
}

for (const refusal of ['cd', 'unavail']) {
  test('refused follow-up ' + refusal + ' keeps intent and chooses another AoE without pulling again', async () => {
    const f = await fixture(), ctx = f.scope.ctx;
    const pull = f.C.chooseAction(ctx, f.mp());
    assert.equal(pull.b, f.provoke);
    f.C.warlordPullResult(ctx, pull, true);
    assert.equal(f.C.chooseAction(ctx, f.mp()).b, f.whirlwind);
    f.outcomes.set('whirlwind', refusal);
    assert.equal(await f.strike(), f.scope.AGAIN);
    assert.deepEqual(f.fired, ['whirlwind']);
    assert.equal(ctx.warlordPull.follow, true);
    const replacement = f.C.chooseAction(ctx, f.mp());
    assert.equal(replacement.warlordPull, 'hit');
    assert.equal(replacement.b, f.thunder);
    await f.strike();
    assert.deepEqual(f.fired, ['whirlwind', 'thunder_storm']);
    assert.equal(ctx.warlordPull.follow, false);
    assert.equal(f.C.warlordPullPlan(ctx, f.mp()), null);
  });
}

test('restored MP releases its own hold before 1.5 seconds', async () => {
  const f = await fixture(), key = f.env.skKey(f.whirlwind);
  Object.assign(f.env.cfg, { warlordAggro: false, nPower: 'Вихор' });
  assert.equal(f.C.chooseAction(f.scope.ctx, f.mp()).b, f.whirlwind);
  f.onBusy(() => f.setMp(0));
  assert.equal(await f.scope.act(f.whirlwind, 'AoE'), 'nomp');
  assert.equal(f.fired.length, 0);
  assert.equal(f.C.lostUntil.has(key), false);
  assert.equal(f.C.ready(f.whirlwind), false);
  assert.equal(f.C.chooseAction(f.scope.ctx, f.mp()).b, f.atk, 'no MP selects the free attack');
  const heldAt = f.now();
  f.setMp(500);
  assert.equal(f.C.ready(f.whirlwind), true);
  assert.equal(f.C.chooseAction(f.scope.ctx, f.mp()).b, f.whirlwind, 'fresh MP restores the preferred skill immediately');
  assert.equal(f.C.replanState.mpUntil.has(key), false);
  assert.equal(f.now(), heldAt, 'release does not wait for the hold timeout');
});

test('restored MP preserves independent lost-click and exact server cooldown holds', async () => {
  const f = await fixture(), key = f.env.skKey(f.whirlwind);
  f.onBusy(() => f.setMp(0));
  assert.equal(await f.scope.act(f.whirlwind, 'AoE'), 'nomp');
  const lostDeadline = f.now() + 1000, serverDeadline = f.now() + 1500;
  f.C.lostUntil.set(key, lostDeadline);
  f.deadlines.set('whirlwind', serverDeadline);
  f.setMp(500);
  assert.equal(f.C.ready(f.whirlwind), false);
  assert.equal(f.C.replanState.mpUntil.has(key), false);
  assert.equal(f.C.lostUntil.get(key), lostDeadline);
  assert.equal(f.deadlines.get('whirlwind'), serverDeadline);
  f.advance(1001);
  assert.equal(f.C.ready(f.whirlwind), false, 'server cooldown still applies after the lost-click hold expires');
  f.advance(500);
  assert.equal(f.C.ready(f.whirlwind), true);
});

test('MP restoration does not release an independent lost-click hold', async () => {
  const f = await fixture(), key = f.env.skKey(f.whirlwind);
  f.onBusy(() => f.setMp(0));
  assert.equal(await f.scope.act(f.whirlwind, 'AoE'), 'nomp');
  f.C.lostUntil.set(key, f.now() + 1000);
  f.setMp(500);
  assert.equal(f.C.ready(f.whirlwind), false, 'lost click remains blocked even without any server cooldown');
  assert.equal(f.C.replanState.mpUntil.has(key), false);
  f.advance(1001);
  assert.equal(f.C.ready(f.whirlwind), true);
});

test('server MP refusal waits for a fresh affordable value, not the unchanged stale DOM value', async () => {
  const f = await fixture(), key = f.env.skKey(f.whirlwind);
  f.outcomes.set('whirlwind', 'nomp');
  assert.equal(await f.scope.act(f.whirlwind, 'AoE'), 'nomp');
  assert.equal(f.C.lostUntil.has(key), false);
  assert.equal(f.C.ready(f.whirlwind), false, 'same apparently sufficient MP does not immediately retry');
  f.setMp(0);
  assert.equal(f.C.ready(f.whirlwind), false);
  f.setMp(500);
  assert.equal(f.C.ready(f.whirlwind), true);
  assert.equal(f.C.replanState.mpUntil.has(key), false);
});

async function stunFixture() {
  const f = await fixture();
  Object.assign(f.env.cfg, { warlordAggro: false, nPower: '', nStun: 'Оглушення' });
  f.atk.disabled = true;
  f.scope.ctx.champ = true;
  assert.equal(f.C.chooseAction(f.scope.ctx, f.mp()).b, f.stun, 'actual selector chooses stun');
  return f;
}

test('replan lock leaves stun time and sequence untouched', async () => {
  const f = await stunFixture(), ctx = f.scope.ctx;
  f.setGlobal(300);
  f.onPulse(() => { f.env.cfg.nStun = ''; });
  assert.equal(await f.strike(), f.scope.AGAIN);
  assert.equal(f.fired.length, 0);
  assert.equal(ctx.lastStun, 0);
  assert.equal(ctx.seq.length, 0);
});

test('server MP refusal leaves stun time and sequence untouched', async () => {
  const f = await stunFixture(), ctx = f.scope.ctx;
  f.outcomes.set('stun_attack', 'nomp');
  assert.equal(await f.strike(), f.scope.AGAIN);
  assert.deepEqual(f.fired, ['stun_attack']);
  assert.equal(ctx.lastStun, 0);
  assert.equal(ctx.seq.length, 0);
});

test('successful stun commits its timestamp and sequence after the real action', async () => {
  const f = await stunFixture(), ctx = f.scope.ctx;
  assert.equal(await f.strike(), f.scope.AGAIN);
  assert.deepEqual(f.fired, ['stun_attack']);
  assert.ok(ctx.lastStun > 0);
  assert.equal(ctx.seq.length, 1);
});

test('changed target cancels the old pull even when the same button is still selected', async () => {
  const f = await fixture(), ctx = f.scope.ctx;
  const before = f.C.chooseAction(ctx, f.mp());
  assert.equal(before.b, f.provoke);
  f.setGlobal(300);
  f.onPulse(() => f.setTitle('Different Mob'));
  assert.equal(await f.strike(), f.scope.AGAIN);
  const after = f.C.chooseAction(ctx, f.mp());
  assert.equal(after.b, before.b, 'button identity alone is insufficient');
  assert.notEqual(after.target, before.target);
  assert.equal(f.fired.length, 0);
  assert.equal(ctx.seq.length, 0);
  assert.equal(ctx.warlordPull, undefined, 'cancelled pull was not committed');
});
