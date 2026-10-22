'use strict';
// 20.44 (проверка набора крафтера 21.10, 10 подтверждённых недочётов): сбой чтения героя не держит главный цикл, фаза ≤ 2 мин
// считается без перерывов, щит — только поверх одноручного, клановое/с Life Stone/неизвестное надетое не снимаем, магическая
// дубина — не булава, проверка «менять нечего» не уводит из цепочки, ранг голема → Crystal D/C, бой с РБ ради ресурса — набор РБ.
const test = require('node:test'), assert = require('node:assert/strict');
const { POLE, YAKSA, BONE, KNIGHT, BRONZE, CRYSTAL, hero, make, eqOf } = require('./kit-harness.cjs');
const NIRVANA = 174, CLAN_PIKE = 9002282, CLAN_SHIELD = 9002285, UNKNOWN = 9999999, CRYSTAL_D = 1458;
const bad = status => ({ ok: false, status, json: async () => ({ messageUk: 'Ні' }) });
const kinds = S => S.posts.map(([p, b]) => p.split('/').pop() + ':' + (b.action || b.battleId || '') + (b.itemId ? ':' + b.itemId : ''));

test('сбой чтения героя посреди набора: цикл не держим, GET не чаще раза в 10 с, фаза кончается за 2 мин', async () => {
  const A = make({ mode: 'raid' }), get0 = A.S.get;
  A.S.get = async p => A.S.posts.length ? (A.S.gets++, bad(502)) : get0(p);
  const out = await A.drive(80, 4000);
  assert.equal(out[0], true, 'своё действие ушло — цикл ждёт ответа игры');
  assert.ok(out.slice(1).every(x => x === false), 'сбой чтения — задача идёт');
  assert.equal(A.S.posts.length, 1);
  assert.ok(A.S.gets <= 15, `GET ${A.S.gets}`);
  const log = A.recs.join('\n');
  assert.match(log, /не собрался за 2 мин — задача идёт как есть/);
  assert.equal((log.match(/не прочитан герой/g) || []).length, 1, 'одна причина — одна строка за 10 мин');
});

test('неизвестный призыв и сбой чтения: держим только первые 15 с, второго призыва нет', async () => {
  const A = make({ hero: { inventory: { eq: { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: KNIGHT } }, stacks: [{ itemId: CRYSTAL, qty: 40 }] } } });
  const get0 = A.S.get;
  A.S.hook = async p => { if (/cast/.test(p)) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  A.S.get = async p => A.S.posts.length ? (A.S.gets++, bad(503)) : get0(p);
  const out = await A.drive(90, 1000);
  assert.equal(A.S.posts.filter(([p]) => /cast/.test(p)).length, 1);
  assert.ok(out.filter(Boolean).length <= 17, `держали ${out.filter(Boolean).length} с`);
  assert.ok(out.slice(20).every(x => x === false));
  assert.match(A.recs.join('\n'), /сверка призыва — герой не прочитан/);
});

test('булаву не дали надеть: следующая булава; ни одной — щит поверх двуручной пики не шлём, «не собран», а не «готов»', async () => {
  let A = make({ mode: 'raid' }); A.S.hook = async (p, b) => b.itemId === YAKSA ? bad(400) : null;
  await A.drive(20);
  assert.deepEqual(eqOf(A.S), [BONE, KNIGHT, 'mechanic_golem'], 'Yaksa отказана — Bonebreaker');
  A = make({ mode: 'raid' }); A.S.hook = async (p, b) => b.itemId === YAKSA || b.itemId === BONE ? bad(423) : null;
  await A.drive(20);
  assert.ok(!A.S.posts.some(([, b]) => b.itemId === KNIGHT || b.itemId === BRONZE), kinds(A.S).join(' '));
  assert.deepEqual(eqOf(A.S), [POLE, 0, 'mechanic_golem']);
  const log = A.recs.join('\n');
  assert.match(log, /набор РБ \(булава \+ щит \+ голем\) не собран|булаву «.*» игра не дала надеть — повторю после \d\d:\d\d/);
  assert.doesNotMatch(log, /набор РБ \(булава \+ щит \+ голем\) готов/);
  // пустая правая рука — щит можно (так правила игры позволяют любые)
  A = make({ mode: 'raid', hero: { inventory: { eq: { l1: 0, l2: 0 }, stacks: [{ itemId: KNIGHT, qty: 1 }, { itemId: CRYSTAL, qty: 40 }] } } });
  await A.drive(10); assert.deepEqual(eqOf(A.S), [0, KNIGHT, 'mechanic_golem']);
});

