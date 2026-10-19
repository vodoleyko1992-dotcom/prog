'use strict';
// 19.10: приоритет только подтверждённых свитков; прежние допуски, стоимость и выбранный бой сохраняются.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { mk, docOf } = require('./epic-harness.cjs');
const MIN = 60000, plain = x => JSON.parse(JSON.stringify(x));
const stats = { hp: 10000, patk: 10, matk: 10, mdef: 10, pdef: 10, src: 'api' };
const row = (name, lvl, ord) => ({ name, lvl, ord, alive: true, price: 100000, unit: 'аден', page: 1 });
function fixture(o = {}) {
  const m = mk({ hero: 55, cfg: { epicMode: false, rbHuntMode: true, rbMode: true, rbScrollFirst: true, rbOrder: 'up', rbProbe: false,
    shopAuto: false, rbMaxBelow: 15, rbMaxAbove: 15, ...o.cfg },
    rt: { rbHunt: { step: 'pick' }, rbListT: Date.now(), rbList: { low: row('Младший', 50, 1), high: row('Старший', 55, 2) }, rbDb: {},
      rbStats: { low: { ...stats, scrollDrops: false }, high: { ...stats, scrollDrops: true } }, rbDps: 2000, ...o.rt },
    meHp: () => ({ cur: 10000, max: 10000, pct: 100 }), doc: o.doc || docOf(''),
    env: { RB_WIN: 15, RB_TRY_MS: 10 * MIN, RB_RETRY_MS: 2 * MIN, tabOwner: true, storyRbIds: () => [], ...o.env } });
  return m;
}
const ids = rows => Array.from(rows, x => x.id);
const pin = (id, r) => `<button class="l2-map-mob-pin l2-map-mob-pin--raid" data-spawn-id="${id}" title="${r.name} · ур. ${r.lvl} · рейд-босс"></button>`;
const info = drops => ({ stats: { maxHp: 10000, pAtk: 10, pDef: 10, mAtk: 10, mDef: 10 }, drops });

