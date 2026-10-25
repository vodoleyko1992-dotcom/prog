'use strict';
// 20.64 (лог John 25.10 22:41–22:59, Destroyer, эпики Queen Ant → Core → Orfen):
// 1) Frenzy держит урон и при полном HP: атака по Core 10 756 при HP 10785/10785 (без Frenzy ≈400) — HP низким держим только до нажатия лимитов;
// 2) после конца Frenzy оценка атаки ещё 100 с была ≈6 000 (среднее за бой), Power Smash/Fatal Strike выпадали по правилу «слабее 1,6 атаки»;
// 3) регистрация TvT открылась за 9,5 мин до конца — бот дважды бросил Core на 51 %.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const { flowFixture } = require('./warlock-combat-fixture.cjs');

// ---------- 1. окно удержания HP после слива ----------
function frenzyFixture() {
  const f = flowFixture('fighter'), { env, combat, slots, atk } = f, active = new Set();
  const skill = (title, action, meta) => ({ title, action, meta, querySelector: () => null, getAttribute: () => null });
  const trance = skill('Battle Trance', 'battle_trance', { n: 'Battle Trance', t: 'HP_SELF_COST', autoUse: false, mp: 0 });
  const frenzy = skill('Frenzy', 'l2_176', { n: 'Frenzy', id: 176, c: 'Бафф', t: 'BUFF', pc: { hp: 30 }, mp: 14 });
  const guts = skill('Guts', 'l2_139', { n: 'Guts', id: 139, c: 'Бафф', t: 'BUFF', pc: { hp: 30 }, mp: 19 });
  slots.splice(0, slots.length, atk, trance, frenzy, guts);
  const names = s => String(s || '').split(/[,|]/).map(x => x.trim().toLowerCase()).filter(Boolean);
  Object.assign(env.cfg, { nKeyBuffs: 'Frenzy, Guts', nBuffs: '', autoRoles: false, stopHp: 25 });
  Object.assign(env, { names, slotKind: b => b === atk ? 'атака' : 'скилл', slotAction: b => b === atk ? 'attack' : b.action,
    ilOf: b => typeof b === 'string' ? slots.find(x => x.title.toLowerCase() === b.toLowerCase())?.meta : b?.meta, skillMp: () => 0,
    buffActive: (bn, b) => active.has(String(b?.title || bn).toLowerCase()), activeBuffs: () => [],
    combatCooldown: { globalWait: () => 0, skillWait: () => 0, recentlyGlobalRejected: () => false },
    epicById: id => id === 'core' ? { k: 'core' } : null });
  return { ...f, active, ctx: { block: {}, rb: { id: 'core', hits: [2457, 2639, 2708] }, limitDiveT: Date.now() } };
}
test('после слива HP держим низким только пока Frenzy не нажат', () => {
  const { combat, ctx, active } = frenzyFixture();
  assert.equal(combat.epicFrenzyHold(ctx), true, 'Frenzy готов и не висит — держим зону 30 %');
  active.add('guts'); assert.equal(combat.epicFrenzyHold(ctx), true, 'один Guts — ещё не всё');
  active.add('frenzy'); assert.equal(combat.epicFrenzyHold(ctx), false, 'Frenzy висит — дальше обычные банки');
  active.delete('frenzy'); ctx.block['buff:frenzy'] = Date.now() + 5000;
  assert.equal(combat.epicFrenzyHold(ctx), false, 'Frenzy только что принят (метка шага) — удержание снято');
  delete ctx.block['buff:frenzy']; ctx.limitDiveT = Date.now() - 16000;
  assert.equal(combat.epicFrenzyHold(ctx), false, 'не дольше 15 с от слива');
});

