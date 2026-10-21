'use strict';
// 20.43 (John 21.10 12:48 «Крафтом на Рб буду ходить с булавой и щитом, а фарм с пикой», 13:05 голем «Только на РБ»,
// 13:44 «Весь тур — набор РБ»): набор крафтера — modules/crafterkit.js. Сервер — модель по живым запросам 16.10/21.10:
// POST /character/equip (equip/unequip), POST /character/skills/cast {battleId:'l2_25'}, POST /character/companion/dismiss.
const test = require('node:test'), assert = require('node:assert/strict');
const { ITEMS, POLE, YAKSA, BONE, KNIGHT, BRONZE, CRYSTAL, hero, make, eqOf, read, vm } = require('./kit-harness.cjs');
test('какой набор нужен: тур РБ/эпики — РБ, фарм/катакомбы/кампания/ресурсы — пика; прочее и не крафтер — не трогаем', () => {
  const { K, M, env } = make();
  for (const [m, want] of [['raid', 'rb'], ['epic', 'rb'], ['farm', 'farm'], ['cat', 'farm'], ['campaign', 'farm'], ['tasks', null], ['fish', null], ['enchant', null]]) { M.mode = m; assert.equal(K.want(), want, m); }
  M.mode = 'tasks'; M.loot = true; assert.equal(K.want(), 'farm', 'задачи с целью фарма — пика');
  M.mode = 'raid'; M.role = 'spoiler'; assert.equal(K.want(), null); assert.equal(K.holds(), false);
  M.role = 'crafter'; env.cfg.crafterKit = false; assert.equal(K.want(), null); assert.equal(K.holds(), false); assert.equal(K.noSummon(), false, 'выключенный набор не мешает бою');
  env.cfg.crafterKit = true; M.mode = 'farm'; assert.equal(K.noSummon(), true, 'на фарме голема в бою не призываем');
  M.mode = 'raid'; assert.equal(K.noSummon(), false);
  // 20.44: бой с РБ ради ресурса (rt.farmRb) — голема можно, а прилетели к живому РБ — набор РБ
  M.mode = 'farm'; assert.equal(K.noSummon(true), false, 'бой с РБ на фарме — голем можно');
  env.farmRbOn = () => true; env.rt.farmRb = { id: 'l2dop_rb_7', t: 1 }; env.rt.rbWant = 'l2dop_rb_7'; let alive = [{ id: 'l2dop_rb_7' }]; env.rbCandidates = () => alive;
  assert.equal(K.want(), 'rb', 'РБ ресурса жив на карте — набор РБ');
  alive = []; assert.equal(K.want(), 'farm', 'РБ убит/не на этой карте — снова пика');
  alive = [{ id: 'l2dop_rb_7' }]; env.farmRbOn = () => false; assert.equal(K.want(), 'farm', 'окно фарма ресурса с РБ кончилось');
  M.mode = 'fish'; env.farmRbOn = () => true; assert.equal(K.want(), null, 'рыбалка — не трогаем');
});

test('выбор вещей: лучшая одноручная дубина и щит по уровню; B/клановые/с ЛС бот сам не берёт; токен с бонусом заточки', () => {
  const { K, S } = make(), c = S.h;
  const rb = K.pick('rb', c);
  assert.equal(rb.weapon.id, YAKSA, 'Yaksa +4 (156+16) лучше Bonebreaker, B-дубина 171 на 42 ур. не надевается');
  assert.equal(rb.shield.id, KNIGHT, 'щит C лучше D, Shield of Victory (B) не по уровню');
  assert.equal(K.token(rb.weapon), 'bag:2503:4:16:0');
  assert.equal(K.pick('farm', c).weapon.where, 'l1', 'пика уже надета');
  c.inventory.stacks[0] = { ...c.inventory.stacks[0], augmentation: { id: 1 } };
  c.inventory.stacks.push({ itemId: 9002285, qty: 1, clanShieldUid: 'instance-1' });
  assert.equal(K.pick('rb', c).weapon.id, BONE, 'дубину с Life Stone сам не выбираю');
  c.inventory.eq.l1 = { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, augmentation: { id: 1 } };
  assert.equal(K.pick('rb', c).weapon.where, 'l1', 'надетую подходящую (даже с ЛС) не снимаю ради более слабой');
});

