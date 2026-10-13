'use strict';
// 7.1.30: дебаффы мага — только на долгом бою/чемпионе/РБ, один раз на обычную цель
// 7.2.1: механика L2WAP (Surrender/Chaos = M.Def −10 %, Weakness = P.Atk −20 % на 10 с) и замер выгоды (rt.debuffGain)
const assert = require('node:assert/strict'); const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const mk = (title, cd, il) => ({ title, cd, il, kind: 'скилл', disabled: false, className: '', getAttribute(k) { return k === 'aria-disabled' ? null : k === 'data-slot-cd' ? this.cd : null; } });
const slots = [mk('Blaze', 'l2_1220', { c: 'Маг. атака', t: 'MDAM' }), mk('Aura Burn', 'l2_1172', { c: 'Маг. атака', t: 'MDAM' }),
  mk('Surrender to Fire', 'l2_1083', { c: 'Дебафф', t: 'DEBUFF', st: 'mDefDown', dur: 15 }), mk('Curse Weakness', 'l2_1164', { c: 'Дебафф', t: 'DEBUFF', st: 'pAtkDown', dur: 10 }),
  mk('Curse Chaos', 'l2_1222', { c: 'Дебафф', t: 'DEBUFF', st: 'mDefDown', st2: 'pAtkDown', dur: 15 })];
let mobTxt = '2400 / 2400';
const sb = { document: { querySelectorAll: () => slots, querySelector: () => null }, console, Date }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), sb);
const env = { SLOT: '.slot', cfg: {}, rt: { skills: { blaze: { dmg: 1600, dmgN: 2 }, 'aura burn': { dmg: 1600, dmgN: 2 } } }, combatProfileKind: () => 'mage_summoner',
  $q: s => s === '#battle-mob-hp-val' ? { textContent: mobTxt } : null, shown: () => false, cleanTitle: s => s, slotKind: b => b.kind, isEquip: () => false, ilOf: b => typeof b === 'string' ? slots.find(x => x.title.toLowerCase() === b.toLowerCase())?.il : b.il,
  slotCd: () => null, memLeft: () => 0, slotAction: b => b.cd, combatCooldown: { skillWait: () => 0 }, battleSpawn: () => 'x', skKey: b => b.title.toLowerCase(),
  names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), skillMp: () => 20, setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a) };
