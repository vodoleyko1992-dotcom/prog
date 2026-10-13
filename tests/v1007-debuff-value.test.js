'use strict';
// 10.0.7 (игрок 13.10 03:11: «бот стал усиленно дебафать мобов, на сколько это реально даёт прирост КПД/ДПС?»; лог 13.10 12:25–13:12):
// цена хода на дебафф против выигрыша — по модели (M.Def −10 % → заклинания ×1,11, только доля заклинаний, шанс пройти по статистике,
// время действия ÷ ход), проба на чемпионе ради замера, второй M.Def-дебафф поверх первого — только на РБ
const assert = require('node:assert/strict'); const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const mk = (title, cd, il) => ({ title, cd, il, kind: 'скилл', disabled: false, className: '', getAttribute(k) { return k === 'aria-disabled' ? null : k === 'data-slot-cd' ? this.cd : null; } });
const slots = [mk('Blaze', 'l2_1220', { c: 'Маг. атака', t: 'MDAM' }),
  mk('Surrender to Fire', 'l2_1083', { c: 'Дебафф', t: 'DEBUFF', st: 'mDefDown', dur: 15 }), mk('Curse Weakness', 'l2_1164', { c: 'Дебафф', t: 'DEBUFF', st: 'pAtkDown', dur: 10 }),
  mk('Curse Chaos', 'l2_1222', { c: 'Дебафф', t: 'DEBUFF', st: 'mDefDown', st2: 'pAtkDown', dur: 10 })];
let mobTxt = '97776 / 97776';
const sb = { document: { querySelectorAll: () => slots, querySelector: () => null }, console, Date }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), sb);
const recs = [];
// Warlock 67 по логу 13.10: Blaze ≈6 600 по чемпиону, ход ≈1,1 с, дебаффы прошли 32 из 44 (73 %)
const env = { SLOT: '.slot', cfg: {}, rt: { skills: { blaze: { dmg: 13200, dmgN: 2 } }, turnMs: 1100, debuffStat: { 'surrender to fire': { ok: 16, fail: 6 }, 'curse chaos': { ok: 16, fail: 6 } } }, combatProfileKind: () => 'mage_summoner',
  $q: s => s === '#battle-mob-hp-val' ? { textContent: mobTxt } : null, shown: () => false, cleanTitle: s => s, slotKind: b => b.kind, isEquip: () => false, ilOf: b => typeof b === 'string' ? slots.find(x => x.title.toLowerCase() === b)?.il : b.il,
  slotCd: () => null, memLeft: () => 0, slotAction: b => b.cd, combatCooldown: { skillWait: () => 0 }, battleSpawn: () => 'x', skKey: b => b.title.toLowerCase(),
  names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), skillMp: () => 20, setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')) };
const C = sb.L2V7Factories.combat(env), mp = { cur: 5000, max: 5196 }, me = { pct: 100 };
// модель: ×1,11 × проходит 73 % → 0,08 за ход; окупается от 14 ходов, а Surrender держится 15 с ÷ 1,1 = 13,6 хода → на чемпионе не жмём
let ctx = { block: {}, champ: true };
assert.equal(C.debuffPlan(ctx, mp, me), null, 'champion 97 776 HP, no samples yet: first two spells clean (nothing to compare otherwise)');
C.spellSample(ctx, 'blaze', 6600); C.spellSample(ctx, 'blaze', 6600);
const p1 = C.debuffPlan(ctx, mp, me);
assert.equal(p1?.n, 'Curse Chaos', 'after 2 clean samples: one probe debuff to measure the gain');
assert.equal(ctx.dbfProbe, 1); assert.ok(env.rt.dbfProbeT > 0); assert.match(recs.join('\n'), /проба на чемпионе: Curse Chaos .*×1\.11.*73 %/);
ctx.debuffed = { 'curse chaos': Date.now() };
assert.equal(C.debuffPlan(ctx, mp, me), null, 'Chaos on the target → no Surrender stacked on top (stacking unknown), probe spent');
ctx = { block: {}, champ: true, spellDmg: { blaze: { off: [13200, 2], on: [0, 0] } } };
assert.equal(C.debuffPlan(ctx, mp, me), null, 'next champion within 3 min: model says the turn is not paid back → no debuff');
assert.equal(C.debuffPlan({ ...ctx, rb: { id: 1 } }, mp, me)?.n, 'Curse Chaos', 'RB: always');
assert.equal(C.debuffPlan(ctx, mp, { pct: 60 })?.n, 'Curse Weakness', 'hurt → defensive Weakness (P.Atk −20 %) still');
env.cfg.debuffMode = 'always'; assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Curse Chaos', '«always» ignores the model'); env.cfg.debuffMode = 'auto';
// замер показал ×1,25 (6 замеров): 0,25 × 0,73 = 0,18 → от 7 ходов; чемпион на 97 776 HP = 14 ходов → дебафф окупается
env.rt.debuffGain = [1.25, 1.25, 1.25, 1.25, 1.25, 1.25];
assert.equal(C.debuffPlan(ctx, mp, me)?.n, 'Curse Chaos', 'measured ×1.25 → debuff pays back on a 14-turn champion');
mobTxt = '30000 / 30000'; assert.equal(C.debuffPlan(ctx, mp, me), null, '4.5 turns left — not paid back');
// без своей статистики попыток шанс пройти = 1, без замера ход ≈1 с: 9 000 HP / 800 = 11 ходов ≥ 11 (как в v7120)
env.rt = { skills: { blaze: { dmg: 1600, dmgN: 2 } } }; mobTxt = '9000 / 9000';
assert.equal(C.debuffPlan({ block: {} }, mp, me)?.n, 'Surrender to Fire', 'no stats: model 1.11 → 11 actions; Chaos lasts 10 turns < 11 → Surrender (15 s) instead');
mobTxt = '8000 / 8000'; assert.equal(C.debuffPlan({ block: {} }, mp, me), null);
console.log('PASS: 10.0.7 debuff value — model (spell share × pass rate × duration), champion probe for measurement, no M.Def stacking on mobs, RB/hurt unchanged');