test('тур РБ с пикой: булава → щит → голем, по одному действию, цикл держится до готовности', async () => {
  const { K, S, drive, notes, pets, recs } = make({ mode: 'raid' });
  const out = await drive(12);
  assert.deepEqual(eqOf(S), [YAKSA, KNIGHT, 'mechanic_golem']);
  assert.deepEqual(S.posts.map(([p, b]) => p + ':' + (b.action || b.battleId || '')), ['/character/equip:equip', '/character/equip:equip', '/character/skills/cast:l2_25']);
  const [, mace] = S.posts[0], [, shield] = S.posts[1];
  assert.deepEqual(mace, { action: 'equip', itemId: YAKSA, enchant: 4, targetInstanceId: 'bag:2503:4:16:0', enchantPAtkBonus: 16, enchantMAtkBonus: 0, expectedRevision: 100 });
  assert.equal('enchantPAtkBonus' in shield, false, 'у щита нет бонусов оружия');
  assert.equal(notes.length, 1, 'учёт оружия — только булава (щит не оружие)'); assert.equal(notes[0].itemId, YAKSA);
  assert.equal(pets.at(-1).key, 'mechanic_golem');
  assert.equal(out[0], true, 'пока набор собирается — задача ждёт'); assert.equal(out.at(-1), false, 'готово — задача идёт');
  assert.match(recs.join('\n'), /набор РБ \(булава \+ щит \+ голем\) готов/);
  const n = S.posts.length, g = S.gets; await drive(30); assert.equal(S.posts.length, n, 'готовый набор не трогаем'); assert.ok(S.gets - g <= 1, 'перепроверка не чаще раза в минуту');
});

test('фарм после РБ: отозвать голема → снять щит → пика; в бою и вне задач ничего не делает', async () => {
  const h = hero(); h.inventory.eq = { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: KNIGHT } };
  h.inventory.stacks = [{ itemId: POLE, qty: 1 }, { itemId: CRYSTAL, qty: 40 }]; h.activeSummon = { key: 'mechanic_golem', hp: 10, maxHp: 2400 };
  const { S, M, drive, K } = make({ mode: 'farm', hero: h });
  M.battle = true; assert.equal(await K.step(), false); assert.equal(S.gets, 0, 'в бою не читаем и не переодеваемся');
  M.battle = false; M.mode = 'fish'; assert.equal(await K.step(), false); assert.equal(S.gets, 0, 'рыбалка — не наше дело');
  M.mode = 'farm'; await drive(12);
  assert.deepEqual(S.posts.map(([p, b]) => p.split('/').pop() + ':' + (b.action || b.slot || '')), ['dismiss:', 'equip:unequip', 'equip:equip']);
  assert.equal(S.posts[1][1].slot, 'l2');
  assert.deepEqual(eqOf(S), [POLE, 0, '']);
});

test('нет кристаллов — без голема (причина в журнал); мало MP — цикл не держим, призыв позже', async () => {
  const h = hero(); h.inventory.stacks = h.inventory.stacks.filter(s => s.itemId !== CRYSTAL);
  let A = make({ hero: h }); await A.drive(10);
  assert.deepEqual(eqOf(A.S), [YAKSA, KNIGHT, '']); assert.match(A.recs.join('\n'), /Crystal C \(есть 0, нужно от 10\)/);
  assert.ok(!A.S.posts.some(([p]) => /cast/.test(p)));
  A = make({ hero: { mp: 60 } }); await A.drive(4);
  const r = await A.K.step(); assert.equal(r, false, 'ждать MP не держит задачу');
  assert.ok(!A.S.posts.some(([p]) => /cast/.test(p)));
  A.S.h.mp = 400; A.clock.now += 25000; await A.drive(4);
  assert.equal(A.S.h.activeSummon?.key, 'mechanic_golem');
});

test('призыв без ответа: сверка, повтор того же запроса с прежней revision — второго голема нет', async () => {
  const A = make({ hero: { inventory: { eq: { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: KNIGHT } }, stacks: [{ itemId: CRYSTAL, qty: 40 }] } } });
  let lost = 0;
  A.S.hook = async (p, b, S) => { if (/cast/.test(p) && !lost++) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  await A.drive(3);
  assert.equal(A.S.posts.length, 1); assert.match(A.recs.join('\n'), /результат неизвестен, сверю по герою/);
  await A.drive(20);
  const casts = A.S.posts.filter(([p]) => /cast/.test(p));
  assert.equal(casts.length, 2); assert.equal(casts[1][1].expectedRevision, casts[0][1].expectedRevision, 'повтор — с прежней revision');
  assert.equal(A.S.h.activeSummon.key, 'mechanic_golem'); assert.equal(A.S.h.inventory.stacks[0].qty, 33, 'кристаллы потрачены один раз');
  // сервер принял первый, ответ потерян: revision ушла вперёд, голем есть — подтверждение без повтора
  const B = make({ hero: { inventory: { eq: { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: KNIGHT } }, stacks: [{ itemId: CRYSTAL, qty: 40 }] } } });
  B.S.hook = async (p, b, S) => { if (/cast/.test(p) && S.posts.length === 1) { S.hook = null; await S.post(p, b); S.posts.pop(); throw new Error('сеть'); } };
  await B.drive(25);
  assert.equal(B.S.posts.filter(([p]) => /cast/.test(p)).length, 1); assert.match(B.recs.join('\n'), /призыв подтверждён сверкой/);
});

