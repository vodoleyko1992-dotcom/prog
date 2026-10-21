'use strict';
// 20.43 (John 21.10 12:47: «давай действовать от того какое я оружие одел»): дубина — первым Spoil Crush, пика/другое — Festival.
// Факт боя из облака 21.10: Fortune Seeker 76 + Elysian, Spoil Crush 14 747 урона, Buffalo 70 убит, «Spoil успішний (59%)».
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const names = s => String(s || '').toLowerCase().split(/[,|]/).map(x => x.trim()).filter(Boolean);
function fixture(wt = 'дубина', o = {}) {
  const crush = { title: 'Spoil Crush' }, solo = { title: 'Spoil' }, mass = { title: 'Spoil Festival' }, slots = [solo, crush, mass];
  const calls = [], lines = [], recs = []; let marked = false, near = o.near || [];
  const env = {
    cfg: { nSpoil: 'Spoil, Spoil Crush', nSpoilMass: 'Spoil Festival' }, rt: { char: 'Warlock' }, weaponNow: () => wt == null ? null : { id: 164, wt },
    roleNow: () => o.role || 'spoiler',
    names, slotsBy: n => slots.filter(b => b.title.toLowerCase() === n.toLowerCase()),
    ready: b => !b.disabled, cleanTitle: s => s, extraMobs: () => near,
    meMp: () => ({ cur: 1560, max: 1560 }), skillMp: n => /festival/i.test(n) ? 73 : 40,
    logLines: () => lines.slice(), newLines: (a, b) => b.slice(a.length),
    mobSpoiled: () => marked, nameLike: (a, b) => a.toLowerCase() === b.toLowerCase(),
    SPOIL_OK: /spoil успішний|спойл успішний/i, SPOIL_FAIL: /spoil не вдався|спойл не вдався/i,
    waitFor: async fn => fn(), noticeText: () => '', rec: (...a) => recs.push(a.join(' ')), setRt: async p => Object.assign(env.rt, p)
  };
  const box = { console, URLSearchParams, Date, Math }; vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/loot.js'), 'utf8'), box);
  const api = box.L2V7Factories.loot(env), ctx = { block: {}, name: 'Buffalo' };
  const act = async b => { calls.push(b.title); const r = o.act?.(b) ?? true;
    if (r !== true) return r;                                  // нажатие не принято игрой — ни строки итога, ни метки спойла
    if (b === crush) { if (o.crushFail) lines.push('⁠348​Spoil Crush: удар.; Spoil не вдався (59%) — 9000 урона'); else { marked = true; lines.push('⁠348​Spoil Crush: удар.; Spoil успішний (59%) — 14747 урона'); } }
    else if (b === mass) { marked = true; lines.push('Spoil Festival: Buffalo: успіх (100%)'); } else { marked = true; lines.push('Спойл успішний'); }
    return r; };
  return { env, api, ctx, act, calls, recs, crush, mass, solo, setNear: v => { near = v; }, mob: { cur: 3540, max: 3540 } };
}
test('дубина: первым Spoil Crush, Festival не жмётся', async () => {
  for (const wt of ['дубина', 'двуруч. дубина', 'blunt']) { const f = fixture(wt); await f.api.spoilStep(f.ctx, f.act, f.mob);
    assert.deepEqual(f.calls, ['Spoil Crush'], wt); assert.equal(f.ctx.spoiled, true); }
});
test('пика, другое или неподтверждённое оружие: первым Festival, как раньше', async () => {
  for (const wt of ['древковое', 'меч', '', null]) { const f = fixture(wt); await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Festival'], String(wt)); }
});
test('дубина, спойл Crush не прошёл и моб жив — следующий ход Festival (100 %)', async () => {
  const f = fixture('дубина', { crushFail: true }); await f.api.spoilStep(f.ctx, f.act, f.mob); await f.api.spoilStep(f.ctx, f.act, { cur: 2000, max: 3540 });
  assert.deepEqual(f.calls, ['Spoil Crush', 'Spoil Festival']);
});
test('дубина: соседи после первого хода — под Festival', async () => {
  const f = fixture('дубина'); await f.api.spoilStep(f.ctx, f.act, { cur: 3540, max: 3540 });
  f.setNear([{ name: 'Antelope', cur: 3000, max: 3000 }]); await f.api.spoilStep(f.ctx, f.act, { cur: 100, max: 3540 });
  assert.deepEqual(f.calls, ['Spoil Crush', 'Spoil Festival']);
});
test('дубина, но Crush на откате/недоступен или бой с РБ — прежний порядок', async () => {
  let f = fixture('дубина'); f.crush.disabled = true; await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Festival']);
  f = fixture('дубина'); f.ctx.block['spoil:spoil crush'] = Infinity; await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Festival']);
  f = fixture('дубина'); f.ctx.rb = true; f.env.cfg.spoilRb = true; assert.equal(f.api.crushFirst(f.ctx, f.mob), false);
});
test('Crush «недоступен» игрой — дальше Festival, без повторов Crush', async () => {
  const f = fixture('дубина', { act: b => b.title === 'Spoil Crush' ? 'unavail' : true });
  await f.api.spoilStep(f.ctx, f.act, f.mob); await f.api.spoilStep(f.ctx, f.act, f.mob);
  assert.deepEqual(f.calls, ['Spoil Crush', 'Spoil Festival']);
});
test('крафтер (Warsmith): соло-Spoil только с дубиной, с пикой и без подтверждённого оружия — не жмёт (John 21.10 12:48)', async () => {
  for (const wt of ['древковое', 'меч', null]) { const f = fixture(wt, { role: 'crafter' }); f.crush.disabled = f.mass.disabled = true;
    assert.equal(await f.api.spoilStep(f.ctx, f.act, f.mob), false, String(wt)); assert.deepEqual(f.calls, [], String(wt));
    await f.api.spoilStep(f.ctx, f.act, f.mob); assert.equal(f.recs.length, 1, 'причина в журнале один раз'); assert.match(f.recs[0], /только с дубиной/);
    assert.equal(f.api.crafterPike(), true); }
  const f = fixture('дубина', { role: 'crafter' }); f.crush.disabled = f.mass.disabled = true;
  assert.equal(await f.api.spoilStep(f.ctx, f.act, f.mob), true); assert.deepEqual(f.calls, ['Spoil']); assert.equal(f.api.crafterPike(), false);
  const g = fixture('древковое'); assert.equal(g.api.crafterPike(), false, 'спойлер с пикой спойлит, как раньше');
});
test('крафтер с пикой: точка фарма не выбирается по спойлу (content.canSpoil)', () => {
  const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.match(src, /const canSpoil = \(\) => !L2V7Modules\.loot\?\.crafterPike\?\.\(\) && \(/);
  assert.match(src, /L2V7Modules\.loot = L2V7Factories\.loot\(\{[^\n]*get roleNow\(\)\{return \(\)=>L2V7Modules\.subclass\?\.role\?\.\(\)\}/);
});
test('подключение: геттер weaponNow у loot и экспорт combatWeapon из combat', () => {
  const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.match(src, /L2V7Modules\.loot = L2V7Factories\.loot\(\{ get weaponNow\(\)\{return \(\)=>L2V7Modules\.combat\?\.combatWeapon\?\.\(\)\}/);
  assert.match(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), /healSlot, combatWeapon, weaponContext/);
});
