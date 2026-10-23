'use strict';
// 20.54 (лог John 23.10 16:11, Orc Raider 32 с Claymore и арбалетом в сумке): автомагистр выучил Iron Punch 18→19 («Лише з
// кастетами», 9500 SP) и Wild Sweep 9→12 (только древковое) — игроку на Two-handed Weapon Mastery SP уже не хватило (409, потом
// «Недостатньо SP»). Навык под вид оружия, которого нет ни в руке, ни в сумке, магистр не учит. Плюс восстановление у баффера при
// полных HP/MP (02:10:57 «HP 100% → 100%») больше не шлёт «Восстановить».
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const combatSrc = read('modules/combat.js'), contentSrc = read('content.js'), buffsSrc = read('modules/buffs.js');
const IL_DB = (() => { const sb = {}; vm.runInNewContext(read('skills-il.js') + ';this.IL_DB=IL_DB;', sb); return sb.IL_DB; })();
const il = name => Object.values(IL_DB).find(x => x.n === name);

function barredFixture(rt) {
  const a = combatSrc.indexOf('const WT_ALIAS = '), b = combatSrc.indexOf('// 20.43 (ревью): запись rt.weapons');
  assert.ok(a > 0 && b > a, 'блок видов оружия найден');
  const sb = { env: { rt, ilOf: x => x } };
  vm.runInNewContext(combatSrc.slice(a, b) + '\nthis.f=learnWeaponBarred;', sb);
  return sb.f;
}
const raider = { weaponsT: 1, weapons: [{ id: 1, wt: 'двуруч. меч', where: 'надето' }, { id: 2, wt: 'лук', where: 'сумка' }] };

test('Orc Raider с Claymore и арбалетом: Iron Punch, Wild Sweep, Polearm Mastery не учим', () => {
  const f = barredFixture(raider);
  for (const n of ['Iron Punch', 'Wild Sweep', 'Polearm Mastery']) assert.equal(f(il(n)), true, n);
  for (const n of ['Two-handed Weapon Mastery', 'Power Smash', 'Vicious Stance', 'Rage']) assert.equal(f(il(n)), false, n);
});
test('пика в сумке (набор крафтера) — древковые навыки учим; сумка не прочитана — решает сервер', () => {
  assert.equal(barredFixture({ ...raider, weapons: [...raider.weapons, { id: 3, wt: 'древковое', where: 'сумка' }] })(il('Wild Sweep')), false);
  assert.equal(barredFixture({ weapons: [] })(il('Iron Punch')), false);
  assert.equal(barredFixture({ weaponsT: 1, weapons: [{ id: 9, wt: '?', unknown: true }] })(il('Iron Punch')), false);
});
test('magScore: барьер оружия даёт -1, остальное как прежде', () => {
  const a = contentSrc.indexOf('function magScore(c) {'), b = contentSrc.indexOf('async function magRead(');
  const barred = new Set(['Iron Punch']);
  const sb = { rt: { panel: [] }, cfg: {}, MAG_SKIP_DEF: '', names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
    ilOf: n => il(n), petState: () => null, L2V7Modules: { combat: { learnWeaponBarred: x => barred.has(x?.n) } } };
  vm.runInNewContext(contentSrc.slice(a, b) + '\nthis.f=magScore;', sb);
  assert.equal(sb.f({ name: 'Iron Punch' }), -1);
  assert.equal(sb.f({ name: 'Two-handed Weapon Mastery', passive: true }), 60);
  assert.ok(contentSrc.slice(a, b).includes('learnWeaponBarred'));
  assert.ok(/learnWeaponBarred \}/.test(combatSrc.slice(combatSrc.lastIndexOf(' return { '))), 'combat экспортирует проверку');
});
test('баффер: полные HP/MP — «Восстановить» не жмём', () => {
  const i = buffsSrc.indexOf("if (st.step === 'restore') {");
  const blk = buffsSrc.slice(i, buffsSrc.indexOf("if (st.step === 'town')", i));
  assert.match(blk, /full = rb && hpPct\(\) >= 99 && mp0\?\.max > 0 && mp0\.cur >= mp0\.max \* 0\.99/);
  assert.match(blk, /if \(full\) \{ ok = true;[^\n]*\}\n\s*else if \(rb\) \{/);
  assert.ok(blk.indexOf('if (full)') < blk.indexOf('env.fire(rb)'), 'проверка до клика');
});