test('409 — перечитать и продолжить; отказ игры — это действие пропускаю 30 мин, остальное идёт; фаза > 2 мин — пауза 10 мин', async () => {
  let A = make(); let once = 0;
  A.S.hook = async (p, b, S) => { if (!once++) { S.h.revision += 3; } };
  await A.drive(14); assert.deepEqual(eqOf(A.S), [YAKSA, KNIGHT, 'mechanic_golem'], '409 не мешает');
  A = make(); A.S.hook = async (p, b) => b.itemId === KNIGHT ? { ok: false, status: 400, json: async () => ({ messageUk: 'Не можна' }) } : null;
  await A.drive(14); assert.deepEqual(eqOf(A.S), [YAKSA, BRONZE, 'mechanic_golem'], '20.44: отказанный щит — следующий по силе'); assert.match(A.recs.join('\n'), /игра отказала — Не можна; это действие пропускаю 30 мин/);
  assert.equal(A.S.posts.filter(([, b]) => b.itemId === KNIGHT).length, 1, 'отказанный щит не долбим');
  A = make(); A.S.hook = async () => ({ ok: false, status: 409, json: async () => ({}) });
  const out = await A.drive(200, 1000);
  assert.match(A.recs.join('\n'), /не собрался за 2 мин — задача идёт как есть/); assert.equal(out.at(-1), false);
  const n = A.S.posts.length; await A.drive(60, 1000); assert.equal(A.S.posts.length, n, '10 мин набор не пробуем');
});

test('5xx/обрыв надевания: второй раз подряд — пауза 30 мин; не крафтер по ответу игры — ничего', async () => {
  let A = make(); A.S.hook = async (p, b) => b.itemId === YAKSA ? { ok: false, status: 502, json: async () => ({}) } : null;
  await A.drive(30, 3000);
  assert.equal(A.S.posts.filter(([, b]) => b.itemId === YAKSA).length, 2); assert.match(A.recs.join('\n'), /второй раз подряд, это действие пропускаю 30 мин/);
  A = make({ hero: { l2Profession: 'human_arcana_lord' } }); await A.drive(5); assert.equal(A.S.posts.length, 0);
});

test('цепочка «Охотиться дальше»: уводит на карту один раз, пока шаг не проверил; по памяти — не чаще раза в 10 мин', async () => {
  const A = make({ mode: 'farm' });
  assert.equal(A.K.chainWant(), true, 'набор ещё ни разу не проверен');
  assert.equal(A.K.chainWant(), false, 'второй раз подряд без проверки — не гоняем');
  await A.drive(6); assert.equal(A.K.chainWant(), false, 'проверено, пика надета');
  A.M.pet = 'mechanic_golem'; assert.equal(A.K.chainWant(), false, 'память вкладки — только через 10 мин');
  A.clock.now += 11 * 60000; assert.equal(A.K.chainWant(), true, 'голем на фарме');
  A.M.mode = 'raid'; A.M.pet = null; assert.equal(A.K.chainWant(), false, 'только что уводили, шаг ещё не проверил');
  A.M.mode = 'farm'; await A.drive(2); A.M.mode = 'raid'; assert.equal(A.K.chainWant(), true, 'задача сменилась — нужен набор РБ');
});

test('новая страница — пауза отказа и неизвестный призыв живут в sessionStorage вкладки', async () => {
  const A = make(); A.S.hook = async (p, b) => b.itemId === KNIGHT ? { ok: false, status: 400, json: async () => ({ messageUk: 'Ні' }) } : null;
  await A.drive(14);
  const box = { ...A.box }; vm.runInNewContext(read('modules/crafterkit.js'), box);
  const K2 = box.L2V7Factories.crafterkit(A.env);
  const n = A.S.posts.length; for (let i = 0; i < 70; i++) { await K2.step(); A.clock.now += 1000; }
  assert.equal(A.S.posts.slice(n).filter(([, b]) => b.itemId === KNIGHT).length, 0);
});

