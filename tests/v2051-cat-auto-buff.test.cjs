'use strict';
// 23.10.2026: на активном котоводе автобаф снова включается и после ручного OFF.
// Все снимки и часы локальные; classAutoTick использует прежний опрос раз в 15 секунд.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./warlock-fixture.cjs');
const engine = require('../engine-core.js');
const copy = x => JSON.parse(JSON.stringify(x));
const loggedTasks = ['tvt', 'mammon', 'dailies', 'clan', 'pvp', 'resources', 'quests', 'raid'];

function setup(o = {}) {
  const f = fixture({ ...o, cfg: { petFullAuto: true, petBuffAuto: true, ...o.cfg } });
  const cfgWrites = [], logs = [];
  Object.assign(f.env, {
    leaseEpoch: 'cat-owner',
    canRun: () => true,
    setCfg: async patch => { Object.assign(f.env.cfg, patch); cfgWrites.push(copy(patch)); },
    classNote: ch => { f.env.rt.classCur = { slot: ch.classSlots.activeSlot, prof: ch.l2Profession }; },
    rec: (...args) => logs.push(args.join(' '))
  });
  return { ...f, cfgWrites, logs, enable: () => f.api().autoEnableClass(f.ch) };
}

function setupTasks(o = {}) {
  const f = setup({ ...o, cfg: { autoTasks: [...loggedTasks], ...o.cfg } });
  const wrap = raw => engine.taskConfig(raw, () => f.env.rt);
  f.env.cfg = wrap(f.env.cfg);
  f.env.setCfg = async patch => {
    f.cfgWrites.push(copy(patch));
    // Как setCfg/withRb в content.js: записываем raw-настройки и строим новый view.
    f.env.cfg = wrap({ ...engine.rawTaskConfig(f.env.cfg), ...copy(patch) });
  };
  return { ...f, raw: () => engine.rawTaskConfig(f.env.cfg),
    changeRaw: patch => { f.env.cfg = wrap({ ...engine.rawTaskConfig(f.env.cfg), ...copy(patch) }); } };
}

for (const prof of ['human_warlock', 'human_arcana_lord', 'warlock', 'arcana_lord']) {
  for (const disabled of [['petFullAuto'], ['petBuffAuto'], ['petFullAuto', 'petBuffAuto']]) {
    test(prof + ': прежний marker не удерживает OFF ' + disabled.join('+'), async () => {
      const f = setup({ char: { l2Profession: prof } });
      await f.enable();
      const marker = copy(f.env.rt.petClassEntry);
      for (const key of disabled) f.env.cfg[key] = false;
      f.ch.revision++;
      await f.enable();
      assert.equal(f.env.cfg.petFullAuto, true);
      assert.equal(f.env.cfg.petBuffAuto, true);
      assert.equal(f.cfgWrites.length, 2, 'после OFF нужна одна дополнительная запись');
      assert.equal(f.env.rt.petClassEntry.key, marker.key);
      assert.equal(f.env.rt.petClassEntry.kick, marker.kick);
      assert.equal(f.calls.length, 0, 'автовключение настройки не покупает бафф');
      await f.enable();
      assert.equal(f.cfgWrites.length, 2, 'следующий снимок уже включённого класса — без записи');
    });
  }
}

test('reload на том же котоводе восстанавливает оба выключенных флага', async () => {
  const f = setup();
  await f.enable();
  f.env.cfg.petFullAuto = false;
  f.env.cfg.petBuffAuto = false;
  f.reload();
  f.ch.revision++;
  await f.enable();
  assert.equal(f.env.cfg.petFullAuto, true);
  assert.equal(f.env.cfg.petBuffAuto, true);
  assert.equal(f.cfgWrites.length, 2);
  assert.equal(f.calls.length, 0);
});

test('подтверждённый котовод с обоими ON не пишет настройки на каждом GET и reload', async () => {
  const f = setup();
  await f.enable();
  for (let n = 0; n < 4; n++) { f.ch.revision++; await f.enable(); }
  f.reload();
  await f.enable();
  assert.equal(f.cfgWrites.length, 1);
  assert.equal(f.logs.length, 1);
  assert.equal(f.calls.length, 0);
});