test('193 подтверждённых РБ точно совпадают с историческими ответами игры, неизвестный ID не повышается', () => {
  const m = fixture(), catalog = JSON.parse(fs.readFileSync(__dirname + '/../kb/data/game-raid-bosses.json', 'utf8'));
  let n = 0;
  for (const boss of catalog) {
    const expected = boss.drops.some(d => d.itemId >= 910510 && d.itemId <= 910529 && d.chance > 0);
    assert.equal(m.R.rbHasScrolls(boss.spawnId), expected, boss.spawnId); n += +expected;
  }
  assert.equal(n, 193); assert.equal(m.R.rbHasScrolls('l2dop_rb_999999'), false);
  assert.equal(m.R.rbHasScrolls('l2dop_rb_29006'), false, 'эпик не получает выдуманный дроп');
});
test('первый круг со свитками, второй без них; внутри обоих прежний порядок уровней', () => {
  const m = fixture(); Object.assign(m.env.rt.rbList, { middle: row('Средний со свитком', 53, 3), lower: row('Ещё младше без свитка', 48, 4) });
  Object.assign(m.env.rt.rbStats, { middle: { ...stats, scrollDrops: true }, lower: { ...stats, scrollDrops: false } });
  assert.deepEqual(ids(m.R.rbTourPlan().ready), ['middle', 'high', 'lower', 'low']);
  assert.deepEqual(ids(m.R.rbPreparationCandidates()), ['middle', 'high', 'lower', 'low']);
  m.env.cfg.rbOrder = 'down';
  assert.deepEqual(ids(m.R.rbTourPlan().ready), ['high', 'middle', 'low', 'lower']);
});
test('выключенная настройка возвращает прежний выбор и не исключает остальные цели', () => {
  const m = fixture({ cfg: { rbScrollFirst: false } });
  assert.deepEqual(ids(m.R.rbTourPlan().ready), ['low', 'high']);
  assert.equal(m.R.rbPreparationCandidates()[0].id, 'low');
});
test('равная группа сохраняет прежний приоритет раненого, сюжета и порядка', () => {
  const m = fixture({ rt: { rbList: { low: row('Младший', 50, 1), high: row('Старший', 50, 2) },
    rbStats: { low: { ...stats, scrollDrops: true }, high: { ...stats, scrollDrops: true } },
    rbWound: { high: { cur: 100, max: 10000, t: Date.now() } } } });
  assert.equal(m.R.rbListPick().id, 'high');
  delete m.env.rt.rbWound.high; m.env.storyRbIds = () => ['high'];
  assert.equal(m.R.rbListPick().id, 'high');
  m.env.storyRbIds = () => []; assert.equal(m.R.rbListPick().id, 'low');
});
test('эксперимент выгоды действует внутри групп и не отменяет первый круг со свитками', () => {
  const m = fixture({ cfg: { rbValueTour: true, rbHuntMode: false, rbPotCost: 0, rbExpValue: 0 },
    rt: { rbDb: { low: { adenaPerKill: 10000000 }, high: { adenaPerKill: 1000000 } } } });
  assert.ok(m.R.rbValueScore('low', m.env.rt.rbList.low) > m.R.rbValueScore('high', m.env.rt.rbList.high));
  assert.deepEqual(ids(m.R.rbTourPlan().ready), ['high', 'low']);
  m.env.cfg.rbScrollFirst = false; assert.deepEqual(ids(m.R.rbTourPlan().ready), ['low', 'high']);
});
for (const kind of ['dead', 'level', 'deny', 'currency', 'skip', 'retry', 'hourly', 'death']) test('свитки не обходят ограничение: ' + kind, () => {
  const m = fixture(), rt = m.env.rt, high = rt.rbList.high, at = Date.now();
  if (kind === 'dead') high.alive = false;
  if (kind === 'level') high.lvl = 90;
  if (kind === 'deny') high.deny = 'игра запрещает';
  if (kind === 'currency') { high.unit = 'CoL'; high.price = 1; }
  if (kind === 'skip') rt.rbSkip = { high: at };
  if (kind === 'retry') rt.rbGoTried = { high: at };
  if (kind === 'hourly') rt.rbGoCnt = { high: [at - 10000, at - 5000, at] };
  if (kind === 'death') rt.rbDb.high = { deathAt: at, deathLog: [{ lvl: 55, t: at }] };
  assert.equal(m.R.rbListPick().id, 'low');
  assert.ok(m.R.rbTourPlan().blocked.some(x => x.id === 'high'));
  assert.equal(m.calls.length, 0); assert.equal(m.fires.length, 0);
});
test('на карте тот же приоритет, rbCur не обгоняет очередь, оплаченный выбор rbWant сохраняется', () => {
  const low = row('Младший', 50, 1), high = row('Старший', 55, 2);
  const m = fixture({ rt: { rbCur: 'low' }, doc: docOf(pin('low', low) + pin('high', high)) });
  assert.deepEqual(ids(m.R.rbCandidates()), ['high', 'low']);
  m.env.rt.rbWant = 'low'; assert.deepEqual(ids(m.R.rbCandidates()), ['low']);
});
test('расчёт новой очереди не трогает текущий бой, выбранный маршрут, память и игровые действия', () => {
  const m = fixture({ rt: { rbHunt: { step: 'fight', id: 'low', fightAt: Date.now() }, rbCur: 'low', rbWant: 'low', rbGo: { id: 'low' } } });
  const before = JSON.stringify(m.env.rt);
  assert.equal(m.R.rbListPick().id, 'high'); assert.equal(m.R.rbPreparationCandidates()[0].id, 'high');
  assert.equal(JSON.stringify(m.env.rt), before); assert.equal(m.fires.length, 0); assert.equal(m.calls.length, 0);
});
test('все20 ID обычных и благословенных свитков распознаются в собственном полном ответе', async () => {
  const m = fixture();
  for (let id = 910510; id <= 910529; id++) {
    await m.R.rbInfoNote('new', info([{ l2ItemId: id, chance: 0.001 }]));
    assert.equal(m.R.rbHasScrolls('new'), true, id);
  }
  assert.ok(m.env.rt.rbStats.new.scrollDropsT > 0);
});
test('телепорты, удочка, похожее имя и нулевой/неизвестный шанс не получают приоритет', async () => {
  const m = fixture();
  for (const d of [{ l2ItemId: 736, displayName: 'Scroll of Escape', chance: 1 }, { itemId: 910600, chance: 1 },
    { itemId: 910530, chance: 1 }, { itemId: 910510.5, chance: 1 }, { itemId: 1, displayName: 'Enchanted Ring', chance: 1 },
    { itemId: 910510, chance: 0 }, { itemId: 910510, chance: -1 }, { itemId: 910510 }, { itemId: 910510, chance: 'unknown' }]) {
    await m.R.rbInfoNote('new', info([d])); assert.equal(m.R.rbHasScrolls('new'), false, JSON.stringify(d));
  }
});
test('новый полный ответ отменяет исторический дроп; пустой/неполный ответ не стирает подтверждение', async () => {
  const m = fixture(), known = 'l2dop_rb_25051';
  assert.equal(m.R.rbHasScrolls(known), true);
  await m.R.rbInfoNote(known, info([]), 'page'); assert.equal(m.R.rbHasScrolls(known), false);
  await m.R.rbInfoNote(known, info([{ kind: 'adena', chance: 1 }, '…ещё 5']), 'page'); assert.equal(m.R.rbHasScrolls(known), false);
  await m.R.rbInfoNote(known, { ...info(['…ещё 5']), scrollDrops: true }, 'page'); assert.equal(m.R.rbHasScrolls(known), true);
  await m.R.rbInfoNote(known, info([{ itemId: 910510 }]), 'api'); assert.equal(m.R.rbHasScrolls(known), true, 'неизвестный шанс не опровергает факт');
  await m.R.rbInfoNote(known, { ...info(['…ещё 5']), scrollDrops: false }, 'api'); assert.equal(m.R.rbHasScrolls(known), true, 'прямой ответ не подменяет сводку hook');
  await m.R.rbInfoNote(known, { stats: { maxHp: 10000 } }, 'page'); assert.equal(m.R.rbHasScrolls(known), true);
  const fresh = fixture({ rt: plain(m.env.rt) }); assert.equal(fresh.R.rbHasScrolls(known), true, 'сохраняется после reload');
  await fresh.R.rbInfoNote(known, { ...info(['…ещё 5']), scrollDrops: false }, 'page'); assert.equal(fresh.R.rbHasScrolls(known), false);
});
test('свежий raw GET Rahha сохраняет серверный дроп, synthetic не значит выдуманный', async () => {
  const m = fixture(), j = JSON.parse(fs.readFileSync(__dirname + '/../kb/raw/spawn-rb-25051.json', 'utf8')).data;
  await m.R.rbInfoNote(j.spawnId, j); assert.equal(m.env.rt.rbStats[j.spawnId].scrollDrops, true);
  assert.equal(m.env.rt.rbStats[j.spawnId].from, 'api'); assert.equal(m.calls.length, 0);
});