test('подключение: цикл, оружие «в класс», бой, цепочка, учёт щита, manifest, меню', () => {
  const content = read('content.js'), town = content.slice(content.indexOf('async function loopTownJobs()'), content.indexOf('async function loopSideJobs()'));
  assert.ok(town.indexOf('L2V7Modules.crafterkit?.step?.()') > 0 && town.indexOf('L2V7Modules.crafterkit?.step?.()') < town.indexOf("townBuffStart('сторож"), 'набор — до сторожа баффов');
  const eq = read('modules/equipment.js');
  assert.match(eq, /weaponClassPick !== false && !manualWeaponChoice\(\) && !env\.gearHold\?\.\(\)/);
  assert.match(eq, /better && !augHold && !env\.gearHold\?\.\(\)\) \{/);
  assert.match(content, /get gearHold\(\)\{return \(\)=>!!L2V7Modules\.crafterkit\?\.holds\?\.\(\)\}/);
  const cb = read('modules/combat.js');
  assert.equal((cb.match(/!env\.crafterKit\?\.noSummon\?\.\(!!ctx\.rb\)/g) || []).length, 2, 'призыв и перепризыв слуги (20.44: в бою с РБ голема можно)');
  assert.match(read('modules/mobfarm.js'), /env\.victory\(\) && env\.canAct\?\.\(\) !== false && env\.crafterKit\?\.chainWant\?\.\(\)\) return env\.toMap\(\);/);
  assert.match(content, /known\.wt === '—'\)\) return;/, 'щит не записывается надетым оружием');
  const js = JSON.parse(read('manifest.json')).content_scripts.find(x => x.js.includes('content.js')).js;
  assert.ok(js.indexOf('modules/crafterkit.js') > js.indexOf('modules/craft.js') && js.indexOf('modules/crafterkit.js') < js.indexOf('content.js'));
  assert.match(read('defaults.js'), /crafterKit: true,/);
  assert.match(read('popup.js'), /'crafterKit'/); assert.match(read('popup.html'), /id="crafterKit" type="checkbox"/);
});

test('закупка: в туре РБ запас Crystal C голему (поверх нужды Маммона), на фарме — нет', async () => {
  const A = make({ mode: 'raid' }), rows = [];
  A.env.shopRow = (id, mm, tag) => ({ key: 'mm' + id, label: `Кристал: ранг C (${tag})`, ids: [id], grade: 'C', mm });
  assert.deepEqual(A.K.shopRows([]), [], '20.44: ранг голема ещё не прочитан — кристаллы не покупаем');
  await A.drive(1);
  assert.deepEqual(A.K.shopRows(rows).map(r => [r.key, r.mm.join('/')]), [['mm1459', '30/100']]);
  const mm = [{ key: 'mm1459', label: 'Кристал: ранг C (Маммон)', ids: [1459], mm: [200, 200] }];
  assert.deepEqual(A.K.shopRows(mm).map(r => [r.label, r.mm.join('/')]), [['Кристал: ранг C (Маммон + голем)', '230/300']]);
  // 20.44: цель Маммона уже собрана (строки Маммона нет) — запас голему поверх её кристаллов; прошлая закупка не смогла купить — час без строки
  A.env.mmNeed = id => id === 1459 ? { need: 300, have: 300 } : null;
  assert.deepEqual(A.K.shopRows([]).map(r => r.mm.join('/')), ['330/400']);
  A.env.mmNeed = () => ({ need: 300, have: 120 }); assert.deepEqual(A.K.shopRows([]).map(r => r.mm.join('/')), ['30/100'], 'цель не собрана — её недостачу при выключенной докупке не покупаем');
  A.env.rt.shopFail = { n: 1, t: A.clock.now, keys: ['mm1459'] }; assert.deepEqual(A.K.shopRows([]), [], 'сумка полна / нет в магазине — строку час не добавляем');
  A.clock.now += 61 * 60000; assert.equal(A.K.shopRows([]).length, 1);
  A.M.mode = 'farm'; assert.deepEqual(A.K.shopRows([]), []);
  assert.match(read('modules/economy.js'), /env\.crafterShop\?\.\(list\)/);
  assert.match(read('content.js'), /get crafterShop\(\) \{ return list => L2V7Modules\.crafterkit\?\.shopRows\?\.\(list\); \}/);
});
