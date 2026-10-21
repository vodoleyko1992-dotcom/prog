'use strict';
// 20.43 (автономность, доводка 21.10, ревью): сторож вкладки «нет прогресса 9 мин» и эпик на передышке. В доводке маршруты задачи на
// передышке убрали из «работы» (taskJobHeld), а состояние эпика rt.epic осталось: в режиме задач [epic] передышка (epicMap на шаге go, stall на
// шаге fight) пропускает эпика в выборе, бот стоит в tasksIdle, rt.epic.step никто не меняет — сторож видел работу с неизменной подписью:
// перезагрузка и «нет прогресса 9 мин … попытка N/3» каждые 9 мин передышки, stallRecoveries копились. Теперь rt.epic — работа, только пока
// режим эпиков выбран (autonomyMode() === 'epic'). Здесь — настоящий loopWatchdog из content.js и настоящий сторож прогресса из engine-core.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const MIN = 60000;

function box({ tasks = ['epic'], hold = null, epic = { step: 'fight', k: 'core' }, holdWait = false, mode = 'epic' } = {}) {
  let now = Date.now();   // engine-core считает передышки по своим часам — начинаем с настоящего времени, срок передышки 30 мин
  const T0 = now, reloads = [], recs = [], holds = [];
  const rt = { char: 'Hero', manualKickAt: 5, epic, stallRecoveries: [] };
  if (hold) rt.selfHold = { [hold.task || 'mode:' + hold.mode]: { kind: hold.kind, why: 'эпик стоит', at: now, until: now + 30 * MIN, n: 1, task: hold.task || null, mode: hold.mode || null, kick: 5 } };
  const D = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  const c = { L2EngineCore: E, Date: D, JSON, Object, Array, String, Number, Math, console, rt, cfg: tasks ? { autoTasks: tasks } : { epicMode: true }, LOOP: { holdWaitT: 0 }, LOOP_BREAK: 'break',
    L2V7Modules: { payments: { pending: () => false }, navigation: { travelPending: () => false } }, dailyWorkWaiting: () => false,
    autonomyMode: () => tasks ? (E.selectedTask(c.cfg, c.rt, now) || 'tasks') : mode,
    isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false, antibotState: () => null,
    selfHoldMain: () => !!c.rt.selfHold && (tasks ? false : true), meHp: () => null, mobHp: () => null,
    location: { pathname: '/map.html', search: '', reload: () => reloads.push(now) }, progressMonitor: E.createProgressMonitor(() => now),
    serverDown: () => false, automationSnapshot: () => 1, automationCurrent: () => true, automationFlush: async () => true, srvUp: async () => true,
    netOutage: {}, serverWait: async () => {}, rec: (...a) => recs.push(a[2]), sleep: async () => {},
    setRt: async p => { Object.assign(c.rt, JSON.parse(JSON.stringify(p))); return { ok: true }; },
    selfHoldStart: async (kind, why) => { holds.push(kind); return 'hold'; } };
  vm.createContext(c);
  vm.runInContext(slice(content, 'async function loopWatchdog() {', '\n}\n') + '\n}\nthis.wd=loopWatchdog;', c);
  // круг главного цикла раз в 3 с; без списка задач ожидание передышки (loopSelfHoldWait) отмечает LOOP.holdWaitT
  const run = async ms => { for (const end = now + ms; now < end; now += 3000) { if (holdWait) c.LOOP.holdWaitT = now; await c.wd(); } };
  return { c, reloads, recs, holds, run, elapsed: () => now - T0 };
}

test('[epic]: stall-передышка эпика на шаге fight — 0 перезагрузок и 0 «нет прогресса» за 20 мин', async () => {
  const f = box({ hold: { kind: 'stall', task: 'epic' }, epic: { step: 'fight', k: 'core' } });
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'tasks', 'эпик на передышке пропущен выбором');
  await f.run(20 * MIN);
  assert.deepEqual(f.reloads, []); assert.equal(f.recs.filter(x => /нет прогресса 9 мин/.test(x)).length, 0); assert.deepEqual([...f.c.rt.stallRecoveries], []);
});

test('[epic]: передышка epicMap на шаге go — тоже без перезагрузок; [epic, cat] на передышке эпика — то же', async () => {
  const f = box({ hold: { kind: 'epicMap', task: 'epic' }, epic: { step: 'go', k: 'core' } });
  await f.run(20 * MIN); assert.deepEqual(f.reloads, []);
  const g = box({ tasks: ['epic', 'cat'], hold: { kind: 'epicMap', task: 'epic' }, epic: { step: 'arrive', k: 'core' } });
  await g.run(20 * MIN); assert.deepEqual(g.reloads, [], 'катакомбы стоят по своим причинам — это не работа эпика');
});

test('эпик выбран и стоит без передышки — сторож по-прежнему видит: перезагрузка через 9 мин', async () => {
  const f = box({ epic: { step: 'fight', k: 'core' } });
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'epic');
  await f.run(10 * MIN);
  assert.equal(f.reloads.length, 1); assert.match(f.recs[0], /нет прогресса 9 мин: \/map\.html, режим epic, попытка 1\/3/);
});

test('без списка задач: передышка режима эпиков ждёт в loopSelfHoldWait — без перезагрузок; без ожидания сторож видит эпика', async () => {
  const f = box({ tasks: null, hold: { kind: 'stall', mode: 'epic' }, holdWait: true });
  await f.run(20 * MIN); assert.deepEqual(f.reloads, []);
  const g = box({ tasks: null, epic: { step: 'go', k: 'core' } });
  await g.run(10 * MIN); assert.equal(g.reloads.length, 1, 'режим эпиков стоит на дороге 9 мин — прежнее восстановление');
});

test('оставшийся rt.epic при выключенных эпиках (другой режим) — не работа', async () => {
  const f = box({ tasks: ['cat'], epic: { step: 'go', k: 'core' } });
  await f.run(20 * MIN); assert.deepEqual(f.reloads, []);
  const g = box({ tasks: null, mode: 'farm', epic: { step: 'fight', k: 'core' } });
  await g.run(20 * MIN); assert.deepEqual(g.reloads, []);
});
