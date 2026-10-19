'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 9.0 «цена хода» (разбор боя, лог 11.10 00:47–01:40, бот 7.2.3): на РБ 255 банок из 1 283 ходов, 96 из 234 банок HP — при HP ≥ 80 %,
// Corpse Life Drain (+225 HP, 0 урона) при живой банке (+600). Банка — целый ход без урона: у знакомого РБ пьём, только когда
// после ещё одного ударного хода HP может уйти ниже «спецудар + 2 удара»; без долива до верхней границы полосы.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const combat = fs.readFileSync(path.join(__dirname, '..', 'modules/combat.js'), 'utf8');

// 1. чистая функция
const fn = combat.slice(combat.indexOf('function rbTurnHeal('), combat.indexOf('function frenzyDive('));
const rbTurnHeal = vm.runInNewContext(`${fn}; rbTurnHeal`, { Math });
// Verfa (лог 00:47): спецудар 1995, обычный ≈359, HP 5417 → пол 2713, лечиться ниже 3072
let r = rbTurnHeal({ cur: 4333, max: 5417, spike: 1995, p90: 359, stopPct: 25 });
assert.equal(r.need, false, '80 % HP on Verfa → hit, not drink');
assert.equal(r.floor, 2713); assert.equal(r.at, 3072);
assert.equal(rbTurnHeal({ cur: 3000, max: 5417, spike: 1995, p90: 359, stopPct: 25 }).need, true, 'below spike + 3 hits → heal');
// Pingolpin: спецудар 708, обычный ≈196 → пол низкий, но аварийный порог стоп-HP + 10 % держится
assert.equal(rbTurnHeal({ cur: 1800, max: 5417, spike: 708, p90: 196, stopPct: 25 }).need, true, '≤ 35 % always heals');
assert.equal(rbTurnHeal({ cur: 2500, max: 5417, spike: 708, p90: 196, stopPct: 25 }).need, false);
// Gigantic Chaos Golem: спецудар 2845 (53 % HP) — лечиться почти всегда, пол не выше 96 %
r = rbTurnHeal({ cur: 4300, max: 5417, spike: 2845, p90: 500, stopPct: 25 });
assert.equal(r.need, true, 'Golem 79 % HP → heal (spike + 3 hits = 4345)');
assert.equal(rbTurnHeal({ cur: 4800, max: 5417, spike: 2845, p90: 500, stopPct: 25 }).need, false, 'Golem 89 %: one more hit still leaves spike + 2 hits');
assert.ok(r.floor <= 5417 * 0.96);

// 2. полоса банок в бою: знакомый РБ — по цене хода, без гистерезиса; выключатель и незнакомый РБ — как в 8.0
const i0 = combat.indexOf('    let potAt = env.cfg.hpPotAt;'), i1 = combat.indexOf('    const hpPot = me && me.pct <= potAt', i0);
assert.ok(i0 > 0 && i1 > i0, 'band block found');
const band = combat.slice(i0, i1);
const run = ({ pct, potOn = false, price = true, known = true }) => {
  const recs = [], max = 5417, me = { cur: Math.round(max * pct / 100), max, pct };
  const env = { cfg: { hpPotAt: 50, stopHp: 25, rbBandAuto: true, rbTurnPrice: price, rbPotAt: 75, rbPotTo: 80 },
    rt: { rbDb: { rb1: known ? { sp: 1995, hitP90: 359 } : {} } }, rec: (...a) => recs.push(a.join(' ')) };
  const ctx = { rb: { id: 'rb1', potOn, hits: [] } };
  const sb = { env, ctx, me, Math, rbTurnHeal, frenzyDive: () => false, slotsBy: () => [] };
  return { potAt: vm.runInNewContext(`(() => {\n${band}\nreturn potAt; })()`, sb), ctx, recs };
};
assert.equal(run({ pct: 80 }).potAt, -1, 'known RB, 80 % → no potion');
assert.equal(run({ pct: 70, potOn: true }).potAt, -1, 'no top-up: was drinking, 70 % is safe → hit');
assert.equal(run({ pct: 50 }).potAt, 100, '50 % < 57 % → potion');
assert.match(run({ pct: 80 }).recs.join('\n'), /цена хода: банка\/лечение только при HP < 3072/);
assert.equal(run({ pct: 70, potOn: true, price: false }).potAt, 100, 'switch off → 8.0 band (65…75 %) keeps drinking');
assert.equal(run({ pct: 79, known: false }).potAt, 100, 'unknown RB → careful 8.0 band from 80 %');

// 19.10: доступность банки проверяет общий резерв HP, а не остаток одного типа.
// 3. лечащий скилл на РБ уступает ход банке, пока банка есть (резерв бережём — тогда скилл)
assert.match(combat, /const rbPotHas = !!ctx\.rb && env\.cfg\.rbTurnPrice !== false && .*hpReserveBlocked\(p, env\.cfg\.rbPotReserve\)/);
assert.match(combat, /if \(me && me\.pct <= env\.cfg\.hpPotAt && !drainFirst && !rbPotHas\) \{/);

// 4. настройка есть в меню, по умолчанию ВКЛ везде
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
assert.match((rd('defaults.js') + '\n' + rd('content.js')), /rbBandAuto: true, rbTurnPrice: true,/);
assert.match((rd('defaults.js') + '\n' + rd('popup.js')), /'rbBandAuto', 'rbTurnPrice'/);
assert.match((rd('defaults.js') + '\n' + rd('popup.js')), /rbBandAuto: true, rbTurnPrice: true/);
assert.match(rd('popup.html'), /<input id="rbTurnPrice" type="checkbox">/);
assert.equal(JSON.parse(rd('base-profile.json')).cfg?.rbTurnPrice ?? JSON.stringify(JSON.parse(rd('base-profile.json'))).includes('"rbTurnPrice":true'), true);
console.log('v90-turnprice: PASS');
