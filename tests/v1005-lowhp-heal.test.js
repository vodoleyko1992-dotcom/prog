'use strict';
// 10.0.5 (лог 13.10 10:51:45–10:52:06, Fierce Tiger King Angel, Warlock 66): GET /character висел 8,6 с, HUD показывал HP 55 %, а РБ бил;
// ответ хода — HP 19 %. Дальше 10 с бот чередовал банку (+600) и Blaze при HP 6–24 %: вампирик (Vampiric Touch, +1 880 HP за ход) был
// запрещён ниже стоп-HP + 10 % = 35 %, лечащий скилл на РБ отдан банке. Игрок жал вампирик руками. Теперь при критическом HP: у мага
// сначала вампирик, потом банка, пока банка на паузе — вампирик/лечащий скилл; удар — только если лечить нечем. Удар, выбранный до ответа
// хода, не жмётся, если за ожидание HP упал до опасного (act(..., hpGuard) → 'lock')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const combat = fs.readFileSync(path.join(__dirname, '..', 'modules/combat.js'), 'utf8');

(async () => {
  // 1. аварийный блок: порядок вампирик → банка → вампирик/лечение, удар только без лечения
  const i0 = combat.indexOf('    if (me && me.pct <= Math.max(env.cfg.stopHp, 25)) {'), i1 = combat.indexOf('    ctx.emWait = 0;', i0);
  assert.ok(i0 > 0 && i1 > i0, 'emergency block');
  const block = combat.slice(i0, i1);
  const VT = { title: 'Vampiric Touch' }, CLD = { title: 'Corpse Life Drain' }, POT = { title: 'Зілля зцілення' };
  const run = async ({ mage = true, steps = 6, pot = POT, drain = true, heal = true } = {}) => {
    const calls = []; let now = 5_000_000;
    const ctx = { rb: { id: 'x' }, block: {}, seq: [] };
    const sb = { env: { cfg: { stopHp: 25 }, hpPotPick: () => pot, cleanTitle: s => s, qty: () => 10, hpPots: () => pot ? [pot] : [], rec: () => {} },
      ctx, me: { pct: 19, cur: 1659, max: 8517 }, mp: { cur: 5000 }, Date: { now: () => now }, Math, mageCombat: () => mage,
      drainPick: c => drain && (c.block['drain:' + VT.title] || 0) <= now ? VT : null,
      healPick: c => heal && (c.block['heal:' + CLD.title] || 0) <= now ? CLD : null,
      act: async (b, st) => { calls.push(b.title + ' @' + (now - 5_000_000)); return true; } };
    vm.runInNewContext(`let lastHpPot = 0; this.step = async () => { let fell = true; for (let i = 0; i < 1; i++) {\n${block}\n fell = false; } return fell; };`, sb);
    const falls = [];
    for (let k = 0; k < steps; k++) { falls.push(await sb.step()); now += 400; }
    return { calls, falls };
  };
  let r = await run();
  assert.deepEqual(r.calls, ['Vampiric Touch @0', 'Зілля зцілення @400', 'Corpse Life Drain @800', 'Vampiric Touch @1600', 'Зілля зцілення @2000'],
    'mage at 19 %: vampiric first, then potion, then heal skill while potion/vampiric wait, vampiric again when free');
  assert.deepEqual(r.falls, [true, true, true, false, true, true], 'the attack gets a turn only when vampiric, potion and heal are all on cooldown (1.2 s)');
  r = await run({ drain: false, heal: false });
  assert.deepEqual(r.calls, ['Зілля зцілення @0', 'Зілля зцілення @1200'], 'potion every 1.1 s as before');
  assert.ok(r.falls.some(f => !f), 'nothing to heal with between potions → the attack gets the turn (as before)');
  r = await run({ mage: false, steps: 3 });
  assert.deepEqual(r.calls, ['Зілля зцілення @0', 'Vampiric Touch @400', 'Corpse Life Drain @800'], 'fighter: potion first, drain/heal while it waits');
  r = await run({ pot: null, steps: 5 });
  assert.deepEqual(r.calls, ['Vampiric Touch @0', 'Corpse Life Drain @400', 'Vampiric Touch @1600'], 'no potions: vampiric and heal skill');

  // 2. обычный ход: нижняя граница «HP > стоп-HP + 10 %» у вампирика снята, лечащий скилл уступает готовому вампирику при любом HP
  assert.match(combat, /const drainB = me && me\.pct <= \(ctx\.rb\?\.potOn \? 100 : env\.cfg\.drainHp \?\? 85\) \? drainPick\(ctx, mp\) : null;/);
  assert.match(combat, /const drainFirst = mageCombat\(\) && me && !!drainPick\(ctx, mp\);/);
  assert.match(combat, /const hs = healPick\(ctx, mp\);/);

  // 3. act(..., hpGuard): HP упал за время ожидания хода → 'lock', лечащий ход (вампирик/лечение) не блокируется
  const actSrc = combat.slice(combat.indexOf('  let lastHpPot = 0, lastMpPot = 0'), combat.indexOf('  const t0 = Date.now();\n  let progSig'));
  const consts = combat.match(/const LOCK_A = \[60, 500, 120\], LOCK_B = \[30, 200, 50\];/)[0];
  const mkAct = (pct0, pctNow) => {
    let now = 1_000_000; const fired = [], recs = [];
    const NET = { start: 1, done: 1, doneT: now - 5000, ok: true, action: 'l2_1220' };
    const env = { on: true, tabOwner: true, isBattle: () => true, rt: {}, setRt: async () => {}, gameBusy: () => ({ busy: false, end: 0 }),
      combatCooldown: { globalWait: () => 0, skillWait: () => 0, recentlyGlobalRejected: () => false }, slotAction: () => 'l2_1220', cdSpawn: () => 'sp', battleSpawn: () => 'sp',
      observeSlot: () => {}, actNet: () => NET, fire: b => { fired.push(b.title); NET.start++; NET.done++; NET.doneT = now + 300; return true; },
      sleep: async ms => { now += ms; }, waitFor: async (fn, ms) => { const r = fn(); if (!r) now += ms; return r; }, setStatus: () => {}, skKey: () => 'k',
      slotCd: () => null, petState: () => null, pause: async () => {}, rnd: a => a, rec: (...a) => recs.push(a.join(' ')), TAG: '', cleanTitle: s => s, memLeft: () => 0,
      FORCE_NEED: /x^/, UNAVAIL: /x^/, CD_RE: /x^/, meHp: () => ({ pct: pctNow, cur: pctNow * 85, max: 8517 }) };
    const sb = { env, Date: { now: () => now }, Math, Map, console, ctx: { pet: null, mePct0: pct0 }, lostUntil: new Map(), pressAt: new Map(), victory: () => false, defeat: () => false,
      noticeText: () => '', uiReady: () => true, mobHp: () => ({ cur: 100 }), rememberCd: async () => {}, mageCombat: () => true, healSlot: b => /Vampiric|Drain/.test(b.title) };
    vm.runInNewContext(`${consts}\n${actSrc}\nthis.act = act;`, sb);
    return { act: sb.act, fired, recs };
  };
  let t = mkAct(55, 19);
  assert.equal(await t.act({ title: 'Blaze' }, 'Blaze', true), 'lock', 'HP 55 → 19 % while waiting: the attack is not pressed');
  assert.deepEqual(t.fired, []);
  assert.ok(t.recs.some(s => /HP упал 55 → 19 %/.test(s)), 'journal line');
  t = mkAct(55, 19);
  assert.equal(await t.act({ title: 'Vampiric Touch' }, 'VT', true), true, 'a healing turn is never held back');
  t = mkAct(55, 19);
  assert.equal(await t.act({ title: 'Blaze' }, 'Blaze'), true, 'without hpGuard (potions, buffs) — as before');
  t = mkAct(55, 45);
  assert.equal(await t.act({ title: 'Blaze' }, 'Blaze', true), true, '55 → 45 %: ordinary hit, attack goes on');
  t = mkAct(90, 60);
  assert.equal(await t.act({ title: 'Blaze' }, 'Blaze', true), true, 'HP still above 50 % — attack');
  assert.match(combat, /const done = await act\(a\.b, `Бой\$\{tc\}: \$\{a\.name\}[^`]*`, true\);/, 'main hit uses hpGuard');
  assert.match(combat, /ctx\.mePct0 = me \? me\.pct : null;/);
  console.log('v1005-lowhp-heal: OK');
})();
