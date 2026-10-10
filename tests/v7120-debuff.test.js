'use strict';
// 7.1.30: дебаффы мага — только на долгом бою/чемпионе/РБ, Surrender to Fire первым при огне, один раз на обычную цель
const assert = require('node:assert/strict'); const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const mk = (title, cd, il) => ({ title, cd, il, kind: 'скилл', disabled: false, className: '', getAttribute(k) { return k === 'aria-disabled' ? null : k === 'data-slot-cd' ? this.cd : null; } });
const slots = [mk('Blaze', 'l2_1220', { c: 'Маг. атака', t: 'MDAM' }), mk('Aura Burn', 'l2_1172', { c: 'Маг. атака', t: 'MDAM' }),
  mk('Surrender to Fire', 'l2_1083', { c: 'Дебафф', t: 'DEBUFF', st: 'FireAtr', dur: 15 }), mk('Curse Weakness', 'l2_1164', { c: 'Дебафф', t: 'DEBUFF', st: 'pAtkDown', dur: 15 }),
  mk('Curse Chaos', 'l2_1222', { c: 'Дебафф', t: 'DEBUFF', st: 'accuracyDown', dur: 15 })];
let mobTxt = '2400 / 2400';
const sb = { document: { querySelectorAll: () => slots, querySelector: () => null }, console, Date }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), sb);
const env = { SLOT: '.slot', cfg: {}, rt: { skills: { blaze: { dmg: 1600, dmgN: 2 }, 'aura burn': { dmg: 1600, dmgN: 2 } } }, combatProfileKind: () => 'mage_summoner',
  $q: s => s === '#battle-mob-hp-val' ? { textContent: mobTxt } : null, shown: () => false, cleanTitle: s => s, slotKind: b => b.kind, isEquip: () => false, ilOf: b => b.il,
  slotCd: () => null, memLeft: () => 0, slotAction: b => b.cd, combatCooldown: { skillWait: () => 0 }, battleSpawn: () => 'x', skKey: b => b.title.toLowerCase(),
  names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), skillMp: () => 20 };
const C = sb.L2V7Factories.combat(env), mp = { cur: 1500, max: 2000 }, me = { pct: 100 };
assert.equal(C.debuffPlan({ block: {} }, mp, me), null, 'ordinary mob (3 spells to kill) — no debuff');
// 7.1.31: «долгий бой» = ещё ≥ 10 действий (заклинание ≈800 + удар кота); 6000 HP — 7,5 действия: дебафф не окупится
mobTxt = '6000 / 6000';
assert.equal(C.debuffPlan({ block: {} }, mp, me), null, '7.5 actions left — debuff turn does not pay back');
assert.equal(C.debuffPlan({ block: {}, champ: true }, mp, me), null, 'auto: champion 6000 HP (лог 10.10: ✦→✦→B→B→B) — no debuffs');
mobTxt = '9000 / 9000';
let ctx = { block: {} };
assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Surrender to Fire', 'long fight (11 actions) + fire spells → Surrender to Fire first');
ctx.debuffed = { 'surrender to fire': Date.now() };
assert.equal(C.debuffPlan(ctx, mp, me), null, 'non-boss: Curse Weakness only when hero is hurt, once per target');
assert.equal(C.debuffPlan(ctx, mp, { pct: 60 })?.n, 'Curse Weakness');
mobTxt = '3000 / 3000';
assert.equal(C.debuffPlan({ block: {} }, mp, { pct: 60 })?.n, 'Curse Weakness', 'short fight, hero hurt: defensive debuff only (no Surrender)');
mobTxt = '9000 / 9000';
ctx = { block: {}, rb: { id: 1 }, debuffed: { 'surrender to fire': Date.now(), 'curse weakness': Date.now() } };
assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Curse Chaos', 'RB → accuracy curse too');
assert.equal(C.debuffPlan({ block: {}, rb: { id: 1 } }, { cur: 40, max: 2000 }, me), null, 'low MP — mana goes to damage');
env.cfg.debuffAuto = false; assert.equal(C.debuffPlan({ block: {}, rb: { id: 1 } }, mp, me), null);
env.cfg.debuffAuto = true;
// 7.1.30: настройки из «Скиллы → Дебаффы»
mobTxt = '5000 / 5000'; env.cfg.debuffMode = 'boss'; assert.equal(C.debuffPlan({ block: {} }, mp, me), null, 'boss mode: long fight alone is not enough');
assert.equal(C.debuffPlan({ block: {}, champ: true }, mp, me)?.n, 'Surrender to Fire', 'boss mode: champion ok');
mobTxt = '900 / 900'; env.cfg.debuffMode = 'always'; assert.equal(C.debuffPlan({ block: {} }, mp, me)?.n, 'Surrender to Fire', 'always: any mob');
env.cfg.debuffMode = 'auto'; mobTxt = '9000 / 9000'; env.cfg.nDebuff = 'Curse Chaos, Surrender to Fire';
assert.equal(C.debuffPlan({ block: {} }, mp, me)?.n, 'Curse Chaos', 'own list overrides built-in priority');
env.cfg.nDebuff = 'Curse Weakness'; const c2 = { block: {}, debuffed: { 'curse weakness': Date.now() } };
assert.equal(C.debuffPlan(c2, mp, me), null, 'own list: only listed debuffs, still once per target');
console.log('PASS: mage debuffs — only when it pays back (≥ 10 actions left / RB / hero hurt), fire debuff first, once per target, MP reserve, switchable');