test('уход с котовода сохраняет OFF, возвращение включает оба флага', async () => {
  const f = setup();
  await f.enable();
  f.env.cfg.petFullAuto = false;
  f.env.cfg.petBuffAuto = false;
  f.ch.l2Profession = 'dwarf_fortune_seeker';
  f.ch.classSlots.activeSlot = 1;
  f.ch.revision++;
  await f.enable();
  f.ch.revision++;
  await f.enable();
  assert.equal(f.env.cfg.petFullAuto, false);
  assert.equal(f.env.cfg.petBuffAuto, false);
  assert.equal(f.cfgWrites.length, 1);
  f.ch.l2Profession = 'human_arcana_lord';
  f.ch.classSlots.activeSlot = 0;
  f.ch.revision++;
  await f.enable();
  assert.equal(f.env.cfg.petFullAuto, true);
  assert.equal(f.env.cfg.petBuffAuto, true);
  assert.equal(f.cfgWrites.length, 2);
});

for (const prof of ['human_warlord', 'human_dark_avenger', 'dwarf_maestro']) {
  test('активный ' + prof + ' с портретом котовода не включает флаги', async () => {
    const f = setup({ cfg: { petFullAuto: false, petBuffAuto: false }, char: {
      l2Profession: prof, portraitProfession: 'human_arcana_lord', portraitClassBranch: 'mystic',
      classSlots: { activeSlot: 3, slots: [
        { slot: 0, active: false, profession: 'human_arcana_lord' },
        { slot: 3, active: true, profession: prof }
      ] }
    } });
    await f.enable();
    f.ch.revision++;
    await f.enable();
    assert.equal(f.cfgWrites.length, 0);
    assert.equal(f.env.cfg.petFullAuto, false);
    assert.equal(f.env.cfg.petBuffAuto, false);
  });
}

test('старый ответ котовода не отменяет свежий активный другой класс', async () => {
  const f = setup({ cfg: { petFullAuto: false, petBuffAuto: false }, char: { revision: 200, l2Profession: 'orc_titan' } });
  await f.enable();
  f.ch.revision = 199;
  f.ch.l2Profession = 'human_warlock';
  await f.enable();
  assert.equal(f.cfgWrites.length, 0);
  assert.equal(f.env.cfg.petFullAuto, false);
  assert.equal(f.env.rt.petClassEntry.key, '0:orc_titan');
});

for (const gate of ['Stop', 'не хозяин', 'чужой снимок', 'чужой герой на странице', 'без ревизии', 'без активного слота']) {
  test('same-marker OFF остаётся без изменения при ограничении: ' + gate, async () => {
    const f = setup();
    await f.enable();
    f.env.cfg.petFullAuto = false;
    f.env.cfg.petBuffAuto = false;
    f.ch.revision++;
    if (gate === 'Stop') f.env.on = false;
    if (gate === 'не хозяин') f.env.tabOwner = false;
    if (gate === 'чужой снимок') f.ch.name = 'other';
    if (gate === 'чужой герой на странице') f.env.heroNick = () => 'other';
    if (gate === 'без ревизии') delete f.ch.revision;
    if (gate === 'без активного слота') delete f.ch.classSlots.activeSlot;
    await f.enable();
    assert.equal(f.cfgWrites.length, 1);
    assert.equal(f.env.cfg.petFullAuto, false);
    assert.equal(f.env.cfg.petBuffAuto, false);
    assert.equal(f.calls.length, 0);
  });
}

for (const disabled of ['petFullAuto', 'petBuffAuto']) {
  test('classAutoTick восстанавливает ' + disabled + ' прежним опросом через 15 секунд без POST', async () => {
    const f = setup();
    await f.api().classAutoTick();
    assert.deepEqual(f.gets, ['/character']);
    const writesBefore = f.cfgWrites.length;
    f.env.cfg[disabled] = false;
    f.ch.revision++;
    f.tick(14999);
    for (let n = 0; n < 20; n++) await f.api().classAutoTick();
    assert.equal(f.gets.length, 1, 'частота запросов не увеличивается');
    assert.equal(f.env.cfg[disabled], false, 'до прежнего срока нового снимка нет');
    f.tick(1);
    await f.api().classAutoTick();
    assert.equal(f.env.cfg[disabled], true);
    assert.deepEqual(f.gets, ['/character', '/character']);
    assert.equal(f.cfgWrites.length, writesBefore + 1);
    assert.equal(f.calls.length, 0);
  });
}

