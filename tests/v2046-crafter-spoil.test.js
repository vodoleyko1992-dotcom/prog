'use strict';
// 20.46 (John22.10: «Автофарм не юзает споил... даже... КРАФТЕРЕ»). TXT10:41:16.312: Warsmith с пикой,
// native l2_254 принят200, MP−59, «Спойл успішний»; после Whirlwind10:41:18.544 — добыча спойла.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(process.env.SPOIL_SOURCE || path.join(__dirname, '../modules/loot.js'), 'utf8');
function make(opt = {}) {
  const slots = (opt.skills || ['Spoil']).map(title => ({ title, disabled: false })), calls = [], lines = [], recs = [];
  let marked = false;
  const env = { cfg: { nSpoil: 'Spoil', nSpoilMass: '', ...opt.cfg }, rt: { char: 'CraftHero' },
    roleNow: () => opt.role || 'crafter', weaponNow: () => opt.wt === null ? null : { wt: opt.wt || 'древковое', id: 299 },
    names: s => String(s || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean), cleanTitle: s => s,
    slotsBy: n => slots.filter(b => b.title.toLowerCase().startsWith(n)), ready: b => !b.disabled && !(opt.cd > 0),
    meMp: () => ({ cur: opt.mp ?? 1834, max: 1834 }), skillMp: n => n === 'Spoil Crush' ? 80 : n === 'Spoil Festival' ? 73 : 59,
    extraMobs: () => [], logLines: () => lines.slice(), newLines: (before, after) => after.slice(before.length), mobSpoiled: () => marked,
    nameLike: (a, b) => a === b, SPOIL_OK: /Спойл успішний/i, SPOIL_FAIL: /Спойл не вдався/i,
    waitFor: async f => f(), noticeText: () => '', rec: (...a) => recs.push(a.join(' ')), setRt: async p => { Object.assign(env.rt, p); return { ok: true }; } };
  const box = { console }; vm.runInNewContext(source, box);
  const ctx = { block: {}, name: 'Seer of Hallate', ...opt.ctx }, mob = { cur: 3060, max: 3060 };
  const act = async b => { calls.push(b.title); const r = opt.answer || true;
    if (r === true) { if (opt.fail) lines.push('Спойл не вдався (74%).'); else { lines.push('Спойл успішний'); marked = true; } }
    return r; };
  return { env, L: box.L2V7Factories.loot(env), ctx, mob, act, calls, recs, slots };
}
for (const wt of ['древковое', 'pole', 'дубина', 'меч', null]) test(`20.46: крафтер с ${wt} использует доступный собственный Spoil`, async () => {
  const f = make({ wt }); assert.equal(await f.L.spoilStep(f.ctx, f.act, f.mob), true);
  assert.deepEqual(f.calls, ['Spoil']); assert.equal(f.ctx.spoiled, true); assert.equal(f.env.rt.spoilStat.ok, 1);
  assert.equal(await f.L.spoilStep(f.ctx, f.act, f.mob), false); assert.deepEqual(f.calls, ['Spoil'], 'уже помеченного не спойлим снова');
  assert.doesNotMatch(f.recs.join('\n'), /только с дубиной/);
});
test('20.46: крафтер с пикой не получает чужие Crush/Festival из одной настройки роли', async () => {
  const f = make({ skills: [] }); assert.equal(await f.L.spoilStep(f.ctx, f.act, f.mob), false); assert.deepEqual(f.calls, []);
  assert.equal(f.L.spoilPick(f.ctx), null); assert.equal(f.L.massSpoilPick(f.ctx), null);
});
test('20.46: подтверждённая пика допускает Spoil, исключая несовместимый Crush', async () => {
  const f = make({ skills: ['Spoil Crush', 'Spoil'] }); await f.L.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil']);
  const g = make({ skills: ['Spoil Crush'] }); assert.equal(await g.L.spoilStep(g.ctx, g.act, g.mob), false); assert.deepEqual(g.calls, []);
});
test('20.46: крафтер без подтверждённой дубины не угадывает совместимость Crush', async () => {
  const f = make({ wt: null, skills: ['Spoil Crush'] }); assert.equal(await f.L.spoilStep(f.ctx, f.act, f.mob), false); assert.deepEqual(f.calls, []);
});
test('20.46: крафтер с дубиной сохраняет Crush первым, если навык есть на панели', async () => {
  const f = make({ wt: 'дубина', skills: ['Spoil', 'Spoil Crush'] }); await f.L.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Crush']);
});
test('20.46: собственного Spoil нет/роль выключена/КД не прошёл — атаки по роли не создаются', async () => {
  for (const opt of [{ skills: [] }, { cfg: { nSpoil: '', nSpoilMass: '' } }, { cd: 1.2 }]) {
    const f = make(opt); assert.equal(await f.L.spoilStep(f.ctx, f.act, f.mob), false); assert.deepEqual(f.calls, []);
  }
});
test('20.46: MP ниже59 — Spoil не держит бой; ровно59 достаточно', async () => {
  const f = make({ mp: 58 }); assert.equal(await f.L.spoilStep(f.ctx, f.act, f.mob), false); assert.deepEqual(f.calls, []); assert.equal(f.ctx.spoilTry, undefined);
  const g = make({ mp: 59 }); await g.L.spoilStep(g.ctx, g.act, g.mob); assert.deepEqual(g.calls, ['Spoil']);
});
test('20.46: дешёвый Spoil доступен, когда MP не хватает на Crush с дубиной', async () => {
  const f = make({ wt: 'дубина', mp: 59, skills: ['Spoil Crush', 'Spoil'] }); await f.L.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil']);
});
test('20.46: ограничения РБ, мёртвой цели, 4 неудач и уже висящего спойла сохранены', async () => {
  for (const ctx of [{ rb: true }, { spoiled: true }, { spoilTry: 4 }]) { const f = make({ ctx }); assert.equal(await f.L.spoilStep(f.ctx, f.act, f.mob), false); assert.deepEqual(f.calls, []); }
  const dead = make(); assert.equal(await dead.L.spoilStep(dead.ctx, dead.act, { cur: 0, max: 3060 }), false); assert.deepEqual(dead.calls, []);
});
test('20.46: серверный unavail блокирует этот Spoil до конца боя без бесконечных повторов', async () => {
  const f = make({ answer: 'unavail' }); await f.L.spoilStep(f.ctx, f.act, f.mob); await f.L.spoilStep(f.ctx, f.act, f.mob);
  assert.deepEqual(f.calls, ['Spoil']); assert.equal(f.ctx.block['spoil:spoil'], Infinity);
});
test('20.46: спойлер с пикой сохраняет доступный Festival, обычный Spoil — fallback без Festival', async () => {
  const f = make({ role: 'spoiler', skills: ['Spoil', 'Spoil Festival'] }); await f.L.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Festival']);
  const g = make({ role: 'spoiler' }); await g.L.spoilStep(g.ctx, g.act, g.mob); assert.deepEqual(g.calls, ['Spoil']);
});
