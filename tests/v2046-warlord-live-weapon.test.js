'use strict';
// 20.46 (приём проекта 22.10): старая запись пики не разрешает Provoke/Howl, если свежая рука /character ей противоречит.
// Проверяем реальные chooseAction и battle → act → повторный выбор перед кликом, а не отдельный предикат оружия.
const test = require('node:test'), assert = require('node:assert/strict');
const { flowFixture } = require('./warlock-combat-fixture.cjs');

function fixture() {
  const f = flowFixture('fighter'), { env } = f, now = Date.now();
  const slot = (title, action, mp, w = null) => ({ title, action, il: { t: 'PDAM', mp, ...(w ? { w } : {}) }, disabled: false, getAttribute: () => null });
  const provoke = slot('Provoke', 'provoke', 20), howl = slot('Howl', 'howl', 20);
  const whirlwind = slot('Whirlwind', 'whirlwind', 30, 'древковое'), storm = slot('Thunder Storm', 'thunder_storm', 40, 'древковое');
  provoke.il = { t: 'DEBUFF', mp: 20, autoUse: false }; howl.il = { t: 'DEBUFF', mp: 20, autoUse: false };
  f.slots.push(provoke, howl, whirlwind, storm);
  Object.assign(env.rt, { char: 'Hero', classCur: { prof: 'human_warlord', slot: 1 }, weaponsT: now - 10,
    weapons: [{ id: 299, name: 'Orcish Poleaxe', wt: 'древковое', where: 'надето' }], weaponAug: { w: 299, t: now }, skillDb: {} });
  Object.assign(env.cfg, { warlordAggro: true, nPower: 'Whirlwind, Thunder Storm', nUltra: '', nStun: '', nDrain: '', nHeal: '', skillMpMin: 35 });
  env.names = s => String(s || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  env.battleInfo = () => ({ name: 'Safe Mob', max: 1000, kind: 'normal', tier: '', t: Date.now() });
  const action = env.slotAction, info = env.ilOf;
  env.slotAction = b => b.action || action(b); env.ilOf = b => b?.il || info(b);
  env.isChargeName = () => false; env.isForceName = () => false; env.noEffect = () => false; env.powerOf = () => 0; env.chargeValue = () => 0;
  const ctx = () => ({ block: {}, rb: false, champ: false, lastStun: 0 });
  const plan = c => f.combat.warlordPullPlan(c || ctx(), env.meMp());
  const choose = c => f.combat.chooseAction(c || ctx(), env.meMp());
  const live = (w, t = now) => { env.rt.weaponAug = { w, t }; };
  // Никакого POST: настоящий battle доходит до env.fire, где стенд записывает действие и завершает круг.
  const stopOnFire = () => { env.fire = b => { f.events.push('fire:' + env.slotAction(b)); env.on = false; return true; }; };
  return { ...f, provoke, howl, whirlwind, storm, now, ctx, plan, choose, live, stopOnFire };
}

test('свежая подтверждённая пика: chooseAction собирает группу и делает AoE без повторного агро', () => {
  const f = fixture(), c = f.ctx(), pull = f.choose(c);
  assert.equal(pull.b, f.provoke); assert.equal(pull.warlordPull, 'pull');
  f.combat.warlordPullResult(c, pull, true);
  const hit = f.choose(c); assert.equal(hit.warlordPull, 'hit'); assert.equal(hit.b, f.whirlwind);
  f.combat.warlordPullResult(c, hit, true);
  assert.equal(f.plan(c), null, 'успешная связка не собирает новую группу');
});

for (const [name, w] of [['другая рука', 164], ['оружие снято', 0]]) {
  for (const sameTime of [false, true]) test(`${name}, native-${sameTime ? 'тот же' : 'более свежий'} момент: нет Provoke/Howl`, () => {
    const f = fixture(); f.live(w, sameTime ? f.env.rt.weaponsT : f.now);
    assert.equal(f.combat.combatWeapon().id, 299, 'старая запись пики действительно ещё лежит');
    assert.equal(f.combat.combatWeaponLive(), null, 'native-рука опровергает запись');
    assert.equal(f.plan(), null, 'нет нового сбора по устаревшей пике');
    assert.equal(f.choose()?.warlordPull, undefined, 'обычная ротация не обходит запрет через chooseAction');
    f.provoke.disabled = true;
    assert.equal(f.plan(), null, 'запасной Howl также не собирает');
  });
}

for (const [name, change] of Object.entries({
  'новое надевание пики после старого native-снимка': f => f.live(164, f.env.rt.weaponsT - 1),
  'native-снимка ещё нет': f => { delete f.env.rt.weaponAug; },
  'native-рука совпадает с записью': f => f.live(299),
  'native-рука совпадает, время неизвестно': f => f.live(299, 0),
})) test('корректная пика остаётся доступна: ' + name, () => {
  const f = fixture(); change(f);
  assert.equal(f.plan()?.b, f.provoke);
  const c = f.ctx(), p = f.choose(c); assert.equal(p.warlordPull, 'pull');
  f.combat.warlordPullResult(c, p, true);
  assert.equal(f.choose(c).warlordPull, 'hit');
});

for (const [name, change] of Object.entries({
  'нет времени инвентаря': f => { f.env.rt.weaponsT = 0; },
  'нет записи надетого': f => { f.env.rt.weapons = []; },
  'два надетых оружия': f => { f.env.rt.weapons.push({ id: 164, wt: 'дубина', where: 'надето' }); },
  'неизвестный предмет': f => { f.env.rt.weapons[0].unknown = true; },
  'неподтверждённая смена оружия': f => { f.env.rt.weaponMetaPending = { id: 164 }; },
  'свежий equip другого ID': f => { f.env.rt.weaponEq = { id: 164, t: f.now }; },
  'свежая проверенная дубина': f => { f.env.rt.weapons[0] = { id: 164, wt: 'дубина', where: 'надето' }; f.live(164); },
})) test('неподтверждённая пика не разрешает сбор: ' + name, () => {
  const f = fixture(); change(f); assert.equal(f.plan(), null);
});

test('reload с сохранённой старой пикой и новой рукой не возвращает допуск агро', () => {
  const a = fixture(); a.live(164);
  const persisted = JSON.parse(JSON.stringify(a.env.rt)), b = fixture();
  b.env.rt = persisted;
  assert.equal(b.plan(), null);
  assert.equal(b.choose()?.warlordPull, undefined);
});

test('противоречие после Provoke отменяет AoE/follow; возврат подтверждённой пики продолжает без нового агро', () => {
  const f = fixture(), c = f.ctx(), pull = f.choose(c);
  f.combat.warlordPullResult(c, pull, true); f.live(164);
  assert.equal(f.plan(c), null, 'по неподтверждённой пике follow не выбирается');
  assert.equal(f.choose(c)?.warlordPull, undefined);
  assert.equal(c.warlordPull.follow, true, 'ожидание оружия не стирает уже выполненный сбор');
  f.live(299);
  const resumed = f.choose(c); assert.equal(resumed.warlordPull, 'hit'); assert.equal(resumed.b, f.whirlwind);
  assert.notEqual(resumed.b, f.provoke); assert.notEqual(resumed.b, f.howl);
});

test('готовый AoE другого вида оружия не разрешает агро и не выбирается для follow', () => {
  const f = fixture(), c = f.ctx();
  f.whirlwind.il.w = 'меч'; f.storm.disabled = true;
  assert.equal(f.plan(c), null, 'нет ни одного совместимого готового массового удара — группа не собирается');
  f.storm.disabled = false;
  const pull = f.choose(c); assert.equal(pull.b, f.provoke);
  f.combat.warlordPullResult(c, pull, true);
  assert.equal(f.choose(c).b, f.storm, 'follow берёт совместимый AoE');
  f.storm.il.w = 'меч';
  assert.equal(f.plan(c), null, 'после агро новый несовместимый набор не обходится специальным follow');
});

test('полный battle со старой пикой и свежей другой рукой не отправляет Provoke/Howl', async () => {
  const f = fixture(); f.live(164); f.stopOnFire();
  await f.combat.battle();
  assert.equal(f.events.includes('fight-entered'), true);
  assert.equal(f.events.some(x => /fire:(provoke|howl)$/.test(x)), false, f.events.join(','));
  assert.equal(f.events.some(x => x.startsWith('fire:')), true, 'обычный бой продолжается');
});

test('полный battle со свежей пикой действительно отправляет Provoke', async () => {
  const f = fixture(); f.stopOnFire(); await f.combat.battle();
  assert.equal(f.events.filter(x => x.startsWith('fire:')).join(','), 'fire:provoke');
});

for (const zero of [false, true]) test('рука меняется между планом и fire: ' + (zero ? 'пика снята' : 'взята дубина'), async () => {
  const f = fixture(); let checked = 0;
  assert.equal(f.choose().b, f.provoke, 'исходный план действительно Provoke');
  // gameFree вызывается после выбора. Оно возвращает управление прямо перед повторным chooseAction в act.
  f.env.gameBusy = () => { if (!checked++) f.live(zero ? 0 : 164); return { busy: false, end: 0 }; };
  f.stopOnFire(); await f.combat.battle();
  assert.ok(checked > 0, 'проверка готовности игры состоялась');
  assert.equal(f.events.some(x => /fire:(provoke|howl)$/.test(x)), false, 'старое агро отменено до клика: ' + f.events.join(','));
  assert.equal(f.events.some(x => x.startsWith('fire:')), true, 'после пересчёта выбрано обычное действие');
});

test('между планом и fire обновился старый native-снимок, но новое надевание пики новее — ложного запрета нет', async () => {
  const f = fixture(); let checked = 0;
  f.env.gameBusy = () => { if (!checked++) f.live(164, f.env.rt.weaponsT - 1); return { busy: false, end: 0 }; };
  f.stopOnFire(); await f.combat.battle();
  assert.equal(f.events.filter(x => x.startsWith('fire:')).join(','), 'fire:provoke');
});

function keepFirstPull(f) {
  let turns = 0;
  f.env.fire = b => {
    const action = f.env.slotAction(b); f.events.push('fire:' + action);
    if (!turns++ && action === 'provoke') f.setNet({ start: 1, done: 1, okN: 1, ok: true, action });
    else f.env.on = false;
    return true;
  };
}
test('полный battle: после Provoke свежая дубина между планом AoE и fire отменяет follow', async () => {
  const f = fixture(); let checks = 0;
  f.env.gameBusy = () => {
    if (++checks === 2) { f.env.rt.weapons[0] = { id: 164, wt: 'дубина', where: 'надето' }; f.live(164); }
    return { busy: false, end: 0 };
  };
  keepFirstPull(f); await f.combat.battle();
  assert.equal(f.events.filter(x => x.startsWith('fire:')).join(','), 'fire:provoke,fire:attack');
});
test('полный battle: несовместимый AoE в ожидании после Provoke заменяется совместимым без повторного агро', async () => {
  const f = fixture(); let checks = 0;
  f.env.gameBusy = () => { if (++checks === 2) f.whirlwind.il.w = 'меч'; return { busy: false, end: 0 }; };
  keepFirstPull(f); await f.combat.battle();
  assert.equal(f.events.filter(x => x.startsWith('fire:')).join(','), 'fire:provoke,fire:thunder_storm');
});