test('classAutoTick после Stop во время GET не включает автобаф', async () => {
  const f = setup({ cfg: { petFullAuto: false, petBuffAuto: false }, read: (_p, env) => { env.on = false; } });
  await f.api().classAutoTick();
  assert.equal(f.gets.length, 1);
  assert.equal(f.cfgWrites.length, 0);
  assert.equal(f.calls.length, 0);
});

test('восстановление ON сохраняет лимиты, расход, pending, unknown и основной режим', async () => {
  const financial = { spent: 12000000, lifetimeSpent: 34000000, budgetEpoch: 77,
    unknownReserved: 10000000, pending: { id: 'unconfirmed', phase: 'sent', price: 10000000 },
    history: [{ id: 'old', outcome: 'unknown', price: 10000000 }], expiresAt: 1792000300000 };
  const f = setup({ cfg: { petFullBudget: 45000000, petFullMaxPrice: 9000000, petFullReserve: 4000000,
    petFullRenew: false, shopReserve: 300000, fishMode: true, rbHuntMode: false }, rt: { petFull: financial } });
  await f.enable();
  const configBefore = copy(f.env.cfg), stateBefore = copy(f.env.rt.petFull);
  f.env.cfg.petFullAuto = false;
  f.env.cfg.petBuffAuto = false;
  f.reload();
  f.ch.revision++;
  await f.enable();
  assert.deepEqual(copy(f.env.cfg), configBefore, 'изменяются только два флага');
  assert.deepEqual(copy(f.env.rt.petFull), stateBefore, 'финансовая память не меняется');
  assert.equal(f.cfgWrites.length, 2);
  assert.equal(f.calls.length, 0);
  assert.equal(f.gets.length, 0, 'достаточно уже полученного снимка класса');
});

test('настоящий taskConfig: список из TXT включает petbuff вместе с обоими флагами одной записью', async () => {
  const f = setupTasks({ cfg: { petFullAuto: false, petBuffAuto: false } });
  assert.equal(f.env.cfg.petFullAuto, false);
  assert.equal(engine.taskAllowed(f.env.cfg, 'petbuff'), false);
  await f.enable();
  assert.deepEqual(f.cfgWrites, [{ petFullAuto: true, petBuffAuto: true, autoTasks: [...loggedTasks, 'petbuff'] }]);
  assert.equal(f.raw().petFullAuto, true);
  assert.equal(f.env.cfg.petFullAuto, true, 'эффективная настройка тоже включена');
  assert.equal(f.env.cfg.petBuffAuto, true);
  assert.equal(engine.taskAllowed(f.env.cfg, 'petbuff'), true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.gets.length, 0);
});

test('настоящий taskConfig: raw ON без petbuff после включения перестаёт порождать записи на каждом GET', async () => {
  const f = setupTasks();
  assert.equal(f.raw().petFullAuto, true);
  assert.equal(f.env.cfg.petFullAuto, false, 'до добавления задачи proxy маскирует raw ON');
  await f.enable();
  for (let n = 0; n < 5; n++) { f.ch.revision++; await f.enable(); }
  assert.equal(f.cfgWrites.length, 1);
  assert.equal(f.logs.length, 1);
  assert.equal(f.env.cfg.petFullAuto, true);
  assert.equal(f.env.cfg.autoTasks.filter(k => k === 'petbuff').length, 1);
  assert.equal(f.calls.length, 0);
});

test('plain cfg: подтверждённый marker и оба ON тоже требуют недостающую задачу petbuff', async () => {
  const f = setup({ cfg: { autoTasks: [...loggedTasks] }, rt: {
    petClassEntry: { char: 'hero', key: '0:warlock', kick: 0, revision: 100 }
  } });
  await f.enable();
  assert.deepEqual(f.cfgWrites, [{ petFullAuto: true, petBuffAuto: true, autoTasks: [...loggedTasks, 'petbuff'] }]);
  await f.enable();
  assert.equal(f.cfgWrites.length, 1);
});