const recs = [];
const C = sb.L2V7Factories.combat(env), mp = { cur: 1500, max: 2000 }, me = { pct: 100 };
assert.equal(C.debuffPlan({ block: {} }, mp, me), null, 'ordinary mob (3 spells to kill) — no debuff');
// 7.1.31: «долгий бой» = ещё ≥ 10 действий (заклинание ≈800 + удар кота); 6000 HP — 7,5 действия: дебафф не окупится
mobTxt = '6000 / 6000';
assert.equal(C.debuffPlan({ block: {} }, mp, me), null, '7.5 actions left — debuff turn does not pay back');
assert.equal(C.debuffPlan({ block: {}, champ: true }, mp, me), null, 'auto: champion 6000 HP (лог 10.10: ✦→✦→B→B→B) — no debuffs');
mobTxt = '9000 / 9000';
let ctx = { block: {} };
assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Curse Chaos', 'long fight (11 actions) → Curse Chaos first (M.Def −10 % + P.Atk −12 %)');
ctx.debuffed = { 'curse chaos': Date.now() };
// 10.0.7: второй M.Def-дебафф поверх первого — только на РБ (стакаются ли Chaos и Surrender, игра не пишет; на мобе второй ход — потеря)
assert.equal(C.debuffPlan(ctx, mp, me), null, 'Chaos on the target → Surrender is not stacked on a mob');
assert.equal(C.debuffPlan({ ...ctx, rb: { id: 1 }, spellDmg: { blaze: { off: [1800, 2], on: [0, 0] } } }, mp, me)?.n, 'Surrender to Fire', 'RB: Surrender over Chaos still (long fight)');
ctx.debuffed['surrender to fire'] = Date.now();
assert.equal(C.debuffPlan(ctx, mp, me), null, 'non-boss: Curse Weakness only when hero is hurt, once per target');
assert.equal(C.debuffPlan(ctx, mp, { pct: 60 })?.n, 'Curse Weakness');
mobTxt = '3000 / 3000';
assert.equal(C.debuffPlan({ block: {} }, mp, { pct: 60 })?.n, 'Curse Weakness', 'short fight, hero hurt: defensive debuff only (no Surrender)');
mobTxt = '9000 / 9000';
// РБ без замера выгоды: сперва 2 заклинания без M.Def-дебаффа (есть с чем сравнить) — пока только защитный Weakness
ctx = { block: {}, rb: { id: 1 } };
assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Curse Weakness', 'RB, no samples yet: defensive Weakness, M.Def debuffs wait');
ctx.debuffed = { 'curse weakness': Date.now() };
assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Curse Chaos', 'Chaos still goes for its P.Atk part');
C.spellSample(ctx, 'blaze', 900); C.spellSample(ctx, 'blaze', 900);
ctx.debuffed['curse chaos'] = Date.now();
assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Surrender to Fire', 'RB after 2 clean samples → Surrender');
C.spellSample(ctx, 'blaze', 1000);
assert.deepEqual([...ctx.spellDmg.blaze.off], [1800, 2], 'samples before the debuff'); assert.deepEqual([...ctx.spellDmg.blaze.on], [1000, 1], 'sample under M.Def debuff');
// Weakness — обновлять по длительности (10 с)
ctx.debuffed = { 'curse chaos': Date.now(), 'surrender to fire': Date.now(), 'curse weakness': Date.now() - 11000 };
assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Curse Weakness', 'RB: Weakness refreshed after 10 s');
assert.equal(C.debuffPlan({ block: {}, rb: { id: 1 } }, { cur: 40, max: 2000 }, me), null, 'low MP — mana goes to damage');
env.cfg.debuffAuto = false; assert.equal(C.debuffPlan({ block: {}, rb: { id: 1 } }, mp, me), null);
env.cfg.debuffAuto = true;
// 7.1.30: настройки из «Скиллы → Дебаффы»
mobTxt = '5000 / 5000'; env.cfg.debuffMode = 'boss'; assert.equal(C.debuffPlan({ block: {} }, mp, me), null, 'boss mode: long fight alone is not enough');
assert.equal(C.debuffPlan({ block: {}, champ: true }, mp, me)?.n, 'Curse Chaos', 'boss mode: champion ok');
mobTxt = '900 / 900'; env.cfg.debuffMode = 'always'; assert.equal(C.debuffPlan({ block: {} }, mp, me)?.n, 'Curse Chaos', 'always: any mob');
env.cfg.debuffMode = 'auto'; mobTxt = '9000 / 9000'; env.cfg.nDebuff = 'Curse Chaos, Surrender to Fire';
assert.equal(C.debuffPlan({ block: {} }, mp, me)?.n, 'Curse Chaos', 'own list overrides built-in priority');
env.cfg.nDebuff = 'Curse Weakness'; const c2 = { block: {}, debuffed: { 'curse weakness': Date.now() } };
assert.equal(C.debuffPlan(c2, mp, me), null, 'own list: only listed debuffs, still once per target');
// 7.2.1: замер выгоды. Итог боя: «под дебаффом / без» → rt.debuffGain
env.cfg.nDebuff = ''; env.rt.debuffGain = [];
(async () => {
  await C.debuffGainFlush(ctx);
  assert.deepEqual([...env.rt.debuffGain], [1.111], 'Blaze 1000 under debuff vs 900 without → ×1.111');
  // замер показал «прибавки нет» (как на логах 10.10: 1447 под дебаффами против 1535 без) — атакующие дебаффы выключены
  env.rt.debuffGain = [0.94, 0.97, 1.0, 1.01, 0.99, 0.95];
  mobTxt = '20000 / 20000';
  assert.equal(C.debuffGain().ratio < 1.03, true);
  assert.equal(C.debuffPlan({ block: {} }, mp, me), null, 'measured no gain → no M.Def debuffs even on a long fight');
  assert.equal(C.debuffPlan({ block: {} }, mp, { pct: 50 })?.n, 'Curse Weakness', 'defensive debuff still when hurt');
  env.cfg.debuffMode = 'always'; assert.equal(C.debuffPlan({ block: {} }, mp, me)?.n, 'Curse Chaos', '«always» ignores the measurement'); env.cfg.debuffMode = 'auto';
  // прибавка ×1.11 → окупается от ceil(1/0.11)+1 = 11 действий
  env.rt.debuffGain = [1.11, 1.11, 1.11, 1.11, 1.11, 1.11];
  assert.equal(C.debuffGain().minActs, 11);
  mobTxt = '9200 / 9200'; assert.equal(C.debuffPlan({ block: {} }, mp, me)?.n, 'Curse Chaos', '11.5 actions left ≥ 11');
  mobTxt = '8400 / 8400'; assert.equal(C.debuffPlan({ block: {} }, mp, me), null, '10.5 actions left < 11');
  // не прошёл — цель не считается обработанной (иначе замер «под дебаффом» врёт)
  assert.match(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), /if \(fail && !ok && ctx\.debuffed\) delete ctx\.debuffed\[dbf\.k\]/);
  console.log('PASS: mage debuffs — L2WAP effects (Chaos/Surrender M.Def, Weakness P.Atk 10 s), pays back by measured gain, RB samples first, measurement turns M.Def debuffs off, own list, MP reserve');
})().catch(e => { console.error(e); process.exit(1); });