test('перерыв (бой 3 мин, Стоп) не съедает 2 минуты фазы: после него набор доделывается', async () => {
  const A = make({ mode: 'raid' });
  await A.drive(1);
  assert.equal(A.S.posts.length, 1, 'булава надета');
  A.M.battle = true; await A.drive(180);
  A.M.battle = false; A.env.on = false; await A.drive(60); A.env.on = true;
  await A.drive(15);
  assert.deepEqual(eqOf(A.S), [YAKSA, KNIGHT, 'mechanic_golem']);
  assert.doesNotMatch(A.recs.join('\n'), /не собрался за 2 мин/);
});

test('надетое, которое набор обратно не наденет (Life Stone, клановое, неизвестное), не снимаем', async () => {
  // РБ, надета пика с Life Stone: булаву не надеваем, щит поверх двуручной — тоже нет, голем — да
  let A = make({ mode: 'raid', hero: { inventory: { eq: { l1: { itemId: POLE, enchant: 0, augmentation: { uid: 'u1', outcomeId: 3 } }, l2: 0 }, stacks: hero().inventory.stacks } } });
  await A.drive(12);
  assert.deepEqual(kinds(A.S), ['cast:l2_25']); assert.deepEqual(eqOf(A.S), [POLE, 0, 'mechanic_golem']);
  assert.match(A.recs.join('\n'), /надето с Life Stone оружие «Orcish Poleaxe» — набор его не снимает/);
  // фарм, надет клановый щит (его нет в справочнике, каталог игры: lhand): пику не надеваем, щит не снимаем
  A = make({ mode: 'farm', hero: { inventory: { eq: { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: CLAN_SHIELD, clanShieldUid: 'cs-1' } }, stacks: [{ itemId: POLE, qty: 1 }] } } });
  A.env.weaponItem = id => id === CLAN_SHIELD ? { id, k: 'A', slot: 'lhand', source: 'game-catalog' } : A.env.itemOf(id);
  await A.drive(10);
  assert.equal(A.S.posts.length, 0, kinds(A.S).join(' '));
  assert.match(A.recs.join('\n'), /надет клановый щит «#9002285» — двуручную пику не надеваю/);
  // фарм, надета клановая пика из каталога игры — подходит, не трогаем (и в РБ щит поверх неё не шлём)
  A = make({ mode: 'farm', hero: { level: 76, inventory: { eq: { l1: { itemId: CLAN_PIKE, enchant: 25, enchantPAtkBonus: 300, clanWeaponUid: 'cw-1' }, l2: 0 }, stacks: [{ itemId: POLE, qty: 1 }, { itemId: 97, qty: 1, enchant: 6, enchantPAtkBonus: 30 }] } } });
  A.env.weaponItem = id => id === CLAN_PIKE ? { id, k: 'W', n: 'Клановий штормер', g: 'S', wt: 'древковое', pa: 400, ma: 200, two: true, requiredLevel: 76, weaponMode: 'phys', source: 'game-catalog' } : A.env.itemOf(id);
  await A.drive(10);
  assert.equal(A.S.posts.length, 0, 'клановую пику на Lance не меняем');
  // неизвестное надетое оружие: спрашиваем каталог игры, не узнали — не снимаем
  A = make({ mode: 'farm', hero: { inventory: { eq: { l1: { itemId: UNKNOWN }, l2: 0 }, stacks: [{ itemId: POLE, qty: 1 }] } } });
  const asked = []; A.env.resolveItem = async id => { asked.push(id); return null; };
  await A.drive(8);
  assert.equal(A.S.posts.length, 0); assert.ok(asked.includes(UNKNOWN));
  assert.match(A.recs.join('\n'), /надето неизвестное оружие «#9999999» — набор его не снимает/);
});

test('магическая одноручная дубина — не булава воина (иначе закупка возьмёт заряды духа)', () => {
  const A = make({ mode: 'raid' }), c = A.S.h;
  c.inventory.stacks = [{ itemId: NIRVANA, qty: 1 }, { itemId: BONE, qty: 1 }, { itemId: KNIGHT, qty: 1 }];
  assert.equal(A.K.pick('rb', c).weapon.id, BONE, 'Nirvana Axe (M.Atk/P.Atk 0,91) не берём, хоть P.Atk выше');
  c.inventory.stacks = [{ itemId: NIRVANA, qty: 1 }];
  assert.equal(A.K.pick('rb', c).weapon, null);
  A.env.weaponItem = id => id === NIRVANA ? { ...A.env.itemOf(id), weaponMode: 'phys' } : A.env.itemOf(id);
  assert.equal(A.K.pick('rb', c).weapon.id, NIRVANA, 'каталог игры говорит «физическое» — берём');
});

test('цепочка: проверка нашла «менять нечего» — не уводим на карту каждые 10 мин, пока сумка и надетое те же', async () => {
  const h = hero(); h.inventory.eq = { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: 0 };
  h.inventory.stacks = [{ itemId: POLE, qty: 1, augmentation: { uid: 'u9', outcomeId: 3 } }];
  const A = make({ mode: 'cat', hero: h, weapons: [{ id: POLE, wt: 'древковое', g: 'C', where: 'сумка' }, { id: YAKSA, wt: 'дубина', g: 'C', where: 'надето' }] });
  A.env.rt.weaponsT = 5; A.M.weapon = { id: YAKSA, wt: 'дубина', g: 'C' };
  assert.equal(A.K.chainWant(), true, 'ещё не проверяли');
  await A.drive(3);
  assert.equal(A.S.posts.length, 0); assert.match(A.recs.join('\n'), /пики в сумке нет/);
  let trips = 0; for (let i = 0; i < 600; i++) { if (A.K.chainWant()) trips++; A.clock.now += 6000; }
  assert.equal(trips, 0, 'час в катакомбах без лишних походов на страницу подземелья');
  A.env.rt.weaponsT = 6; assert.equal(A.K.chainWant(), true, 'сумку перечитали — проверить снова');
  assert.equal(A.K.chainWant(), false);
});

test('голем по рангу: ранги 1–2 — Crystal D, не выучен — не призываем и кристаллы не покупаем', async () => {
  const rowOf = (id, mm, tag) => ({ key: 'mm' + id, label: tag, ids: [id], mm });
  let A = make({ mode: 'raid', hero: { l2Profession: 'dwarf_artisan', learnedBattleSkillsDetail: [{ battleId: 'l2_25', level: 2 }],
    inventory: { eq: { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: KNIGHT } }, stacks: [{ itemId: CRYSTAL_D, qty: 40 }] } } });
  A.env.shopRow = rowOf;
  await A.drive(3);
  assert.deepEqual(kinds(A.S), ['cast:l2_25'], 'Crystal D есть — призываем');
  assert.deepEqual(A.K.shopRows([]).map(r => [r.key, r.mm.join('/')]), [['mm1458', '30/100']]);
  A = make({ mode: 'raid', hero: { learnedBattleSkillsDetail: [{ battleId: 'l2_1', level: 1 }], inventory: { eq: { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: KNIGHT } }, stacks: [{ itemId: CRYSTAL, qty: 40 }] } } });
  A.env.shopRow = rowOf;
  await A.drive(3);
  assert.equal(A.S.posts.length, 0); assert.match(A.recs.join('\n'), /Summon Mechanic Golem не выучен/);
  assert.deepEqual(A.K.shopRows([]), []);
});

test('фарм ресурса с РБ: прилетели к живому РБ — булава + щит + голем до боя; РБ убит — пика, голем остаётся', async () => {
  const A = make({ mode: 'farm' });
  let alive = [{ id: 'rb1' }];
  Object.assign(A.env, { farmRbOn: () => true, rbCandidates: () => alive }); Object.assign(A.env.rt, { farmRb: { id: 'rb1', t: 1 }, rbWant: 'rb1' });
  await A.drive(14);
  assert.deepEqual(eqOf(A.S), [YAKSA, KNIGHT, 'mechanic_golem']);
  alive = [];
  await A.drive(14);
  assert.deepEqual(eqOf(A.S), [POLE, 0, 'mechanic_golem']);   // 20.46, решение John 22.10: потеря EXP приемлема, слугу не отзываем.
});