test('настоящий taskConfig: удалённая задача petbuff возвращается на том же котоводе', async () => {
  const f = setupTasks();
  await f.enable();
  f.changeRaw({ autoTasks: [...loggedTasks] });
  assert.equal(f.env.cfg.petFullAuto, false);
  f.ch.revision++;
  await f.enable();
  assert.deepEqual(f.env.cfg.autoTasks, [...loggedTasks, 'petbuff']);
  assert.equal(f.env.cfg.petFullAuto, true);
  assert.equal(f.cfgWrites.length, 2);
  await f.enable();
  assert.equal(f.cfgWrites.length, 2);
  assert.equal(f.calls.length, 0);
});

test('legacy без autoTasks включает только флаги и не создаёт явный список задач', async () => {
  const f = setupTasks({ cfg: { autoTasks: undefined, petFullAuto: false, petBuffAuto: false } });
  assert.equal(f.env.cfg.autoTasks, undefined);
  await f.enable();
  assert.deepEqual(f.cfgWrites, [{ petFullAuto: true, petBuffAuto: true }]);
  assert.equal(f.env.cfg.autoTasks, undefined);
  assert.equal(engine.taskList(f.env.cfg), null);
  assert.equal(f.env.cfg.petFullAuto, true);
});

test('настоящий taskConfig: добавление petbuff сохраняет порядок, прочие задачи, режим и финансовую память', async () => {
  const financial = { spent: 12000000, budgetEpoch: 4, unknownReserved: 10000000,
    pending: { id: 'task-pending', phase: 'sent', price: 10000000 } };
  const original = ['pvp', 'raid', 'fish', 'resources', 'tvt', 'quests'];
  const f = setupTasks({ cfg: { autoTasks: original, petFullBudget: 43000000, petFullMaxPrice: 8000000,
    petFullReserve: 600000, fishMode: true, rbHuntMode: true }, rt: { petFull: financial } });
  const configBefore = copy(f.raw()), stateBefore = copy(f.env.rt.petFull);
  const primaryBefore = engine.selectedTask(f.env.cfg, f.env.rt);
  await f.enable();
  const after = copy(f.raw());
  assert.deepEqual(after, { ...configBefore, autoTasks: [...original, 'petbuff'] });
  assert.deepEqual(copy(f.env.rt.petFull), stateBefore);
  assert.equal(engine.selectedTask(f.env.cfg, f.env.rt), primaryBefore);
  assert.deepEqual(original, ['pvp', 'raid', 'fish', 'resources', 'tvt', 'quests'], 'исходный массив не меняется');
  assert.equal(f.calls.length, 0);
});

test('настоящий taskConfig: другой саб с котом на портрете не добавляет petbuff', async () => {
  const f = setupTasks({ char: { l2Profession: 'human_warlord', portraitProfession: 'human_arcana_lord' } });
  const before = copy(f.raw());
  await f.enable();
  f.ch.revision++;
  await f.enable();
  assert.deepEqual(copy(f.raw()), before);
  assert.equal(f.cfgWrites.length, 0);
  assert.equal(engine.taskAllowed(f.env.cfg, 'petbuff'), false);
});

test('настоящий taskConfig: reload восстанавливает удалённую задачу, последующий reload не повторяет запись', async () => {
  const f = setupTasks();
  await f.enable();
  f.changeRaw({ autoTasks: [...loggedTasks], petFullAuto: false, petBuffAuto: false });
  f.reload();
  f.ch.revision++;
  await f.enable();
  assert.equal(engine.taskAllowed(f.env.cfg, 'petbuff'), true);
  assert.equal(f.env.cfg.petFullAuto, true);
  assert.equal(f.env.cfg.petBuffAuto, true);
  assert.equal(f.cfgWrites.length, 2);
  f.reload();
  f.ch.revision++;
  await f.enable();
  assert.equal(f.cfgWrites.length, 2);
  assert.equal(f.calls.length, 0);
});
