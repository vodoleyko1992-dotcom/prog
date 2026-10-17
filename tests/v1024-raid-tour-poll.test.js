'use strict';
// Лог15.10 18:59: пустая очередь тура перечитывает своё окно без полного скана и переходов.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../modules/rbtimer.js'), 'utf8');
const START = Date.UTC(2026, 9, 15, 8, 59), MIN = 60000;
const clone = value => JSON.parse(JSON.stringify(value));
const boss = (id, lvl = 69, alive = true) => ({ spawnId: id, name: id, level: lvl, bossType: 'raid', isAlive: alive, adenaCost: 100000, canAttack: true });
const row = (lvl = 69, page = 10, alive = false) => ({ name: 'Boss', lvl, page, alive, price: 100000, unit: 'аден', t: START - 3 * MIN });
const page = (p, bosses = [boss('boss')]) => ({ page: p, totalPages: p, bosses });
function fixture(options = {}) {
  let now = options.now ?? START, active = true;
  const storage = options.storage || new Map(), gets = [], writes = [], logs = [];
  const sandbox = { Date: class extends Date { static now() { return now; } }, console,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const env = { cfg: { rbTimers: false, rbTimerMin: 10, rbMaxBelow: 9, rbMaxAbove: 15, ...options.cfg },
    rt: { lvl: 77, rbListT: START - 3 * MIN, rbList: { boss: row() },
      rbTimer: { b: { boss: { n: 'Boss', l: 69, al: false, dh: START - 3 * 3600000, ls: START - 3 * MIN } }, pg: {} }, ...clone(options.rt || {}) },
    RB_WIN: 15, heroLevel: () => options.level ?? env.rt.lvl,
    rec: (...args) => logs.push(args), sleep: async () => {},
    setRt: async patch => { writes.push(clone(patch)); Object.assign(env.rt, patch); options.onWrite?.(patch); },
    gameGet: async url => { gets.push(url); return options.get ? options.get(url) : { ok: true, json: async () => page(+new URL(url, 'https://fixture.invalid').searchParams.get('page')) }; } };
  const T = sandbox.L2V7Factories.rbtimer(env);
  return { T, env, gets, writes, logs, storage, active: () => active, stop: () => { active = false; }, advance: ms => { now += ms; } };
}

test('живой ответ обновляет очередь и таймер, даже когда общие таймеры выключены', async () => {
  const f = fixture(), oldListT = f.env.rt.rbListT;
  assert.equal(await f.T.tick(), false);
  assert.equal(await f.T.tourTick({ active: f.active }), true);
  assert.deepEqual(f.gets, ['/game/raid-bosses?page=10']);
  assert.equal(f.env.rt.rbList.boss.alive, true);
  assert.equal(f.env.rt.rbList.boss.t, START);
  assert.equal(f.env.rt.rbTimer.b.boss.al, true);
  assert.deepEqual(Array.from(f.T.revivedSince(START - MIN)), ['boss']);
  assert.equal(f.env.rt.rbListT, oldListT, 'частичная проверка не объявлена полным сканированием');
});

test('мёртвый ответ снимает устаревшее alive без удаления других строк', async () => {
  const f = fixture({ rt: { rbList: { boss: row(69, 10, true), untouched: row(75, 11, true) } },
    get: async url => ({ ok: true, json: async () => page(+url.split('=').pop(), [boss('boss', 69, false)]) }) });
  assert.equal(await f.T.tourTick({ active: f.active }), true);
  assert.equal(f.env.rt.rbList.boss.alive, false);
  assert.equal(f.env.rt.rbList.untouched.alive, true);
});

for (const route of ['tourTick', 'listNote']) test(`${route}: отставший alive после убийства не воскрешает очередь раньше таймера`, async () => {
  const f = fixture({ rt: { rbTimer: { b: { boss: { n: 'Boss', l: 69, al: false, dh: START, dl: START, k: START, ls: START } }, pg: {} } } });
  const refresh = () => route === 'tourTick' ? f.T.tourTick({ active: f.active }) : f.T.listNote(page(10), 'страница');
  await refresh();
  assert.equal(f.env.rt.rbList.boss.alive, false);
  assert.equal(f.env.rt.rbList.boss.status, 'Убит');
  assert.equal(f.env.rt.rbTimer.b.boss.al, false);
  assert.deepEqual(Array.from(f.T.revivedSince(START - MIN)), []);
  f.advance(10 * MIN - 1);
  await refresh();
  assert.equal(f.env.rt.rbList.boss.alive, false);
  f.advance(30000);
  await refresh();
  assert.equal(f.env.rt.rbList.boss.alive, true, 'после защитного окна свежий alive принят');
  assert.equal(f.env.rt.rbTimer.b.boss.al, true);
});

test('границы окна включены, страницы дедуплицируются и внутренние страницы не пропущены', async () => {
  const f = fixture({ rt: { rbList: {
    below: row(67, 9), lower: row(68, '10'), same: row('68', 10), next: row(72, 11),
    middle: row(80, 13), upper: row(92, 14), above: row(93, 15), invalid: row(75, 0), fraction: row(75, 11.5), absent: null
  } } });
  // 20.13 (ревизия 17.10, шаг 5, TM-1): окно страниц прежнее, но за один опрос — не больше 2 страниц, остальные по кругу
  assert.deepEqual(Array.from(f.T.tourPages()), [10, 11, 12, 13, 14]);
  assert.equal(await f.T.tourTick({ active: f.active }), true);
  assert.equal(f.gets.length, 2);
  for (let i = 0; i < 6; i++) { f.advance(30000); await f.T.tourTick({ active: f.active }); }
  assert.deepEqual([...new Set(f.gets)].sort(), [10, 11, 12, 13, 14].map(p => '/game/raid-bosses?page=' + p).sort(), 'за несколько опросов пройдены все страницы окна');
});

test('настройки окна тура уже стандартного ±15 ограничивают страницы', async () => {
  const f = fixture({ cfg: { rbMaxBelow: 3, rbMaxAbove: 0 }, rt: { rbList: {
    below: row(73, 10), lower: row(74, 11), equal: row(77, 12), above: row(78, 13)
  } } });
  assert.equal(await f.T.tourTick({ active: f.active }), true);
  assert.deepEqual(f.gets, [11, 12].map(p => '/game/raid-bosses?page=' + p));
});

test('без страниц в rbList используется пересечение диапазонов rbTimer.pg', async () => {
  const f = fixture({ rt: { rbList: {}, rbTimer: { b: {}, pg: { 8: [50, 67], 9: [67, 68], 11: [72, 92], 12: [93, 99], bad: [68, 92] } } } });
  assert.deepEqual(Array.from(f.T.tourPages()), [9, 10, 11]);
  assert.equal(await f.T.tourTick({ active: f.active }), true);
  assert.equal(f.gets.length, 2);
});

test('неизвестные страницы и уровень не запускают полный скан и не расходуют cooldown', async () => {
  for (const options of [{ rt: { rbList: {}, rbTimer: { b: {}, pg: {} } } }, { level: 0, rt: { lvl: 0 } }]) {
    const f = fixture(options);
    assert.equal(await f.T.tourTick({ active: f.active }), false);
    assert.deepEqual(f.gets, []);
    assert.equal(f.storage.has('l2bot-rbtTourT'), false);
  }
});

for (const failure of ['http', 'fetch', 'json', 'schema', 'wrong-page', 'empty']) test(`ошибка ${failure}: прежняя память сохранена, повтор только через30с`, async () => {
  const f = fixture({ get: async () => {
    if (failure === 'fetch') throw Error('network');
    return { ok: failure !== 'http', json: async () => {
      if (failure === 'json') throw Error('bad JSON');
      return failure === 'schema' ? { page: 10, bosses: {} } : failure === 'wrong-page' ? page(11) : failure === 'empty' ? page(10, []) : page(10);
    } };
  } }), before = clone(f.env.rt);
  assert.equal(await f.T.tourTick({ active: f.active }), false);
  assert.deepEqual(f.env.rt, before);
  assert.deepEqual(f.writes, []);
  assert.equal(f.storage.get('l2bot-rbtTourT'), String(START));
  assert.equal(await f.T.tourTick({ active: f.active }), false);
  assert.equal(f.gets.length, 1);
  f.advance(30000);
  await f.T.tourTick({ active: f.active });
  assert.equal(f.gets.length, 2);
});

test('ошибка первой страницы не стирает её и не блокирует обновление второй', async () => {
  const f = fixture({ rt: { rbList: { first: row(69, 10), second: row(74, 11) } }, get: async url => url.endsWith('=10')
    ? { ok: false } : { ok: true, json: async () => page(11, [boss('second', 74)]) } });
  const before = clone(f.env.rt.rbList.first);
  assert.equal(await f.T.tourTick({ active: f.active }), true);
  assert.deepEqual(f.env.rt.rbList.first, before);
  assert.equal(f.env.rt.rbList.second.alive, true);
});

test('cooldown30с сохраняется после reload независимо от обычного опроса', async () => {
  const storage = new Map([['l2bot-rbtT', String(START)]]), f = fixture({ storage });
  assert.equal(await f.T.tourTick({ active: f.active }), true);
  const reload = fixture({ storage, now: START + 29999 });
  assert.equal(await reload.T.tourTick({ active: reload.active }), false);
  assert.deepEqual(reload.gets, []);
  reload.advance(1);
  assert.equal(await reload.T.tourTick({ active: reload.active }), true);
  assert.equal(storage.get('l2bot-rbtT'), String(START), 'тур не переносит общий десятиминутный опрос');
});

test('Stop до начала не делает GET и не расходует cooldown', async () => {
  const f = fixture(); f.stop();
  assert.equal(await f.T.tourTick({ active: f.active }), false);
  assert.deepEqual(f.gets, []);
  assert.equal(f.storage.has('l2bot-rbtTourT'), false);
  assert.equal(await f.T.tourTick(), false, 'без проверки активности опрос запрещён');
});

test('Stop во время GET отменяет чтение JSON и публикацию старого результата', async () => {
  let resolve, jsonCalls = 0;
  const gate = new Promise(r => { resolve = r; });
  const f = fixture({ get: async () => { await gate; return { ok: true, json: async () => { jsonCalls++; return page(10); } }; } });
  const run = f.T.tourTick({ active: f.active });
  f.stop(); resolve();
  assert.equal(await run, false);
  assert.equal(jsonCalls, 0);
  assert.deepEqual(f.writes, []);
});

test('смена контекста во время JSON не публикует alive прежнего режима', async () => {
  let resolve, enter, context = 'raid';
  const gate = new Promise(r => { resolve = r; });
  const entered = new Promise(r => { enter = r; });
  const f = fixture({ get: async () => ({ ok: true, json: async () => { enter(); await gate; return page(10); } }) });
  const run = f.T.tourTick({ active: () => context === 'raid' });
  await entered;
  context = 'tasks'; resolve();
  assert.equal(await run, false);
  assert.deepEqual(f.writes, []);
});

test('прерывание после первой записи не запускает следующую страницу', async () => {
  let active = true;
  const f = fixture({ rt: { rbList: { first: row(69, 10), second: row(74, 11) } }, onWrite: () => { active = false; } });
  assert.equal(await f.T.tourTick({ active: () => active }), true);
  assert.deepEqual(f.gets, ['/game/raid-bosses?page=10']);
  assert.equal(f.env.rt.rbList.second.alive, false);
});

test('обычный tick и tourTick используют один busy без параллельных запросов', async () => {
  let resolve;
  const gate = new Promise(r => { resolve = r; });
  const f = fixture({ cfg: { rbTimers: true }, get: async url => { await gate; return { ok: true, json: async () => url.includes('epic') ? { bosses: [] } : page(10) }; } });
  const run = f.T.tourTick({ active: f.active });
  assert.equal(await f.T.tick(), false);
  assert.equal(await f.T.tourTick({ active: f.active }), false);
  assert.equal(f.gets.length, 1);
  resolve(); assert.equal(await run, true);
  assert.equal(await f.T.tick(), false, '15.10: фоновый мониторинг отключён и после тура');
});

test('15.10: выключенный фоновый tick не мешает чтению целей активного тура', async () => {
  const f = fixture({ cfg: { rbTimers: true } });
  assert.equal(await f.T.tick(), false);
  assert.equal(f.gets.length, 0);
  assert.equal(f.storage.has('l2bot-rbtTourT'), false);
  assert.equal(await f.T.tourTick({ active: f.active }), true);
});
