'use strict';
// 20.43 (John 21.10 12:48 «Крафтом на Рб буду ходить с булавой и щитом, а фарм с пикой», 13:05 голем «Только на РБ»,
// 13:44 «Весь тур — набор РБ»): набор крафтера — modules/crafterkit.js. Сервер — модель по живым запросам 16.10/21.10:
// POST /character/equip (equip/unequip), POST /character/skills/cast {battleId:'l2_25'}, POST /character/companion/dismiss.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = n => fs.readFileSync(path.join(root, n), 'utf8');
const ITEMS = JSON.parse(read('items-il.json'));
const GRADE_LV = { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 };
const POLE = 299, YAKSA = 2503, BONE = 159, KNIGHT = 632, BRONZE = 626, VICTORY = 104, B_MACE = 171, CRYSTAL = 1459;

function hero(over = {}) {
  return { id: 7, name: 'Craft', revision: 100, level: 42, mp: 500, l2Profession: 'dwarf_warsmith', inBattle: false, activeSummon: null,
    inventory: { eq: { l1: { itemId: POLE, enchant: 0 }, l2: 0 },
      stacks: [{ itemId: YAKSA, qty: 1, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, { itemId: BONE, qty: 1 }, { itemId: KNIGHT, qty: 1 },
        { itemId: BRONZE, qty: 1 }, { itemId: VICTORY, qty: 1 }, { itemId: B_MACE, qty: 1 }, { itemId: CRYSTAL, qty: 40 }] }, ...over };
}
// сервер: revision, сумка/надетое, голем; hook — подмена ответа на конкретный запрос
function server(h) {
  const S = { h, posts: [], gets: 0, hook: null };
  const res = (status, j) => ({ ok: status >= 200 && status < 300, status, json: async () => j });
  const tokenOf = s => `bag:${s.itemId}:${+s.enchant || 0}` + (s.enchantPAtkBonus || s.enchantMAtkBonus ? `:${+s.enchantPAtkBonus || 0}:${+s.enchantMAtkBonus || 0}` : '');
  const bagPut = v => { if (v && (+v.itemId || +v)) S.h.inventory.stacks.push(typeof v === 'object' ? { ...v, qty: 1 } : { itemId: +v, qty: 1 }); };
  S.get = async p => { S.gets++; assert.equal(p, '/character'); return res(200, { character: JSON.parse(JSON.stringify(S.h)) }); };
  S.post = async (p, b) => {
    S.posts.push([p, JSON.parse(JSON.stringify(b))]);
    if (S.hook) { const r = await S.hook(p, b, S); if (r) return r; }
    if (b.expectedRevision !== S.h.revision) return res(409, { error: 'revision' });
    const inv = S.h.inventory;
    if (p === '/character/equip' && b.action === 'equip') {
      const i = inv.stacks.findIndex(s => +s.itemId === b.itemId && tokenOf(s) === b.targetInstanceId);
      if (i < 0) return res(400, { messageUk: 'Предмет не знайдено' });
      const it = ITEMS[b.itemId], slot = it.wt === '—' ? 'l2' : 'l1';
      if (slot === 'l2' && ITEMS[inv.eq.l1?.itemId]?.two) return res(400, { messageUk: 'Дворучна зброя' });
      const [s] = inv.stacks.splice(i, 1); bagPut(inv.eq[slot]); inv.eq[slot] = { itemId: s.itemId, enchant: +s.enchant || 0, enchantPAtkBonus: s.enchantPAtkBonus, enchantMAtkBonus: s.enchantMAtkBonus };
      if (slot === 'l1' && it.two && inv.eq.l2) { bagPut(inv.eq.l2); inv.eq.l2 = 0; }
    } else if (p === '/character/equip' && b.action === 'unequip') { bagPut(inv.eq[b.slot]); inv.eq[b.slot] = 0; }
    else if (p === '/character/skills/cast') {
      assert.equal(b.battleId, 'l2_25'); const c = inv.stacks.find(s => +s.itemId === CRYSTAL);
      if (!c || c.qty < 7) return res(400, { messageUk: 'Немає кристалів' });
      c.qty -= 7; S.h.mp -= 88; S.h.activeSummon = { key: 'mechanic_golem', hp: 2400, maxHp: 2400, summonSkillId: 25 };
    } else if (p === '/character/companion/dismiss') { assert.equal(b.characterId, 7); S.h.activeSummon = null; }
    else return res(404, {});
    S.h.revision++;
    return res(200, { character: JSON.parse(JSON.stringify(S.h)) });
  };
  return S;
}
function make(o = {}) {
  const st = {}, clock = { now: 1792000000000 };
  const box = { console, JSON, sessionStorage: { getItem: k => st[k] ?? null, setItem: (k, v) => { st[k] = String(v); } }, Date: class extends Date { static now() { return clock.now; } } };
  vm.runInNewContext(read('modules/crafterkit.js'), box);
  const S = server(hero(o.hero)), recs = [], notes = [], pets = [];
  const M = { mode: o.mode || 'raid', role: 'crafter', loot: false, battle: false, pet: null, weapon: null };
  const env = { cfg: { crafterKit: true, ...o.cfg }, rt: { char: 'Craft', weapons: o.weapons || [] }, on: true, tabOwner: true,
    role: () => M.role, mode: () => M.mode, lootGoal: () => M.loot, isBattle: () => M.battle, busy: () => false, canAct: () => true, gearBusy: () => false,
    rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, itemsDb: async () => ITEMS, itemOf: id => ITEMS[id] ? { id, ...ITEMS[id] } : null, GRADE_LV, heroLevel: () => 42,
    gameGet: p => S.get(p), gamePost: (p, b) => S.post(p, b), equipNote: async b => notes.push(b), petNote: c => pets.push(c.activeSummon),
    petHas: re => !!M.pet && re.test(M.pet), weaponNow: () => M.weapon };
  const K = box.L2V7Factories.crafterkit(env);
  // прогон шагов, как главный цикл: true — набор держит цикл; время идёт на 1 с за шаг
  const drive = async (n = 30, dt = 1000) => { const out = []; for (let i = 0; i < n; i++) { out.push(await K.step()); clock.now += dt; } return out; };
  return { K, S, env, M, recs, notes, pets, clock, drive, box, st };
}
const eqOf = S => [S.h.inventory.eq.l1?.itemId || 0, S.h.inventory.eq.l2?.itemId || 0, S.h.activeSummon?.key || ''];

test('какой набор нужен: тур РБ/эпики — РБ, фарм/катакомбы/кампания/ресурсы — пика; прочее и не крафтер — не трогаем', () => {
  const { K, M, env } = make();
  for (const [m, want] of [['raid', 'rb'], ['epic', 'rb'], ['farm', 'farm'], ['cat', 'farm'], ['campaign', 'farm'], ['tasks', null], ['fish', null], ['enchant', null]]) { M.mode = m; assert.equal(K.want(), want, m); }
  M.mode = 'tasks'; M.loot = true; assert.equal(K.want(), 'farm', 'задачи с целью фарма — пика');
  M.mode = 'raid'; M.role = 'spoiler'; assert.equal(K.want(), null); assert.equal(K.holds(), false);
  M.role = 'crafter'; env.cfg.crafterKit = false; assert.equal(K.want(), null); assert.equal(K.holds(), false); assert.equal(K.noSummon(), false, 'выключенный набор не мешает бою');
  env.cfg.crafterKit = true; M.mode = 'farm'; assert.equal(K.noSummon(), true, 'на фарме голема в бою не призываем');
  M.mode = 'raid'; assert.equal(K.noSummon(), false);
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
  await A.drive(14); assert.deepEqual(eqOf(A.S), [YAKSA, 0, 'mechanic_golem']); assert.match(A.recs.join('\n'), /игра отказала — Не можна; это действие пропускаю 30 мин/);
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
  assert.equal((cb.match(/!env\.crafterKit\?\.noSummon\?\.\(\)/g) || []).length, 2, 'призыв и перепризыв слуги');
  assert.match(read('modules/mobfarm.js'), /env\.victory\(\) && env\.canAct\?\.\(\) !== false && env\.crafterKit\?\.chainWant\?\.\(\)\) return env\.toMap\(\);/);
  assert.match(content, /known\.wt === '—'\)\) return;/, 'щит не записывается надетым оружием');
  const js = JSON.parse(read('manifest.json')).content_scripts.find(x => x.js.includes('content.js')).js;
  assert.ok(js.indexOf('modules/crafterkit.js') > js.indexOf('modules/craft.js') && js.indexOf('modules/crafterkit.js') < js.indexOf('content.js'));
  assert.match(read('defaults.js'), /crafterKit: true,/);
  assert.match(read('popup.js'), /'crafterKit'/); assert.match(read('popup.html'), /id="crafterKit" type="checkbox"/);
});

test('закупка: в туре РБ запас Crystal C голему (поверх нужды Маммона), на фарме — нет', () => {
  const A = make({ mode: 'raid' }), rows = [];
  A.env.shopRow = (id, mm, tag) => ({ key: 'mm' + id, label: `Кристал: ранг C (${tag})`, ids: [id], grade: 'C', mm });
  assert.deepEqual(A.K.shopRows(rows).map(r => [r.key, r.mm.join('/')]), [['mm1459', '30/100']]);
  const mm = [{ key: 'mm1459', label: 'Кристал: ранг C (Маммон)', ids: [1459], mm: [200, 200] }];
  assert.deepEqual(A.K.shopRows(mm).map(r => [r.label, r.mm.join('/')]), [['Кристал: ранг C (Маммон + голем)', '230/300']]);
  A.M.mode = 'farm'; assert.deepEqual(A.K.shopRows([]), []);
  assert.match(read('modules/economy.js'), /env\.crafterShop\?\.\(list\)/);
  assert.match(read('content.js'), /get crafterShop\(\) \{ return list => L2V7Modules\.crafterkit\?\.shopRows\?\.\(list\); \}/);
});