// ---------- 2. оценка урона по состоянию Frenzy ----------
function dmgFixture() {
  const src = read('content.js');
  const box = { rt: { skills: { 'атака': { damageEvidence: { v: 1, dmg: 2500 * 40, dmgN: 40 } } } }, location: { search: '?spawnId=l2dop_rb_29006' }, leaseEpoch: 'e1',
    Date, Math, JSON, Set, buffs: [] };
  box.activeBuffs = () => box.buffs;
  const a = src.indexOf('let fightLearn ='), b = src.indexOf('// КД скилла —', a);
  const c = src.indexOf('function observeOwner()'), d = src.indexOf('function damageSample(', c);
  const e = src.indexOf('function damageSkill(p)'), g = src.indexOf('function skillMp(', e);
  assert.ok(a > 0 && b > a && c > 0 && d > c && e > 0 && g > e);
  vm.runInNewContext(src.slice(a, b) + src.slice(c, d) + src.slice(e, g), box);
  return box;
}
test('лог 22:48 Core: после конца Frenzy атака снова ≈400, а не среднее за бой', () => {
  const f = dmgFixture(), frenzy = [{ id: 176, title: 'Frenzy', exp: Date.now() + 60000 }];
  f.buffs = frenzy;
  for (const v of [10756, 4625, 3986, 4729, 4236, 11906, 10079, 10006, 4027, 4284, 10805, 11268]) f.fightNote('атака', v);
  assert.ok(f.expDmg('атака') > 7000, 'под Frenzy — замеры под Frenzy');
  f.buffs = [];
  assert.equal(f.expDmg('атака'), 2500, 'без Frenzy и без своих замеров — общее среднее, не 7 000');
  f.fightNote('атака', 353); f.fightNote('атака', 396);
  assert.equal(f.expDmg('атака'), 374.5, 'два замера без Frenzy — уже честная оценка');
  f.buffs = [{ id: 176, title: 'Frenzy', exp: Date.now() - 1000 }];
  assert.equal(f.dmgBoostTag(), '', 'истёкший значок не считается');
  f.buffs = frenzy; assert.ok(f.expDmg('атака') > 7000, 'новый Frenzy снова видит свои замеры');
});
test('оценка — по последним 12 замерам состояния', () => {
  const f = dmgFixture();
  for (let i = 0; i < 20; i++) f.fightNote('power smash', 6000);
  for (let i = 0; i < 12; i++) f.fightNote('power smash', 2200);
  assert.equal(f.expDmg('power smash'), 2200);
});
test('урон под Frenzy не портит общее среднее и выборку анализатора боя', () => {
  const c = read('content.js'), fl = read('modules/fightlab.js');
  assert.match(c, /const boost = dmgBoostTag\(\), learnDmg = boost \? 0 : dmg;/);
  assert.match(c, /damageSample\(p, learnDmg, damageKnown && !\(boost && dmg > 0\)/);
  assert.match(c, /get dmgBoostTag\(\)\{return dmgBoostTag\}/);
  assert.match(fl, /return c && g \? `\$\{c\}\|boost:\$\{g\}` : c;/);
  assert.equal((fl.match(/rollContext\(\)/g) || []).length, 3);
});

// ---------- 3. TvT-регистрация не бросает эпика без нужды ----------
function tvtFixture(o = {}) {
  let now = 1900000000000;
  const loc = { pathname: '/battle.html', search: '?spawnId=' + (o.spawn || 'l2dop_rb_29006'), href: '' }, logs = [], leaves = [];
  const env = { cfg: { tvtOn: true }, rt: {}, on: true, tabOwner: true,
    TVT: { phase: 'REGISTRATION', eventId: 'ev', isRegistered: false, registeredCount: o.count ?? 7, maxPlayers: 50, registrationEndsAt: now + o.left,
      schedule: { next: { registrationOpensAt: now - 30000 } }, t: now },
    $q: () => null, shown: () => false, isBattle: () => true, victory: () => false, rec: (...x) => logs.push(x.join(' ')), setStatus: () => {},
    setRt: async p => Object.assign(env.rt, p), sleep: async ms => { now += ms; }, pause: async () => {}, waitX: async f => f(), autonomyMode: () => 'farm',
    leaveMark: id => leaves.push(id), toMap: async () => leaves.push('map'), fire: () => {} };
  const box = { console, Date: class extends Date { static now() { return now; } }, location: loc, document: { querySelectorAll: () => [] } };
  vm.runInNewContext(read('modules/tvt.js'), box);
  return { T: box.L2V7Factories.tvt(env), logs, leaves };
}
test('лог 22:50 Core: до конца регистрации 9,5 мин — добиваю босса, запишусь позже', async () => {
  const f = tvtFixture({ left: 570000 });
  assert.equal(await f.T.tvtStep(), false); assert.equal(f.leaves.length, 0);
  assert.match(f.logs.join('\n'), /сначала добиваю босса/);
  assert.equal(await f.T.tvtStep(), false); assert.equal(f.logs.length, 1, 'строка один раз на событие');
});
test('регистрация кончается (≤ 3 мин) или мест почти нет — уходим на арену, как раньше', async () => {
  for (const o of [{ left: 170000 }, { left: 570000, count: 46 }, { left: 570000, spawn: 'dense_8041' }]) {
    const f = tvtFixture(o);
    assert.equal(await f.T.tvtStep(), true, JSON.stringify(o)); assert.ok(f.leaves.length > 0);
  }
});
