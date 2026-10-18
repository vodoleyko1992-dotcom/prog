'use strict';
// 20.14 (просьба игрока 18.10): РБ основной целью, обычные мобы рядом — масс-спойл по ним и АОЕ (Whirlwind и др.).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { flowFixture } = require('./warlock-combat-fixture.cjs');
const root = path.resolve(__dirname, '..');
const names = s => String(s || '').toLowerCase().split(/[,|]/).map(x => x.trim()).filter(Boolean);
function loot(near = [{ name: 'Side', cur: 3000, max: 3000 }], cfg = {}) {
  const mass = { title: 'Spoil Festival' }, solo = { title: 'Spoil' }, slots = [solo, mass], calls = [], lines = [];
  const env = {
    cfg: { nSpoil: 'Spoil', nSpoilMass: 'Spoil Festival', spoilRb: false, ...cfg }, rt: {},
    names, slotsBy: n => slots.filter(b => b.title.toLowerCase().startsWith(n.toLowerCase())),
    ready: () => true, cleanTitle: s => s, extraMobs: () => near,
    meMp: () => ({ cur: 629, max: 629 }), skillMp: n => /festival/i.test(n) ? 73 : 12,
    logLines: () => lines.slice(), newLines: (a, b) => b.slice(a.length), mobSpoiled: () => false,
    nameLike: (a, b) => a.toLowerCase() === b.toLowerCase(), SPOIL_OK: /спойл успішний/i, SPOIL_FAIL: /спойл не вдався/i,
    waitFor: async fn => fn(), noticeText: () => '', rec() {}, setRt: async p => Object.assign(env.rt, p)
  };
  const box = { console, URLSearchParams, Date, Math };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules', 'loot.js'), 'utf8'), box);
  const api = box.L2V7Factories.loot(env), ctx = { block: {}, name: 'Boss', rb: { id: 'l2dop_rb_1', note: 'тест' } };
  const act = async b => { calls.push(b.title); lines.push('Spoil Festival: Side: успіх (100%)'); return true; };
  return { api, ctx, act, calls, env, mob: { cur: 900000, max: 1000000 } };
}
test('РБ с живым мобом рядом: Festival метит соседа, обычный Spoil по РБ не жмётся без галки', async () => {
  const f = loot(); await f.api.spoilStep(f.ctx, f.act, f.mob); await f.api.spoilStep(f.ctx, f.act, f.mob);
  assert.deepEqual(f.calls, ['Spoil Festival']); assert.equal(f.ctx.nearSpoiled, 1); assert.notEqual(f.ctx.spoiled, true);
});
test('РБ без соседей или с выключенной галкой: масс-спойла нет', async () => {
  for (const f of [loot([]), loot([{ name: 'Side', cur: 0, max: 3000 }]), loot(undefined, { rbNearMobs: false })]) {
    await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, []);
  }
});
test('20.15: на РБ новый непомеченный сосед — Festival снова (по откату); убитый помеченный не держит метку', async () => {
  const near = [{ name: 'Side', cur: 3000, max: 3000 }], f = loot(near);
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.equal(f.calls.length, 1);
  near.push({ name: 'Other', cur: 2000, max: 2000 });
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.equal(f.calls.length, 2);
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.equal(f.calls.length, 2, 'все помечены — не жмём');
  near.splice(0, 1);                                   // Side убит
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.equal(f.calls.length, 2);
  near.push({ name: 'Side', cur: 3000, max: 3000 });   // подошёл новый того же вида
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.equal(f.calls.length, 3);
  assert.equal(f.ctx.nearSpoiled, 2);
});
test('20.15: на обычном мобе масс-спойл по-прежнему один раз за бой', async () => {
  const near = [{ name: 'Side', cur: 3000, max: 3000 }], f = loot(near); delete f.ctx.rb; f.ctx.name = 'Main';
  await f.api.spoilStep(f.ctx, f.act, f.mob); near.push({ name: 'Other', cur: 2000, max: 2000 });
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls.filter(c => /festival/i.test(c)), ['Spoil Festival']);
});
function fight(spoiled = 0, cfg = {}) {
  const f = flowFixture('mage'), e = f.env, flame = { title: 'Flame Strike', getAttribute: () => null };
  f.slots.push(flame); f.hp.textContent = '900000 / 1000000';
  Object.assign(e.cfg, { mageProbe: false, ...cfg }); e.rt.skills.blaze = { dmg: 25449 * 3, dmgN: 3 };
  e.rt.skills['flame strike'] = { dmg: 21264 * 3, dmgN: 3 };      // splash на РБ не измерен — каталог AREA
  e.expDmg = k => { const p = e.rt.skills[k.toLowerCase()]; return p ? p.dmg / p.dmgN : 0; };
  e.skillMp = n => n === 'Flame Strike' ? 38 : 29;
  e.ilOf = b => b === flame ? { c: 'Маг. атака', t: 'MDAM', mp: 38, target: 'AREA' } : { c: 'Маг. атака', t: 'MDAM', mp: 29, target: 'ONE' };
  const row = (name, hp) => ({ querySelector: s => s.includes('__icon') ? { alt: name } : { textContent: hp } });
  const panel = { textContent: '', querySelectorAll: () => [row('A', '20000 / 20000'), row('B', '20000 / 20000')] };
  const q = e.$q; e.$q = s => s === '#battle-whirlwind-extras' ? panel : q(s);
  const ctx = { block: {}, rb: { id: 'l2dop_rb_1', note: 'тест' }, nearSpoiled: spoiled };
  return { f, panel, pick: () => f.combat.chooseAction(ctx, { cur: 5370, max: 5408 }) };
}
test('РБ + проспойленные соседи: АОЕ (потеря урона по РБ 16 %) выбирается', () => {
  const r = fight(2).pick(); assert.equal(r.name, 'Flame Strike'); assert.match(r.why, /РБ: АОЕ по мобам рядом/);
});
test('РБ + непроспойленные соседи: та же потеря 16 % больше 15 % — одиночный удар', () => {
  assert.equal(fight(0).pick().name, 'Blaze');
});
test('РБ: без соседей или с выключенной галкой АОЕ не выбирается', () => {
  const a = fight(2); a.panel.querySelectorAll = () => []; assert.equal(a.pick().name, 'Blaze');
  assert.equal(fight(2, { rbNearMobs: false }).pick().name, 'Blaze');
});
